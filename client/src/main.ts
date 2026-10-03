// The game screen: the store scene, the job card, the to-do list. Runs the day and turns clicks and keys into tasks.
import { abandonWorkflow, canGoHome, currentCustomer, goHome, isDayOver, previewTask, startTask, tick, workLeft, type Sim } from "./sim/sim";
import { endDay, loadGame, newGame, saveGame, startDay, type Game } from "./sim/game";
import { report, summarize } from "./sim/summary";
import { botAct, createBot, type Bot, type BotStyle } from "./sim/bot";
import { devEvent, devSpawn, setArrivals, skipToClose } from "./sim/dev";
import { activeCount, todoList } from "./sim/todo";
import { currentStep } from "./sim/workflow";
import { CLOSING } from "./sim/config";
import type { EventKind, Station, TaskRequest } from "./sim/types";
import { getLeaderboard, postShift } from "./api";
import * as view from "./ui/view";
import { createScene, drawScene, hitTest, H, W } from "./ui/scene";
import { devPanel, type SPAWN_KINDS } from "./ui/dev";

const STEP = 1; // the sim always advances one game minute at a time, so a seed plays the same on any machine
// Game minutes per real second, shown as 1x, 2x, 4x. At 1x the 8-hour day takes about 5 real minutes.
const SPEEDS = [1.5, 3, 6];
const SPEED_LABEL = ["1×", "2×", "4×"];
const DECIDING = 0.35; // the clock slows to this while a choice is waiting on you...
const AT_THE_COUNTER = 0; // ...and stops while a customer's explaining what they want: read it all, then decide
const QUIET = 4; // nothing going on: time flies
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
const scene = createScene();
let pop: { kind: "station"; place: Station | "truck" } | { kind: "customer"; id: number } | null = null;
// The first turn-away, walk-away, and going home with work left ask for a quick confirm (a second click).
let confirming: { key: string; until: number } | null = null;
const confirmedOnce = new Set<string>();

const $ = (id: string) => document.getElementById(id)!;
const canvas = $("scene") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

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

function begin(g: Game): void {
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
  pop = null;
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
  const deciding = !bot && !s.employee.task && step !== null && (step.type === "respond" || step.alts.length > 0);
  const pace = deciding ? (step!.type === "respond" ? AT_THE_COUNTER : DECIDING) : quiet(s) ? QUIET : 1;
  acc += elapsed * speed * (closed ? CLOSING.overtimeSpeed : 1) * pace;
  let steps = 0;
  while (acc >= STEP && steps < 600) {
    if (bot) botAct(bot, sim.state, STEP);
    tick(sim, STEP);
    acc -= STEP;
    steps++;
    if (isDayOver(sim.state)) break;
  }
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
  if (sim) drawScene(ctx, sim.state, scene, performance.now());
}

// ---------- drawing the panels ----------

function set(id: string, html: string): void {
  const el = $(id);
  if (el.innerHTML !== html) el.innerHTML = html;
}

function confirmKey(): string | null {
  if (confirming && performance.now() > confirming.until) confirming = null;
  return confirming?.key ?? null;
}

function refresh(): void {
  if (!sim) return;
  const s = sim.state;
  const ck = confirmKey();
  $("day").textContent = `Day ${s.day}`;
  set("clock", view.clock(s));
  set("mood", view.managerMoodHtml(s));
  set("home", ck === "goHome" ? `<button class="btn corner" data-act="goHome">Sure? ${workLeft(s).length} left undone</button>` : view.goHomeButton(s));
  set("speed", speedButtons() + (quiet(s) && !paused ? `<span class="muted small" style="padding:0 8px;align-self:center">Quiet. Time flies.</span>` : ""));
  const banner = view.banner(s);
  $("banner").hidden = !banner;
  if (banner) set("banner", banner);
  set("job", view.jobCard(s, ck));
  set("todo", view.todo(s, ck));
  set("log", `<h2>What happened</h2><ol>${view.logList(s)}</ol>`);
  const popEl = $("pop");
  if (pop) {
    const html = pop.kind === "station" ? view.stationMenu(s, pop.place) : view.customerMenu(s, pop.id);
    if (!html) pop = null;
    else set("pop", html);
  }
  popEl.hidden = !pop;
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

// A short message where you clicked (or near the job card, for keys): what happened, or why not.
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

function doTask(req: TaskRequest): void {
  const s = sim!.state;
  if (req.choice === "turn_away" && needsConfirm("turn_away")) return;
  const label = req.type === "respond" ? null : previewTask(s, req).label;
  const err = startTask(s, req);
  if (err) tip(err);
  else {
    pop = null;
    if (label) tip(label);
  }
}

function abandon(): void {
  if (!sim?.state.workflow) return;
  if (needsConfirm("abandon")) return;
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

// Keyboard: Enter does it (the step you're on, answering Do, or the top of the to-do list), X is Don't, I is Ignore.
function keyDo(): void {
  const s = sim!.state;
  const step = currentStep(s);
  if (step) return doTask(step.type === "respond" ? { ...step.req, choice: "take" } : step.req);
  const front = currentCustomer(s);
  if (front?.state === "line") return doTask({ type: "talk", customerId: front.id });
  const top = todoList(s)[0];
  if (top) doTask(top.req);
  else tip("Nothing to do right now.");
}

function keyDont(): void {
  const step = currentStep(sim!.state);
  if (step?.type === "respond") return doTask({ ...step.req, choice: "turn_away" });
  if (step?.alts.length) return doTask(step.alts[0]);
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
document.addEventListener("pointerdown", (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
  if (e.button !== 0) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (el && el.tagName === "BUTTON") {
    e.preventDefault();
    el.classList.add("pressed");
    handle(el);
  }
});
document.addEventListener("click", (e) => {
  if (e.detail !== 0) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (el) handle(el);
});

canvas.addEventListener("pointerdown", (e) => {
  if (!sim || screen) return;
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * W;
  const y = ((e.clientY - r.top) / r.height) * H;
  const hit = hitTest(sim.state, scene, x, y);
  const place = (p: typeof pop) => {
    pop = p;
    const el = $("pop");
    const wrap = $("sceneWrap").getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(wrap.width - 308, e.clientX - wrap.left + 8))}px`;
    el.style.top = `${Math.max(8, Math.min(wrap.height - 80, e.clientY - wrap.top + 8))}px`;
  };
  if (!hit) pop = null;
  else if (hit.kind === "customer") {
    const front = currentCustomer(sim.state);
    if (front?.id === hit.id && front.state === "line") doTask({ type: "talk", customerId: front.id });
    else place({ kind: "customer", id: hit.id });
  } else if (hit.place === "counter") {
    const front = currentCustomer(sim.state);
    if (front?.state === "line") doTask({ type: "talk", customerId: front.id });
    else tip(front ? `You're talking to ${front.name}.` : "Nobody at the counter.");
  } else place({ kind: "station", place: hit.place });
  refresh();
});

function handle(el: HTMLElement): void {
  const d = el.dataset;
  switch (d.act) {
    case "newGame":
      begin(newGame(seedParam ?? Math.floor(Math.random() * 1e9)));
      return;
    case "continue":
      begin(loadGame(read(SAVE_KEY))!);
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
    case "abandon":
      abandon();
      break;
    case "goHome":
      home();
      break;
    case "closePop":
      pop = null;
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
  if (tag === "INPUT" || tag === "TEXTAREA") return;
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
  } else if (e.code === "Escape") pop = null;
  else if (k === "enter") keyDo();
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
setInterval(draw, 33);
setInterval(refresh, 150);
