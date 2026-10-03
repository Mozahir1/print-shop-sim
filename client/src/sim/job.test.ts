import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canStart, createSim, tick, type Sim } from "./sim";
import { placeWebOrder, returnCustomer, spawnCustomer } from "./customers";
import { DURATIONS, FINISH_SECONDS, PRINTER } from "./config";
import { collect, doTask, runUntil, talkTo, calm } from "./testkit";
import type { Customer, JobSpec } from "./types";

// These are about the work, not how customers react: nobody balks.
let restore: () => void;
beforeEach(() => (restore = calm()));
afterEach(() => restore());

const plain = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "document", originals: 1, copies: 1, color: "bw", media: "letter", duplex: false, finishing: "none", ...s });

function quiet(): Sim {
  const sim = createSim(1);
  sim.state.printer.paperOutAt = Infinity;
  sim.state.director.enabled = false; // only the customers each test brings in
  return sim;
}

// Counter -> computer -> printer -> finishing table: what every print order goes through.
function makeIt(sim: Sim, c: Customer) {
  const jobId = c.jobId!;
  const job = sim.state.jobs.find((j) => j.id === jobId)!;
  if (job.status === "new") doTask(sim, { type: "enter_order", jobId });
  doTask(sim, { type: "send_job", jobId });
  collect(sim, job);
  if (job.spec.finishing !== "none") doTask(sim, { type: "finish", jobId });
  doTask(sim, { type: "bag", jobId });
  expect(job.status).toBe("bagged");
  return job;
}

describe("each request, arrival to done, using only tasks", () => {
  it("quick copies: talk, enter, send, print, collect, bag, ring up", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "quick_copies", { spec: plain({ copies: 10, finishing: "staple" }) });
    talkTo(sim, c);
    expect(c.state).toBe("waiting");
    const job = makeIt(sim, c);
    doTask(sim, { type: "ring_up", customerId: c.id });
    expect(job.status).toBe("picked_up");
    expect(c.outcome).toBe("served");
    expect(s.revenueCents).toBe(job.priceCents);
  });

  it("a larger job: they come back later for it", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "large_job", { spec: plain({ originals: 4, copies: 30, duplex: true, finishing: "cut" }), timing: "back", needIn: 400 });
    talkTo(sim, c);
    expect(c.state).toBe("away");
    makeIt(sim, c);
    returnCustomer(s, c);
    expect(c.kind).toBe("order_pickup");
    talkTo(sim, c);
    doTask(sim, { type: "ring_up", customerId: c.id });
    expect(c.outcome).toBe("served");
  });

  it("poster: printed big and laminated", () => {
    const sim = quiet();
    const c = spawnCustomer(sim.state, sim.rng.director, "poster", { timing: "wait" });
    expect(c.spec!.finishing).toBe("laminate");
    talkTo(sim, c);
    makeIt(sim, c);
    doTask(sim, { type: "ring_up", customerId: c.id });
    expect(c.outcome).toBe("served");
  });

  it("ship: weigh, pack, label (they pay and go), bin, then the truck takes it", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "ship", { weightLb: 12 });
    talkTo(sim, c);
    const packageId = c.packageId!;
    for (const type of ["weigh", "pack", "label"] as const) doTask(sim, { type, packageId });
    expect(c.outcome).toBe("served");
    expect(s.revenueCents).toBeGreaterThan(0);
    doTask(sim, { type: "bin", packageId });
    runUntil(sim, () => s.truck.status === "waiting");
    doTask(sim, { type: "hand_off" });
    expect(s.packages.find((p) => p.id === packageId)!.status).toBe("shipped");
  });

  it("drop-off: scan it, they go, bin it", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "dropoff");
    talkTo(sim, c);
    doTask(sim, { type: "scan_dropoff", customerId: c.id });
    expect(c.outcome).toBe("served");
    const pkg = s.packages.find((p) => p.customerId === c.id)!;
    doTask(sim, { type: "bin", packageId: pkg.id });
    expect(pkg.status).toBe("binned");
  });

  it("held package: find it, hand it over", () => {
    const sim = quiet();
    const c = spawnCustomer(sim.state, sim.rng.director, "package_pickup");
    talkTo(sim, c);
    expect(sim.state.employee.task).toBeNull();
    doTask(sim, { type: "find_package", customerId: c.id });
    doTask(sim, { type: "hand_over", customerId: c.id });
    expect(c.outcome).toBe("served");
  });

  it("web order: open it in the inbox (paid online), make it, hand it over when they come in", () => {
    const sim = quiet();
    const s = sim.state;
    const job = placeWebOrder(s, sim.rng.director, { spec: plain({ copies: 20 }) });
    const c = s.customers.find((x) => x.id === job.customerId)!;
    const msg = s.messages.find((m) => m.jobId === job.id)!;
    expect(job.status).toBe("unread");
    doTask(sim, { type: "open_message", messageId: msg.id });
    expect(job.status).toBe("entered");
    expect(s.revenueCents).toBe(job.priceCents);
    makeIt(sim, c);
    returnCustomer(s, c);
    talkTo(sim, c);
    doTask(sim, { type: "hand_over", customerId: c.id });
    expect(c.outcome).toBe("served");
  });

  it("self-serve help, and a broken copier has to be fixed first", () => {
    const sim = quiet();
    const s = sim.state;
    s.copier.status = "broken";
    const c = spawnCustomer(s, sim.rng.director, "self_serve_help");
    talkTo(sim, c);
    expect(canStart(s, { type: "help_self_serve", customerId: c.id })).toMatch(/broken/);
    doTask(sim, { type: "fix_copier" });
    doTask(sim, { type: "help_self_serve", customerId: c.id });
    expect(c.outcome).toBe("served");
  });
});

