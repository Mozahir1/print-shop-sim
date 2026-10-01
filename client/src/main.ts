import { counterCustomer, createSim, isShiftOver, servingCustomerId, startTask, stopTask, tick, type Sim } from "./sim/sim";
import { report, summarize } from "./sim/summary";
import type { PaperStock, TaskRequest, TaskType } from "./sim/types";
import { render, setupCanvas } from "./ui/render";
import { showEndScreen, showLeaderboard, ui, updatePanels } from "./ui/panel";
import { getDailySeed, getLeaderboard, postShift } from "./api";
import { botAct } from "./sim/bot";
import { ringingCalls } from "./sim/phone";
import { dev, initDev, setBot, updateDev } from "./ui/dev";

const STEP = 1; // the sim always advances in 1-second steps, so a seed plays the same on any machine
const SPEEDS = [1, 10, 30, 60]; // sim seconds per real second
const MAX_STEPS_PER_FRAME = 240;

const canvas = document.getElementById("floor") as HTMLCanvasElement;
const ctx = setupCanvas(canvas);

let sim: Sim | null = null;
let speed = 30;
let paused = true;
let ended = false;
let lastCounterId: number | null = null;
let lastTruckStatus: "coming" | "waiting" | "gone" = "coming";
let lastRinging: number[] = [];

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
        checkAutoPause();
      }
      if (steps === MAX_STEPS_PER_FRAME) acc = 0;
    }
    if (sim) render(ctx, sim.state);
    if (sim && isShiftOver(sim.state)) return endShift();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  setInterval(() => {
    if (!sim || ended) return;
    updatePanels(sim.state);
    updateDev(sim.state);
  }, 200);
}

// Optionally stop the clock when someone new walks up to the register and you aren't already helping them.
function checkAutoPause() {
  const c = sim && counterCustomer(sim.state);
  const id = c ? c.id : null;
  if (id !== null && id !== lastCounterId && servingCustomerId(sim!.state) !== id && autopause.checked) {
    setPaused(true);
    toast(`${c!.name} is at the counter.`);
  }
  lastCounterId = id;

  // The truck only waits a few minutes, so its arrival always gets a toast (and a pause, if you asked for those).
  const truck = sim!.state.truck.status;
  if (truck === "waiting" && lastTruckStatus === "coming") {
    toast("The carrier truck is here. Hand off the outbound packages before the driver leaves.");
    if (autopause.checked) setPaused(true);
  }
  lastTruckStatus = truck;

  // A call only rings for 30 sim seconds, which is a blink at 30x, so by default the clock stops for it.
  const ringing = ringingCalls(sim!.state).map((c) => c.id);
  if (ringing.some((id) => !lastRinging.includes(id)) && phonepause.checked) {
    setPaused(true);
    toast("The phone is ringing.");
  }
  lastRinging = ringing;
}

function refresh() {
  if (!sim) return;
  updatePanels(sim.state);
  updateDev(sim.state);
  renderSpeed();
  document.getElementById("devBadge")!.hidden = !sim.state.devUsed;
  // The bot plays every action for you, so make it impossible to miss even with the dev drawer closed.
  document.getElementById("botChip")!.hidden = dev.bot === null;
}

// ---------- speed ----------

const speedBox = document.getElementById("speed")!;
const autopause = document.getElementById("autopause") as HTMLInputElement;
const phonepause = document.getElementById("phonepause") as HTMLInputElement;

function renderSpeed() {
  speedBox.innerHTML =
    `<button data-act="pause" class="${paused ? "on" : ""}" title="Pause (Space)">${paused ? "Paused" : "Pause"}</button>` +
    SPEEDS.map((s, i) => `<button data-act="speed" data-speed="${s}" class="${!paused && s === speed ? "on" : ""}" title="Key ${i + 1}">${s}×</button>`).join("") +
    (SPEEDS.includes(speed) ? "" : `<button data-act="speed" data-speed="${speed}" class="${paused ? "" : "on"}" title="Dev speed">${speed}×</button>`);
}

function setPaused(p: boolean) {
  paused = p;
  renderSpeed();
}

// ---------- input ----------

// Panels are re-rendered several times a second, so act on pointerdown (a click can straddle a re-render).
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
      };
      const err = startTask(sim.state, req);
      if (err) toast(err);
      else lastCounterId = counterCustomer(sim.state)?.id ?? null;
      break;
    }
  }
  refresh();
}

window.addEventListener("keydown", (e) => {
  if (!sim || ended || (e.target as HTMLElement).tagName === "INPUT") return;
  if (document.getElementById("intro")!.classList.contains("show")) return;
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
  updatePanels(sim!.state);
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
