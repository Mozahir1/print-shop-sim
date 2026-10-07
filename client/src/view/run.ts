// The controller: the day (start, play, end), the clock, and everything you do. Scenes and overlays read from here
// and call into it; the sim stays the source of truth.
import { abandonWorkflow, begin, canGoHome, canStart, cashGiven, currentCustomer, goHome, isDayOver, previewTask, startTask, tick, workLeft, type Sim } from "../sim/sim";
import { endDay, loadGame, newGame, saveGame, startDay, type Game } from "../sim/game";
import { report, summarize } from "../sim/summary";
import { botAct, createBot, type Bot, type BotStyle } from "../sim/bot";
import { devEvent, devSpawn, setArrivals, skipTo, skipToClose, type SkipTo } from "../sim/dev";
import { activeCount, choreNow, suggested, todoList } from "../sim/todo";
import { currentStep, isChoice, isCurrentStep, STEP, WORKFLOWS, type Hand } from "../sim/workflow";
import { requestLines } from "../sim/dialogue";
import { MACHINE_LABEL, machineFor, shipQuote } from "../sim/orders";
import { customerById, jobById, packageById } from "../sim/util";
import { CLOCK, CLOSING } from "../sim/config";
import type { BoxSize, EventKind, GameState, ShipService, TaskRequest } from "../sim/types";
import { getLeaderboard, postShift } from "../api";
import * as html from "../ui/view";
import type { Tab } from "../ui/view";
import { toast } from "./hud";
import type { App } from "../ui/computer";
import type { SPAWN_KINDS } from "../ui/dev";
import { HOLD_MS, LINE_MS, MAX_TAPS, SPEEDS } from "./config";
import { clockRate, isQuiet } from "../sim/clock";

const SAVE_KEY = "printshop.save";
const NAME_KEY = "printshop.name";
const params = new URLSearchParams(location.search);
export const devEnabled = import.meta.env.DEV || params.has("dev");
const seedParam = devEnabled && params.get("seed") ? Number(params.get("seed")) : null;

// A step you're doing by hand: its parts (from the step data), the one you're on, and what you've done so far.
export interface Doing {
  key: string;
  req: TaskRequest;
  parts: Hand[];
  i: number;
  count: number; // taps so far
  held: number; // ms held so far (letting go pauses it)
  typed: string; // keypad
}

// Something you've picked up: the scene object it is (a step's "drag" ref), what it looks like, and where it's from.
export interface Carry {
  ref: string;
  texture: string;
  tab: Tab;
}

export const ctl = {
  game: null as Game | null,
  sim: null as Sim | null,
  bot: null as Bot | null,
  speed: SPEEDS[0],
  paused: true,
  screen: "start" as "start" | "report" | "ending" | null,
  tab: "counter" as Tab,
  doing: null as Doing | null,
  talk: { id: -1, n: 0, at: 0 }, // the customer talking, and how many lines they've said
  followed: "", // the step the view last moved to
  confirming: null as { key: string; until: number } | null,
  note: null as number | null, // the sticky note you've unfolded (its order); the clock waits while you read it
  carry: null as Carry | null, // what you've picked up for the part you're on, until you put it where it goes
  app: "orders" as App, // the computer app on the monitor
  mail: null as number | null, // the email you've opened
  webForm: null as number | null, // the web order whose form you've brought up (from its email)
  tip: (msg: string) => toast(msg),
};
const confirmedOnce = new Set<string>();

export function state(): GameState {
  return ctl.sim!.state;
}

// ---------- storage (fails soft) ----------

function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* the game still works, it just won't remember */
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// ---------- screens and days ----------

const $ = (id: string) => document.getElementById(id)!;

function showScreen(kind: typeof ctl.screen, body: string): void {
  ctl.screen = kind;
  ctl.paused = true;
  $("screenBody").innerHTML = body;
}

export function showStart(): void {
  showScreen("start", html.startScreen(loadGame(read(SAVE_KEY)), read(NAME_KEY) ?? ""));
}

