import { describe, expect, it } from "vitest";
import { createSim, goHome, isDayOver, tick } from "./sim";
import { botAct, createBot, type BotStyle } from "./bot";
import { endDay, newGame, startDay, type Game } from "./game";
import { spawnCustomer } from "./customers";
import { devEvent } from "./dev";
import { pickLine, POOLS } from "./lines";
import { CLOSING, HEAT } from "./config";
import { calm, doTask } from "./testkit";
import type { RequestKind } from "./types";
import { readdirSync, readFileSync } from "node:fs";

function play(game: Game, style: BotStyle) {
  const sim = startDay(game);
  const bot = createBot(1, style, game.baseSeed);
  while (!isDayOver(sim.state)) {
    botAct(bot, sim.state, 1);
    tick(sim, 1);
  }
  endDay(game, sim);
  return sim;
}

const moments = (sim: ReturnType<typeof createSim>) => sim.state.captions.map((c) => c.moment);

describe("the MC", () => {
  it("talks at the start and end of the day", () => {
    const game = newGame(1);
    const sim = play(game, "smart");
    expect(moments(sim)[0]).toBe("start_of_day");
    expect(moments(sim).at(-1)).toBe("end_of_day");
  });

  it("never changes: the same moment gets the same line whether you do everything or ignore everyone", () => {
    const a = play(newGame(1), "smart");
    const b = play(newGame(1), "ignore");
    const line = (sim: typeof a, m: string) => sim.state.captions.find((c) => c.moment === m)!.text;
    expect(line(a, "start_of_day")).toBe(line(b, "start_of_day"));
    expect(line(a, "end_of_day")).toBe(line(b, "end_of_day"));
  });

  it("only reacts and narrates: answering a customer, whichever way, isn't an MC line", () => {
    const sim = createSim(1);
    sim.state.director.enabled = false;
    const kinds = new Set<string>();
    for (const choice of ["take", "turn_away", "ignore"] as const) {
      const c = spawnCustomer(sim.state, sim.rng.dev, "dropoff");
      doTask(sim, { type: "talk", customerId: c.id });
      const before = sim.state.captions.length;
      doTask(sim, { type: "respond", customerId: c.id, choice });
      expect(sim.state.captions.length).toBe(before);
      for (const cap of sim.state.captions) kinds.add(cap.moment);
      sim.state.customers = [];
    }
    expect([...kinds].sort()).toEqual(["greeting", "start_of_day"]);
  });

  it("says something on bad luck and the manager's messages", () => {
    const sim = createSim(1);
    sim.state.director.enabled = false;
    sim.state.event = null;
    devEvent(sim, "copier_dies");
    expect(moments(sim)).toContain("bad_luck");

    const game = newGame(3);
    play(game, "smart"); // clean day: a hollow reward tomorrow
    expect(moments(startDay(game))).toContain("hollow_reward");
    game.writeUps = 0;
    const s = startDay(game);
    s.state.manager.heat = HEAT.warnAt + CLOSING.onTimeReward; // (leaving on time takes a little off)
    s.state.director.enabled = false; // nothing else happens
    s.state.event = null;
    s.state.manager.flags = [];
    while (s.state.time < s.state.closeAt) tick(s, 1);
    goHome(s.state);
    endDay(game, s);
    expect(moments(startDay(game))).toContain("warning");
  });

  it("customers say what they want, how they react, and how they feel when they go", () => {
    const restore = calm();
    const sim = createSim(1);
    sim.state.director.enabled = false;
    const c = spawnCustomer(sim.state, sim.rng.dev, "dropoff");
    doTask(sim, { type: "talk", customerId: c.id });
    expect(c.said).toBe("Just dropping this off.");
    doTask(sim, { type: "respond", customerId: c.id, choice: "take" });
    expect(c.said).toBe("Thanks!");
    const no = spawnCustomer(sim.state, sim.rng.dev, "ship");
    doTask(sim, { type: "talk", customerId: no.id });
    doTask(sim, { type: "respond", customerId: no.id, choice: "turn_away" });
    expect(no.said).toBe("Oh. Okay.");
    restore();
  });
});

describe("endings", () => {
  function firedEnding(style: BotStyle, seed = 2) {
    const game = newGame(seed);
    while (!game.fired && game.day < 20) play(game, style);
    expect(game.fired).toBe(true);
    return game.ending!;
  }

  it("turning everyone away: the lost sales ending", () => {
    const e = firedEnding("turn_away", 2001);
    expect(e.cause).toBe("lost_sales");
    expect(e.text).toBe(pickLine(POOLS.endings, "ending", { cause: "lost_sales" }).text);
    expect(e.message).toBe("We're going to have to let you go.");
    expect(e.mc).toBe("Okay.");
  });

  it("ignoring everyone: the ignoring ending", () => {
    expect(firedEnding("ignore").cause).toBe("ignoring");
  });

  it("there's a variant for every cause", () => {
    for (const cause of ["complaints", "ignoring", "lost_sales"]) expect(pickLine(POOLS.endings, "ending", { cause }).text).toBeTruthy();
  });
});

describe("content", () => {
  it("every request and reaction has a line, every MC moment has a line", () => {
    const kinds: RequestKind[] = ["quick_copies", "large_job", "poster", "ship", "dropoff", "order_pickup", "package_pickup", "self_serve_help"];
    for (const request of kinds) expect(pickLine(POOLS.customers, "request", { request }).text).toBeTruthy();
    for (const about of ["damaged_box", "smudged_return"]) expect(pickLine(POOLS.customers, "request", { request: "complaint", about }).text).toBeTruthy();
    for (const reaction of ["accept_self_serve", "refuse_self_serve", "balk_fee", "balk_rush", "too_late", "accept_later", "turned_away"]) {
      expect(pickLine(POOLS.customers, "reaction", { reaction }).text).toBeTruthy();
    }
    for (const m of ["greeting", "bad_luck", "hollow_reward", "warning", "write_up", "start_of_day", "end_of_day", "fired"]) {
      expect(pickLine(POOLS.mc, m).text).toBeTruthy();
    }
  });

  it("player-facing text has no em dashes", () => {
    const dir = new URL("../data/", import.meta.url);
    for (const f of readdirSync(dir)) expect(readFileSync(new URL(f, dir), "utf8")).not.toContain("—");
  });
});
