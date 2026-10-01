import { describe, expect, it } from "vitest";
import { isDayOver, tick } from "./sim";
import { BOT_STYLES, botAct, createBot, type BotStyle } from "./bot";
import { endDay, newGame, startDay, type Game } from "./game";
import { summarize } from "./summary";
import type { ChoiceType } from "./types";

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

describe("bot playstyles pick their choice type consistently", () => {
  const counterTypes = (style: BotStyle): Set<ChoiceType> => {
    const { sim } = playDay(newGame(5), style);
    return new Set(sim.state.choices.filter((c) => c.what === "counter" && !c.auto).map((c) => c.type));
  };

  it("at the counter", () => {
    expect(counterTypes("proper")).toEqual(new Set(["proper"]));
    expect(counterTypes("minimum")).toEqual(new Set(["minimum"]));
    expect(counterTypes("rude")).toEqual(new Set(["rude"]));
    expect(counterTypes("ignore")).toEqual(new Set(["ignore"]));
    expect(counterTypes("lazy")).toEqual(new Set(["proper"])); // polite enough; it cuts corners on the work
    expect(counterTypes("random").size).toBeGreaterThan(2);
  });

  it("on the work: lazy takes every shortcut, proper none", () => {
    const tasks = (style: BotStyle) => {
      const game = newGame(9);
      const all = [];
      for (let d = 0; d < 3; d++) all.push(...playDay(game, style).sim.state.choices.filter((c) => c.what !== "counter" && c.what !== "event"));
      return new Set(all.map((c) => c.type));
    };
    expect(tasks("proper")).toEqual(new Set(["proper"]));
    expect(tasks("lazy")).toEqual(new Set(["lazy"]));
  });

  it("every style is in the list", () => {
    expect(BOT_STYLES).toEqual(["proper", "minimum", "lazy", "rude", "ignore", "random"]);
  });
});

describe("balance targets (the batch checks these over more games)", () => {
  it("proper and minimum last 20 days", () => {
    for (const seed of [1, 1001]) {
      expect(lasts(seed, "proper")).toBe(21);
      expect(lasts(seed, "minimum")).toBe(21);
    }
  });

  it("rude and ignore are fired within 2 to 6 days; lazy lands in between", () => {
    for (const seed of [1, 1001]) {
      for (const style of ["rude", "ignore"] as const) {
        const day = lasts(seed, style);
        expect(day).toBeGreaterThanOrEqual(2);
        expect(day).toBeLessThanOrEqual(6);
      }
      const lazy = lasts(seed, "lazy");
      expect(lazy).toBeGreaterThan(6);
      expect(lazy).toBeLessThanOrEqual(20);
    }
  });
});

describe("the server summary", () => {
  it("keeps the shape the server accepts, mapped from the new day", () => {
    const { sim } = playDay(newGame(3), "minimum");
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