function startGame(g: Game): void {
  const name = ($("name") as HTMLInputElement | null)?.value.trim();
  if (name !== undefined) store(NAME_KEY, name);
  ctl.game = g;
  store(SAVE_KEY, saveGame(g));
  playDay();
}

function playDay(): void {
  const sim = startDay(ctl.game!);
  if (seedParam !== null) sim.state.devUsed = true;
  sim.state.handsOn = true; // you do every step by hand
  Object.assign(window, { sim, game: ctl.game, ctl }); // (for the console)
  Object.assign(ctl, { sim, tab: "counter", doing: null, followed: "", talk: { id: -1, n: 0, at: 0 }, screen: null, paused: false, note: null, app: "orders", mail: null, webForm: null });
}

async function finishDay(): Promise<void> {
  const s = state();
  const result = endDay(ctl.game!, ctl.sim!);
  store(SAVE_KEY, saveGame(ctl.game!));
  if (ctl.game!.fired) {
    store(SAVE_KEY, null);
    return showScreen("ending", html.endingScreen(ctl.game!.ending!, result.day));
  }
  const canPost = !s.devUsed && !ctl.bot;
  showScreen("report", html.reportScreen(report(s, result), canPost ? "Saving to the leaderboard..." : "Dev tools were used today, so it isn't saved to the leaderboard."));
  if (!canPost) return;
  const note = await postShift(summarize(s, read(NAME_KEY) || "Anonymous", "human")).then(
    () => "Saved to the leaderboard.",
    () => "Couldn't reach the server, so it isn't on the leaderboard. The game is saved either way.",
  );
  if (ctl.screen !== "report") return;
  $("posted").textContent = note;
  const rows = await getLeaderboard().catch(() => []);
  if (ctl.screen === "report") $("board").innerHTML = html.leaderboard(rows);
}

// ---------- the clock ----------

// Called every frame by the UI scene. The sim always steps one game minute at a time (so a seed plays the same
// anywhere); how many minutes pass per real second depends on the speed and on what's going on.
let acc = 0;
export function frame(dtMs: number): void {
  if (ctl.paused || !ctl.sim || ctl.screen || ctl.note !== null) return;
  const s = state();
  acc += (Math.min(dtMs, 1000) / 1000) * (ctl.bot ? ctl.speed * (s.time >= s.closeAt ? CLOSING.overtimeSpeed : 1) * (isQuiet(s) ? CLOCK.quiet : 1) : clockRate(s, ctl.speed));
  for (let n = 0; acc >= 1 && n < 600 && !isDayOver(s); n++) {
    if (ctl.bot) botAct(ctl.bot, s, 1);
    tick(ctl.sim, 1);
    acc -= 1;
  }
  follow();
  if (isDayOver(s)) {
    acc = 0;
    void finishDay();
  }
}

export const quiet = isQuiet;

// The dialogue comes out a line at a time; the view goes where the next step is; a step done by hand with nothing to
// choose gets started.
function follow(): void {
  const s = state();
  const now = performance.now();
  const front = currentCustomer(s);
  if (front?.state === "talking") {
    if (ctl.talk.id !== front.id) ctl.talk = { id: front.id, n: 1, at: now };
    else if (now - ctl.talk.at > LINE_MS && ctl.talk.n < requestLines(s, front).length) ctl.talk = { ...ctl.talk, n: ctl.talk.n + 1, at: now };
  }
  const step = currentStep(s);
  const key = step && !s.employee.task ? stepKey(step.req) : "";
  if (key && key !== ctl.followed) {
    ctl.followed = key;
    ctl.tab = html.tabOf(step!.type);
    if (!ctl.bot && hands(step!.req) && !step!.alts.length && ctl.doing?.key !== key) ctl.doing = startDoing(step!.req);
  }
  if (ctl.doing && (s.employee.task || !s.workflow || !isCurrentStep(s, ctl.doing.req))) ctl.doing = null; // done, or moot
  if (!ctl.doing) ctl.carry = null;
}

export function stepKey(req: TaskRequest): string {
  return [req.type, req.customerId, req.jobId, req.packageId, req.messageId].join(":");
}

// ---------- doing things ----------

