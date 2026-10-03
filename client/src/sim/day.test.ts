import { describe, expect, it } from "vitest";
import { createSim, isDayOver, tick, type Sim } from "./sim";
import { botAct, createBot } from "./bot";
import { daySeed, endDay, loadGame, newGame, saveGame, startDay } from "./game";
import { activeCount } from "./todo";
import { spawnCustomer } from "./customers";
import { CLOSING, DIRECTOR } from "./config";
import { calm, doTask, talkTo } from "./testkit";

function playDay(sim: Sim, onTick?: () => void): void {
  const bot = createBot();
  while (!isDayOver(sim.state)) {
    botAct(bot, sim.state, 1);
    tick(sim, 1);
    onTick?.();
  }
}

describe("the flow director", () => {
  it("keeps the load in the band: never above the ceiling; quiet stretches, but not most of the day", () => {
    let idle = 0;
    let open = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const sim = createSim(seed);
      playDay(sim, () => expect(activeCount(sim.state)).toBeLessThanOrEqual(DIRECTOR.ceiling));
      idle += sim.state.stats.idleSeconds;
      open += sim.state.closeAt;
    }
    expect(idle / open).toBeLessThan(0.4); // fewer customers, more time with each (the UI speeds through quiet time)
  });

  it("you deal with 15 to 40 people at the counter (plus whoever goes straight to self-serve)", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const sim = createSim(seed);
      playDay(sim);
      const helped = new Set(sim.state.choices.filter((c) => c.what === "counter").map((c) => c.customerId)).size;
      expect(helped).toBeGreaterThanOrEqual(15);
      expect(helped).toBeLessThanOrEqual(40);
    }
  });

  it("holds back while you're at the ceiling", () => {
    const sim = createSim(3);
    const s = sim.state;
    for (let i = 0; i < DIRECTOR.ceiling; i++) spawnCustomer(s, sim.rng.dev, "quick_copies");
    for (let i = 0; i < 10; i++) tick(sim, 1);
    expect(s.customers).toHaveLength(DIRECTOR.ceiling);
  });

  it("same seed and same choices: the same day", () => {
    const run = () => {
      const sim = createSim(11);
      playDay(sim);
      return JSON.stringify(sim.state);
    };
    expect(run()).toBe(run());
  });

  it("later days lean toward requests with more steps", () => {
    const multi = (day: number) => {
      let n = 0;
      let all = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const sim = createSim(seed, { day });
        playDay(sim);
        for (const c of sim.state.customers) {
          all++;
          if (c.kind === "large_job" || c.kind === "poster" || c.kind === "ship" || (c.kind === "order_pickup" && c.spec && c.timing !== "wait")) n++;
        }
      }
      return n / all;
    };
    expect(multi(20)).toBeGreaterThan(multi(1));
  });
});

describe("the day", () => {
  it("starts with a note in the inbox", () => {
    const s = createSim(1).state;
    expect(s.messages.some((m) => m.kind === "note")).toBe(true);
  });

  it("nobody new comes in after close; an attentive player finishes up and goes home soon after", () => {
    const sim = createSim(5);
    const s = sim.state;
    playDay(sim);
    expect(s.customers.every((c) => c.arrivedAt < s.closeAt)).toBe(true);
    expect(s.time).toBeGreaterThanOrEqual(s.closeAt);
    expect(s.time).toBeLessThan(s.closeAt + CLOSING.sentHomeAfter);
    expect(s.wentHome!.leftUndone).toEqual([]);
  });

  it("if you stop working, the manager eventually locks up and sends you home; nobody's left inside", () => {
    const sim = createSim(5);
    const s = sim.state;
    while (!isDayOver(s)) tick(sim, 1);
    expect(s.time).toBe(s.closeAt + CLOSING.sentHomeAfter);
    expect(s.customers.some((c) => c.state === "line" || c.state === "talking" || c.state === "waiting")).toBe(false);
  });
});

describe("multiple days", () => {
  it("each day's seed is the base seed plus the day number", () => {
    const g = newGame(100);
    expect(daySeed(g)).toBe(101);
    expect(startDay(g).state.seed).toBe(101);
  });

  it("orders not picked up and packages that missed the truck carry over; nothing else does", () => {
    const game = newGame(1);
    const sim = startDay(game);
    const s = sim.state;
    s.director.enabled = false;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { timing: "back", needIn: 400 });
    const restore = calm();
    talkTo(sim, c);
    restore();
    const shipper = spawnCustomer(s, sim.rng.dev, "ship");
    talkTo(sim, shipper);
    doTask(sim, { type: "pack", packageId: shipper.packageId! }); // taped, labeled, binned
    s.revenueCents = 12345;
    while (!isDayOver(s)) tick(sim, 1); // never hand off to the truck
    endDay(game, sim);
    expect(game.day).toBe(2);

    const next = startDay(game).state;
    expect(next.day).toBe(2);
    expect(next.revenueCents).toBe(0);
    const job = next.jobs.find((j) => j.id === c.jobId)!;
    expect(["entered", "printed"]).toContain(job.status); // never still in the printer
    expect(next.customers.find((x) => x.id === c.id)!.state).toBe("away");
    expect(next.packages.find((p) => p.id === shipper.packageId)!.status).toBe("binned");
    expect(next.printer.queue).toEqual([]);
    expect(next.nextId).toBeGreaterThan(job.id);
  });

  it("saves and loads between days", () => {
    const game = newGame(42);
    const sim = startDay(game);
    playDay(sim);
    endDay(game, sim);
    const loaded = loadGame(saveGame(game))!;
    expect(loaded).toEqual(game);
    expect(JSON.stringify(startDay(loaded).state)).toBe(JSON.stringify(startDay(game).state));
    expect(loadGame("not json")).toBeNull();
    expect(loadGame(null)).toBeNull();
  });
});
