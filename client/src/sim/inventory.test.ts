import { describe, expect, it } from "vitest";
import { canStart, counterCustomer, createSim, startTask, tick, type Sim } from "./sim";
import { DURATIONS, STOCK } from "./config";
import { canOrder, fetchSeconds, generateStockroom, paperShortfall, placeSupplyOrder } from "./inventory";
import { spawnShippingCustomer } from "./dev";
import { createRng } from "./rng";

function runUntil(sim: Sim, cond: () => boolean, limit = 3 * 3600) {
  for (let i = 0; i < limit && !cond(); i++) tick(sim, 1);
  expect(cond()).toBe(true);
}

function quiet(): Sim {
  const sim = createSim(1);
  sim.state.customers = [];
  sim.state.packages = [];
  return sim;
}

describe("stockroom", () => {
  it("starts each shift within the configured ranges", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = createSim(seed).state;
      for (const [item, n] of Object.entries(s.stockroom)) {
        const [lo, hi] = STOCK[item as keyof typeof STOCK].start;
        expect(n).toBeGreaterThanOrEqual(lo);
        expect(n).toBeLessThanOrEqual(hi);
      }
    }
    expect(generateStockroom(createRng(5))).toEqual(generateStockroom(createRng(5)));
  });

  it("loading paper takes sheets out of the stockroom", () => {
    const sim = quiet();
    const s = sim.state;
    const tray = s.printers[0].trays[0]; // B&W letter
    tray.level = 500;
    s.stockroom.letter = 10000;
    startTask(s, { type: "load_paper", printerId: "bw", stock: "letter" });
    runUntil(sim, () => !s.employee.task);
    expect(tray.level).toBe(2000);
    expect(s.stockroom.letter).toBe(8500);
  });

  it("fills partially when the stockroom has some but not enough", () => {
    const sim = quiet();
    const s = sim.state;
    const tray = s.printers[0].trays[0];
    tray.level = 0;
    s.stockroom.letter = 300;
    startTask(s, { type: "load_paper", printerId: "bw", stock: "letter" });
    runUntil(sim, () => !s.employee.task);
    expect(tray.level).toBe(300);
    expect(s.stockroom.letter).toBe(0);
  });

  it("can't load paper the stockroom doesn't have", () => {
    const s = quiet().state;
    s.printers[0].trays[0].level = 0;
    s.stockroom.letter = 0;
    expect(canStart(s, { type: "load_paper", printerId: "bw", stock: "letter" })).toMatch(/no letter paper left/);
  });

  it("toner uses one cartridge, and none in stock means you can't", () => {
    const sim = quiet();
    const s = sim.state;
    s.printers[1].toner = 3;
    s.stockroom.color_toner = 1;
    startTask(s, { type: "replace_toner", printerId: "color" });
    runUntil(sim, () => !s.employee.task);
    expect(s.printers[1].toner).toBe(100);
    expect(s.stockroom.color_toner).toBe(0);

    s.printers[1].toner = 3;
    expect(canStart(s, { type: "replace_toner", printerId: "color" })).toMatch(/no spare color toner/);
  });

  it("rolls get changed when they run out, not before", () => {
    const s = quiet().state;
    s.stockroom.wide_roll = 2;
    s.printers[2].trays[0].level = 120;
    expect(canStart(s, { type: "load_paper", printerId: "wide", stock: "roll" })).toMatch(/still has 120 ft/);
    s.printers[2].trays[0].level = 4;
    expect(canStart(s, { type: "load_paper", printerId: "wide", stock: "roll" })).toBeNull();
  });

  it("packing uses a box; with none you can only take packages that come packed", () => {
    const sim = quiet();
    const s = sim.state;
    s.stockroom.box_medium = 1;
    const boxed = spawnShippingCustomer(s, "ship", { packed: false, weightLb: 10 });
    runUntil(sim, () => counterCustomer(s)?.id === boxed.id);
    startTask(s, { type: "ship_package" });
    runUntil(sim, () => boxed.outcome !== null);
    expect(s.stockroom.box_medium).toBe(0);

    const another = spawnShippingCustomer(s, "ship", { packed: false, weightLb: 12 });
    runUntil(sim, () => counterCustomer(s)?.id === another.id);
    expect(canStart(s, { type: "ship_package" })).toMatch(/out of medium boxes/);
    expect(canStart(s, { type: "turn_away" })).toBeNull();
    another.ship!.packed = true;
    expect(canStart(s, { type: "ship_package" })).toBeNull();
  });

  it("the walk to the stockroom is part of the task", () => {
    const s = quiet().state;
    s.printers[0].trays[0].level = 0;
    s.stockroom.letter = 5000;
    startTask(s, { type: "load_paper", printerId: "bw", stock: "letter" });
    expect(s.employee.task!.duration).toBe(DURATIONS.loadPaper + fetchSeconds(s.printers[0].station));
    expect(fetchSeconds(s.printers[0].station)).toBeGreaterThan(10);
  });

  it("warns when an order needs more paper than is on hand", () => {
    const s = quiet().state;
    s.stockroom.cardstock = 0;
    s.printers[1].trays[2].level = 100; // cardstock tray
    const spec = { item: "flyer", originals: 1, copies: 500, color: "color" as const, media: "cardstock" as const, duplex: false, finishing: "none" as const };
    expect(paperShortfall(s, spec)).toMatch(/Not enough cardstock/);
    expect(paperShortfall(s, { ...spec, copies: 50 })).toBeNull();
  });

  it("supply ordering is hidden in a single shift", () => {
    const s = quiet().state;
    expect(canOrder(s)).toMatch(/career mode/);
    expect(placeSupplyOrder(s, "letter")).not.toBeNull();
    expect(s.supplyOrders).toHaveLength(0);
  });
});
