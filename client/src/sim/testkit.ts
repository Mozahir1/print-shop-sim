// Helpers for tests: run the clock, and do a task start to finish.
import { expect } from "vitest";
import { startTask, tick, type Sim } from "./sim";
import type { CounterAction, Customer, Job, OrderEntry, TaskRequest } from "./types";
import { currentStep } from "./workflow";
import { jobById } from "./util";
import { REACTIONS } from "./config";

export function runUntil(sim: Sim, done: () => boolean, limit = 3600): void {
  for (let i = 0; i < limit && !done(); i++) tick(sim, 1);
  expect(done()).toBe(true);
}

// Starts a task (it has to be allowed) and runs the clock until you're free: inside a workflow the next steps run
// on by themselves, so that's when it ends or stops at a choice.
export function doTask(sim: Sim, req: TaskRequest): void {
  expect(startTask(sim.state, req)).toBeNull();
  runUntil(sim, () => sim.state.employee.task === null);
}

// Talks to the customer at the counter and answers them. Taking a print order goes on to the order form, filled in
// exactly as they asked (pass an entry to get it wrong).
export function talkTo(sim: Sim, c: Customer, choice: CounterAction = "take", entry?: Partial<OrderEntry>): void {
  doTask(sim, { type: "talk", customerId: c.id });
  doTask(sim, { type: "respond", customerId: c.id, choice });
  const step = currentStep(sim.state);
  if (step?.type === "enter_order") doTask(sim, { ...step.req, entry: entry && { ...jobById(sim.state, step.req.jobId!)!.spec, ...entry } });
}

// Gets an order all the way to bagged from wherever it is, the way you would: steps run on by themselves inside a
// workflow; a smudged run gets reprinted.
export function makeReady(sim: Sim, job: Job): void {
  const s = sim.state;
  const idle = () => runUntil(sim, () => s.employee.task === null);
  for (let guard = 0; guard < 30 && job.status !== "bagged"; guard++) {
    idle();
    if (s.workflow) {
      // Paused at a choice in this job's workflow (a smudged run): do it properly.
      if (job.smudge === "found" && job.status === "collected") doTask(sim, { type: "reprint", jobId: job.id });
      else if (currentStep(s)?.type === "finish") doTask(sim, { type: "finish", jobId: job.id });
      else throw new Error(`makeReady: stuck in a workflow (${s.workflow.kind})`);
      continue;
    }
    if (job.status === "new") doTask(sim, { type: "enter_order", jobId: job.id });
    else if (job.status === "entered") doTask(sim, { type: "send_job", jobId: job.id });
    else if (job.status === "queued" || job.status === "printing") runUntil(sim, () => job.status === "printed");
    else if (job.status === "printed") doTask(sim, { type: "collect", jobId: job.id });
    else if (job.status === "collected" && job.smudge === "found") doTask(sim, { type: "reprint", jobId: job.id });
    else if (job.status === "collected" && job.spec.finishing !== "none") doTask(sim, { type: "finish", jobId: job.id });
    else if (job.status === "collected" || job.status === "finished") doTask(sim, { type: "bag", jobId: job.id });
  }
  expect(job.status).toBe("bagged");
}

// Customers who never balk, always accept a later time, and always agree to self-serve: for tests about something
// else. Returns a function that puts the real odds back.
export function calm(): () => void {
  const saved = { ...REACTIONS };
  Object.assign(REACTIONS, { goAlone: 0, acceptSelfServe: 1, serviceFeeBalk: 0, rushBalk: 0, acceptLater: 1 });
  return () => Object.assign(REACTIONS, saved);
}
