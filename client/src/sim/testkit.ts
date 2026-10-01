// Helpers for tests: run the clock, and do a task start to finish.
import { expect } from "vitest";
import { startTask, tick, type Sim } from "./sim";
import type { CounterChoice, Customer, Job, TaskRequest } from "./types";

export function runUntil(sim: Sim, done: () => boolean, limit = 3600): void {
  for (let i = 0; i < limit && !done(); i++) tick(sim, 1);
  expect(done()).toBe(true);
}

// Starts a task (it has to be allowed) and runs the clock until it's done.
export function doTask(sim: Sim, req: TaskRequest): void {
  expect(startTask(sim.state, req)).toBeNull();
  runUntil(sim, () => sim.state.employee.task === null);
}

// Talks to the customer at the counter and answers them.
export function talkTo(sim: Sim, c: Customer, choice: CounterChoice = "proper"): void {
  doTask(sim, { type: "talk", customerId: c.id });
  doTask(sim, { type: "respond", customerId: c.id, choice });
}

// Collects a printed order, reprinting it as long as it comes out smudged.
export function collect(sim: Sim, job: Job): void {
  for (;;) {
    runUntil(sim, () => job.status === "printed");
    doTask(sim, { type: "collect", jobId: job.id });
    if (job.smudge !== "found") return;
    doTask(sim, { type: "reprint", jobId: job.id });
  }
}
