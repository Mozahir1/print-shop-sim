import { describe, expect, it } from "vitest";
import {
  canStart,
  counterCustomer,
  createSim,
  isShiftOver,
  jobById,
  sheetsPerSecond,
  startTask,
  stopTask,
  tick,
  type Sim,
} from "./sim";
import { botAct, createBot } from "./bot";
import { collectAll, finishAndShelve, loadPaper } from "./testkit";
import { report, summarize } from "./summary";
import { priceCents, totalSheets, finishSeconds } from "./orders";
import type { Customer, JobSpec } from "./types";

function playShift(seed: number, reaction = 10) {
  const sim = createSim(seed);
  const bot = createBot(reaction);
  while (!isShiftOver(sim.state)) {
    botAct(bot, sim.state, 1);
    tick(sim, 1);
  }
  return sim;
}

function run(sim: Sim, seconds: number) {
  for (let i = 0; i < seconds; i++) tick(sim, 1);
}

// Run until a condition holds (or fail after a sim-hour).
function runUntil(sim: Sim, cond: () => boolean, limit = 3600) {
  for (let i = 0; i < limit && !cond(); i++) tick(sim, 1);
  expect(cond()).toBe(true);
}

// A fresh sim with exactly one customer walking in right now with the given order.
function soloSim(spec: Partial<JobSpec>, timing: NonNullable<Customer["request"]>["timing"] = { kind: "wait", minutes: 30 }) {
  const sim = createSim(1);
  const template = sim.state.customers.find((c) => c.purpose === "order")!;
  const c: Customer = {
    ...template,
    id: 1,
    visitAt: 0,
    request: {
      spec: { item: "document", originals: 10, copies: 1, color: "bw", media: "letter", duplex: false, finishing: "none", ...spec },
      timing,
    },
    linePatience: 3600,
    lateTolerance: 3600,
    selfServeRoll: 0.999, // wants full service, so these tests go through the counter
  };
  sim.state.customers = [c];
  for (const p of sim.state.printers) {
    p.sheetsUntilJam = Infinity;
    p.toner = 100;
    for (const t of p.trays) t.level = t.capacity;
  }
  return { sim, c };
}

describe("determinism", () => {
  it("same seed and same play gives the exact same shift", () => {
    expect(summarize(playShift(42).state, "t", "bot")).toEqual(summarize(playShift(42).state, "t", "bot"));
  });

  it("the day's customers don't depend on how you play", () => {
    const idle = createSim(5);
    const busy = playShift(5);
    expect(idle.state.customers.map((c) => c.request)).toEqual(busy.state.customers.map((c) => c.request));
  });
});

describe("orders", () => {
  it("prices from the price list", () => {
    // 10 pages x 5 copies B&W letter = 50 sides at 15c
    expect(priceCents({ item: "x", originals: 10, copies: 5, color: "bw", media: "letter", duplex: true, finishing: "staple" })).toBe(750);
    // 2 color posters at 24x36
    expect(priceCents({ item: "x", originals: 2, copies: 1, color: "color", media: "wide_24x36", duplex: false, finishing: "none" })).toBe(8000);
  });

  it("double-sided halves the sheets", () => {
    expect(totalSheets({ item: "x", originals: 9, copies: 4, color: "bw", media: "letter", duplex: true, finishing: "none" })).toBe(20);
  });
});

