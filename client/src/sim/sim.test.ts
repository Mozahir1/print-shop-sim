import { describe, expect, it } from "vitest";
import { createSim, startTask, tick } from "./sim";
import { spawnCustomer } from "./customers";
import { fullServiceQuote, priceCents, selfServeBlocker, selfServePriceCents, shipQuote, totalSheets } from "./orders";
import { FULL_SERVICE, POSTAGE_CUT } from "./config";
import type { JobSpec } from "./types";

const plain = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "document", originals: 1, copies: 1, color: "bw", media: "letter", duplex: false, finishing: "none", ...s });

describe("determinism", () => {
  it("same seed and same play gives the exact same day", () => {
    const run = () => {
      const sim = createSim(7);
      const c = spawnCustomer(sim.state, sim.rng.director, "quick_copies");
      startTask(sim.state, { type: "talk", customerId: c.id });
      for (let i = 0; i < 100; i++) tick(sim, 1);
      return JSON.stringify(sim.state);
    };
    expect(run()).toBe(run());
  });
});

describe("the task system", () => {
  it("one thing at a time, and canStart says why not", () => {
    const sim = createSim(1);
    const a = spawnCustomer(sim.state, sim.rng.director, "quick_copies");
    const b = spawnCustomer(sim.state, sim.rng.director, "ship");
    expect(startTask(sim.state, { type: "talk", customerId: b.id })).toMatch(/front of the line/);
    expect(startTask(sim.state, { type: "talk", customerId: a.id })).toBeNull();
    expect(startTask(sim.state, { type: "fix_copier" })).toMatch(/busy/);
  });
});

describe("pricing", () => {
  it("prices from the price list", () => {
    expect(priceCents(plain({ copies: 10 }))).toBe(150);
    expect(priceCents(plain({ copies: 10, color: "color" }))).toBe(590);
  });

  it("double-sided halves the sheets", () => {
    expect(totalSheets(plain({ originals: 4, copies: 10, duplex: true }))).toBe(20);
  });

  it("a flat service fee on small full-service orders, none on bigger ones", () => {
    expect(fullServiceQuote(plain({ copies: 10 }), false)).toEqual({ printCents: 150, serviceFeeCents: 200, rushCents: 0, totalCents: 350 });
    expect(fullServiceQuote(plain({ copies: 100 }), false)).toEqual({ printCents: 1500, serviceFeeCents: 0, rushCents: 0, totalCents: 1500 });
  });

  it("a rush adds a share of the printing price, with a minimum", () => {
    const big = plain({ copies: 100, color: "color" }); // $59
    expect(fullServiceQuote(big, true)).toEqual({ printCents: 5900, serviceFeeCents: 0, rushCents: Math.round(5900 * FULL_SERVICE.rushRate), totalCents: 5900 + Math.round(5900 * FULL_SERVICE.rushRate) });
    expect(fullServiceQuote(plain(), true).rushCents).toBe(FULL_SERVICE.rushMinCents);
  });

  it("self-serve is cheaper, plain paper and simple jobs only", () => {
    const spec = plain({ copies: 10 });
    expect(selfServePriceCents(spec)).toBeLessThan(fullServiceQuote(spec, false).totalCents);
    expect(selfServeBlocker(spec)).toBeNull();
    expect(selfServeBlocker(plain({ finishing: "staple" }))).toBeNull();
    expect(selfServeBlocker(plain({ media: "cardstock" }))).toMatch(/plain paper/);
    expect(selfServeBlocker(plain({ finishing: "laminate" }))).toMatch(/laminated/);
  });

  it("shipping: postage by service level, packing by box size; the store keeps the packing and a small cut", () => {
    const ground = shipQuote(3, "ground");
    const overnight = shipQuote(3, "overnight");
    expect(overnight.postageCents).toBeGreaterThan(ground.postageCents);
    expect(shipQuote(30, "ground").packingCents).toBeGreaterThan(ground.packingCents);
    expect(ground.storeCents).toBe(ground.packingCents + Math.round(ground.postageCents * POSTAGE_CUT));
    expect(ground.storeCents).toBeLessThan(ground.totalCents / 2); // shipping pays little
  });
});