export function hands(req: TaskRequest): boolean {
  return (STEP[req.type].hands?.length ?? 0) > 0;
}

function startDoing(req: TaskRequest): Doing {
  return { key: stepKey(req), req: { ...req }, parts: STEP[req.type].hands ?? [], i: 0, count: 0, held: 0, typed: "" };
}

// The part you're on, with finishing turned into what it is for this job: a tap per set for a small stapled run, a
// hold on the right tool otherwise.
export function part(d: Doing): Hand {
  const p = d.parts[d.i];
  if (!p.finish) return p;
  const spec = jobById(state(), d.req.jobId!)!.spec;
  if (spec.finishing === "staple" && spec.copies <= MAX_TAPS) return { tap: "finishing/set", n: spec.copies, say: "Staple each set" };
  const tool = { staple: "stapler", cut: "cutter", laminate: "laminator", none: "" }[spec.finishing];
  return { hold: `finishing/${tool}`, on: "finishing/stack", say: `Hold the ${tool} on the stack` };
}

// What to do right now for the part you're on ("Put it in the tray", "Pull out the jammed sheets (3 left)").
export function sayNow(d: Doing): string {
  const p = part(d);
  if (p.form) return "Fill in the form";
  if (p.pay) return "Type it on the register";
  const left = (p.n ?? 1) - d.count;
  const job = d.req.jobId !== undefined ? jobById(state(), d.req.jobId) : undefined;
  const raw = (p.drag && ctl.carry ? p.put : p.say) ?? hintOf(d.req);
  const text = job && machineFor(job.spec) === "wide" ? raw.replace("the stack", "the rolled-up print") : raw; // (a large print isn't a stack)
  return p.tap && (p.n ?? 1) > 1 ? `${text} (${left} left)` : text;
}

// What to do next, for the top bar: the step you're on (and how to do it by hand), and where.
export function nextHint(): { text: string; tab: Tab } | null {
  const s = state();
  const d = ctl.doing;
  // The truck's here while you're on a job: hand off first (it won't wait all day), then back to it.
  const chore = !ctl.carry && !s.employee.task ? choreNow(s) : undefined;
  if (chore?.req.type === "hand_off" && s.workflow) return { text: `The truck is here. Hand off, then back to ${WORKFLOWS[s.workflow.kind].label.toLowerCase()}`, tab: "shipping" };
  if (d) return { text: sayNow(d), tab: html.tabOf(d.req.type) };
  if (s.employee.task) return null;
  const step = currentStep(s);
  if (step) {
    const who = customerById(s, step.req.customerId ?? -1);
    if (step.type === "talk" || step.type === "respond") return { text: who ? `${step.type === "talk" ? "Talk to" : "Answer"} ${who.name}` : hintOf(step.req), tab: "counter" };
    return { text: hintOf(step.req), tab: html.tabOf(step.type) };
  }
  const front = currentCustomer(s);
  if (front?.state === "line") return { text: `${front.name} is waiting`, tab: "counter" };
  if (s.workflow) return null;
  // Free: the first thing on the to-do list (what Enter would start).
  const top = suggested(todoList(s))[0];
  return top ? { text: top.text, tab: html.tabOf(top.req.type) } : null;
}

export function hintOf(req: TaskRequest): string {
  const fin = req.jobId !== undefined ? jobById(state(), req.jobId)?.spec.finishing : undefined;
  const job = req.jobId !== undefined ? jobById(state(), req.jobId) : undefined;
  return STEP[req.type].hint.replace("{finishing}", fin && fin !== "none" ? `${fin[0].toUpperCase()}${fin.slice(1)} it` : "Finish it").replace("{machine}", MACHINE_LABEL[job ? machineFor(job.spec) : "printer"]);
}

function needsConfirm(key: string): boolean {
  if (confirmedOnce.has(key)) return false;
  if (ctl.confirming?.key === key && performance.now() < ctl.confirming.until) {
    confirmedOnce.add(key);
    ctl.confirming = null;
    return false;
  }
  ctl.confirming = { key, until: performance.now() + 4000 };
  ctl.tip(key === "turn_away" ? "Turning them away. Again to confirm." : key === "abandon" ? "Walking away counts as ignoring it. Again to confirm." : "There's still work to do. Again to go home anyway.");
  return true;
}

