import { canStart, createSim, isShiftOver, startTask, stopTask, tick, type Sim } from "./sim/sim";
import { report, summarize } from "./sim/summary";
import type { PaperStock, TaskRequest, TaskType } from "./sim/types";
import { MAP_H, MAP_W, STOCKROOM } from "./sim/layout";
import { formatClock, formatDuration } from "./sim/time";
import { render, setupCanvas } from "./ui/render";
import { esc, showEndScreen, showLeaderboard, ui, updatePanels } from "./ui/panel";
import { hitTest, targetBody, targetInfo, type Target } from "./ui/floor";
import { computerUi, rateFromForm, readSpecForm, renderComputer, setComputerHtml } from "./ui/computer";
import { renderStockroomView } from "./ui/stockroom";
import { notepad, renderNotepad } from "./ui/notes";
import { carryLabel } from "./sim/hands";
import { counterCustomer } from "./sim/sim";
import { REGISTER } from "./sim/layout";
import { getDailySeed, getLeaderboard, postShift } from "./api";
import { botAct } from "./sim/bot";
import { dev, initDev, setBot, updateDev } from "./ui/dev";

const STEP = 1; // the sim always advances in 1-second steps, so a seed plays the same on any machine
const SPEEDS = [1, 10, 30, 60]; // sim seconds per real second
const MAX_STEPS_PER_FRAME = 240;

const canvas = document.getElementById("floor") as HTMLCanvasElement;
const ctx = setupCanvas(canvas);
const menuEl = document.getElementById("menu")!;
const stationEl = document.getElementById("station")!;

let sim: Sim | null = null;
let speed = 30;
let paused = true;
let ended = false;
let menuTarget: Target | null = null;

// Dev mode: always on under `npm run dev`; in a build, add ?dev to the URL. ?seed=N plays a specific day.
const params = new URLSearchParams(location.search);
const devEnabled = import.meta.env.DEV || params.has("dev");
const seedParam = devEnabled && params.get("seed") ? Number(params.get("seed")) : null;

// ---------- loop ----------

