// Machine upkeep: self-serve copier paper and jams, production printer breakdowns that need a technician,
// pulling stuck jobs back off a printer, and the sheets a jam ruins. Random parts come from their own RNG stream.
import type { Copier, GameState, Printer, Task, TaskRequest } from "./types";
import { STOCK, UPKEEP } from "./config";
import { COPIER_SPOTS, REGISTER } from "./layout";
import { randInt, type Rng } from "./rng";
import { fetchSeconds, take } from "./inventory";
import { formatClock } from "./time";
import { jobById, log, printerById } from "./util";

const MIN = 60;
const HOUR = 3600;

// Copiers start each single shift full.
export function createCopiers(rng: Rng): Copier[] {
  return COPIER_SPOTS.map((spot, i) => ({
    id: i + 1,
    spot,
    station: { x: spot.x - 1.1, y: spot.y + 0.75 },
    userId: null,
    work: null,
    status: "ok",
    paper: UPKEEP.copierCapacity,
    capacity: UPKEEP.copierCapacity,
    sheetsUntilJam: rollCopierJam(rng),
    fixSeconds: 0,
    stoppedSince: null,
    sheetsToday: 0,
    jamsToday: 0,
  }));
}

export function rollCopierJam(rng: Rng): number {
  return -UPKEEP.copierMeanSheetsBetweenJams * Math.log(1 - rng());
}

export function rollFixSeconds(rng: Rng): number {
  return randInt(rng, UPKEEP.fixCopierSeconds[0], UPKEEP.fixCopierSeconds[1]);
}

export function rollJamWaste(rng: Rng): number {
  return randInt(rng, UPKEEP.jamWasteSheets[0], UPKEEP.jamWasteSheets[1]);
}

// Each production printer has a small chance of an error today that only a technician can clear.
// Every printer rolls the same number of times whether it breaks or not, so the stream stays stable.
export function rollBreakdowns(rng: Rng, printers: Printer[], closeAt: number): void {
  for (const p of printers) {
    const breaks = rng() < UPKEEP.breakdownChance;
    const at = Math.round(30 * MIN + rng() * (closeAt - 2 * HOUR));
    const techArrivesAt = at + Math.round((UPKEEP.techDelayHours[0] + rng() * (UPKEEP.techDelayHours[1] - UPKEEP.techDelayHours[0])) * HOUR);
    const fixedAt = techArrivesAt + randInt(rng, UPKEEP.techWorkMinutes[0], UPKEEP.techWorkMinutes[1]) * MIN;
    p.breakdown = breaks ? { at, techArrivesAt, fixedAt, phase: "pending" } : null;
  }
}

export function printerStopped(p: Printer): boolean {
  return p.status === "jammed" || p.status === "out_of_paper" || p.status === "out_of_toner" || p.status === "needs_service";
}

export function runBreakdowns(state: GameState): void {
  for (const p of state.printers) {
    const b = p.breakdown;
    if (!b || b.phase === "fixed") continue;
    if (b.phase === "pending" && state.time >= b.at) {
      b.phase = "down";
      p.status = "needs_service";
      state.stats.breakdowns++;
      log(state, `The ${p.short} printer is showing an error you can't clear. A service technician is booked for about ${formatClock(b.techArrivesAt)}.`);
    }
    if (b.phase === "down" && state.time >= b.techArrivesAt) {
      b.phase = "tech";
      log(state, `The service technician is here working on the ${p.short} printer.`);
    }
    if (b.phase === "tech" && state.time >= b.fixedAt) {
      b.phase = "fixed";
      p.status = p.currentJobId !== null ? "printing" : "idle"; // a jam or empty tray will show up again on its own
      log(state, `The technician fixed the ${p.short} printer.`);
    }
  }
}

// ---------- tasks ----------

