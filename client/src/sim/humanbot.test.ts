import { describe, expect, it } from "vitest";
import { endDay, newGame, startDay } from "./game";
import { createHuman, effort, humanDay } from "./humanbot";
import { createSim } from "./sim";

// The human-pace bot plays like a first-time player: a few seconds a click, a pause to find the station, forms typed
// out. The game is tuned so that, playing sensibly at that pace, the first days go fine and only later does someone
// occasionally walk out (SIM_SPEC.md, human-play checks). npm run batch -- --pace human shows the full picture.
describe("at a person's pace", () => {
  it("waits when there's nothing to do", () => {
    const sim = createSim(1);
    const h = createHuman("smart", 1);
    expect(effort(h, sim.state)).toBeNull(); // nothing to do yet
  });

  it("days 1 to 3 go fine for a sensible first-timer; by day 5 someone now and then walks out", () => {
    const early = { days: 0, withWalkout: 0, late: 0 };
    let laterWalkouts = 0;
    for (let g = 0; g < 15; g++) {
      const game = newGame(1 + g * 1000);
      for (let day = 1; day <= 5 && !game.fired; day++) {
        const sim = startDay(game);
        humanDay(sim, createHuman("smart", sim.state.seed));
        const s = sim.state;
        if (day <= 3) {
          early.days++;
          if (s.stats.left > 0) early.withWalkout++;
          early.late += s.stats.lateOrders;
        } else laterWalkouts += s.stats.left;
        endDay(game, sim);
      }
      expect(game.fired, `game ${g}`).toBe(false);
    }
    expect(early.withWalkout / early.days).toBeLessThanOrEqual(0.07); // (a rare chain of a late order and bad luck)
    expect(early.late / early.days).toBeLessThanOrEqual(0.15);
    expect(laterWalkouts).toBeGreaterThan(0); // it isn't trivially easy
  });
});