// Starts something. A step done by hand starts its hands-on part instead (the task runs once you've done it).
export function doTask(req: TaskRequest): void {
  const s = state();
  if (req.choice === "turn_away" && needsConfirm("turn_away")) return;
  const was = s.workflow;
  // (Putting a job down for a quick chore: you'll go back to it.)
  const putDown = () => (s.setAside && s.setAside === was ? ` Then back to ${WORKFLOWS[was.kind].label.toLowerCase()}.` : "");
  if (hands(req) && !ctl.bot) {
    const err = begin(s, req);
    if (err) return ctl.tip(err);
    if (!isCurrentStep(s, req)) return ctl.tip("Do the step you're on first.");
    ctl.doing = startDoing(req);
    ctl.followed = stepKey(currentStep(s)!.req);
    ctl.tab = html.tabOf(req.type);
    if (putDown()) ctl.tip(`${previewTask(s, req).label}.${putDown()}`);
    return;
  }
  const label = req.type === "respond" ? null : previewTask(s, req).label;
  const err = startTask(s, req);
  if (err) ctl.tip(err);
  else if (label) ctl.tip(`${label}${putDown() ? `.${putDown()}` : ""}`);
  if (req.type === "ask_again") ctl.talk = { id: req.customerId!, n: 0, at: performance.now() }; // from the top
}

// The part's done: on to the next, or do the step with what you did. Returns an error, or null.
export function nextPart(): string | null {
  const d = ctl.doing;
  if (!d) return null;
  d.i++;
  d.count = d.held = 0;
  ctl.carry = null;
  d.typed = "";
  if (d.i < d.parts.length) return null;
  ctl.doing = null;
  const err = startTask(state(), d.req);
  if (err) ctl.tip(err);
  return err;
}

// Each kind of hand action. They return why not (shown on the spot), or null.
export function tapped(): boolean {
  const d = ctl.doing!;
  d.count++;
  if (d.count < (part(d).n ?? 1)) return false;
  nextPart();
  return true;
}

export function holding(ms: number): boolean {
  const d = ctl.doing!;
  d.held += ms;
  if (d.held < HOLD_MS) return false;
  nextPart();
  return true;
}

export function picked(value: string | number): string | null {
  const d = ctl.doing!;
  const p = part(d);
  if (p.pick === "box") {
    const err = canStart(state(), { ...d.req, box: value as BoxSize }); // it has to fit
    if (err) return err;
    d.req.box = value as BoxSize;
  }
  if (p.pick === "bag") d.req.jobId = Number(value);
  if (p.pick === "package" && Number(value) !== customerById(state(), d.req.customerId!)?.packageId) return "That's not theirs.";
  nextPart();
  return null;
}

export function formDone(form: HTMLFormElement): string | null {
  const d = ctl.doing!;
  const get = (name: string) => (form.elements.namedItem(name) as RadioNodeList | HTMLInputElement | null)?.value ?? "";
  if (part(d).form === "order") {
    const copies = Number(get("copies"));
    const [media, color, duplex, finishing] = ["media", "color", "duplex", "finishing"].map(get);
    if (!copies || !media || !color || !duplex || !finishing) return "Fill in every field.";
    d.req.entry = { copies, media: media as never, color: color as never, duplex: duplex === "true", finishing: finishing as never };
  } else {
    const weightLb = Number(get("weight"));
    const service = get("service");
    if (!weightLb || !service) return "Fill in the weight and the service.";
    d.req.shipLabel = { weightLb, service: service as ShipService };
  }
  nextPart();
  return null;
}

// The register: what's due, and what you're shown (a card, or the cash they hand you).
export function register(customerId: number): { due: number; cash: number | null } {
  const c = customerById(state(), customerId)!;
  let due = c.jobId !== null ? (jobById(state(), c.jobId)?.priceCents ?? 0) : 0;
  if (c.kind === "ship" && c.packageId !== null) {
    const p = packageById(state(), c.packageId)!;
    due = shipQuote(p.weightLb, p.service!).totalCents;
  }
  return { due, cash: c.pays === "cash" ? cashGiven(due) : null };
}