async function load() {
  const daily = seedParam === null ? await getDailySeed() : null;
  sim = createSim(seedParam ?? daily ?? Math.floor(Math.random() * 1e9));
  if (seedParam !== null) sim.state.devUsed = true; // a hand-picked seed isn't the daily shift
  initDev(
    {
      sim: () => sim!,
      setSpeed: (s) => {
        speed = s;
        setPaused(false);
      },
      refresh,
      toast,
    },
    devEnabled,
    params.has("dev"),
  );
  refresh();

  let last = performance.now();
  let acc = 0;
  function frame(now: number) {
    const elapsed = Math.min((now - last) / 1000, 0.25); // don't fast-forward after a hidden tab
    last = now;
    if (!paused && sim) {
      acc += elapsed * speed;
      let steps = 0;
      while (acc >= STEP && steps < MAX_STEPS_PER_FRAME && !paused) {
        if (dev.bot) botAct(dev.bot, sim.state, STEP);
        tick(sim, STEP);
        acc -= STEP;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) acc = 0;
    }
    if (sim) render(ctx, sim.state, menuTarget ? targetInfo(sim.state, menuTarget)?.rect : undefined);
    if (sim && isShiftOver(sim.state)) return endShift();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(() => !ended && refresh(), 200);
}

// The dashboard of true state lives in dev mode, shown while the dev drawer is open.
function showTrueState(): boolean {
  return devEnabled && !document.getElementById("dev")!.hidden;
}

function refresh() {
  if (!sim) return;
  const state = sim.state;
  const trueState = showTrueState();
  document.getElementById("truestate")!.hidden = !trueState;
  updatePanels(state, trueState);
  updateDev(state);
  updateHud();
  updateMenu();
  updateStation();
  renderSpeed();
  document.getElementById("devBadge")!.hidden = !state.devUsed;
  // The bot plays every action for you, so make it impossible to miss even with the dev drawer closed.
  document.getElementById("botChip")!.hidden = dev.bot === null;
}

// ---------- HUD: the wall clock, what you're doing, what you're holding ----------

let lastHud = "";
function updateHud() {
  const state = sim!.state;
  document.getElementById("clock")!.textContent = formatClock(state.time);
  const t = state.employee.task;
  let html: string;
  if (!t) {
    html = `<b>Free.</b> <span class="muted">Click something in the store.</span>`;
  } else {
    const walking = t.elapsed === 0 && (Math.abs(state.employee.pos.x - t.station.x) > 0.05 || Math.abs(state.employee.pos.y - t.station.y) > 0.05);
    const frac = t.duration > 0 ? t.elapsed / t.duration : 0;
    const status = walking ? "walking over" : `${formatDuration(t.duration - t.elapsed)} left`;
    html = `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><span><b>${esc(t.label)}</b> <span class="muted">· ${status}</span></span>
      <button class="btn" data-act="stop" style="padding:2px 8px">Stop</button></div>
      <div class="bar"><div style="width:${(frac * 100).toFixed(1)}%"></div></div>`;
  }
  if (html !== lastHud) {
    lastHud = html;
    document.getElementById("hudTask")!.innerHTML = html;
  }
  const h = state.employee.hands;
  const counter = state.counterItems.length ? ` · ${state.counterItems.length} on the counter` : "";
  document.getElementById("hudHands")!.textContent = `Hands: ${h ? carryLabel(state, h) : "empty"}${counter}`;
}

// ---------- the floor and its action menus ----------

canvas.addEventListener("pointerdown", (e) => {
  if (!sim || ended || e.button !== 0) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * MAP_W;
  const y = ((e.clientY - rect.top) / rect.height) * MAP_H;
  const target = hitTest(sim.state, x, y);
  closeStation();
  if (!target) return closeMenu();
  if (target.kind === "object" && target.id === "register") return openStation("computer");
  if (target.kind === "object" && target.id === "stockroom") return openStation("stockroom");
  openMenu(target);
});

function openMenu(target: Target) {
  const state = sim!.state;
  const info = targetInfo(state, target);
  if (!info) return closeMenu();
  menuTarget = target;
  lastMenu = "";
  // Walk over if you're free (or already just walking). Real work in progress isn't dropped to go look at something.
  const cur = state.employee.task;
  if (!cur || cur.type === "walk_to") {
    const walk: TaskRequest = { type: "walk_to", to: info.spot };
    if (canStart(state, walk) === null) startTask(state, walk);
  }
  updateMenu();
}

function closeMenu() {
  menuTarget = null;
  menuEl.hidden = true;
  lastMenu = "";
}

let lastMenu = "";
function updateMenu() {
  if (!menuTarget || !sim) return;
  const state = sim.state;
  const info = targetInfo(state, menuTarget);
  if (!info) return closeMenu();
  const html = `<div class="menu-head"><span>${esc(info.label)}</span><button class="btn" data-act="closeMenu" style="padding:0 8px">×</button></div>${targetBody(state, menuTarget)}`;
  if (html !== lastMenu) {
    lastMenu = html;
    setComputerHtml(menuEl, html); // keeps a half-made choice (like the name to shelve under) across refreshes
  }
  menuEl.hidden = false;
  // Next to the object, flipped to the other side when it would run off the floor.
  const scale = canvas.clientWidth / MAP_W;
  const menuWidth = menuEl.offsetWidth || 310;
  let left = (info.rect.x + info.rect.w) * scale + 8;
  if (left + menuWidth > canvas.clientWidth) left = Math.max(0, info.rect.x * scale - menuWidth - 8);
  const top = Math.min(Math.max(0, info.rect.y * scale), Math.max(0, canvas.clientHeight - menuEl.offsetHeight));
  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
}

// ---------- station views: the computer, the stockroom shelves, and your notepad ----------

type Station = "computer" | "stockroom" | "notepad";
let station: Station | null = null;

function openStation(kind: Station, app?: "pos") {
  const state = sim!.state;
  closeMenu();
  station = kind;
  computerUi.open = kind === "computer";
  notepad.open = kind === "notepad";
  // The computer and the shelves are places: walk over (or bring up the POS) if you're free. The notepad is in your pocket.
  const cur = state.employee.task;
  if (kind !== "notepad" && (!cur || cur.type === "walk_to")) {
    const req: TaskRequest =
      kind === "computer" && app && state.computer.app !== app ? { type: "open_app", app } : { type: "walk_to", to: kind === "computer" ? REGISTER : STOCKROOM };
    if (canStart(state, req) === null) startTask(state, req);
  }
  lastStation = "";
  updateStation();
}

function closeStation() {
  if (station === "notepad") saveNotes();
  station = null;
  computerUi.open = false;
  notepad.open = false;
  stationEl.hidden = true;
  lastStation = "";
}

function saveNotes() {
  const t = document.getElementById("notepadText") as HTMLTextAreaElement | null;
  if (t) notepad.notes = t.value;
}

let lastStation = "";
function updateStation() {
  if (!station || !sim) return;
  stationEl.hidden = false;
  if (station === "notepad") saveNotes();
  const html = station === "computer" ? renderComputer(sim.state) : station === "stockroom" ? renderStockroomView(sim.state) : renderNotepad(sim.state);
  if (html !== lastStation) {
    lastStation = html;
    setComputerHtml(stationEl, html); // keeps whatever's typed in forms and the notes box
  }
}

// ---------- speed ----------

const speedBox = document.getElementById("speed")!;

function renderSpeed() {
  const html =
    `<button data-act="pause" class="${paused ? "on" : ""}" title="Pause (Space)">${paused ? "Paused" : "Pause"}</button>` +
    SPEEDS.map((s, i) => `<button data-act="speed" data-speed="${s}" class="${!paused && s === speed ? "on" : ""}" title="Key ${i + 1}">${s}×</button>`).join("") +
    (SPEEDS.includes(speed) ? "" : `<button data-act="speed" data-speed="${speed}" class="${paused ? "" : "on"}" title="Dev speed">${speed}×</button>`);
  if (speedBox.innerHTML !== html) speedBox.innerHTML = html;
}

function setPaused(p: boolean) {
  paused = p;
  renderSpeed();
}

// ---------- input ----------

// Menus and panels re-render several times a second, so act on pointerdown (a click can straddle a re-render).
// Keyboard activation still comes through as a click with detail 0.
document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (el) {
    e.preventDefault();
    handle(el);
  }
});
document.addEventListener("click", (e) => {
  if (e.detail !== 0) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (el) handle(el);
});

