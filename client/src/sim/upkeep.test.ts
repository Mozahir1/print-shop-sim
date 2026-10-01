import { describe, expect, it } from "vitest";
import { canStart, counterCustomer, createSim, startTask, tick, type Sim } from "./sim";
import { botAct, createBot } from "./bot";
import { breakPrinter, spawnCustomer } from "./dev";
import { UPKEEP } from "./config";
import type { Customer, Job, JobSpec } from "./types";

function runUntil(sim: Sim, cond: () => boolean, limit = 6 * 3600) {
  for (let i = 0; i < limit && !cond(); i++) tick(sim, 1);
  expect(cond()).toBe(true);
}

// No scheduled customers, calls, breakdowns or jams unless a test sets them up.
function quiet(): Sim {
  const sim = createSim(1);
  const s = sim.state;
  s.customers = [];
  s.calls = [];
  s.packages = [];
  for (const p of s.printers) {
    p.breakdown = null;
    p.sheetsUntilJam = Infinity;
    p.toner = 100;
    for (const t of p.trays) t.level = t.capacity;
  }
  for (const cp of s.copiers) cp.sheetsUntilJam = Infinity;
  return sim;
}

function selfServeCustomer(sim: Sim, originals: number, patienceMin = 60): Customer {
  const c = spawnCustomer(sim.state, "quick_copies", "wait", false, "alone");
  c.request!.spec = { item: "document", originals, copies: 1, color: "bw", media: "letter", duplex: false, finishing: "none" };
  c.linePatience = patienceMin * 60;
  return c;
}

// Takes an order at the counter and (unless printerId is null) sends it to a printer. Returns the job.
function printJob(sim: Sim, spec: Partial<JobSpec>, printerId: string | null): Job {
  const c = spawnCustomer(sim.state, "quick_copies", "back", false, "full_service");
  c.request!.spec = { item: "document", originals: 1, copies: 600, color: "bw", media: "letter", duplex: false, finishing: "none", ...spec };
  runUntil(sim, () => counterCustomer(sim.state)?.id === c.id);
  startTask(sim.state, { type: "take_order" });
  runUntil(sim, () => c.jobId !== null);
  const job = sim.state.jobs.find((j) => j.id === c.jobId)!;
  if (printerId === null) return job;
  expect(startTask(sim.state, { type: "send_job", jobId: job.id, printerId })).toBeNull();
  runUntil(sim, () => job.status === "queued" || job.status === "printing");
  return job;
}

describe("self-serve copiers", () => {
  it("start each shift full", () => {
    for (const cp of createSim(9).state.copiers) expect(cp.paper).toBe(UPKEEP.copierCapacity);
  });

  it("a jam stops the copier mid-job and the customer waits until you clear it", () => {
    const sim = quiet();
    const s = sim.state;
    s.copiers[0].sheetsUntilJam = 10;
    const c = selfServeCustomer(sim, 40);
    runUntil(sim, () => s.copiers[0].status === "jammed");
    const left = s.copiers[0].work!.sidesLeft;
    for (let i = 0; i < 300; i++) tick(sim, 1);
    expect(s.copiers[0].work!.sidesLeft).toBe(left); // nothing happens while it's jammed
    expect(c.state).toBe("self_serve");

    expect(startTask(s, { type: "fix_copier", copierId: 1 })).toBeNull();
    runUntil(sim, () => c.outcome !== null);
    expect(c.outcome).toBe("self_served");
    expect(s.revenueCents).toBeGreaterThan(0);
  });

  it("if nobody fixes it, the customer gives up: no sale and a bad rating", () => {
    const sim = quiet();
    const s = sim.state;
    s.copiers[0].sheetsUntilJam = 5;
    const c = selfServeCustomer(sim, 40, 8);
    runUntil(sim, () => c.outcome !== null);
    expect(c.outcome).toBe("copier_gave_up");
    expect(c.rating).toBe(1);
    expect(s.revenueCents).toBe(0);
    expect(s.stats.copierGaveUp).toBe(1);
    expect(s.copiers[0].userId).toBeNull();
  });

  it("runs out of paper and resumes after a refill from the stockroom", () => {
    const sim = quiet();
    const s = sim.state;
    s.copiers[0].paper = 15;
    s.stockroom.letter = 5000;
    const c = selfServeCustomer(sim, 40);
    runUntil(sim, () => s.copiers[0].status === "out_of_paper");
    expect(startTask(s, { type: "refill_copier", copierId: 1 })).toBeNull();
    runUntil(sim, () => c.outcome !== null);
    expect(c.outcome).toBe("self_served");
    expect(s.stockroom.letter).toBe(5000 - (UPKEEP.copierCapacity - 0));
  });
});

