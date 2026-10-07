import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canStart, createSim, isDayOver, tick, type Sim } from "./sim";
import { endDay, newGame, startDay } from "./game";
import { botAct, createBot, type BotStyle } from "./bot";
import { onTheShelf, spawnCustomer } from "./customers";
import { SHIPPING } from "./config";
import { calm, doTask, runUntil, talkTo } from "./testkit";
import type { GameState } from "./types";

// The truck and the pickup shelf: packages for pickup only ever come on the truck (or were there before your first
// day), and the driver waits while you're busy with a customer, so missing the truck is a choice, never bad timing.
let restore: () => void;
beforeEach(() => (restore = calm()));
afterEach(() => restore());

function quiet(seed = 1): Sim {
  const sim = createSim(seed);
  sim.state.director.enabled = false;
  sim.state.event = null;
  sim.state.printer.paperOutAt = Infinity;
  return sim;
}

const held = (s: GameState) => s.packages.filter((p) => p.kind === "held");

describe("the pickup shelf", () => {
  it("your first day isn't the shop's: there are already packages waiting to be picked up", () => {
    const s = quiet().state;
    expect(held(s).length).toBeGreaterThanOrEqual(SHIPPING.shelfStart[0]);
    expect(held(s).length).toBeLessThanOrEqual(SHIPPING.shelfStart[1]);
    for (const p of held(s)) expect(p.to).toMatch(/\S+ \S+/); // a name on the label
  });

  it("someone picking up a package is whoever one on the shelf is for: nothing appears for them", () => {
    const sim = quiet();
    const s = sim.state;
    const before = s.packages.length;
    const pkg = onTheShelf(s)[0];
    const c = spawnCustomer(s, sim.rng.dev, "package_pickup");
    expect(s.packages.length).toBe(before);
    expect(c.packageId).toBe(pkg.id);
    expect(c.name).toBe(pkg.to);
    expect(onTheShelf(s)).not.toContain(pkg); // (spoken for)
    talkTo(sim, c);
    expect(pkg.status).toBe("picked_up");
  });

  it("new ones come on the truck, and whatever nobody came for is still there tomorrow", () => {
    const game = newGame(7);
    const sim = startDay(game);
    const s = sim.state;
    s.director.enabled = false;
    const start = held(s).length;
    runUntil(sim, () => s.truck.status === "waiting", 600);
    const delivered = held(s).length - start;
    expect(delivered).toBeGreaterThanOrEqual(Math.min(SHIPPING.deliveries[0], SHIPPING.shelfMax - start));
    expect(held(s).length).toBeLessThanOrEqual(SHIPPING.shelfMax);
    doTask(sim, { type: "hand_off" });
    runUntil(sim, () => s.time >= s.closeAt, 600);
    const ids = held(s).map((p) => p.id);
    endDay(game, sim);
    const next = startDay(game).state;
    expect(held(next).map((p) => p.id)).toEqual(ids);
    expect(held(next).every((p) => p.status === "held" && p.customerId === 0)).toBe(true);
  });

  it("over real days: held packages only ever show up at the start of the game or with the truck", () => {
    for (const style of ["smart", "careless", "random"] as BotStyle[])
      for (let g = 0; g < 3; g++) {
        const game = newGame(5 + g * 1000);
        for (let d = 0; d < 5 && !game.fired; d++) {
          const sim = startDay(game);
          const s = sim.state;
          const bot = createBot(1, style, s.seed);
          let known = new Set(held(s).map((p) => p.id));
          let wasHere = s.truck.status !== "coming";
          while (!isDayOver(s)) {
            botAct(bot, s, 1);
            tick(sim, 1);
            const now = held(s).map((p) => p.id);
            const fresh = now.filter((id) => !known.has(id));
            const truckCame = !wasHere && s.truck.status !== "coming";
            if (fresh.length) expect(truckCame, `day ${s.day} ${s.time}: package out of nowhere`).toBe(true);
            known = new Set([...known, ...now]);
            wasHere = s.truck.status !== "coming";
          }
          for (const c of s.customers) if (c.kind === "package_pickup") expect(c.packageId).not.toBeNull();
          endDay(game, sim);
        }
      }
  });
});

describe("the truck", () => {
  it("waits while you're with a customer, then gives you its usual time", () => {
    const sim = quiet();
    const s = sim.state;
    runUntil(sim, () => s.truck.status === "waiting", 600);
    const came = s.time;
    const c = spawnCustomer(s, sim.rng.dev, "ship", { weightLb: 3 });
    doTask(sim, { type: "talk", customerId: c.id });
    expect(canStart(s, { type: "hand_off" })).toMatch(/^You can't do that/); // you're helping them
    for (let i = 0; i < SHIPPING.truckWaits + 5; i++) tick(sim, 1);
    expect(s.truck.status).toBe("waiting"); // the driver's waiting on you
    expect(s.truck.leavesAt).toBeGreaterThan(came + SHIPPING.truckWaits);
    expect(s.truck.leavesAt).toBeLessThanOrEqual(came + SHIPPING.truckWaitsMax);
  });

  it("...but not forever", () => {
    const sim = quiet();
    const s = sim.state;
    runUntil(sim, () => s.truck.status === "waiting", 600);
    const came = s.time;
    const c = spawnCustomer(s, sim.rng.dev, "ship", { weightLb: 3 });
    talkTo(sim, c); // at the packing table with them, and they're not going anywhere
    c.giveUp = 999;
    runUntil(sim, () => s.truck.status === "gone", 200);
    expect(s.workflow?.customerId).toBe(c.id);
    expect(s.time).toBe(came + SHIPPING.truckWaitsMax);
  });

  it("you can put a job down to hand off, and go back to it", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "dropoff");
    talkTo(sim, c); // in the bin
    const web = spawnCustomer(s, sim.rng.dev, "large_job", { timing: "back", needIn: 400 });
    doTask(sim, { type: "talk", customerId: web.id });
    doTask(sim, { type: "respond", customerId: web.id, choice: "take" }); // at the order form
    const wf = s.workflow!;
    expect(wf.kind).toBe("take_order");
    runUntil(sim, () => s.truck.status === "waiting", 600);
    doTask(sim, { type: "hand_off" });
    expect(s.truck.handedOff).toBe(true);
    expect(s.workflow).toBe(wf); // back at the form
  });

  it("no one new walks in while the driver's here", () => {
    const sim = createSim(3);
    const s = sim.state;
    s.event = null;
    runUntil(sim, () => s.truck.status === "waiting", 600);
    const n = s.customers.length;
    const arrivals = s.director.arrivals;
    for (let i = 0; i < 10 && s.truck.status === "waiting"; i++) tick(sim, 1);
    expect(s.director.arrivals).toBe(arrivals);
    expect(s.customers.filter((c) => c.kind !== "order_pickup").length).toBeLessThanOrEqual(n);
  });
});