describe("a whole order, start to finish", () => {
  it("take order -> send -> prints at the printer's speed -> finish -> ring up", () => {
    const { sim, c } = soloSim({ originals: 10, copies: 13 }); // 130 sheets
    const s = sim.state;
    expect(canStart(s, { type: "take_order" })).toBe("Nobody is at the counter.");

    runUntil(sim, () => counterCustomer(s)?.id === c.id);
    expect(startTask(s, { type: "take_order" })).toBeNull();
    runUntil(sim, () => s.jobs.length === 1);
    const job = s.jobs[0];
    expect(job.status).toBe("unsent");
    expect(c.state).toBe("seated");

    expect(startTask(s, { type: "send_job", jobId: job.id, printerId: "color" })).toBeNull();
    runUntil(sim, () => job.status === "printing");
    const started = s.time;
    runUntil(sim, () => job.status === "printed");
    // 130 sheets at 65 ppm is 2 min, plus 20s warm-up. (We sent it to color: 45 ppm, 30s warm-up.)
    const expected = 30 + 130 / sheetsPerSecond(s.printers[1], job);
    expect(s.time - started).toBeGreaterThanOrEqual(expected - 2);
    expect(s.time - started).toBeLessThanOrEqual(expected + 2);

    // Phase 8: the sheets go output tray -> hands -> finishing table -> bag -> pickup shelf.
    expect(job.location).toBe("output");
    finishAndShelve(sim, job);
    expect(job.status).toBe("ready");
    // The customer was waiting in the store, so they come up to the counter themselves.
    runUntil(sim, () => counterCustomer(s)?.id === c.id);
    expect(startTask(s, { type: "ring_up" })).toBeNull();
    runUntil(sim, () => job.status === "picked_up");
    expect(s.revenueCents).toBe(job.priceCents);
    expect(c.outcome).toBe("picked_up");
    expect(c.rating).toBe(5);
  });

  it("can't send a color job to the B&W printer", () => {
    const { sim } = soloSim({ color: "color" });
    runUntil(sim, () => !!counterCustomer(sim.state));
    startTask(sim.state, { type: "take_order" });
    runUntil(sim, () => sim.state.jobs.length === 1);
    expect(canStart(sim.state, { type: "send_job", jobId: sim.state.jobs[0].id, printerId: "bw" })).toMatch(/can't print/);
  });

  it("next-day orders are paid up front", () => {
    const { sim } = soloSim({ copies: 50 }, { kind: "tomorrow" });
    runUntil(sim, () => !!counterCustomer(sim.state));
    startTask(sim.state, { type: "take_order" });
    runUntil(sim, () => sim.state.jobs.length === 1);
    expect(sim.state.jobs[0].prepaid).toBe(true);
    expect(sim.state.revenueCents).toBe(sim.state.jobs[0].priceCents);
  });
});

describe("you can only do one thing at a time", () => {
  it("a jam clear can't be interrupted once you're working on it", () => {
    const { sim } = soloSim({});
    const p = sim.state.printers[0];
    p.status = "jammed";
    p.jamClearSeconds = 120;
    expect(startTask(sim.state, { type: "clear_jam", printerId: "bw" })).toBeNull();
    runUntil(sim, () => sim.state.employee.task!.elapsed > 0);
    expect(canStart(sim.state, { type: "replace_toner", printerId: "bw" })).toMatch(/busy/);
  });

  it("finishing work can be put down and picked up again without losing progress", () => {
    const { sim } = soloSim({ originals: 40, copies: 10, duplex: true, finishing: "coil_bind" });
    const s = sim.state;
    runUntil(sim, () => !!counterCustomer(s));
    startTask(s, { type: "take_order" });
    runUntil(sim, () => s.jobs.length === 1);
    const job = s.jobs[0];
    startTask(s, { type: "send_job", jobId: job.id, printerId: "bw" });
    runUntil(sim, () => job.status === "printed");
    collectAll(sim, job);
    startTask(s, { type: "finish_job", jobId: job.id });
    runUntil(sim, () => s.employee.task!.elapsed >= 300);
    stopTask(s);
    expect(job.finishWorkDone).toBeGreaterThanOrEqual(300);
    startTask(s, { type: "finish_job", jobId: job.id });
    expect(s.employee.task!.duration).toBe(finishSeconds(job.spec) - job.finishWorkDone);
  });
});

describe("machines", () => {
  it("runs out of paper mid-job and resumes after you load it", () => {
    const { sim } = soloSim({ originals: 1, copies: 100 });
    const s = sim.state;
    const tray = s.printers[0].trays[0];
    tray.level = 40;
    runUntil(sim, () => !!counterCustomer(s));
    startTask(s, { type: "take_order" });
    runUntil(sim, () => s.jobs.length === 1);
    const job = s.jobs[0];
    startTask(s, { type: "send_job", jobId: job.id, printerId: "bw" });
    runUntil(sim, () => s.printers[0].status === "out_of_paper");
    expect(Math.round(job.sheetsPrinted)).toBe(40);
    run(sim, 120);
    expect(Math.round(job.sheetsPrinted)).toBe(40); // nothing happens until you deal with it
    loadPaper(sim, "bw", "letter"); // fetch it from the stockroom, load it, put the rest back
    runUntil(sim, () => job.status === "printed");
  });

  it("a jam stops the printer until you clear it", () => {
    const { sim } = soloSim({ originals: 1, copies: 300 });
    const s = sim.state;
    s.printers[0].sheetsUntilJam = 50;
    runUntil(sim, () => !!counterCustomer(s));
    startTask(s, { type: "take_order" });
    runUntil(sim, () => s.jobs.length === 1);
    startTask(s, { type: "send_job", jobId: s.jobs[0].id, printerId: "bw" });
    runUntil(sim, () => s.printers[0].status === "jammed");
    expect(s.stats.jams).toBe(1);
    startTask(s, { type: "clear_jam", printerId: "bw" });
    runUntil(sim, () => s.printers[0].status === "printing" || s.printers[0].status === "idle");
  });

  it("toner only gets swapped when it's low", () => {
    const sim = createSim(1);
    sim.state.printers[0].toner = 80;
    expect(canStart(sim.state, { type: "replace_toner", printerId: "bw" })).toMatch(/Still 80%/);
  });
});

describe("customers", () => {
  it("ignored customers give up, and nobody pays", () => {
    const sim = createSim(7);
    while (!isShiftOver(sim.state)) tick(sim, 1);
    const r = report(sim.state);
    expect(r.walkouts + r.balks).toBeGreaterThan(0);
    expect(sim.state.stats.pickups).toBe(0);
    expect(sim.state.revenueCents).toBeGreaterThanOrEqual(0); // web orders are prepaid; nothing else comes in
  });

  it("a late order costs stars", () => {
    const { sim, c } = soloSim({ originals: 10, copies: 1 }, { kind: "wait", minutes: 10 });
    const s = sim.state;
    runUntil(sim, () => !!counterCustomer(s));
    startTask(s, { type: "take_order" });
    runUntil(sim, () => s.jobs.length === 1);
    run(sim, 30 * 60); // forget about it for half an hour
    const job = s.jobs[0];
    startTask(s, { type: "send_job", jobId: job.id, printerId: "bw" });
    runUntil(sim, () => job.status === "printed");
    finishAndShelve(sim, job);
    runUntil(sim, () => counterCustomer(s)?.id === c.id);
    startTask(s, { type: "ring_up" });
    runUntil(sim, () => c.outcome !== null);
    expect(c.rating!).toBeLessThan(4);
  });
});

describe("balance", () => {
  it("a competent employee gets through the day", () => {
    const reports = [1, 2, 3, 4, 5].map((seed) => report(playShift(seed).state));
    for (const r of reports) {
      expect(r.pickups + r.selfServed).toBeGreaterThan(10);
      expect(r.onTimePct!).toBeGreaterThan(70);
      expect(r.avgRating!).toBeGreaterThan(4);
      expect(r.profitCents).toBeGreaterThan(0);
    }
  });

  it("job ids in the summary match what was ordered", () => {
    const sim = playShift(9);
    const s = summarize(sim.state, "t", "bot");
    expect(s.jobs.length).toBe(sim.state.jobs.length);
    for (const j of sim.state.jobs) expect(jobById(sim.state, j.id)).toBe(j);
  });
});