describe("printer breakdowns", () => {
  it("a broken printer stays down until the technician is done", () => {
    const sim = quiet();
    const s = sim.state;
    const job = printJob(sim, { copies: 2000 }, "bw");
    runUntil(sim, () => job.sheetsPrinted > 50);
    breakPrinter(s, "bw");
    runUntil(sim, () => s.printers[0].status === "needs_service");
    const printed = job.sheetsPrinted;
    for (let i = 0; i < 500; i++) tick(sim, 1);
    expect(job.sheetsPrinted).toBe(printed);
    expect(canStart(s, { type: "clear_jam", printerId: "bw" })).not.toBeNull(); // you can't clear it yourself

    runUntil(sim, () => s.printers[0].breakdown!.phase === "fixed");
    runUntil(sim, () => job.status === "printed");
  });

  it("breaks on about 6% of printer-days", () => {
    let broken = 0;
    let total = 0;
    for (let seed = 1; seed <= 400; seed++) {
      for (const p of createSim(seed).state.printers) {
        total++;
        if (p.breakdown) broken++;
      }
    }
    expect(broken / total).toBeGreaterThan(0.035);
    expect(broken / total).toBeLessThan(0.085);
  });

  it("a recalled job can be sent to another printer and finishes with the right count", () => {
    const sim = quiet();
    const s = sim.state;
    const job = printJob(sim, { copies: 1000 }, "bw");
    runUntil(sim, () => job.sheetsPrinted > 100);
    breakPrinter(s, "bw");
    runUntil(sim, () => s.printers[0].status === "needs_service");
    const done = job.sheetsPrinted;

    expect(startTask(s, { type: "recall_job", jobId: job.id })).toBeNull();
    runUntil(sim, () => job.status === "unsent");
    expect(job.sheetsPrinted).toBe(done); // nothing already printed is lost
    expect(s.printers[0].currentJobId).toBeNull();

    const colorLetterBefore = s.printers[1].trays[0].level;
    expect(startTask(s, { type: "send_job", jobId: job.id, printerId: "color" })).toBeNull();
    runUntil(sim, () => job.status === "printed");
    expect(job.sheetsPrinted).toBe(1000);
    expect(Math.round(colorLetterBefore - s.printers[1].trays[0].level)).toBe(Math.round(1000 - done)); // only the rest
  });

  it("you can't recall a job that's printing fine", () => {
    const sim = quiet();
    const job = printJob(sim, { copies: 1500 }, "bw");
    runUntil(sim, () => job.status === "printing" && sim.state.printers[0].status === "printing");
    expect(canStart(sim.state, { type: "recall_job", jobId: job.id })).toMatch(/printing fine/);
  });

  it("can't send work to a broken printer", () => {
    const sim = quiet();
    breakPrinter(sim.state, "color");
    tick(sim, 1);
    const job = printJob(sim, {}, null);
    expect(canStart(sim.state, { type: "send_job", jobId: job.id, printerId: "color" })).toMatch(/down until the technician/);
    expect(canStart(sim.state, { type: "send_job", jobId: job.id, printerId: "bw" })).toBeNull();
  });
});

describe("jam waste", () => {
  it("a jam ruins a few sheets that get printed again", () => {
    const sim = quiet();
    const s = sim.state;
    const job = printJob(sim, { copies: 500 }, "bw");
    s.printers[0].sheetsUntilJam = 100;
    runUntil(sim, () => s.printers[0].status === "jammed");
    const ruined = s.stats.wastedSheets;
    expect(ruined).toBeGreaterThanOrEqual(1);
    expect(ruined).toBeLessThanOrEqual(5);
    expect(job.sheetsPrinted).toBeLessThan(100);
    startTask(s, { type: "clear_jam", printerId: "bw" });
    runUntil(sim, () => job.status === "printed");
    expect(Math.round(s.stats.sheets)).toBe(500 + ruined); // the ruined ones were printed twice
  });
});

describe("the bot does upkeep", () => {
  it("fixes a jammed copier with a customer stuck at it", () => {
    const sim = quiet();
    const s = sim.state;
    s.copiers[0].sheetsUntilJam = 5;
    const c = selfServeCustomer(sim, 40, 30);
    const bot = createBot(10);
    for (let i = 0; i < 3600 && c.outcome === null; i++) {
      botAct(bot, s, 1);
      tick(sim, 1);
    }
    expect(c.outcome).toBe("self_served");
  });

  it("recalls jobs off a broken printer and finishes them elsewhere", () => {
    const sim = quiet();
    const s = sim.state;
    const job = printJob(sim, { copies: 800 }, "bw");
    breakPrinter(s, "bw");
    s.printers[0].breakdown!.techArrivesAt = s.time + 6 * 3600; // not coming any time soon
    s.printers[0].breakdown!.fixedAt = s.time + 7 * 3600;
    const bot = createBot(10);
    for (let i = 0; i < 3600 && job.status !== "printed"; i++) {
      botAct(bot, s, 1);
      tick(sim, 1);
    }
    expect(job.status).toBe("printed");
    expect(s.stats.recalls).toBeGreaterThanOrEqual(1);
  });
});
