// Helpers for tests: do things the long way, the way the player has to (fetch from the stockroom, collect output,
// finish and bag, shelve, stage packages). Not used by the game itself.
import type { Job, PaperStock, StockItem, TaskRequest } from "./types";
import { startTask, tick, type Sim } from "./sim";
import { itemForTray } from "./inventory";
import { jobById, printerById } from "./util";

export function runUntil(sim: Sim, cond: () => boolean, limit = 6 * 3600): void {
  for (let i = 0; i < limit && !cond(); i++) tick(sim, 1);
  if (!cond()) throw new Error(`condition not met within ${limit}s of sim time`);
}

// Start a task and run until it's done. Throws with the reason if it can't start.
export function doTask(sim: Sim, req: TaskRequest): void {
  const err = startTask(sim.state, req);
  if (err) throw new Error(`${req.type}: ${err}`);
  runUntil(sim, () => sim.state.employee.task === null);
}

export function fetch(sim: Sim, item: StockItem): void {
  doTask(sim, { type: "take_stock", item });
}

// Get paper from the stockroom, load it, and put back whatever's left over.
export function loadPaper(sim: Sim, printerId: string, stock: PaperStock): void {
  fetch(sim, itemForTray(stock));
  doTask(sim, { type: "load_paper", printerId, stock });
  if (sim.state.employee.hands) doTask(sim, { type: "put_back" });
}

export function replaceToner(sim: Sim, printerId: string): void {
  fetch(sim, printerById(sim.state, printerId)!.supply);
  doTask(sim, { type: "replace_toner", printerId });
}

// Carry every sheet of a job from its printer's output tray to the finishing table.
export function collectAll(sim: Sim, job: Job): void {
  const s = sim.state;
  for (let guard = 0; guard < 500; guard++) {
    if (job.status === "printed" && job.tableSheets >= job.sheets - 1e-6) return;
    const p = s.printers.find((x) => x.output.some((o) => o.jobId === job.id));
    if (!p) {
      runUntil(sim, () => s.printers.some((x) => x.output.some((o) => o.jobId === job.id)) || (job.status === "printed" && job.tableSheets >= job.sheets - 1e-6));
      continue;
    }
    // Clear anything ahead of it in the tray onto the table too.
    doTask(sim, { type: "collect_output", printerId: p.id });
    doTask(sim, { type: "drop_output" });
  }
  throw new Error(`couldn't collect order #${job.id}`);
}

// The whole back half of a job: output tray, finishing table, bag, pickup shelf.
export function finishAndShelve(sim: Sim, job: Job): void {
  collectAll(sim, job);
  doTask(sim, { type: "finish_job", jobId: job.id });
  doTask(sim, { type: "shelve" });
}

export function job(sim: Sim, id: number): Job {
  return jobById(sim.state, id)!;
}
