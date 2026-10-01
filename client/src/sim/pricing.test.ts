import { describe, expect, it } from "vitest";
import { canStart, createSim, fullServiceShare, isShiftOver, tick, type Sim } from "./sim";
import { fullServiceQuote, selfServePriceCents } from "./orders";
import type { JobSpec } from "./types";

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

describe("full service pricing", () => {
  it("adds a $2 service fee to orders of $50 or less", () => {
    const q = fullServiceQuote(spec({ originals: 10 }), true); // 10 sides at 15c
    expect(q).toEqual({ printCents: 150, serviceFeeCents: 200, rushCents: 0, totalCents: 350 });
  });

  it("waives the fee over $50, and adds a 10% rush if it's needed the same day", () => {
    const big = spec({ originals: 100, copies: 5, color: "color" }); // 500 color sides at 59c = $295
    expect(fullServiceQuote(big, true)).toEqual({ printCents: 29500, serviceFeeCents: 0, rushCents: 2950, totalCents: 32450 });
    expect(fullServiceQuote(big, false)).toEqual({ printCents: 29500, serviceFeeCents: 0, rushCents: 0, totalCents: 29500 });
  });

  it("exactly $50 is not over $50: it still pays the fee and no rush", () => {
    const fifty = fullServiceQuote(spec({ originals: 2, copies: 1, color: "color", media: "wide_18x24" }), true); // 2 posters at $25
    expect(fifty).toEqual({ printCents: 5000, serviceFeeCents: 200, rushCents: 0, totalCents: 5200 });
    const over = fullServiceQuote(spec({ originals: 100, copies: 1, color: "color" }), true); // 100 color sides at 59c = $59
    expect(over).toEqual({ printCents: 5900, serviceFeeCents: 0, rushCents: 590, totalCents: 6490 });
  });

  it("orders taken at the counter and online both charge it", () => {
    const sim = createSim(6);
    while (!isShiftOver(sim.state)) tick(sim, 1); // nobody serves anyone, but online orders still come in
    const online = sim.state.jobs.filter((j) => j.channel === "web");
    expect(online.length).toBeGreaterThan(0);
    for (const j of online) {
      const q = fullServiceQuote(j.spec, !j.dueTomorrow);
      expect(j.priceCents).toBe(q.totalCents);
      expect(j.prepaid).toBe(true);
    }
  });
});

describe("online orders", () => {
  it("come in on their own and can't be turned away", () => {
    const sim: Sim = createSim(2);
    const c = sim.state.customers.find((x) => x.webOrderAt !== null)!;
    for (let i = 0; i < 9 * 3600 && c.jobId === null; i++) tick(sim, 1);
    expect(c.jobId).not.toBeNull();
    // There is no counter step to refuse: the order already exists, and turn_away only applies to someone at the counter.
    expect(canStart(sim.state, { type: "turn_away" })).not.toBeNull();
  });
});

describe("who refuses self-serve weighs the fee", () => {
  it("small jobs, where the $2 fee is most of the price, are rarely worth full service", () => {
    const tiny = spec({ originals: 2 });
    const mid = spec({ originals: 60 });
    expect(fullServiceShare(tiny)).toBeLessThan(0.2);
    expect(fullServiceShare(mid)).toBeLessThan(0.2);
  });

  it("the more full service costs over doing it yourself, the fewer insist on it", () => {
    const cheapGap = spec({ originals: 4 });
    const bigGap = spec({ originals: 300, copies: 3, color: "color" }); // big color run: full service costs far more
    expect(fullServiceQuote(bigGap, true).totalCents - selfServePriceCents(bigGap)).toBeGreaterThan(
      fullServiceQuote(cheapGap, true).totalCents - selfServePriceCents(cheapGap),
    );
    expect(fullServiceShare(bigGap)).toBeLessThan(fullServiceShare(cheapGap));
    expect(fullServiceShare(bigGap)).toBeGreaterThanOrEqual(0.02);
  });
});
