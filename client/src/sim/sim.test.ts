import { describe, expect, it } from "vitest";
import { createSim, startTask, tick } from "./sim";
import { spawnCustomer } from "./customers";
import { fullServiceQuote, priceCents, totalSheets } from "./orders";
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

  it("adds a $2 service fee to orders of $50 or less", () => {
    const q = fullServiceQuote(plain({ copies: 10 }), true);
    expect(q).toEqual({ printCents: 150, serviceFeeCents: 200, rushCents: 0, totalCents: 350 });
  });

  it("waives the fee over $50, and adds a 10% rush if it's needed the same day", () => {
    const spec = plain({ copies: 100, color: "color" }); // $59
    expect(fullServiceQuote(spec, true)).toEqual({ printCents: 5900, serviceFeeCents: 0, rushCents: 590, totalCents: 6490 });
    expect(fullServiceQuote(spec, false).rushCents).toBe(0);
  });
});
