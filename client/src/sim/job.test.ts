import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canStart, createSim, startTask, tick, type Sim } from "./sim";
import { placeWebOrder, returnCustomer, spawnCustomer } from "./customers";
import { DURATIONS, PRINTER, RESPOND_MINUTES } from "./config";
import { walkUpMinutes } from "./orders";
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
  it("quick copies, done yourself while they wait: you make them, ring them up, done (and locked in the whole time)", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "quick_copies", { spec: plain({ originals: 3, copies: 10, finishing: "staple" }), timing: "wait", needIn: 300 });
    doTask(sim, { type: "talk", customerId: c.id });
    const start = s.time;
    expect(startTask(s, { type: "respond", customerId: c.id, choice: "take" })).toBeNull();
    tick(sim, 3);
    expect(s.workflow?.kind).toBe("walk_up");
    expect(canStart(s, { type: "fix_copier" })).toBe("You can't do that, you're making copies for someone.");
    runUntil(sim, () => s.workflow === null);
    const job = s.jobs[0];
    expect(job.walkUp).toBe(true);
    expect(job.status).toBe("picked_up");
    expect(c.outcome).toBe("served");
    expect(s.revenueCents).toBe(job.priceCents);
    const expected = RESPOND_MINUTES.take + walkUpMinutes(job.spec) + DURATIONS.ring_up;
    expect(s.time - start).toBeGreaterThanOrEqual(expected);
    expect(s.time - start).toBeLessThanOrEqual(expected + 1); // (steps start the minute the last one ends)
  });

  it("a production order (cardstock): taking it enters and sends it on its own; collecting finishes and bags it", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "quick_copies", { spec: plain({ copies: 10, media: "cardstock", finishing: "staple" }), timing: "wait", needIn: 300 });
    talkTo(sim, c);
    expect(c.state).toBe("waiting");
    const job = s.jobs[0];
    expect(job.walkUp).toBe(false);
    expect(job.status === "queued" || job.status === "printing").toBe(true); // entered and sent
    expect(s.workflow).toBeNull();
    runUntil(sim, () => job.status === "printed");
    doTask(sim, { type: "collect", jobId: job.id });
    if (job.smudge === "found") makeReady(sim, job);
    expect(job.status).toBe("bagged"); // stapled and bagged on the way
    doTask(sim, { type: "ring_up", customerId: c.id });
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
    doTask(sim, { type: "ring_up", customerId: c.id });
    expect(c.outcome).toBe("served");
  });

  it("ship: weigh, then you choose how to pack it; box, tape, label (they pay and go), bin", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.director, "ship", { weightLb: 12 });
    talkTo(sim, c);
    const pkg = s.packages[0];
    expect(pkg.status).toBe("weighed"); // weighed on its own, then it waits for your choice
    expect(s.workflow?.kind).toBe("ship");
    doTask(sim, { type: "pack", packageId: pkg.id });
    expect(pkg.status).toBe("binned"); // taped, labeled, binned
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
