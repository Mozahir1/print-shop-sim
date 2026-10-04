// The game screen: the station you're at (first person), the tabs to move between stations, your hands, and the
// sticky notes. Runs the day and turns clicks, holds, drags and keys into what you do.
import { abandonWorkflow, begin, canGoHome, canStart, currentCustomer, goHome, isDayOver, previewTask, startTask, tick, workLeft, type Sim } from "./sim/sim";
import { endDay, loadGame, newGame, saveGame, startDay, type Game } from "./sim/game";
import { report, summarize } from "./sim/summary";
import { botAct, createBot, type Bot, type BotStyle } from "./sim/bot";
import { devEvent, devSpawn, setArrivals, skipToClose } from "./sim/dev";
import { activeCount, todoList } from "./sim/todo";
import { currentStep, isChoice, isCurrentStep } from "./sim/workflow";
import { requestLines } from "./sim/dialogue";
import { CLOSING } from "./sim/config";
import type { EventKind, TaskRequest } from "./sim/types";
import { getLeaderboard, postShift } from "./api";
import * as view from "./ui/view";
import type { Tab } from "./ui/view";
import { drawHand, drawStage } from "./ui/stage";
import { act, advance, handsHtml, hasHands, HOLD_MS, startDoing, stepKey, type Doing } from "./ui/hands";
import { devPanel, type SPAWN_KINDS } from "./ui/dev";

const STEP = 1; // the sim always advances one game minute at a time, so a seed plays the same on any machine
// Game minutes per real second, shown as 1x, 2x, 4x. At 1x the 8-hour day takes about 5 real minutes.
const SPEEDS = [1.5, 3, 6];
const SPEED_LABEL = ["1×", "2×", "4×"];
const DECIDING = 0.35; // the clock slows to this while a step waits for you (doing it by hand, or choosing)...
const AT_THE_COUNTER = 0; // ...and stops while a customer's explaining what they want: hear it all, then decide
const QUIET = 4; // nothing going on: time flies
const LINE_MS = 1300; // a customer says the next line this long after the last (tap to hurry them)
const SAVE_KEY = "printshop.save";
const NAME_KEY = "printshop.name";

const params = new URLSearchParams(location.search);
const devEnabled = import.meta.env.DEV || params.has("dev");
const seedParam = devEnabled && params.get("seed") ? Number(params.get("seed")) : null;

let game: Game | null = null;
let sim: Sim | null = null;
let speed = SPEEDS[0];
let paused = true;
let bot: Bot | null = null;
let screen: "start" | "report" | "ending" | null = "start";
let tab: Tab = "counter";
let shownTab: Tab | null = null;
let followed = ""; // the step the view last moved to (it follows each new step to its station once)
let doing: Doing | null = null; // the step you're doing by hand
let talk = { id: -1, n: 0, at: 0 }; // the customer talking, and how many of their lines are out
let inLine = new Set<number>(); // who was in line last time we looked (a new face rings the bell)
let bellUntil = 0;
// The first turn-away, walk-away, and going home with work left ask for a quick confirm (a second click).
let confirming: { key: string; until: number } | null = null;
const confirmedOnce = new Set<string>();

