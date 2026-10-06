import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canStart, createSim, startTask, tick, type Sim } from "./sim";
import { placeWebOrder, returnCustomer, spawnCustomer } from "./customers";
import { DURATIONS, PRINTER, RESPOND_MINUTES } from "./config";
import { currentStep } from "./workflow";
import { doTask, makeReady, runUntil, talkTo, calm } from "./testkit";
import type { JobSpec } from "./types";

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

describe("each request, arrival to done, as workflows", () => {
  it("quick copies taken at the counter are full service, same as 200 pages: the order form, the production printer", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "quick_copies", { spec: plain({ originals: 3, copies: 10, finishing: "staple" }), timing: "wait", needIn: 300 });
    doTask(sim, { type: "talk", customerId: c.id });
    doTask(sim, { type: "respond", customerId: c.id, choice: "take" });
    expect(s.workflow?.kind).toBe("take_order");
    expect(currentStep(s)?.type).toBe("enter_order"); // nothing goes to the self-serve copier unless you send them
    const job = s.jobs[0];
    expect(job.serviceFeeCents).toBeGreaterThan(0); // the small-order fee
    doTask(sim, { ...currentStep(s)!.req, entry: { ...job.spec } });
    expect(job.status === "queued" || job.status === "printing").toBe(true);
    expect(c.state).toBe("waiting");
    makeReady(sim, job);
    expect(job.status).toBe("bagged");
  });

  it("a production order (cardstock): taking it enters and sends it on its own; you staple it (or not), it's bagged", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "quick_copies", { spec: plain({ copies: 10, media: "cardstock", finishing: "staple" }), timing: "wait", needIn: 300 });
    talkTo(sim, c);
    expect(c.state).toBe("waiting");
    const job = s.jobs[0];
    expect(job.status === "queued" || job.status === "printing").toBe(true); // entered and sent
    expect(s.workflow).toBeNull();
    runUntil(sim, () => job.status === "printed");
    doTask(sim, { type: "collect", jobId: job.id });
    if (job.smudge === "found") doTask(sim, { type: "reprint", jobId: job.id });
    makeReady(sim, job);
    expect(job.status).toBe("bagged");
    expect(job.skipped).toBe(false);
    doTask(sim, { type: "fetch_bag", customerId: c.id, jobId: job.id }); // off the shelf, then rung up
    expect(c.outcome).toBe("served");
  });

  it("a larger job: they come back later for it", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "large_job", { spec: plain({ originals: 4, copies: 30, duplex: true, finishing: "cut" }), timing: "back", needIn: 400 });
    talkTo(sim, c);
    expect(c.state).toBe("away");
    makeReady(sim, s.jobs[0]);
    returnCustomer(s, c);
    expect(c.kind).toBe("order_pickup");
    talkTo(sim, c); // rings them up on its own
    expect(c.outcome).toBe("served");
  });

  it("poster: printed big and laminated", () => {
    const sim = quiet();
    const c = spawnCustomer(sim.state, sim.rng.director, "poster", { timing: "wait" });
    expect(c.spec!.finishing).toBe("laminate");
    talkTo(sim, c);
    makeReady(sim, sim.state.jobs[0]);
    doTask(sim, { type: "fetch_bag", customerId: c.id, jobId: sim.state.jobs[0].id });
    expect(c.outcome).toBe("served");
  });

  it("ship: you choose how to pack it; then tape, weigh, label, ring up (they go), bin", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "ship", { weightLb: 12 });
    talkTo(sim, c);
    const pkg = s.packages[0];
    expect(pkg.status).toBe("new"); // it waits for your choice
    expect(s.workflow?.kind).toBe("ship");
    expect(canStart(s, { type: "pack", packageId: pkg.id, box: "small" })).toBe("It doesn't fit in a small box.");
    doTask(sim, { type: "pack", packageId: pkg.id, box: "large" }); // a bigger box is fine
    expect(pkg.status).toBe("binned"); // taped, weighed, labeled, rung up, binned
    expect(pkg.label).toEqual({ weightLb: 12, service: c.service });
    expect(c.outcome).toBe("served");
    expect(s.revenueCents).toBeGreaterThan(0);
    expect(s.workflow).toBeNull();
    runUntil(sim, () => s.truck.status === "waiting");
    doTask(sim, { type: "hand_off" });
    expect(pkg.status).toBe("shipped");
  });

  it("drop-off: scan it, they go, bin it", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "dropoff");
    talkTo(sim, c);
    expect(c.outcome).toBe("served");
    expect(s.packages.find((p) => p.customerId === c.id)!.status).toBe("binned");
  });

  it("held package: find it, hand it over", () => {
    const sim = quiet();
    const c = spawnCustomer(sim.state, sim.rng.director, "package_pickup");
    talkTo(sim, c);
    expect(c.outcome).toBe("served");
    expect(sim.state.packages[0].status).toBe("picked_up");
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
    makeReady(sim, job);
    returnCustomer(s, c);
    talkTo(sim, c); // handed over on its own (it's paid for)
    expect(c.outcome).toBe("served");
  });

  it("self-serve help with a broken copier: Do fixes it first, then helps them", () => {
    const sim = quiet();
    const s = sim.state;
    s.copier.status = "broken";
    const c = spawnCustomer(s, sim.rng.director, "self_serve_help");
    talkTo(sim, c);
    expect(s.copier.status).toBe("ok");
    expect(c.outcome).toBe("served");
  });
});

describe("the printer", () => {
  it("prints at its speed after a short warm-up", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "large_job", { spec: plain({ copies: 90 }), timing: "back", needIn: 300 });
    talkTo(sim, c); // enters and sends it
    const start = s.time;
    const job = s.jobs[0];
    runUntil(sim, () => job.status === "printed");
    // It starts in the same second the send finishes.
    expect(s.time - start).toBe(PRINTER.warmup + 90 / PRINTER.sheetsPerMinute - 1);
  });

  it("an empty tray stops it mid-job; loading paper is one task and it picks up where it left off", () => {
    const sim = quiet();
    const s = sim.state;
    s.printer.paperOutAt = 20;
    const c = spawnCustomer(s, sim.rng.director, "large_job", { spec: plain({ copies: 50 }), timing: "back", needIn: 300 });
    talkTo(sim, c); // enters and sends it
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
    for (const d of Object.values(DURATIONS)) {
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(30);
    }
  });
});