export function keypad(key: string): void {
  const d = ctl.doing;
  if (!d || !part(d).pay) return;
  if (key === "back") d.typed = d.typed.slice(0, -1);
  else if (key === "ok") {
    if (!d.typed) return ctl.tip("Type the amount.");
    const cents = Math.round(Number(d.typed) * 100);
    if (register(d.req.customerId!).cash !== null) d.req.change = cents;
    else d.req.amount = cents;
    nextPart();
  } else if (d.typed.length < 7 && !(key === "." && d.typed.includes("."))) d.typed += key;
}

// Puts what you picked up back where it came from (tap what you're holding in the top bar, or Escape).
export function putBack(): void {
  if (!ctl.carry) return;
  ctl.carry = null;
  ctl.tip("Put it back.");
}

export function abandon(): void {
  if (!ctl.sim?.state.workflow || needsConfirm("abandon")) return;
  ctl.doing = null;
  abandonWorkflow(state());
  ctl.tip("Walked away.");
}

export function home(): void {
  const err = canGoHome(state());
  if (err) return ctl.tip(err);
  if (workLeft(state()).length && needsConfirm("goHome")) return;
  goHome(state());
}

export function goTab(t: Tab): void {
  ctl.tab = t;
}

// ---------- keys ----------

// Enter: hear the rest / do the step / the next thing. X: Don't. I: Ignore. G: go home. Space: pause. 1 to 3: speed.
// Digits and the dot go to the register keypad while it's up.
function onKey(e: KeyboardEvent): void {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    const btn = (e.target as HTMLElement).closest("form")?.querySelector<HTMLElement>("[data-act=form]");
    if (e.key === "Enter" && btn) {
      e.preventDefault();
      act(btn);
    }
    return;
  }
  if (e.key === "`" && devEnabled && ctl.sim) return void ($("dev").hidden = !$("dev").hidden);
  if (ctl.screen || !ctl.sim) return;
  if (ctl.note !== null) {
    if (e.key === "Escape" || e.key === "Enter") ctl.note = null; // (nothing else while you're reading a note)
    return;
  }
  const s = state();
  const k = e.key.toLowerCase();
  if (ctl.doing && part(ctl.doing).pay && /^[0-9.]$|^backspace$|^enter$/.test(k)) return keypad(k === "backspace" ? "back" : k === "enter" ? "ok" : k);
  if (e.key === "Escape") return putBack();
  if (e.code === "Space") {
    e.preventDefault();
    ctl.paused = !ctl.paused;
  } else if (k === "enter") {
    const front = currentCustomer(s);
    if (front?.state === "talking" && ctl.talk.n < requestLines(s, front).length) return void (ctl.talk = { ...ctl.talk, n: requestLines(s, front).length });
    if (ctl.doing) return ctl.tip("Do it by hand.");
    const step = currentStep(s);
    if (step) return doTask(step.type === "respond" ? { ...step.req, choice: "take" } : step.req);
    if (front?.state === "line") return doTask({ type: "talk", customerId: front.id });
    const top = suggested(todoList(s))[0];
    if (top) doTask(top.req);
    else ctl.tip("Nothing to do right now.");
  } else if (k === "x") {
    const step = currentStep(s);
    if (step?.type === "respond") doTask({ ...step.req, choice: "turn_away" });
    else if (step && isChoice(step) && step.alts.length) doTask(step.alts[0]);
  } else if (k === "i") {
    const step = currentStep(s);
    if (step?.type === "respond") doTask({ ...step.req, choice: "ignore" });
    else if (s.workflow) abandon();
  } else if (k === "g") home();
  else if (k === "n" && devEnabled) devSkip("next");
  else if (Number(k) >= 1 && Number(k) <= SPEEDS.length) {
    ctl.speed = SPEEDS[Number(k) - 1];
    ctl.paused = false;
  }
}

// ---------- the DOM overlays' buttons (dialogue, forms, screens, dev drawer) ----------

