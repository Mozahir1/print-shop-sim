import { describe, expect, it } from "vitest";
import { canStart, counterCustomer, createSim, startTask, tick, type Sim } from "./sim";
import { fullServiceQuote, priceCents, selfServeBlocker, selfServePriceCents } from "./orders";
import { spawnCustomer } from "./dev";
import type { Customer, JobSpec } from "./types";

const spec = (s: Partial<JobSpec>): JobSpec => ({
  item: "document",
  originals: 10,
  copies: 1,
  color: "bw",
  media: "letter",
  duplex: false,
  finishing: "none",
  ...s,
});

function runUntil(sim: Sim, cond: () => boolean, limit = 3 * 3600) {
  for (let i = 0; i < limit && !cond(); i++) tick(sim, 1);
  expect(cond()).toBe(true);
}

// Copier jams are covered in upkeep.test.ts; these tests are about who goes to self-serve.
function noJams(sim: Sim) {
  for (const cp of sim.state.copiers) cp.sheetsUntilJam = Infinity;
}

// An empty store with one customer walking in now.
function solo(s: Partial<JobSpec>, selfServe: "alone" | "with_help" | "full_service") {
  const sim = createSim(1);
  sim.state.customers = [];
  noJams(sim);
  const c = spawnCustomer(sim.state, "quick_copies", "wait", false, selfServe);
  c.request!.spec = spec(s);
  c.linePatience = 3600;
  return { sim, c };
}

describe("what qualifies for self-serve", () => {
  it("any narrow format job on 20 lb bond, at any length", () => {
    expect(selfServeBlocker(spec({}))).toBeNull();
    expect(selfServeBlocker(spec({ color: "color", media: "tabloid", duplex: true }))).toBeNull();
    expect(selfServeBlocker(spec({ originals: 400, copies: 25 }))).toBeNull();
    expect(selfServeBlocker(spec({ media: "legal", finishing: "staple" }))).toBeNull();
  });

  it("not better paper, wide format, or finishing done behind the counter", () => {
    expect(selfServeBlocker(spec({ media: "cardstock" }))).toMatch(/20 lb bond/);
    expect(selfServeBlocker(spec({ media: "wide_24x36" }))).toMatch(/wide format/i);
    expect(selfServeBlocker(spec({ finishing: "coil_bind" }))).toMatch(/coil bind/);
    expect(selfServeBlocker(spec({ finishing: "laminate" }))).toMatch(/laminate/);
  });

  it("self-serve is cheaper than full service for the same job", () => {
    for (const s of [spec({}), spec({ color: "color" }), spec({ media: "legal" }), spec({ media: "tabloid", color: "color" })]) {
      expect(selfServePriceCents(s)).toBeLessThan(priceCents(s));
    }
  });
});

describe("customers at self-serve", () => {
  it("most eligible customers go straight to a copier, pay there, and never need you", () => {
    const { sim, c } = solo({ originals: 20 }, "alone");
    runUntil(sim, () => c.state === "self_serve");
    expect(counterCustomer(sim.state)).toBeUndefined();
    runUntil(sim, () => c.outcome !== null);
    expect(c.outcome).toBe("self_served");
    expect(sim.state.revenueCents).toBe(selfServePriceCents(c.request!.spec));
    expect(sim.state.employee.busySeconds).toBe(0);
    expect(c.rating).toBe(5);
  });

  it("some come to the counter and go once you show them over", () => {
    const { sim, c } = solo({}, "with_help");
    runUntil(sim, () => counterCustomer(sim.state)?.id === c.id);
    expect(startTask(sim.state, { type: "usher_self_serve" })).toBeNull();
    runUntil(sim, () => c.state === "self_serve");
    runUntil(sim, () => c.outcome === "self_served");
  });

  it("some refuse and want full service, and stay at the counter for a normal order", () => {
    const { sim, c } = solo({}, "full_service");
    runUntil(sim, () => counterCustomer(sim.state)?.id === c.id);
    startTask(sim.state, { type: "usher_self_serve" });
    runUntil(sim, () => c.selfServeDeclined);
    expect(counterCustomer(sim.state)?.id).toBe(c.id);
    expect(canStart(sim.state, { type: "usher_self_serve" })).toMatch(/full service/);
    expect(startTask(sim.state, { type: "take_order" })).toBeNull();
    runUntil(sim, () => sim.state.jobs.length === 1);
    // The regular full-service price (with its standard service fee), the same as anyone ordering this would pay.
    expect(sim.state.jobs[0].priceCents).toBe(fullServiceQuote(c.request!.spec, true).totalCents);
  });

  it("you can't send a job that doesn't qualify", () => {
    const { sim } = solo({ media: "cardstock" }, "with_help");
    runUntil(sim, () => !!counterCustomer(sim.state));
    expect(canStart(sim.state, { type: "usher_self_serve" })).toMatch(/cardstock/);
  });

  it("drop-off customers aren't staying to make copies", () => {
    const sim = createSim(1);
    sim.state.customers = [];
    const c = spawnCustomer(sim.state, "quick_copies", "back", false, "with_help");
    c.request!.spec = spec({});
    runUntil(sim, () => counterCustomer(sim.state)?.id === c.id); // didn't wander off to self-serve
    expect(canStart(sim.state, { type: "usher_self_serve" })).toMatch(/dropping it off/);
  });

  it("a long job ties up a copier and the people waiting behind it get annoyed", () => {
    const sim = createSim(1);
    sim.state.customers = [];
    noJams(sim);
    const hogs: Customer[] = [];
    for (let i = 0; i < 2; i++) {
      const h = spawnCustomer(sim.state, "quick_copies", "wait", false, "alone");
      h.request!.spec = spec({ originals: 300, copies: 4 }); // 1,200 sides, ~40 min each
      hogs.push(h);
    }
    const waiting = spawnCustomer(sim.state, "quick_copies", "wait", false, "alone");
    waiting.request!.spec = spec({ originals: 2 });
    waiting.linePatience = 15 * 60;

    runUntil(sim, () => waiting.state === "line"); // gave up on the copiers, went to the counter
    expect(waiting.penalty).toBeGreaterThanOrEqual(1);
    expect(hogs.every((h) => h.state === "self_serve")).toBe(true);
    expect(canStart(sim.state, { type: "usher_self_serve" })).not.toBeNull();
  });
});
