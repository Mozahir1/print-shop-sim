// An automated employee, used by batch-sim.ts and the tests to check the day is workable.
// reactionTime is how long it takes to decide on the next thing after starting one, in sim seconds.
import type { Customer, GameState, PaperStock, Printer, TaskRequest } from "./types";
import {
  canStart,
  counterCustomer,
  estimateReadyAt,
  isInterruptible,
  jobById,
  printerBacklog,
  printerCanRun,
  printerSupports,
  quoteDue,
  selfServeBlockerFor,
  servingCustomerId,
  startTask,
} from "./sim";
import { stockFor, takeOrderSeconds } from "./orders";
import { paperShortfall } from "./inventory";
import { ringingCalls } from "./phone";
import { printerStopped } from "./upkeep";
import { packageById, truckNeedsHandoff, unsortedPackages } from "./shipping";

export interface Bot {
  reactionTime: number;
  cooldown: number;
}

export function createBot(reactionTime = 10): Bot {
  return { reactionTime, cooldown: 0 };
}

export function botAct(bot: Bot, state: GameState, dt: number): void {
  bot.cooldown -= dt;
  if (bot.cooldown > 0) return;
  const req = chooseAction(state);
  if (req && startTask(state, req) === null) bot.cooldown = bot.reactionTime;
}

export function chooseAction(state: GameState): TaskRequest | null {
  const cur = state.employee.task;
  const front = counterCustomer(state);

  if (cur) {
    if (!isInterruptible(state, cur) || cur.type !== "finish_job") return null;
    // Put finishing down for the truck, or to help someone at the counter.
    if (truckNeedsHandoff(state)) return { type: "hand_off_truck" };
    const call = ringingCalls(state)[0];
    if (call) return { type: "answer_phone", callId: call.id };
    if (front && servingCustomerId(state) !== front.id) return counterAction(state, front);
    return null;
  }

  // The driver won't wait long.
  if (truckNeedsHandoff(state)) return { type: "hand_off_truck" };

  // Only consider things that can actually be done right now (the stockroom may be out of what a fix needs).
  const can = (req: TaskRequest) => canStart(state, req) === null;

  // A stopped printer with work on it comes first: it's losing time every second.
  for (const p of state.printers) {
    const fix: TaskRequest | null =
      p.status === "jammed"
        ? { type: "clear_jam", printerId: p.id }
        : p.status === "out_of_toner"
          ? { type: "replace_toner", printerId: p.id }
          : p.status === "out_of_paper"
            ? { type: "load_paper", printerId: p.id, stock: emptyTrayStock(state, p) }
            : null;
    if (fix && can(fix)) return fix;
  }
  for (const cp of state.copiers) {
    const fix: TaskRequest | null =
      cp.status === "jammed" ? { type: "fix_copier", copierId: cp.id } : cp.status === "out_of_paper" ? { type: "refill_copier", copierId: cp.id } : null;
    if (fix && can(fix)) return fix;
  }
  // Jobs stuck on a printer that won't be running soon (broken, or no supplies to fix it) go to another one.
  for (const p of state.printers) {
    if (!printerStopped(p) || p.status === "jammed") continue;
    for (const id of [p.currentJobId, ...p.queue]) {
      if (id === null) continue;
      const job = jobById(state, id)!;
      const elsewhere = state.printers.some((o) => o !== p && o.status !== "needs_service" && printerSupports(o, job) && printerCanRun(state, o, job.spec));
      const recall: TaskRequest = { type: "recall_job", jobId: id };
      if (elsewhere && can(recall)) return recall;
    }
  }

  const call = ringingCalls(state)[0];
  if (call) return { type: "answer_phone", callId: call.id };

  if (front) return counterAction(state, front);

  const byDue = (a: { dueAt: number }, b: { dueAt: number }) => a.dueAt - b.dueAt;

  for (const unsent of state.jobs.filter((j) => j.status === "unsent").sort(byDue)) {
    const printer = state.printers
      .filter((p) => can({ type: "send_job", jobId: unsent.id, printerId: p.id }))
      .sort((a, b) => printerBacklog(state, a, unsent.dueAt) - printerBacklog(state, b, unsent.dueAt))[0];
    if (printer) return { type: "send_job", jobId: unsent.id, printerId: printer.id };
  }

  const printed = state.jobs.filter((j) => j.status === "printed").sort(byDue)[0];
  if (printed) return { type: "finish_job", jobId: printed.id };

  if (unsortedPackages(state).length) return { type: "check_in_packages" };

  // Quiet moment: restock the machines from the stockroom.
  for (const cp of state.copiers) {
    const refill: TaskRequest = { type: "refill_copier", copierId: cp.id };
    if (cp.paper < cp.capacity * 0.25 && can(refill)) return refill;
  }
  for (const p of state.printers) {
    const toner: TaskRequest = { type: "replace_toner", printerId: p.id };
    if (p.toner <= 10 && can(toner)) return toner;
    for (const t of p.trays) {
      const load: TaskRequest = { type: "load_paper", printerId: p.id, stock: t.stock };
      if (t.level < t.capacity * 0.2 && can(load)) return load;
    }
  }
  return null;
}

// The tray a stopped printer needs: the one its current job prints from.
function emptyTrayStock(state: GameState, p: Printer): PaperStock {
  const job = p.currentJobId !== null ? jobById(state, p.currentJobId) : undefined;
  return job ? stockFor(job.spec.media) : p.trays.reduce((a, t) => (t.level / t.capacity < a.level / a.capacity ? t : a)).stock;
}

function counterAction(state: GameState, c: Customer): TaskRequest {
  switch (c.purpose) {
    case "pickup": {
      const job = jobById(state, c.jobId!)!;
      return { type: job.status === "ready" ? "ring_up" : "explain_delay" };
    }
    case "ship":
      // No box in the right size and they didn't bring it packed: nothing to put it in.
      return { type: canStart(state, { type: "ship_package" }) === null ? "ship_package" : "turn_away" };
    case "dropoff":
      return { type: "accept_dropoff" };
    case "package":
      // Their package is still in the unsorted delivery: sort it, then they can have it.
      return { type: packageById(state, c.packageId!)!.status === "unsorted" ? "check_in_packages" : "release_package" };
  }
  if (!c.selfServeDeclined && selfServeBlockerFor(c) === null) return { type: "usher_self_serve" };
  const spec = c.request!.spec;
  const due = quoteDue(state, c, state.time + takeOrderSeconds(spec));
  if (paperShortfall(state, spec)) return { type: "turn_away" }; // can't make it with what's on the shelf
  const est = estimateReadyAt(state, spec, due.dueAt);
  const doable = due.tomorrow ? est.at <= state.closeAt + 3600 : est.at <= due.dueAt + 10 * 60;
  return { type: doable ? "take_order" : "turn_away" };
}