const $ = (id: string) => document.getElementById(id)!;
const canvas = $("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const handCtx = ($("handIcon") as HTMLCanvasElement).getContext("2d")!;

// ---------- storage (fails soft: private windows, blocked storage) ----------

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

// ---------- screens ----------

function showScreen(kind: typeof screen, html: string): void {
  screen = kind;
  paused = true;
  $("screenBody").innerHTML = html;
  $("screen").hidden = false;
}

function hideScreen(): void {
  screen = null;
  $("screen").hidden = true;
}

function showStart(): void {
  showScreen("start", view.startScreen(loadGame(read(SAVE_KEY)), read(NAME_KEY) ?? ""));
}

function startGame(g: Game): void {
  const name = ($("name") as HTMLInputElement | null)?.value.trim();
  if (name !== undefined) store(NAME_KEY, name);
  game = g;
  store(SAVE_KEY, saveGame(game));
  playDay();
}

function playDay(): void {
  sim = startDay(game!);
  if (seedParam !== null) sim.state.devUsed = true;
  (window as unknown as { sim: Sim; game: Game }).sim = sim;
  (window as unknown as { sim: Sim; game: Game }).game = game!;
  sim.state.handsOn = true; // you do every step by hand
  tab = "counter";
  doing = null;
  talk = { id: -1, n: 0, at: 0 };
  hideScreen();
  paused = false;
  refresh();
}

async function finishDay(): Promise<void> {
  const s = sim!.state;
  const result = endDay(game!, sim!);
  store(SAVE_KEY, saveGame(game!));
  if (game!.fired) {
    store(SAVE_KEY, null);
    showScreen("ending", view.endingScreen(game!.ending!, result.day));
    return;
  }
  const r = report(s, result);
  const canPost = !s.devUsed && !bot;
  showScreen("report", view.reportScreen(r, canPost ? "Saving to the leaderboard..." : "Dev tools were used today, so it isn't saved to the leaderboard."));
  if (!canPost) return;
  const name = read(NAME_KEY) || "Anonymous";
  const note = await postShift(summarize(s, name, "human")).then(
    () => "Saved to the leaderboard.",
    () => "Couldn't reach the server, so it isn't on the leaderboard. The game is saved either way.",
  );
  if (screen !== "report") return;
  $("posted").textContent = note;
  const rows = await getLeaderboard().catch(() => []);
  if (screen === "report") $("board").innerHTML = view.leaderboard(rows);
}

// ---------- loop ----------

// Driven by a timer measuring real time (animation frames can be throttled), capped so a hidden tab doesn't
// fast-forward the day. After close the clock drags: you're bored and want to go home.
let last = performance.now();
let acc = 0;
function frame(): void {
  const now = performance.now();
  const elapsed = Math.min((now - last) / 1000, 1);
  last = now;
  if (paused || !sim || screen) return;
  const s = sim.state;
  const closed = s.time >= s.closeAt;
  const step = currentStep(s);
  const waiting = !bot && !s.employee.task && step !== null;
  const pace = waiting ? (step!.type === "respond" ? AT_THE_COUNTER : DECIDING) : quiet(s) ? QUIET : 1;
  acc += elapsed * speed * (closed ? CLOSING.overtimeSpeed : 1) * pace;
  let steps = 0;
  while (acc >= STEP && steps < 600) {
    if (bot) botAct(bot, sim.state, STEP);
    tick(sim, STEP);
    acc -= STEP;
    steps++;
    if (isDayOver(sim.state)) break;
  }
  if (doing?.holdFrom != null && now - doing.holdFrom >= HOLD_MS) finishPart(advance(doing));
  if (isDayOver(sim.state)) {
    acc = 0;
    refresh();
    void finishDay();
  }
}

// Nobody in the store and nothing to do: let the clock run.
function quiet(s: Sim["state"]): boolean {
  return !s.workflow && !s.employee.task && s.time < s.closeAt && activeCount(s) === 0;
}

function draw(): void {
  if (!sim) return;
  canvas.hidden = tab === "computer"; // the computer is all screen
  if (!canvas.hidden) drawStage(ctx, sim.state, tab);
  drawHand(handCtx, view.held(sim.state));
}

// ---------- keeping up with the day ----------

// What follows you around: the dialogue, the bell, the station of the step you're on, and the step you're doing by
// hand.
function follow(): void {
  const s = sim!.state;
  const now = performance.now();
  // A customer talking says one line at a time.
  const front = currentCustomer(s);
  if (front?.state === "talking") {
    if (talk.id !== front.id) talk = { id: front.id, n: 1, at: now };
    else if (now - talk.at > LINE_MS && talk.n < requestLines(s, front).length) talk = { ...talk, n: talk.n + 1, at: now };
  }
  // Someone new at the counter while you're elsewhere: the bell, and the Counter tab pulses.
  const line = new Set(s.customers.filter((c) => c.state === "line").map((c) => c.id));
  if ([...line].some((id) => !inLine.has(id))) {
    if (tab !== "counter") {
      bell();
      bellUntil = now + 6000;
    }
  }
  inLine = line;
  // A new step: go to where it's done, and if it's done by hand with nothing to choose, get started.
  const step = currentStep(s);
  const key = step && !s.employee.task ? stepKey(step.req) : "";
  if (key && key !== followed) {
    followed = key;
    tab = view.tabOf(step!.type);
    if (!bot && hasHands(step!.req) && !step!.alts.length && doing?.key !== key) doing = startDoing(step!.req);
  }
  if (doing && (s.employee.task || !s.workflow || !isCurrentStep(s, doing.req))) doing = null; // it's done, or moot
}

function bell(): void {
  try {
    const ac = new AudioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = 1320;
    g.gain.setValueAtTime(0.15, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.6);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.6);
  } catch {
    /* no sound: the tab still pulses */
  }
}

