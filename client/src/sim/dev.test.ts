import { describe, expect, it } from "vitest";
import { createSim } from "./sim";
import { skipTo } from "./dev";

// Dev mode's skip ahead: the clock runs until the moment you asked for, and stops there.
describe("skip to", () => {
  it("the next thing: stops as soon as something new needs you", () => {
    const sim = createSim(3);
    const s = sim.state;
    const msg = skipTo(sim, "next");
    expect(msg).toMatch(/^Skipped \d+ min to/);
    expect(s.customers.some((c) => c.state === "line") || s.messages.some((m) => !m.read && m.at > 0)).toBe(true);
    expect(s.devUsed).toBe(true);
  });

  it("the truck, closing time, and today's bad luck", () => {
    const sim = createSim(3);
    const s = sim.state;
    s.director.enabled = false;
    skipTo(sim, "truck");
    expect(s.truck.status).toBe("waiting");
    expect(skipTo(sim, "truck")).toMatch(/already here/);
    skipTo(sim, "close");
    expect(s.time).toBe(s.closeAt);
    expect(skipTo(sim, "event")).toMatch(/bad luck/);
  });

  it("today's bad luck, when there's some to come", () => {
    const sim = createSim(11, { day: 6 });
    const s = sim.state;
    s.event = { kind: "card_reader_down", at: 60, status: "pending", firedAt: null };
    skipTo(sim, "event");
    expect(s.event.status).toBe("active");
    expect(s.time).toBeGreaterThanOrEqual(60);
  });
});
