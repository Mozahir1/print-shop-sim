import { describe, expect, it } from "vitest";
import { canStart, counterCustomer, createSim, isShiftOver, startTask, tick, type Sim } from "./sim";
import { botAct, createBot } from "./bot";
import { report } from "./summary";
import { generateDay } from "./schedule";
import { createRng } from "./rng";
import { spawnShippingCustomer, truckNow } from "./dev";
import { shipQuote } from "./shipping";
import { doTask, fetch } from "./testkit";
import type { Customer, ShipService, StockItem } from "./types";

function runUntil(sim: Sim, cond: () => boolean, limit = 3 * 3600) {
  for (let i = 0; i < limit && !cond(); i++) tick(sim, 1);
  expect(cond()).toBe(true);
}

// A store with nobody scheduled and no morning delivery, so each test controls who walks in.
function emptyStore(): Sim {
  const sim = createSim(1);
  sim.state.customers = [];
  sim.state.packages = [];
  sim.state.nextPackageId = 1;
  return sim;
}

// Wait for the customer to reach the counter, start the task, and run until they're done.
function serve(sim: Sim, c: Customer, type: "ship_package" | "accept_dropoff" | "release_package") {
  runUntil(sim, () => counterCustomer(sim.state)?.id === c.id);
  expect(startTask(sim.state, { type })).toBeNull();
  runUntil(sim, () => c.outcome !== null);
}

// Phase 8: packing needs a box you fetched, and the finished package ends up in your hands until you stage it.
function ship(sim: Sim, service: ShipService, packed: boolean, weightLb = 10, stage = true): Customer {
  const c = spawnShippingCustomer(sim.state, "ship", { service, packed, weightLb });
  if (!packed) {
    runUntil(sim, () => counterCustomer(sim.state)?.id === c.id);
    fetch(sim, `box_${c.ship!.box}` as StockItem);
  }
  serve(sim, c, "ship_package");
  if (stage) doTask(sim, { type: "stage_packages" });
  return c;
}

