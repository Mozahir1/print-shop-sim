import { describe, expect, it } from "vitest";
import { canStart, counterCustomer, createSim, startTask, tick, type Sim } from "./sim";
import { DURATIONS, STOCK } from "./config";
import { generateStockroom, paperShortfall } from "./inventory";
import { doTask, fetch, loadPaper, replaceToner } from "./testkit";
import { STOCKROOM } from "./layout";
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

  // Phase 8: supplies are carried by hand now, so these go through the stockroom on purpose (take, carry, load, put back).
  it("loading paper takes sheets out of the stockroom, and you put back what's left", () => {
    const sim = quiet();
    const s = sim.state;
    const tray = s.printers[0].trays[0]; // B&W letter
    tray.level = 500;
    s.stockroom.letter = 10000;
    fetch(sim, "letter");
    expect(s.employee.hands).toEqual({ kind: "paper", stock: "letter", sheets: 5000 }); // a case
    expect(s.stockroom.letter).toBe(5000);
    doTask(sim, { type: "load_paper", printerId: "bw", stock: "letter" });
    expect(tray.level).toBe(2000);
    doTask(sim, { type: "put_back" });
    expect(s.stockroom.letter).toBe(8500);
    expect(s.employee.hands).toBeNull();
  });

  it("fills partially when the stockroom has some but not enough", () => {
    const sim = quiet();
    const s = sim.state;
    const tray = s.printers[0].trays[0];
    tray.level = 0;
    s.stockroom.letter = 300;
    loadPaper(sim, "bw", "letter");
    expect(tray.level).toBe(300);
    expect(s.stockroom.letter).toBe(0);
  });

  it("can't get paper the stockroom doesn't have, or load paper you aren't holding", () => {
    const s = quiet().state;
    s.printers[0].trays[0].level = 0;
    s.stockroom.letter = 0;
    expect(canStart(s, { type: "take_stock", item: "letter" })).toMatch(/no letter paper on the shelf/);
    expect(canStart(s, { type: "load_paper", printerId: "bw", stock: "letter" })).toMatch(/need letter paper in your hands/);
  });

  it("toner uses one cartridge, and none in stock means you can't", () => {
    const sim = quiet();
    const s = sim.state;
    s.printers[1].toner = 3;
    s.stockroom.color_toner = 1;
    replaceToner(sim, "color");
    expect(s.printers[1].toner).toBe(100);
    expect(s.stockroom.color_toner).toBe(0);

    s.printers[1].toner = 3;
    expect(canStart(s, { type: "take_stock", item: "color_toner" })).toMatch(/no color toner on the shelf/);
    expect(canStart(s, { type: "replace_toner", printerId: "color" })).toMatch(/need a color toner/);
  });

  it("rolls get changed when they run out, not before", () => {
    const sim = quiet();
    const s = sim.state;
    s.stockroom.wide_roll = 2;
    fetch(sim, "wide_roll");
    s.printers[2].trays[0].level = 120;
    expect(canStart(s, { type: "load_paper", printerId: "wide", stock: "roll" })).toMatch(/still has 120 ft/);
    s.printers[2].trays[0].level = 4;
    expect(canStart(s, { type: "load_paper", printerId: "wide", stock: "roll" })).toBeNull();
  });

  it("boxing a shipment needs the right box in hand; with none left you can only take packed ones", () => {
    const sim = quiet();
    const s = sim.state;
    s.stockroom.box_medium = 1;
    const boxed = spawnShippingCustomer(s, "ship", { packed: false, weightLb: 10 });
    runUntil(sim, () => counterCustomer(s)?.id === boxed.id);
    expect(canStart(s, { type: "ship_package" })).toMatch(/needs a medium box/);
    fetch(sim, "box_medium");
    doTask(sim, { type: "ship_package" });
    expect(s.stockroom.box_medium).toBe(0);
    doTask(sim, { type: "stage_packages" });

    const another = spawnShippingCustomer(s, "ship", { packed: false, weightLb: 12 });
    runUntil(sim, () => counterCustomer(s)?.id === another.id);
    expect(canStart(s, { type: "take_stock", item: "box_medium" })).toMatch(/no medium boxes on the shelf/);
    expect(canStart(s, { type: "turn_away" })).toBeNull();
    another.ship!.packed = true;
    expect(canStart(s, { type: "ship_package" })).toBeNull();
  });

  it("the trip to the stockroom is real walking now, not a hidden extra in the task", () => {
    const sim = quiet();
    const s = sim.state;
    s.printers[0].trays[0].level = 0;
    s.stockroom.letter = 5000;
    startTask(s, { type: "take_stock", item: "letter" });
    expect(s.employee.task!.station).toEqual(STOCKROOM);
    runUntil(sim, () => !s.employee.task);
    startTask(s, { type: "load_paper", printerId: "bw", stock: "letter" });
    expect(s.employee.task!.duration).toBe(DURATIONS.loadPaper);
  });

  it("warns when an order needs more paper than is on hand", () => {
    const s = quiet().state;
    s.stockroom.cardstock = 0;
    s.printers[1].trays[2].level = 100; // cardstock tray
    const spec = { item: "flyer", originals: 1, copies: 500, color: "color" as const, media: "cardstock" as const, duplex: false, finishing: "none" as const };
    expect(paperShortfall(s, spec)).toMatch(/Not enough cardstock/);
    expect(paperShortfall(s, { ...spec, copies: 50 })).toBeNull();
  });

});
