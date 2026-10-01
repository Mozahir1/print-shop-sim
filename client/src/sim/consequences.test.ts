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
  it("rude to everyone: three write-ups and fired within a few days", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const day = daysUntilFired(seed, "rude");
      expect(day).not.toBeNull();
      expect(day!).toBeLessThanOrEqual(6);
    }
  });

  it("ignoring everyone: fired too", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const day = daysUntilFired(seed, "ignore");
      expect(day).not.toBeNull();
      expect(day!).toBeLessThanOrEqual(6);
    }
  });

  it("doing it properly: never a write-up", () => {
    for (const seed of [1, 2, 3]) {
      const game = newGame(seed);
      for (let d = 0; d < 20; d++) playDay(game, "proper");
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
  it("angry customers usually complain, happy ones never; complaints arrive in the inbox and add heat", () => {
    let angry = 0;
    let complained = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const sim = createSim(seed);
      sim.state.director.enabled = false;
      const c = spawnCustomer(sim.state, sim.rng.dev, "self_serve_help");
      talkTo(sim, c, "rude");
      doTask(sim, { type: "help_self_serve", customerId: c.id });
      if (c.mood <= -1) angry++;
      complained += sim.state.manager.complaints;
    }
    expect(complained / angry).toBeGreaterThan(COMPLAINT_CHANCE.angry - 0.15);

    const game = newGame(7);
    const { sim } = playDay(game, "proper");
    expect(sim.state.manager.complaints).toBe(0);
  });

  it("a complaint that arrives adds heat when it lands", () => {
    const game = newGame(1);
    const sim = quietDay(game);
    sim.state.manager.scheduled.push({ kind: "complaint", subject: "x", body: "y", at: 5, heat: HEAT.complaint, cause: "complaints" });
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
    doTask(sim, { type: "weigh", packageId: c.packageId! });
    doTask(sim, { type: "tape_shut", packageId: c.packageId! });
    doTask(sim, { type: "label", packageId: c.packageId! });
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

  it("a rude answer usually turns into a bad review the next morning", () => {
    let reviews = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const game = newGame(seed);
      const sim = quietDay(game);
      const c = spawnCustomer(sim.state, sim.rng.dev, "dropoff");
      talkTo(sim, c, "rude");
      doTask(sim, { type: "scan_dropoff", customerId: c.id });
      const flagged = sim.state.manager.flags.some((f) => f.kind === "bad_review");
      finishDay(game, sim);
      const next = quietDay(game);
      tick(next, 1);
      const got = next.state.messages.some((m) => m.kind === "review");
      expect(got).toBe(flagged);
      if (got) reviews++;
    }
    expect(reviews).toBeGreaterThan(10);
  });

  it("packages left in the bin are a complaint the next day", () => {
    const game = newGame(1);
    const sim = quietDay(game);
    const c = spawnCustomer(sim.state, sim.rng.dev, "dropoff");
    talkTo(sim, c);
    doTask(sim, { type: "scan_dropoff", customerId: c.id });
    doTask(sim, { type: "bin", packageId: sim.state.packages[0].id });
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
    const { result } = playDay(game, "proper");
    expect(result.clean).toBe(true);
    const next = startDay(game);
    const reward = next.state.messages.find((m) => m.kind === "reward");
    expect(reward).toBeDefined();
    expect(next.state.revenueCents).toBe(0);
    expect(game.writeUps).toBe(0);
  });

  it("a day with complaints gets none", () => {
    const game = newGame(1);
    const { result } = playDay(game, "rude");
    expect(result.clean).toBe(false);
    expect(startDay(game).state.messages.some((m) => m.kind === "reward")).toBe(false);
  });
});
