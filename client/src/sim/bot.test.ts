import { describe, expect, it } from "vitest";
import { isDayOver, tick } from "./sim";
import { BOT_STYLES, botAct, createBot, type BotStyle } from "./bot";
import { endDay, newGame, startDay, type Game } from "./game";
import { summarize } from "./summary";

function playDay(game: Game, style: BotStyle) {
  const sim = startDay(game);
  const bot = createBot(1, style, sim.state.seed);
  while (!isDayOver(sim.state)) {
    botAct(bot, sim.state, 1);
    tick(sim, 1);
  }
  const result = endDay(game, sim);
  return { sim, result };
}

function lasts(seed: number, style: BotStyle, days = 20): number {
  const game = newGame(seed);
  while (!game.fired && game.day <= days) playDay(game, style);
  return game.fired ? game.day : days + 1;
}

describe("bot playstyles", () => {
  const counterActions = (style: BotStyle, days = 2) => {
    const game = newGame(5);
    const all = [];
    for (let d = 0; d < days; d++) all.push(...playDay(game, style).sim.state.choices.filter((c) => c.what === "counter" && !c.auto));
    return new Set(all.map((c) => c.action));
  };

  it("pick their answers consistently", () => {
    expect(counterActions("ignore")).toEqual(new Set(["ignore"]));
    expect(counterActions("do_everything")).not.toContain("turn_away");
    expect(counterActions("do_everything")).not.toContain("self_serve");
    expect(counterActions("turn_away")).toContain("turn_away");
    expect(counterActions("smart", 4).has("self_serve")).toBe(true);
    expect(counterActions("random").size).toBeGreaterThan(2);
  });

  it("on the work: smart and do-everything always Do", () => {
    const tasks = (style: BotStyle) => {
      const game = newGame(9);
      const all = [];
      for (let d = 0; d < 3; d++) all.push(...playDay(game, style).sim.state.choices.filter((c) => c.what !== "counter" && c.what !== "event" && c.what !== "inbox" && c.what !== "truck" && c.what !== "coworker")); // (a request can lapse while you're with a customer)
      return new Set(all.map((c) => c.type));
    };
    expect(tasks("smart")).toEqual(new Set(["do"]));
    expect(tasks("do_everything")).toEqual(new Set(["do"]));
  });

  it("smart only turns away what couldn't be done in time or wasn't worth it", () => {
    const game = newGame(3);
    for (let d = 0; d < 5; d++) expect(playDay(game, "smart").sim.state.stats.lostSales).toBe(0);
  });

  it("every style is in the list", () => {
    expect(BOT_STYLES).toEqual(["smart", "careless", "do_everything", "turn_away", "ignore", "random"]);
  });
});

describe("balance targets (the batch checks these over more games)", () => {
  it("smart and do-everything last 20 days", () => {
    for (const seed of [1, 1001]) {
      expect(lasts(seed, "smart")).toBe(21);
      expect(lasts(seed, "do_everything")).toBe(21);
    }
  });

  it("ignoring gets you fired fast; turning business away gets you fired slowly", () => {
    for (const seed of [1, 1001]) expect(lasts(seed, "ignore")).toBeLessThanOrEqual(8);
    // Across a few games: most get fired, and not right away.
    const slow = [1, 1001, 2001, 3001, 4001].map((seed) => lasts(seed, "turn_away"));
    expect(slow.filter((d) => d <= 20).length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...slow)).toBeGreaterThan(5);
  });
});

describe("the server summary", () => {
  it("keeps the shape the server accepts, mapped from the new day", () => {
    const { sim } = playDay(newGame(3), "do_everything");
    const s = sim.state;
    const sum = summarize(s, "Tester", "human");
    expect(Object.keys(sum).sort()).toEqual(["cashCents", "customersLost", "customersServed", "jams", "jobs", "playerName", "satisfaction", "score", "seed", "source"]);
    expect(sum.score).toBe(s.stats.served);
    expect(sum.cashCents).toBe(s.revenueCents);
    expect(sum.customersLost).toBe(s.stats.angry);
    expect(sum.satisfaction).toBe(Math.round((s.stats.happy / (s.stats.happy + s.stats.neutral + s.stats.angry)) * 100));
    expect(sum.satisfaction).toBeGreaterThanOrEqual(0);
    expect(sum.satisfaction).toBeLessThanOrEqual(100);
    expect(sum.jams).toBe(s.event && s.event.status !== "pending" ? 1 : 0);
    for (const j of sum.jobs) {
      expect(["picked_up", "abandoned", "ready", "unfinished"]).toContain(j.outcome);
      expect(Object.keys(j).sort()).toEqual(["customerType", "kind", "outcome", "pages", "priceCents", "waitSeconds"]);
    }
  });
});
