import { describe, expect, it } from "vitest";
import { createSim, isDayOver, tick } from "./sim";
import { botAct, createBot, type BotStyle } from "./bot";
import { endDay, newGame, startDay, type Game } from "./game";
import { spawnCustomer } from "./customers";
import { devEvent } from "./dev";
import { answerLine } from "./mc";
import { pickLine, POOLS } from "./lines";
import { HEAT } from "./config";
import { doTask, talkTo } from "./testkit";
import type { RequestKind } from "./types";
import { readdirSync, readFileSync } from "node:fs";

function play(game: Game, style: BotStyle) {
  const sim = startDay(game);
  const bot = createBot(1, style);
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
    const sim = play(game, "proper");
    expect(moments(sim)[0]).toBe("start_of_day");
    expect(moments(sim).at(-1)).toBe("end_of_day");
  });

  it("never changes: the same moment gets the same line whether you're perfect or awful", () => {
    const a = play(newGame(1), "proper");
    const b = play(newGame(1), "rude");
    const line = (sim: typeof a, m: string) => sim.state.captions.find((c) => c.moment === m)!.text;
    expect(line(a, "start_of_day")).toBe(line(b, "start_of_day"));
    expect(line(a, "end_of_day")).toBe(line(b, "end_of_day"));
  });

  it("even proper answers read as bored, and the buttons say exactly what gets said", () => {
    const sim = createSim(1);
    sim.state.director.enabled = false;
    const c = spawnCustomer(sim.state, sim.rng.dev, "ship");
    doTask(sim, { type: "talk", customerId: c.id });
    const rude = answerLine(sim.state, c, "rude");
    expect(rude).toBe("It's a box. It goes in a truck."); // tagged for shipping customers
    doTask(sim, { type: "respond", customerId: c.id, choice: "rude" });
    expect(sim.state.captions.at(-1)).toMatchObject({ moment: "rude", text: rude });
    expect(answerLine(sim.state, c, "proper")).toBe("Yeah, I can do that.");
  });

  it("says something on bad luck, lazy choices, and the manager's messages", () => {
    const sim = createSim(1);
    sim.state.director.enabled = false;
    sim.state.event = null;
    devEvent(sim, "copier_dies");
    doTask(sim, { type: "out_of_order_sign" });
    expect(moments(sim)).toEqual(expect.arrayContaining(["bad_luck", "lazy"]));

    const game = newGame(3);
    play(game, "proper"); // clean day: a hollow reward tomorrow
    expect(moments(startDay(game))).toContain("hollow_reward");
    game.writeUps = 0;
    const s = startDay(game);
    s.state.manager.heat = HEAT.warnAt;
    s.state.director.enabled = false; // nothing else happens
    s.state.event = null;
    s.state.manager.flags = [];
    while (!isDayOver(s.state)) tick(s, 1);
    endDay(game, s);
    expect(moments(startDay(game))).toContain("warning");
  });

  it("customers say what they want, and how they feel when they go", () => {
    const sim = createSim(1);
    sim.state.director.enabled = false;
    const c = spawnCustomer(sim.state, sim.rng.dev, "dropoff");
    doTask(sim, { type: "talk", customerId: c.id });
    expect(c.said).toBe("Just dropping this off.");
    doTask(sim, { type: "respond", customerId: c.id, choice: "proper" });
    doTask(sim, { type: "scan_dropoff", customerId: c.id });
    expect(c.said).toBe("Thanks!");
  });
});

describe("endings", () => {
  function firedEnding(style: BotStyle) {
    const game = newGame(2);
    while (!game.fired && game.day < 15) play(game, style);
    expect(game.fired).toBe(true);
    return game.ending!;
  }

  it("rude to everyone: the rude ending", () => {
    const e = firedEnding("rude");
    expect(e.cause).toBe("rude");
    expect(e.text).toBe(pickLine(POOLS.endings, "ending", { cause: "rude" }).text);
    expect(e.message).toBe("We're going to have to let you go.");
    expect(e.mc).toBe("Okay.");
  });

  it("ignoring everyone: the ignoring ending", () => {
    expect(firedEnding("ignore").cause).toBe("ignoring");
  });

  it("there's a variant for every cause", () => {
    for (const cause of ["complaints", "ignoring", "rude"]) expect(pickLine(POOLS.endings, "ending", { cause }).text).toBeTruthy();
  });
});

describe("content", () => {
  it("every request has a line, every MC moment has a line", () => {
    const kinds: RequestKind[] = ["quick_copies", "large_job", "poster", "ship", "dropoff", "order_pickup", "package_pickup", "self_serve_help"];
    for (const request of kinds) expect(pickLine(POOLS.customers, "request", { request }).text).toBeTruthy();
    for (const about of ["damaged_box", "smudged_return"]) expect(pickLine(POOLS.customers, "request", { request: "complaint", about }).text).toBeTruthy();
    for (const m of ["greeting", "proper", "minimum", "rude", "ignore", "lazy", "bad_luck", "hollow_reward", "warning", "write_up", "start_of_day", "end_of_day", "fired"]) {
      expect(pickLine(POOLS.mc, m).text).toBeTruthy();
    }
  });

  it("player-facing text has no em dashes", () => {
    const dir = new URL("../data/", import.meta.url);
    for (const f of readdirSync(dir)) expect(readFileSync(new URL(f, dir), "utf8")).not.toContain("—");
  });
});
