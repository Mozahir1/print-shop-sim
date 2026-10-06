import { describe, expect, it } from "vitest";
import { createSim, isDayOver, tick, type Sim } from "./sim";
import { botAct, createBot, type BotStyle } from "./bot";
import { endDay, loadGame, newGame, saveGame, startDay, type Game } from "./game";
import { spawnCustomer } from "./customers";
import { COMPLAINT_CHANCE, HEAT } from "./config";
import { doTask, runUntil, talkTo } from "./testkit";

function playDay(game: Game, style: BotStyle, setup?: (sim: Sim) => void) {
  const sim = startDay(game);
  setup?.(sim);
  const bot = createBot(1, style);
  while (!isDayOver(sim.state)) {
    botAct(bot, sim.state, 1);
    tick(sim, 1);
  }
  return { sim, result: endDay(game, sim) };
}

function daysUntilFired(seed: number, style: BotStyle, max = 20): number | null {
  const game = newGame(seed);
  while (game.day <= max) {
    playDay(game, style);
    if (game.fired) return game.day;
  }
  return null;
}

// Plays a day where only what the test sets up happens.
function quietDay(game: Game) {
  const sim = startDay(game);
  sim.state.director.enabled = false;
  sim.state.printer.paperOutAt = Infinity;
  return sim;
}

function finishDay(game: Game, sim: Sim) {
  while (!isDayOver(sim.state)) tick(sim, 1);
  return endDay(game, sim);
}

describe("playstyles and the manager", () => {
  it("ignoring everyone: three write-ups and fired within a few days", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const day = daysUntilFired(seed, "ignore");
      expect(day).not.toBeNull();
      expect(day!).toBeLessThanOrEqual(8);
    }
  });

  it("turning away everything you could have done: fired, but slowly", () => {
    const day = daysUntilFired(1, "turn_away");
    expect(day).not.toBeNull();
    expect(day!).toBeGreaterThan(5);
  });

  it("doing it smart: never a write-up", () => {
    for (const seed of [1, 2, 3]) {
      const game = newGame(seed);
      for (let d = 0; d < 20; d++) playDay(game, "smart");
      expect(game.writeUps).toBe(0);
      expect(game.results.every((r) => r.outcome === "none")).toBe(true);
      expect(game.fired).toBe(false);
    }
  });

  it("the third write-up is getting fired, and the game doesn't move on", () => {
    const game = newGame(1);
    game.writeUps = 2;
    const sim = quietDay(game);
    sim.state.manager.heat = HEAT.writeUpAt;
    const r = finishDay(game, sim);
    expect(r.outcome).toBe("fired");
    expect(game.fired).toBe(true);
    expect(game.day).toBe(1);
  });

  it("a warning, then a write-up, by heat at close", () => {
    const game = newGame(1);
    let sim = quietDay(game);
    sim.state.manager.heat = HEAT.warnAt;
    expect(finishDay(game, sim).outcome).toBe("warning");
    sim = quietDay(game);
    expect(sim.state.messages.some((m) => m.kind === "warning")).toBe(true);
    sim.state.manager.heat = HEAT.writeUpAt;
    expect(finishDay(game, sim).outcome).toBe("write_up");
    expect(game.writeUps).toBe(1);
    expect(quietDay(game).state.messages.some((m) => m.kind === "write_up")).toBe(true);
  });
});

describe("complaints", () => {
  it("bad work usually ends in a complaint (here: the copier left broken with a sign on it); happy customers never complain", () => {
    let complained = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const sim = createSim(seed);
      sim.state.director.enabled = false;
      sim.state.copier = { status: "broken", sign: true };
      const c = spawnCustomer(sim.state, sim.rng.dev, "self_serve_help");
      talkTo(sim, c, "turn_away"); // "Sorry, it's broken."
      expect(c.mood).toBeLessThanOrEqual(-1);
      complained += sim.state.manager.complaints;
    }
    expect(complained / 100).toBeGreaterThan(COMPLAINT_CHANCE.angry - 0.15);

    const game = newGame(7);
    const { sim } = playDay(game, "smart");
    expect(sim.state.manager.complaints).toBe(0);
  });

  it("a complaint that arrives adds heat when it lands", () => {
    const game = newGame(1);
    const sim = quietDay(game);
    sim.state.manager.scheduled.push({ kind: "complaint", from: "A customer", subject: "x", body: "y", at: 5, heat: HEAT.complaint, cause: "complaints" });
    const before = sim.state.manager.heat;
    runUntil(sim, () => sim.state.messages.some((m) => m.kind === "complaint"));
    expect(sim.state.manager.heat).toBe(before + HEAT.complaint);
  });
});

describe("delayed consequences", () => {
  it("a taped-shut box comes back damaged in one or two days", () => {
    const game = newGame(1);
    const sim = quietDay(game);
    const c = spawnCustomer(sim.state, sim.rng.dev, "ship");
    talkTo(sim, c);
    doTask(sim, { type: "tape_shut", packageId: c.packageId! }); // labeled and binned
    const flag = sim.state.manager.flags.find((f) => f.kind === "damaged_box")!;
    expect(flag.dueDay - 1).toBeGreaterThanOrEqual(1);
    expect(flag.dueDay - 1).toBeLessThanOrEqual(2);
    finishDay(game, sim);
    while (game.day < flag.dueDay) finishDay(game, quietDay(game));
    const due = startDay(game);
    due.state.printer.paperOutAt = Infinity;
    runUntil(due, () => due.state.customers.some((x) => x.kind === "complaint"));
    const back = due.state.customers.find((x) => x.kind === "complaint")!;
    expect(back.name).toBe(c.name);
    expect(back.about).toBe("damaged_box");
    expect(back.mood).toBe(-1);
  });

  it("packages left in the bin are a complaint the next day", () => {
    const game = newGame(1);
    const sim = quietDay(game);
    const c = spawnCustomer(sim.state, sim.rng.dev, "dropoff");
    talkTo(sim, c);
    finishDay(game, sim); // the truck came and went without them
    const next = quietDay(game);
    tick(next, 1);
    expect(next.state.messages.some((m) => m.kind === "complaint" && /package/.test(m.body))).toBe(true);
  });

  it("flags persist with the save", () => {
    const game = newGame(1);
    game.flags.push({ kind: "damaged_box", dueDay: 3, dueAt: 20, name: "Dana R." });
    expect(loadGame(saveGame(game))!.flags).toEqual(game.flags);
  });
});

describe("hollow rewards", () => {
  it("a clean day gets a reward message the next morning, and nothing else changes", () => {
    const game = newGame(1);
    const { result } = playDay(game, "smart");
    expect(result.clean).toBe(true);
    const next = startDay(game);
    const reward = next.state.messages.find((m) => m.kind === "reward");
    expect(reward).toBeDefined();
    expect(next.state.revenueCents).toBe(0);
    expect(game.writeUps).toBe(0);
  });

  it("a day with complaints gets none", () => {
    const game = newGame(1);
    const { result } = playDay(game, "ignore");
    expect(result.clean).toBe(false);
    expect(startDay(game).state.messages.some((m) => m.kind === "reward")).toBe(false);
  });
});
