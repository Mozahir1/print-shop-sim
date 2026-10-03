// Helpers for tests: run the clock, and do a task start to finish.
import { expect } from "vitest";
import { startTask, tick, type Sim } from "./sim";
import type { CounterAction, Customer, Job, TaskRequest } from "./types";
import { REACTIONS } from "./config";

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
export function talkTo(sim: Sim, c: Customer, choice: CounterAction = "take"): void {
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

// Customers who never balk, always accept a later time, and always agree to self-serve: for tests about something
// else. Returns a function that puts the real odds back.
export function calm(): () => void {
  const saved = { ...REACTIONS };
  Object.assign(REACTIONS, { goAlone: 0, acceptSelfServe: 1, serviceFeeBalk: 0, rushBalk: 0, acceptLater: 1 });
  return () => Object.assign(REACTIONS, saved);
}