// ---------- drawing the panels ----------

// Redraws a panel only when what we'd draw changed. (Compared with what we drew last, not with innerHTML: the browser
// writes some HTML back differently, and redrawing a form wipes what you've typed and picked.)
const drawn = new Map<string, string>();
function set(id: string, html: string): void {
  if (drawn.get(id) === html) return;
  drawn.set(id, html);
  $(id).innerHTML = html;
}

function confirmKey(): string | null {
  if (confirming && performance.now() > confirming.until) confirming = null;
  return confirming?.key ?? null;
}

function refresh(): void {
  if (!sim) return;
  const s = sim.state;
  follow();
  const ck = confirmKey();
  $("day").textContent = `Day ${s.day}`;
  set("clock", view.clock(s));
  set("mood", view.managerMoodHtml(s));
  set("home", ck === "goHome" ? `<button class="btn corner" data-act="goHome">Sure? ${workLeft(s).length} left undone</button>` : view.goHomeButton(s));
  set("speed", speedButtons() + (quiet(s) && !paused ? `<span class="muted small" style="padding:0 8px;align-self:center">Quiet. Time flies.</span>` : ""));
  const banner = view.banner(s);
  $("banner").hidden = !banner;
  if (banner) set("banner", banner);
  const pulse = view.attention(s);
  if (performance.now() < bellUntil) pulse.add("counter");
  set("tabs", view.tabBar(tab, pulse));
  if (tab !== shownTab) document.querySelector(".tab.on")?.scrollIntoView({ block: "nearest", inline: "nearest" }); // (narrow screens)
  shownTab = tab;
  set("doing", view.doing(s, ck));
  const byHand = doing !== null && view.tabOf(doing.req.type) === tab;
  set("hands", byHand ? handsHtml(s, doing!, performance.now()) : "");
  set("panel", tab === "counter" ? view.counterPanel(s, talk.id === currentCustomer(s)?.id ? talk.n : 0, ck, byHand) : tab === "computer" ? view.computerPanel(s, byHand) : view.stationPanel(s, tab, byHand));
  const h = view.held(s);
  set("handLabel", h ? `Holding: ${h}` : "Hands free");
  set("notes", view.notesHtml(s));
  set("log", `<h2>What happened</h2><ol>${view.logList(s)}</ol>`);
  // Something just went wrong: say so right there, for a few seconds.
  const f = s.failures.at(-1);
  const fresh = f && s.time - f.time < 8;
  $("flash").hidden = !fresh;
  if (fresh) set("flash", view.esc(f.text));
  $("botChip").hidden = !bot;
  $("devBadge").hidden = !s.devUsed;
  if (!$("dev").hidden) set("dev", devPanel(sim, game!, bot?.style ?? null));
}

function speedButtons(): string {
  const btns = SPEEDS.map((n, i) => `<button data-act="speed" data-speed="${n}" class="${!paused && speed === n ? "on" : ""}" title="Key ${i + 1}">${SPEED_LABEL[i]}</button>`);
  if (!SPEEDS.includes(speed)) btns.push(`<button data-act="speed" data-speed="${speed}" class="${paused ? "" : "on"}">${speed / SPEEDS[0]}×</button>`);
  return `<button data-act="pause" class="${paused ? "on" : ""}" title="Space">${paused ? "Paused" : "Pause"}</button>${btns.join("")}`;
}

// A short message where you clicked (or near the panel, for keys): what happened, or why not.
let tipTimer = 0;
let lastPointer = { x: innerWidth / 2, y: 120 };
function tip(msg: string, at = lastPointer): void {
  const el = $("tip");
  el.textContent = msg;
  el.style.left = `${Math.min(innerWidth - 290, at.x + 12)}px`;
  el.style.top = `${Math.max(8, at.y - 36)}px`;
  el.classList.add("show");
  clearTimeout(tipTimer);
  tipTimer = window.setTimeout(() => el.classList.remove("show"), 1600);
}

