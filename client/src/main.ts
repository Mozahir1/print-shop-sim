// The counter view: runs the day, draws it, and turns clicks into tasks.
import { isDayOver, startTask, stopTask, tick, type Sim } from "./sim/sim";
import { endDay, loadGame, newGame, saveGame, startDay, type Game } from "./sim/game";
import { report, summarize } from "./sim/summary";
import { botAct, createBot, type Bot, type BotStyle } from "./sim/bot";
import { devEvent, devSpawn, setArrivals, skipToClose } from "./sim/dev";
import type { EventKind, Station, TaskRequest } from "./sim/types";
import { getLeaderboard, postShift } from "./api";
import * as view from "./ui/view";
import { devPanel, type SPAWN_KINDS } from "./ui/dev";

const STEP = 1; // the sim always advances in 1-second steps, so a seed plays the same on any machine
const SPEEDS = [1, 2, 4]; // sim seconds per real second; 1x is a 5-minute day
const SAVE_KEY = "printshop.save";
const NAME_KEY = "printshop.name";

const params = new URLSearchParams(location.search);
const devEnabled = import.meta.env.DEV || params.has("dev");
const seedParam = devEnabled && params.get("seed") ? Number(params.get("seed")) : null;

let game: Game | null = null;
let sim: Sim | null = null;
let speed = 1;
let paused = true;
let station: Station | null = null;
let bot: Bot | null = null;
let screen: "start" | "report" | "ending" | null = "start";

const $ = (id: string) => document.getElementById(id)!;

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
  station = null;
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

// Driven by a timer measuring real elapsed time (animation frames can be throttled), capped so a hidden tab
// doesn't fast-forward the day when it comes back.
let last = performance.now();
let acc = 0;
function frame(): void {
  const now = performance.now();
  const elapsed = Math.min((now - last) / 1000, 1);
  last = now;
  if (!paused && sim && !screen) {
    acc += elapsed * speed;
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
}

// ---------- drawing ----------

function set(id: string, html: string): void {
  const el = $(id);
  if (el.innerHTML !== html) el.innerHTML = html;
}

function refresh(): void {
  if (!sim) return;
  const s = sim.state;
  $("day").textContent = `Day ${s.day}`;
  set("clock", view.clock(s));
  set("hudTask", view.hudTask(s));
  set("speed", speedButtons());
  set("caption", view.caption(s));
  const banner = view.banner(s);
  $("banner").hidden = !banner;
  if (banner) set("banner", banner);
  set("stations", view.stationButtons(s, station));
  set("counter", view.counter(s));
  $("station").hidden = !station;
  if (station) set("station", view.stationPanel(s, station));
  set("todo", view.todo(s));
  set("log", `<h2>What happened</h2><ol>${view.logList(s)}</ol>`);
  $("botChip").hidden = !bot;
  $("devBadge").hidden = !s.devUsed;
  if (!$("dev").hidden) set("dev", devPanel(sim, game!, bot?.style ?? null));
}

function speedButtons(): string {
  const btns = SPEEDS.map((n, i) => `<button data-act="speed" data-speed="${n}" class="${!paused && speed === n ? "on" : ""}" title="Key ${i + 1}">${n}×</button>`);
  if (!SPEEDS.includes(speed)) btns.push(`<button data-act="speed" data-speed="${speed}" class="${paused ? "" : "on"}">${speed}×</button>`);
  return `<button data-act="pause" class="${paused ? "on" : ""}" title="Space">${paused ? "Paused" : "Pause"}</button>${btns.join("")}`;
}

let toastTimer = 0;
function toast(msg: string): void {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 2500);
}

// ---------- input ----------

// Panels re-render several times a second, so act on pointerdown (a click can straddle a re-render).
// Keyboard activation still arrives as a click with detail 0.
document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (el && el.tagName === "BUTTON") {
    e.preventDefault();
    handle(el);
  }
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
    case "task": {
      const err = startTask(s, JSON.parse(d.req!) as TaskRequest);
      if (err) toast(err);
      break;
    }
    case "stop":
      stopTask(s);
      break;
    case "station":
      station = station === d.station ? null : (d.station as Station);
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
      bot = d.style ? createBot(1, d.style as BotStyle) : null;
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
      if (err) toast(err);
      break;
    }
    case "spawn":
      devSpawn(sim, d.kind as (typeof SPAWN_KINDS)[number]);
      break;
    case "copyState":
      void navigator.clipboard?.writeText(JSON.stringify({ game, state: s }, null, 2)).then(() => toast("Copied."));
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
  if (e.code === "Space") {
    e.preventDefault();
    paused = !paused;
  }
  if (e.code === "Escape") station = null;
  const n = Number(e.key);
  if (n >= 1 && n <= SPEEDS.length) {
    speed = SPEEDS[n - 1];
    paused = false;
  }
  refresh();
});

showStart();
setInterval(frame, 50);
setInterval(refresh, 150);
