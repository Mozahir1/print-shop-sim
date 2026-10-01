import { describe, expect, it } from "vitest";
import { canStart, createSim, isShiftOver, startTask, tick, type Sim } from "./sim";
import { botAct, createBot } from "./bot";
import { spawnCustomer, spawnShippingCustomer, truckNow } from "./dev";
import { KEYS, age, snapshot, type TraySnap } from "./knowledge";
import { HANDS } from "./config";
import { collectAll, doTask, fetch, runUntil } from "./testkit";
import { counterCustomer } from "./util";
import type { Customer, Job, JobSpec } from "./types";

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
  return sim;
}

const plain = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "document", originals: 1, copies: 1, color: "bw", media: "letter", duplex: false, finishing: "none", ...s });

function orderAndSend(sim: Sim, want: JobSpec, printerId = "bw", timing: "wait" | "back" = "wait"): { c: Customer; job: Job } {
  const c = spawnCustomer(sim.state, "quick_copies", timing, false, "full_service");
  c.request!.spec = want;
  c.linePatience = 3 * 3600;
  c.lateTolerance = 3 * 3600;
  runUntil(sim, () => counterCustomer(sim.state)?.id === c.id);
  doTask(sim, { type: "take_order" });
  const job = sim.state.jobs.find((j) => j.id === c.jobId)!;
  doTask(sim, { type: "send_job", jobId: job.id, printerId });
  return { c, job };
}

describe("the job path: printer, output tray, hands, finishing, hands, shelf", () => {
  it("only reaches the shelf by going every step, and can only be rung up from there", () => {
    const sim = quiet();
    const s = sim.state;
    const { c, job } = orderAndSend(sim, plain({ originals: 20, copies: 5, finishing: "staple" }));
    runUntil(sim, () => job.status === "printed");
    expect(job.location).toBe("output");
    expect(s.printers[0].output).toEqual([{ jobId: job.id, sheets: 100 }]);
    expect(canStart(s, { type: "finish_job", jobId: job.id })).toMatch(/Only 0 of 100 sheets are here/);

    doTask(sim, { type: "collect_output", printerId: "bw" });
    expect(s.employee.hands).toEqual({ kind: "output", jobId: job.id, sheets: 100 });
    expect(job.location).toBe("hands");

    doTask(sim, { type: "finish_job", jobId: job.id }); // sets the stack down at the table and gets to work
    expect(job.status).toBe("bagged");
    expect(s.employee.hands).toEqual({ kind: "bag", jobId: job.id });

    runUntil(sim, () => counterCustomer(s)?.id === c.id || s.time > 4 * 3600);
    // They can't have it until it's on the shelf (and you can't help them with your hands full anyway).
    expect(canStart(s, { type: "ring_up" })).not.toBeNull();
    doTask(sim, { type: "shelve" });
    expect(job.status).toBe("ready");
    expect(job.location).toBe("shelf");
    expect(job.filedUnder).toBe(c.id);
  });

  it("a full output tray stops the printer until you collect it", () => {
    const sim = quiet();
    const s = sim.state;
    const { job } = orderAndSend(sim, plain({ copies: 800 }), "bw", "back");
    runUntil(sim, () => s.printers[0].status === "output_full");
    expect(s.printers[0].output[0].sheets).toBe(HANDS.outputCapacity.narrow);
    const printed = job.sheetsPrinted;
    for (let i = 0; i < 120; i++) tick(sim, 1);
    expect(job.sheetsPrinted).toBe(printed);

    doTask(sim, { type: "collect_output", printerId: "bw" });
    expect(s.printers[0].status).not.toBe("output_full");
    doTask(sim, { type: "drop_output" });
    expect(job.tableSheets).toBe(500);
    collectAll(sim, job);
    expect(job.tableSheets).toBeCloseTo(800, 6); // sheets accrue fractionally while printing
  });
});