function handle(el: HTMLElement) {
  if (!sim || ended) return;
  const d = el.dataset;
  switch (d.act) {
    case "pause":
      setPaused(!paused);
      break;
    case "speed":
      speed = Number(d.speed);
      setPaused(false);
      break;
    case "stopBot":
      setBot(false);
      break;
    case "closeMenu":
      closeMenu();
      break;
    case "closeComputer":
    case "closeStation":
    case "closeNotepad":
      closeStation();
      break;
    case "notepad":
      if (station === "notepad") closeStation();
      else openStation("notepad");
      break;
    case "ticketDone": {
      const id = Number(d.job);
      if (notepad.done.has(id)) notepad.done.delete(id);
      else notepad.done.add(id);
      lastStation = "";
      break;
    }
    case "openPos":
      openStation("computer", "pos");
      break;
    case "enterOrder": {
      const c = counterCustomer(sim.state);
      const err = startTask(sim.state, { type: "take_order", spec: readSpecForm("pos", c?.request?.spec.item ?? "document") });
      if (err) toast(err);
      break;
    }
    case "sendJob": {
      const id = Number(d.job);
      const printerId = (document.getElementById(`ps-${id}-printer`) as HTMLSelectElement).value;
      const job = sim.state.jobs.find((j) => j.id === id)!;
      const err = startTask(sim.state, { type: "send_job", jobId: id, printerId, spec: readSpecForm(`ps-${id}`, job.ticket.item) });
      if (err) toast(err);
      break;
    }
    case "shelveAs": {
      const filedUnder = Number((document.getElementById("shelveName") as HTMLSelectElement).value);
      const err = startTask(sim.state, { type: "shelve", filedUnder });
      if (err) toast(err);
      else closeMenu();
      break;
    }
    case "rate":
      computerUi.rate = rateFromForm();
      break;
    case "tab":
      ui.ordersTab = d.tab === "done" ? "done" : "active";
      break;
    case "stop":
      stopTask(sim.state);
      break;
    case "task": {
      const req: TaskRequest = {
        type: d.type as TaskType,
        jobId: d.job !== undefined ? Number(d.job) : undefined,
        printerId: d.printer,
        stock: d.stock as PaperStock | undefined,
        callId: d.call !== undefined ? Number(d.call) : undefined,
        copierId: d.copier !== undefined ? Number(d.copier) : undefined,
        app: d.app as TaskRequest["app"],
        messageId: d.message !== undefined ? Number(d.message) : undefined,
        voicemailId: d.voicemail !== undefined ? Number(d.voicemail) : undefined,
        dir: d.dir as TaskRequest["dir"],
        item: d.item as TaskRequest["item"],
        index: d.index !== undefined ? Number(d.index) : undefined,
        filedUnder: d.filed !== undefined ? Number(d.filed) : undefined,
      };
      const err = startTask(sim.state, req);
      if (err) toast(err);
      else if (el.closest("#menu")) closeMenu();
      break;
    }
  }
  refresh();
}

window.addEventListener("keydown", (e) => {
  if (!sim || ended || (e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
  if (document.getElementById("intro")!.classList.contains("show")) return;
  if (e.code === "Escape") {
    closeMenu();
    closeStation();
  }
  if (e.code === "Space") {
    e.preventDefault();
    setPaused(!paused);
  }
  const n = Number(e.key);
  if (n >= 1 && n <= SPEEDS.length) {
    speed = SPEEDS[n - 1];
    setPaused(false);
  }
});

document.getElementById("startBtn")!.addEventListener("click", () => {
  document.getElementById("intro")!.classList.remove("show");
  setPaused(false);
});

let toastTimer = 0;
function toast(msg: string) {
  const el = document.getElementById("toast")!;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 3000);
}

// ---------- end of shift ----------

async function endShift() {
  ended = true;
  closeMenu();
  updatePanels(sim!.state, showTrueState());
  showEndScreen(report(sim!.state));
  if (sim!.state.devUsed) {
    (document.getElementById("submit") as HTMLButtonElement).disabled = true;
    document.getElementById("submitStatus")!.textContent = "Dev tools were used this shift, so it can't be submitted.";
  }
  showLeaderboard(await getLeaderboard().catch(() => null));
}

document.getElementById("submit")!.addEventListener("click", async () => {
  const nameInput = document.getElementById("name") as HTMLInputElement;
  const status = document.getElementById("submitStatus")!;
  const name = nameInput.value.trim() || "Anonymous";
  try {
    await postShift(summarize(sim!.state, name, "human"));
    status.textContent = "Saved.";
    (document.getElementById("submit") as HTMLButtonElement).disabled = true;
    showLeaderboard(await getLeaderboard());
  } catch {
    status.textContent = "Couldn't reach the server. Is the backend running?";
  }
});

document.getElementById("again")!.addEventListener("click", () => location.reload());

load();