// ---------- doing things ----------

function needsConfirm(key: string): boolean {
  if (confirmedOnce.has(key)) return false;
  if (confirmKey() === key) {
    confirmedOnce.add(key);
    confirming = null;
    return false;
  }
  confirming = { key, until: performance.now() + 4000 };
  tip(key === "turn_away" ? "Turning them away. Click again to confirm." : key === "abandon" ? "Walking away counts as ignoring it. Click again to confirm." : "There's still work to do. Click again to go home anyway.");
  return true;
}

// Starts something. A step done by hand starts its hands-on part instead (the task runs once you've done it).
function doTask(req: TaskRequest): void {
  const s = sim!.state;
  if (req.choice === "turn_away" && needsConfirm("turn_away")) return;
  if (hasHands(req) && !bot) {
    const err = begin(s, req);
    if (err) return tip(err);
    if (!isCurrentStep(s, req)) return tip("Do the step you're on first.");
    doing = startDoing(req);
    followed = stepKey(currentStep(s)!.req);
    tab = view.tabOf(req.type);
    return;
  }
  const label = req.type === "respond" ? null : previewTask(s, req).label;
  const err = startTask(s, req);
  if (err) tip(err);
  else if (label) tip(label);
  if (req.type === "ask_again") talk = { id: req.customerId!, n: 0, at: performance.now() }; // they start over
}

// The hands-on part of a step moved on; when it's all done, do the step with what you did.
function finishPart(stepDone: boolean): void {
  if (!doing || !stepDone) return;
  const req = doing.req;
  doing = null;
  const err = startTask(sim!.state, req);
  if (err) tip(err);
}

function hand(el: HTMLElement): void {
  if (!doing || !sim) return;
  const r = act(sim.state, doing, el.dataset.what!, el.dataset.value, el.closest("form"));
  if (r === "step") finishPart(true);
  else if (r) tip(r);
}

function abandon(): void {
  if (!sim?.state.workflow) return;
  if (needsConfirm("abandon")) return;
  doing = null;
  abandonWorkflow(sim.state);
  tip("Walked away.");
}

function home(): void {
  if (!sim) return;
  const err = canGoHome(sim.state);
  if (err) return tip(err);
  if (workLeft(sim.state).length && needsConfirm("goHome")) return;
  goHome(sim.state);
}

// Keyboard: Enter does it (hurries a customer along, the step you're on, answering Do, or the next thing), X is
// Don't, I is Ignore.
function keyDo(): void {
  const s = sim!.state;
  const front = currentCustomer(s);
  if (front?.state === "talking" && talk.n < requestLines(s, front).length) {
    talk = { ...talk, n: requestLines(s, front).length };
    return;
  }
  if (doing) return tip("Finish what you're doing by hand.");
  const step = currentStep(s);
  if (step) return doTask(step.type === "respond" ? { ...step.req, choice: "take" } : step.req);
  if (front?.state === "line") return doTask({ type: "talk", customerId: front.id });
  const top = todoList(s)[0];
  if (top) doTask(top.req);
  else tip("Nothing to do right now.");
}

function keyDont(): void {
  const step = currentStep(sim!.state);
  if (step?.type === "respond") return doTask({ ...step.req, choice: "turn_away" });
  if (step && isChoice(step) && step.alts.length) return doTask(step.alts[0]);
  tip("There's no corner to cut here.");
}

function keyIgnore(): void {
  const step = currentStep(sim!.state);
  if (step?.type === "respond") return doTask({ ...step.req, choice: "ignore" });
  if (sim!.state.workflow) return abandon();
  tip("Nothing to ignore.");
}

// ---------- input ----------