export function canStartUpkeep(state: GameState, req: TaskRequest): string | null {
  switch (req.type) {
    case "fix_copier": {
      const cp = copierById(state, req.copierId ?? -1);
      if (!cp) return "No such copier.";
      if (cp.status !== "jammed") return `Self-serve copier ${cp.id} isn't jammed.`;
      return null;
    }
    case "refill_copier": {
      const cp = copierById(state, req.copierId ?? -1);
      if (!cp) return "No such copier.";
      if (cp.paper >= cp.capacity - 0.5) return `Self-serve copier ${cp.id} is full.`;
      if (state.stockroom.letter < 1) return "There's no letter paper left in the stockroom.";
      return null;
    }
    case "recall_job": {
      const job = jobById(state, req.jobId ?? -1);
      if (!job) return "No such order.";
      if (job.status === "queued") return null;
      if (job.status !== "printing") return `Order #${job.id} isn't on a printer.`;
      const p = printerById(state, job.printerId!)!;
      if (!printerStopped(p)) return `Order #${job.id} is printing fine on the ${p.short} printer. Let it finish.`;
      return null;
    }
    default:
      return "Not an upkeep task.";
  }
}

export function buildUpkeepTask(state: GameState, req: TaskRequest): Task {
  const base = { ...req, elapsed: 0 };
  switch (req.type) {
    case "fix_copier": {
      const cp = copierById(state, req.copierId!)!;
      return { ...base, label: `Clearing a jam in self-serve copier ${cp.id}`, station: cp.station, duration: cp.fixSeconds };
    }
    case "refill_copier": {
      const cp = copierById(state, req.copierId!)!;
      return { ...base, label: `Refilling self-serve copier ${cp.id}`, station: cp.station, duration: UPKEEP.refillCopierSeconds + fetchSeconds(cp.station) };
    }
    case "recall_job": {
      const job = jobById(state, req.jobId!)!;
      const p = printerById(state, job.printerId!)!;
      return { ...base, label: `Pulling order #${job.id} off the ${p.short} printer`, station: REGISTER, duration: UPKEEP.recallSeconds };
    }
    default:
      throw new Error(`not an upkeep task: ${req.type}`);
  }
}

export function completeUpkeepTask(state: GameState, task: Task): void {
  switch (task.type) {
    case "fix_copier": {
      const cp = copierById(state, task.copierId!)!;
      cp.status = cp.paper > 0 ? "ok" : "out_of_paper";
      if (cp.status === "ok") cp.stoppedSince = null;
      log(state, `Cleared the jam in self-serve copier ${cp.id}.`);
      return;
    }
    case "refill_copier": {
      const cp = copierById(state, task.copierId!)!;
      const amount = Math.min(Math.floor(cp.capacity - cp.paper), state.stockroom.letter);
      if (amount <= 0) return;
      cp.paper += amount;
      take(state, "letter", amount);
      state.stats.copierRefills++;
      if (cp.status === "out_of_paper") {
        cp.status = "ok";
        cp.stoppedSince = null;
      }
      log(state, `Refilled self-serve copier ${cp.id} with ${amount.toLocaleString("en-US")} sheets of ${STOCK.letter.label.toLowerCase()}.`);
      return;
    }
    case "recall_job": {
      const job = jobById(state, task.jobId!)!;
      if (job.status !== "queued" && job.status !== "printing") return;
      const p = printerById(state, job.printerId!)!;
      p.queue = p.queue.filter((id) => id !== job.id);
      if (p.currentJobId === job.id) {
        p.currentJobId = null;
        // A jam or a broken printer stays that way; an empty tray or toner was only a problem for this job.
        if (p.status === "out_of_paper" || p.status === "out_of_toner") p.status = "idle";
      }
      job.status = "unsent";
      job.printerId = null;
      state.stats.recalls++;
      log(state, `Pulled order #${job.id} off the ${p.short} printer (${Math.floor(job.sheetsPrinted)} of ${job.sheets} sheets already done). It can go to another printer.`);
      return;
    }
  }
}

export function copierById(state: GameState, id: number): Copier | undefined {
  return state.copiers.find((c) => c.id === id);
}