describe("hands", () => {
  it("must be empty for counter work; you can set things down on the counter and pick them back up", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, "quick_copies", "back", false, "full_service");
    runUntil(sim, () => counterCustomer(s)?.id === c.id);
    fetch(sim, "letter");
    expect(canStart(s, { type: "take_order" })).toMatch(/hands are full \(5,000 sheets of letter paper\)/);
    doTask(sim, { type: "set_down" });
    expect(s.counterItems).toHaveLength(1);
    expect(canStart(s, { type: "take_order" })).toBeNull();
    doTask(sim, { type: "take_order" });
    doTask(sim, { type: "pick_up", index: 0 });
    expect(s.employee.hands?.kind).toBe("paper");
    expect(s.counterItems).toHaveLength(0);
  });

  it("carry one thing at a time, and the right thing for the job", () => {
    const sim = quiet();
    const s = sim.state;
    fetch(sim, "cardstock");
    expect(canStart(s, { type: "take_stock", item: "letter" })).toMatch(/hands are full/);
    s.printers[0].trays[0].level = 100;
    s.printers[0].trays[1].level = 100;
    // Cardstock is letter-sized, so it physically fits the letter tray (a mistake you can make), but not the legal one.
    expect(canStart(s, { type: "load_paper", printerId: "bw", stock: "letter" })).toBeNull();
    expect(canStart(s, { type: "load_paper", printerId: "bw", stock: "legal" })).toMatch(/need legal paper in your hands/);
    expect(canStart(s, { type: "put_back" })).toBeNull();
  });
});

describe("checks", () => {
  it("looking takes time at the spot and is the only way snapshots refresh", () => {
    const sim = quiet();
    const s = sim.state;
    s.printers[1].trays[0].level = 640;
    startTask(s, { type: "check_trays", printerId: "color" });
    expect(s.employee.task!.station).toEqual(s.printers[1].station);
    expect(s.employee.task!.duration).toBe(HANDS.checkTraySecondsPerTray * 3);
    runUntil(sim, () => !s.employee.task);
    expect(snapshot<TraySnap>(s, KEYS.tray("color", "letter"))!.data.level).toBe(650);

    s.printers[1].trays[0].level = 90;
    for (let i = 0; i < 600; i++) tick(sim, 1);
    expect(snapshot<TraySnap>(s, KEYS.tray("color", "letter"))!.data.level).toBe(650); // out of date
    expect(age(s, KEYS.tray("color", "letter"))).toBeGreaterThanOrEqual(600);
    doTask(sim, { type: "check_trays", printerId: "color" });
    expect(snapshot<TraySnap>(s, KEYS.tray("color", "letter"))!.data.level).toBe(100);
    expect(s.stats.checks).toBe(2);
  });

  it("every place has a check", () => {
    const sim = quiet();
    for (const req of [
      { type: "check_panel", printerId: "wide" },
      { type: "check_copier", copierId: 2 },
      { type: "glance_stock" },
      { type: "count_stock", item: "box_large" },
      { type: "check_shelf" },
      { type: "scan_package_room" },
      { type: "check_finishing" },
    ] as const) {
      doTask(sim, req);
    }
    for (const key of [KEYS.panel("wide"), KEYS.copier(2), KEYS.stockGlance, KEYS.stockItem("box_large"), KEYS.shelf, KEYS.packageRoom, KEYS.finishing]) {
      expect(snapshot(sim.state, key)).toBeDefined();
    }
  });
});

describe("packages have to be staged", () => {
  it("a package left in your hands misses the truck", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnShippingCustomer(s, "ship", { service: "overnight", packed: true, weightLb: 4 });
    runUntil(sim, () => counterCustomer(s)?.id === c.id);
    doTask(sim, { type: "ship_package" });
    expect(s.packages[0].status).toBe("unstaged");
    truckNow(s);
    runUntil(sim, () => s.truck.status === "gone");
    expect(s.stats.missedTruckPackages).toBe(1);
    expect(s.stats.refundsCents).toBe(s.packages[0].pricePaidCents);
  });
});

describe("the bot walks the whole path", () => {
  it("collects, finishes, shelves and stages everything, and ends the day empty-handed", () => {
    const sim = createSim(2);
    const bot = createBot(10);
    while (!isShiftOver(sim.state)) {
      botAct(bot, sim.state, 1);
      tick(sim, 1);
    }
    const s = sim.state;
    expect(s.stats.pickups).toBeGreaterThan(5);
    expect(s.stats.refundsCents).toBe(0);
    expect(s.packages.filter((p) => p.status === "unstaged")).toHaveLength(0);
    expect(s.counterItems).toHaveLength(0);
    for (const j of s.jobs.filter((x) => x.status === "picked_up")) expect(j.filedUnder).toBe(j.customerId);
  });
});