describe("shipping a package", () => {
  it("charges the rate and books the carrier's cut as cost (already packed)", () => {
    const sim = emptyStore();
    const c = ship(sim, "two_day", true, 10, false);
    // two-day: 2400 + 220/lb x 10 lb = 4600; carrier gets 70%
    expect(sim.state.revenueCents).toBe(4600);
    expect(Math.round(sim.state.costCents)).toBe(3220);
    expect(c.outcome).toBe("shipped");
    expect(sim.state.packages).toHaveLength(1);
    expect(sim.state.packages[0].status).toBe("unstaged"); // in your hands
    expect(sim.state.employee.hands).toEqual({ kind: "packages", packageIds: [sim.state.packages[0].id] });
    doTask(sim, { type: "stage_packages" });
    expect(sim.state.packages[0].status).toBe("staged");
    expect(sim.state.stats.shipments).toBe(1);
  });

  it("adds the packing fee and material when we box it", () => {
    const sim = emptyStore();
    ship(sim, "two_day", false, 10); // 10 lb goes in a medium box
    expect(sim.state.revenueCents).toBe(4600 + 1000);
    expect(Math.round(sim.state.costCents)).toBe(3220 + 40 + 100); // + one medium box ($25 / 25)
    expect(sim.state.stats.shippingRevenueCents).toBe(5600);
  });

  it("packing takes longer than taking a packed box", () => {
    const sim = emptyStore();
    const packed = spawnShippingCustomer(sim.state, "ship", { packed: true, weightLb: 30 });
    runUntil(sim, () => counterCustomer(sim.state)?.id === packed.id);
    startTask(sim.state, { type: "ship_package" });
    const quick = sim.state.employee.task!.duration;
    packed.ship!.packed = false;
    sim.state.employee.task = null;
    packed.waitStart = sim.state.time;
    sim.state.employee.hands = { kind: "box", size: "large" }; // as if you'd just fetched it
    startTask(sim.state, { type: "ship_package" });
    expect(sim.state.employee.task!.duration).toBe(quick + 300); // large box
  });

  it("you can turn a shipper away", () => {
    const sim = emptyStore();
    const c = spawnShippingCustomer(sim.state, "ship");
    runUntil(sim, () => counterCustomer(sim.state)?.id === c.id);
    expect(canStart(sim.state, { type: "turn_away" })).toBeNull();
    expect(canStart(sim.state, { type: "take_order" })).toMatch(/isn't here to order/);
  });

  it("drop-offs are staged for the truck and don't earn anything", () => {
    const sim = emptyStore();
    const c = spawnShippingCustomer(sim.state, "dropoff");
    serve(sim, c, "accept_dropoff");
    expect(sim.state.revenueCents).toBe(0);
    expect(sim.state.packages.filter((p) => p.status === "unstaged")).toHaveLength(c.dropoffCount);
    doTask(sim, { type: "stage_packages" });
    expect(sim.state.packages.filter((p) => p.status === "staged")).toHaveLength(c.dropoffCount);
    expect(sim.state.stats.dropoffPackages).toBe(c.dropoffCount);
  });
});

describe("the carrier truck", () => {
  it("missing the truck refunds express packages but not ground", () => {
    const sim = emptyStore();
    ship(sim, "ground", true);
    ship(sim, "two_day", true);
    ship(sim, "overnight", true);
    const s = sim.state;
    const express = s.packages.filter((p) => p.service !== "ground").reduce((a, p) => a + p.pricePaidCents, 0);
    const before = s.revenueCents;

    truckNow(s);
    runUntil(sim, () => s.truck.status === "gone"); // nobody hands off
    expect(s.revenueCents).toBe(before - express);
    expect(s.stats.refundsCents).toBe(express);
    expect(s.stats.missedTruckPackages).toBe(3);
    expect(s.packages.every((p) => p.status === "staged" && p.missedTrucks === 1)).toBe(true); // they go tomorrow
  });

  it("handing off in time ships everything, no refunds", () => {
    const sim = emptyStore();
    ship(sim, "overnight", true);
    ship(sim, "ground", false);
    const s = sim.state;
    expect(canStart(s, { type: "hand_off_truck" })).toMatch(/isn't here yet/);
    truckNow(s);
    runUntil(sim, () => s.truck.status === "waiting");
    expect(startTask(s, { type: "hand_off_truck" })).toBeNull();
    runUntil(sim, () => s.truck.status === "gone");
    expect(s.truck.handedOff).toBe(true);
    expect(s.packages.every((p) => p.status === "shipped")).toBe(true);
    expect(s.stats.refundsCents).toBe(0);
  });

  it("the driver doesn't leave while you're mid hand-off", () => {
    const sim = emptyStore();
    ship(sim, "overnight", true);
    const s = sim.state;
    truckNow(s);
    runUntil(sim, () => s.truck.status === "waiting");
    s.truck.leavesAt = s.time + 30; // you'll get there with a few seconds to spare
    startTask(s, { type: "hand_off_truck" });
    runUntil(sim, () => s.truck.status === "gone");
    expect(s.truck.handedOff).toBe(true);
    expect(s.stats.refundsCents).toBe(0);
  });

  it("an express shipment after the truck left costs a star", () => {
    const sim = emptyStore();
    sim.state.truck.status = "gone";
    const overnight = ship(sim, "overnight", true);
    const ground = ship(sim, "ground", true);
    expect(overnight.rating).toBeLessThanOrEqual(4);
    expect(ground.rating).toBe(5);
    expect(sim.state.stats.missedTruckPackages).toBe(0); // shipped after it left: not "missed"
  });
});

describe("held packages", () => {
  it("can't be released before the delivery is checked in, and can after", () => {
    const sim = emptyStore();
    const c = spawnShippingCustomer(sim.state, "package");
    runUntil(sim, () => counterCustomer(sim.state)?.id === c.id);
    expect(canStart(sim.state, { type: "release_package" })).toMatch(/unsorted/);

    expect(startTask(sim.state, { type: "check_in_packages" })).toBeNull();
    runUntil(sim, () => sim.state.packages[0].status === "on_hold");
    expect(canStart(sim.state, { type: "release_package" })).toBeNull();
    serve(sim, c, "release_package");
    expect(c.outcome).toBe("package_picked_up");
    expect(sim.state.packages[0].status).toBe("released");
    expect(sim.state.stats.packagePickups).toBe(1);
  });

  it("the morning delivery arrives unsorted, and most owners come in today", () => {
    const counts = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => {
      const s = createSim(seed).state;
      const held = s.packages.filter((p) => p.direction === "in");
      expect(held.every((p) => p.status === "unsorted")).toBe(true);
      const owners = held.map((p) => s.customers.find((c) => c.id === p.customerId)!);
      return { held: held.length, coming: owners.filter((c) => c.visitAt !== null).length };
    });
    const held = counts.reduce((a, c) => a + c.held, 0);
    const coming = counts.reduce((a, c) => a + c.coming, 0);
    expect(held / counts.length).toBeGreaterThan(3);
    expect(coming / held).toBeGreaterThan(0.5);
  });
});

describe("determinism", () => {
  it("adding shipping didn't change the print customers a seed produces", () => {
    const s = createSim(11).state;
    const printOnly = generateDay(createRng(11));
    expect(s.customers.slice(0, printOnly.length).map((c) => c.request)).toEqual(printOnly.map((c) => c.request));
  });

  it("shipping customers don't depend on how you play", () => {
    const pick = (cs: Customer[]) => cs.filter((c) => c.purpose !== "order" && c.request === null).map((c) => [c.ship, c.dropoffCount, c.packageId]);
    const idle = createSim(8);
    const played = createSim(8);
    const bot = createBot(10);
    for (let i = 0; i < 4 * 3600; i++) {
      botAct(bot, played.state, 1);
      tick(played, 1);
    }
    expect(pick(played.state.customers)).toEqual(pick(idle.state.customers));
  });

  it("quotes follow the rate card", () => {
    expect(shipQuote({ weightLb: 3, service: "ground", packed: false, box: "small" })).toEqual({
      rateCents: 1100 + 270,
      packingCents: 600,
      totalCents: 1970,
      carrierCents: Math.round(1370 * 0.7),
      materialCents: 40,
    });
  });
});

describe("the bot handles shipping", () => {
  it("ships, takes drop-offs, hands packages out, and makes the truck", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const sim = createSim(seed);
      const bot = createBot(10);
      const ownersComing = sim.state.customers.filter((c) => c.purpose === "package" && c.visitAt !== null).length;
      while (!isShiftOver(sim.state)) {
        botAct(bot, sim.state, 1);
        tick(sim, 1);
      }
      const r = report(sim.state);
      expect(r.shipments).toBeGreaterThan(0);
      expect(r.packagePickups).toBe(ownersComing); // everyone who came for a package got it
      expect(r.refundsCents).toBe(0);
      expect(sim.state.truck.handedOff).toBe(true);
      expect(sim.state.packages.filter((p) => p.direction === "in" && p.status === "unsorted")).toHaveLength(0);
    }
  });
});