export function act(el: HTMLElement): void {
  const d = el.dataset;
  switch (d.act) {
    case "newGame":
      return startGame(newGame(seedParam ?? Math.floor(Math.random() * 1e9)));
    case "continue":
      return startGame(loadGame(read(SAVE_KEY))!);
    case "nextDay":
      return playDay();
    case "pause":
      if (!ctl.screen) ctl.paused = !ctl.paused;
      return;
  }
  if (!ctl.sim) return;
  const s = state();
  switch (d.act) {
    case "task":
      return doTask(JSON.parse(d.req!) as TaskRequest);
    case "form": {
      const err = formDone(el.closest("form")!);
      return void (err && ctl.tip(err));
    }
    case "tab":
      ctl.note = null;
      return goTab(d.tab as Tab);
    case "note": {
      const id = Number(d.job);
      ctl.note = ctl.note === id ? null : id;
      return;
    }
    case "closeNote":
      ctl.note = null;
      return;
    case "putBack":
      return putBack();
    case "app":
      ctl.app = d.app as App;
      ctl.mail = ctl.webForm = null;
      return;
    case "mail": {
      // Opening an email reads it (a minute). A web order is read by entering it ("Enter this order").
      const id = d.msg ? Number(d.msg) : null;
      ctl.mail = id;
      ctl.webForm = null;
      const m = id !== null ? s.messages.find((x) => x.id === id) : undefined;
      if (m && !m.read && m.kind !== "web_order") doTask({ type: "open_message", messageId: m.id });
      return;
    }
    case "webForm":
      ctl.webForm = Number(d.msg);
      return;
    case "webSubmit": {
      const err = canStart(s, { type: "open_message", messageId: Number(d.msg) });
      if (err) return ctl.tip(err);
      doTask({ type: "open_message", messageId: Number(d.msg) });
      ctl.webForm = ctl.mail = null;
      ctl.app = "orders"; // (where it goes next: send it to the printer)
      return;
    }
    case "home":
      return home();
    case "abandon":
      return abandon();
    case "key":
      return keypad(d.key!);
    case "nextLine":
      ctl.talk = { ...ctl.talk, n: ctl.talk.n + 1, at: performance.now() };
      return;
    case "closeDev":
      return void ($("dev").hidden = true);
    case "bot":
      ctl.bot = d.style ? createBot(1, d.style as BotStyle, s.seed) : null;
      ctl.doing = null;
      if (ctl.bot) s.devUsed = true;
      return;
    case "skipTo":
      return devSkip(d.to as SkipTo);
    case "skipDay":
      return skipToClose(ctl.sim, ctl.bot ? () => botAct(ctl.bot!, s, 1) : undefined);
    case "arrivals":
      return setArrivals(ctl.sim, !s.director.enabled);
    case "event": {
      const err = devEvent(ctl.sim, d.kind as EventKind);
      return void (err && ctl.tip(err));
    }
    case "spawn":
      return void devSpawn(ctl.sim, d.kind as (typeof SPAWN_KINDS)[number]);
    case "speed":
      ctl.speed = Number(d.speed);
      ctl.paused = false;
      return;
    case "copyState":
      void navigator.clipboard?.writeText(JSON.stringify({ game: ctl.game, state: s }, null, 2)).then(() => ctl.tip("Copied."));
  }
}

// Dev mode: skip ahead to what matters (see skipTo in sim/dev.ts). The bot, if one's on, plays the skipped time.
function devSkip(to: SkipTo): void {
  const s = state();
  ctl.doing = null;
  ctl.carry = null;
  ctl.tip(skipTo(ctl.sim!, to, ctl.bot ? () => botAct(ctl.bot!, s, 1) : undefined));
}

export function listen(): void {
  window.addEventListener("keydown", onKey);
  // Act on pointerdown (overlays can redraw between down and up); keyboard activation still arrives as a click.
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!el) return;
    if (el.tagName === "BUTTON") e.preventDefault();
    act(el);
  });
  document.addEventListener("click", (e) => {
    if (e.detail !== 0) return;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (el) act(el);
  });
}