describe("the printer", () => {
  it("prints at its speed after a short warm-up", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "quick_copies", { spec: plain({ copies: 80 }) });
    talkTo(sim, c);
    doTask(sim, { type: "enter_order", jobId: c.jobId! });
    doTask(sim, { type: "send_job", jobId: c.jobId! });
    const start = s.time;
    const job = s.jobs[0];
    runUntil(sim, () => job.status === "printed");
    // It starts in the same second the send finishes.
    expect(s.time - start).toBe(PRINTER.warmup + 80 / PRINTER.sheetsPerSecond - 1);
  });

  it("an empty tray stops it mid-job; loading paper is one task and it picks up where it left off", () => {
    const sim = quiet();
    const s = sim.state;
    s.printer.paperOutAt = 20;
    const c = spawnCustomer(s, sim.rng.director, "quick_copies", { spec: plain({ copies: 50 }) });
    talkTo(sim, c);
    doTask(sim, { type: "enter_order", jobId: c.jobId! });
    doTask(sim, { type: "send_job", jobId: c.jobId! });
    runUntil(sim, () => s.printer.status === "tray_empty");
    const job = s.jobs[0];
    expect(job.sheetsPrinted).toBe(20);
    for (let i = 0; i < 30; i++) tick(sim, 1);
    expect(job.sheetsPrinted).toBe(20); // stays stopped
    doTask(sim, { type: "load_paper" });
    runUntil(sim, () => job.status === "printed");
    expect(job.sheetsPrinted).toBe(50);
  });

  it("the tray runs out at most occasionally, decided by the seed", () => {
    let days = 0;
    for (let seed = 1; seed <= 200; seed++) if (createSim(seed).state.printer.paperOutAt !== Infinity) days++;
    expect(days).toBeGreaterThan(30);
    expect(days).toBeLessThan(110);
  });
});

describe("tasks are short and fixed", () => {
  it("every task takes a few seconds to about 30", () => {
    for (const d of [...Object.values(DURATIONS), ...Object.values(FINISH_SECONDS)]) {
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(30);
    }
  });
});