// Panels re-render several times a second, so act on pointerdown (a click can straddle a re-render).
// Keyboard activation still arrives as a click with detail 0.
let ghost: HTMLElement | null = null;
document.addEventListener("pointerdown", (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  if (e.button !== 0) return;
  const t = e.target as HTMLElement;
  if (t.closest("[data-hold]") && doing) {
    e.preventDefault();
    doing.holdFrom = performance.now();
    return;
  }
  if (t.closest("[data-drag]") && doing) {
    e.preventDefault();
    act(sim!.state, doing, "grab", undefined, null);
    ghost = document.createElement("div");
    ghost.className = "ghost";
    ghost.textContent = t.closest("[data-drag]")!.textContent;
    document.body.append(ghost);
    moveGhost(e);
    return;
  }
  if (t.closest(".textbox") && sim) {
    const front = currentCustomer(sim.state);
    if (front?.state === "talking") talk = { ...talk, n: talk.n + 1, at: performance.now() };
  }
  const el = t.closest<HTMLElement>("[data-act]");
  if (el && el.tagName === "BUTTON") {
    e.preventDefault();
    el.classList.add("pressed");
    handle(el);
  }
});
function moveGhost(e: PointerEvent): void {
  if (!ghost) return;
  ghost.style.left = `${e.clientX - 30}px`;
  ghost.style.top = `${e.clientY - 18}px`;
}
document.addEventListener("pointermove", moveGhost);
document.addEventListener("pointerup", (e) => {
  if (doing?.holdFrom != null) doing.holdFrom = null; // let go too soon: start over
  if (!ghost) return;
  ghost.remove();
  ghost = null;
  const slot = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-slot]");
  if (slot) hand(slot);
  refresh();
});
document.addEventListener("click", (e) => {
  if (e.detail !== 0) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (el) handle(el);
});

function handle(el: HTMLElement): void {
  const d = el.dataset;
  switch (d.act) {
    case "newGame":
      startGame(newGame(seedParam ?? Math.floor(Math.random() * 1e9)));
      return;
    case "continue":
      startGame(loadGame(read(SAVE_KEY))!);
      return;
    case "nextDay":
      playDay();
      return;
  }
  if (!sim) return;
  const s = sim.state;
  switch (d.act) {
    case "task":
      doTask(JSON.parse(d.req!) as TaskRequest);
      break;
    case "hand":
      hand(el);
      break;
    case "tab":
      tab = d.tab as Tab;
      if (tab === "counter") bellUntil = 0;
      break;
    case "nextLine":
      break; // (handled on pointerdown)
    case "abandon":
      abandon();
      break;
    case "goHome":
      home();
      break;
    case "pause":
      paused = !paused;
      break;
    case "speed":
      speed = Number(d.speed);
      paused = false;
      break;
    case "stopBot":
      bot = null;
      break;
    // dev
    case "closeDev":
      $("dev").hidden = true;
      break;
    case "bot":
      bot = d.style ? createBot(1, d.style as BotStyle, s.seed) : null;
      doing = null;
      if (bot) s.devUsed = true;
      break;
    case "skipDay":
      skipToClose(sim, bot ? () => botAct(bot!, s, 1) : undefined); // a bot, if on, keeps working
      break;
    case "arrivals":
      setArrivals(sim, !s.director.enabled);
      break;
    case "event": {
      const err = devEvent(sim, d.kind as EventKind);
      if (err) tip(err);
      break;
    }
    case "spawn":
      devSpawn(sim, d.kind as (typeof SPAWN_KINDS)[number]);
      break;
    case "copyState":
      void navigator.clipboard?.writeText(JSON.stringify({ game, state: s }, null, 2)).then(() => tip("Copied."));
      break;
  }
  refresh();
}

window.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    // Enter in a form fills it in.
    const btn = (e.target as HTMLElement).closest("form")?.querySelector<HTMLElement>("[data-act=hand]");
    if (e.key === "Enter" && btn) {
      e.preventDefault();
      hand(btn);
      refresh();
    }
    return;
  }
  if (e.key === "`" && devEnabled && sim) {
    $("dev").hidden = !$("dev").hidden;
    refresh();
    return;
  }
  if (screen || !sim) return;
  const k = e.key.toLowerCase();
  if (e.code === "Space") {
    e.preventDefault();
    paused = !paused;
  } else if (k === "enter") keyDo();
  else if (k === "x") keyDont();
  else if (k === "i") keyIgnore();
  else if (k === "g") home();
  else {
    const n = Number(e.key);
    if (n >= 1 && n <= SPEEDS.length) {
      speed = SPEEDS[n - 1];
      paused = false;
    }
  }
  refresh();
});

showStart();
setInterval(frame, 50);
setInterval(draw, 100);
setInterval(refresh, 120);
