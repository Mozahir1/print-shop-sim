import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { begin, canStart, createSim, currentCustomer, isDayOver, startTask, tick, type Sim } from "./sim";
import { endDay, loadGame, newGame, saveGame, startDay } from "./game";
import { botAct, createBot } from "./bot";
import { spawnCustomer } from "./customers";
import { COWORKERS, newCrew, planSchedule } from "./schedule";
import { inUse, runCoworker } from "./coworker";
import { activeCount, todoList } from "./todo";
import { notes } from "./notes";
import { CREW, DIRECTOR } from "./config";
import { calm, makeReady, runUntil, talkTo } from "./testkit";
import type { JobSpec } from "./types";

let restore: () => void;
beforeEach(() => (restore = calm()));
afterEach(() => restore());

function quiet(coworker = "A", seed = 1): Sim {
  const sim = createSim(seed, { coworker });
  sim.state.director.enabled = false;
  sim.state.event = null;
  sim.state.printer.paperOutAt = Infinity;
  sim.state.coworker!.breaks = [];
  return sim;
}

const spec = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "flyer", originals: 1, copies: 8, color: "color", media: "cardstock", duplex: false, finishing: "staple", ...s });

describe("the schedule", () => {
  it("never puts anyone on more than two days in a row, and everyone works", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const s = planSchedule(newCrew(), seed, 60);
      for (let i = CREW.streak; i < s.length; i++) expect(s.slice(i - CREW.streak, i + 1).every((x) => x === s[i]), `seed ${seed} day ${i + 1}`).toBe(false);
      for (const c of COWORKERS) expect(s, `seed ${seed}`).toContain(c.id);
    }
  });

  it("is posted ahead and stays put (the same seed, the same schedule, however far ahead you look)", () => {
    const a = planSchedule(newCrew(), 42, 10);
    const crew = newCrew();
    planSchedule(crew, 42, 3);
    expect(planSchedule(crew, 42, 10)).toEqual(a);
  });

  it("isn't streaky: whoever you haven't seen in a while is likelier", () => {
    let gaps = 0;
    let n = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const s = planSchedule(newCrew(), seed, 30);
      for (const c of COWORKERS) {
        const days = s.map((x, i) => (x === c.id ? i : -1)).filter((i) => i >= 0);
        for (let i = 1; i < days.length; i++) {
          gaps = Math.max(gaps, days[i] - days[i - 1]);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(gaps).toBeLessThanOrEqual(8); // nobody disappears for much over a week
  });

  it("each day starts with that day's coworker, and the schedule is saved with the game", () => {
    const game = newGame(5);
    const sim = startDay(game);
    expect(sim.state.coworker?.id).toBe(game.crew.schedule[0]);
    expect(sim.state.schedule).toEqual(game.crew.schedule.slice(0, 3));
    endDay(game, sim);
    const loaded = loadGame(saveGame(game))!;
    expect(loaded.crew.schedule.slice(0, 3)).toEqual(game.crew.schedule.slice(0, 3));
  });
});

describe("the coworker", () => {
  it("serves their own customers start to finish: none of it is on your list, your notes, or your load", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec(), timing: "back", needIn: 200 });
    c.crew = true;
    expect(currentCustomer(s)).toBeUndefined();
    expect(todoList(s)).toEqual([]);
    expect(activeCount(s)).toBe(0);
    runUntil(sim, () => s.jobs.length > 0 && s.jobs[0].status === "bagged", 400);
    const job = s.jobs[0];
    expect(notes(s)).toEqual([]);
    expect(canStart(s, { type: "collect", jobId: job.id })).toMatch(/Corinne is taking care of that/);
    s.director.enabled = true; // (they come back for it)
    runUntil(sim, () => c.state === "gone", 400);
    expect(job.status).toBe("picked_up");
    expect(s.coworker!.stats.served).toBe(1);
    expect(s.stats.served).toBe(0); // (theirs, not yours)
    expect(s.revenueCents).toBe(job.priceCents);
  });

  it("ships, scans drop-offs, and hands over packages", () => {
    const sim = quiet();
    const s = sim.state;
    const kinds = ["ship", "dropoff", "package_pickup"] as const;
    const cs = kinds.map((k) => Object.assign(spawnCustomer(s, sim.rng.dev, k), { crew: true }));
    runUntil(sim, () => cs.every((c) => c.state === "gone"), 200);
    expect(s.packages.filter((p) => p.kind !== "held").every((p) => p.status === "binned")).toBe(true);
    expect(s.coworker!.stats.served).toBe(3);
  });

  it("takes breaks, and goes home after close once their customers are done", () => {
    const sim = createSim(1, { coworker: "B" });
    const s = sim.state;
    s.director.enabled = false;
    const at = s.coworker!.breaks[0];
    runUntil(sim, () => s.coworker!.at === "break", at + 5);
    runUntil(sim, () => s.coworker!.at !== "break", 60);
    runUntil(sim, () => s.coworker!.at === "gone", s.closeAt + 10);
    expect(s.time).toBeGreaterThanOrEqual(s.closeAt);
  });
});

describe("shared machines", () => {
  it("while they're at the finishing table, your steps there wait (and say for how long)", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec(), timing: "back", needIn: 300 });
    talkTo(sim, c);
    const job = s.jobs[0];
    runUntil(sim, () => job.status === "printed");
    s.handsOn = true; // (from here, each step waits for you)
    expect(begin(s, { type: "collect", jobId: job.id })).toBeNull();
    expect(startTask(s, { type: "collect", jobId: job.id })).toBeNull();
    runUntil(sim, () => s.employee.task === null);
    s.coworker!.task = { kind: "finish", what: "Finishing order #99", station: "finishing", until: s.time + 4, total: 4 };
    expect(inUse(s, "finishing")).toMatch(/In use: Corinne, about 4 min/);
    expect(canStart(s, { type: "finish", jobId: job.id })).toMatch(/In use: Corinne/);
    expect(s.workflow?.kind).toBe("collect_finish"); // (it's a wait: the job's still yours)
    s.coworker!.task = null;
    expect(canStart(s, { type: "finish", jobId: job.id })).toBeNull();
  });

  it("they never take a station you're in the middle of", () => {
    const sim = quiet();
    const s = sim.state;
    const mine = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec(), timing: "back", needIn: 300 });
    talkTo(sim, mine);
    const theirs = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec(), timing: "back", needIn: 300 });
    theirs.crew = true;
    runUntil(sim, () => s.jobs.length === 2 && s.jobs.every((j) => j.status !== "new"), 100); // (they've sent theirs)
    s.coworker!.at = "break"; // (out of the way while yours prints and you collect it)
    s.coworker!.breakUntil = Infinity;
    runUntil(sim, () => s.jobs.length === 2 && s.jobs.every((j) => j.status === "printed"), 300);
    s.handsOn = true;
    const myJob = s.jobs.find((j) => j.customerId === mine.id)!;
    expect(begin(s, { type: "collect", jobId: myJob.id })).toBeNull();
    startTask(s, { type: "collect", jobId: myJob.id });
    runUntil(sim, () => s.employee.task === null);
    s.coworker!.breakUntil = s.time; // back
    // You're at the finishing table (staple it next); their job's ready for it.
    const theirJob = s.jobs.find((j) => j.customerId === theirs.id)!;
    for (let i = 0; i < 30; i++) {
      tick(sim, 1);
      expect(s.coworker!.task?.station ?? "", `minute ${i}`).not.toBe("finishing");
    }
    expect(["collected", "printed"]).toContain(theirJob.status);
  });

  it("their jobs share the printer queue, but let yours go first when yours is due sooner", () => {
    const sim = quiet();
    const s = sim.state;
    const theirs = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec({ copies: 300 }), timing: "back", needIn: 400 });
    theirs.crew = true;
    const big = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec({ copies: 300 }), timing: "back", needIn: 400 });
    big.crew = true;
    runUntil(sim, () => s.jobs.length === 2 && s.jobs.every((j) => j.status !== "new"), 100);
    const mine = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: spec({ copies: 5, finishing: "none", media: "letter" }), timing: "wait", needIn: 60 });
    talkTo(sim, mine);
    const myJob = s.jobs.find((j) => j.customerId === mine.id)!;
    expect(s.printer.queue[0]).toBe(myJob.id); // ahead of theirs that's waiting
  });
});

describe("the director", () => {
  it("brings in more with a coworker on (by their capacity), and your own load stays in its band", () => {
    for (const c of COWORKERS) {
      const sim = createSim(3, { coworker: c.id });
      const s = sim.state;
      expect(s.director.perDay[1]).toBe(Math.round(DIRECTOR.perDay[1] * (1 + c.capacity)));
      const bot = createBot(1, "smart", s.seed);
      let most = 0;
      while (!isDayOver(s)) {
        botAct(bot, s, 1);
        tick(sim, 1);
        if (s.time < s.closeAt) most = Math.max(most, activeCount(s));
      }
      expect(s.customers.filter((x) => x.crew).length, c.id).toBeGreaterThan(0);
      expect(most, c.id).toBeLessThanOrEqual(DIRECTOR.ceiling + 1); // (someone back for an order can tip it over by one)
    }
  });

  it("over real days, everything of theirs gets done or carried over (nothing left hanging, nothing on you)", () => {
    for (let g = 0; g < 4; g++) {
      const game = newGame(9 + g * 1000);
      for (let d = 0; d < 5; d++) {
        const sim = startDay(game);
        const s = sim.state;
        const bot = createBot(1, "smart", s.seed);
        while (!isDayOver(s)) {
          botAct(bot, s, 1);
          tick(sim, 1);
          runCoworker(s, 0); // (no-op: just making sure it's safe to call)
        }
        for (const c of s.customers.filter((x) => x.crew)) expect(["gone", "away"], `${c.kind} ${c.state}`).toContain(c.state);
        expect(s.failures.filter((f) => s.customers.find((c) => c.id === f.customerId)?.crew)).toEqual([]);
        endDay(game, sim);
      }
    }
  });
});

describe("makeReady still works for your own orders", () => {
  it("(sanity)", () => {
    const sim = quiet();
    const c = spawnCustomer(sim.state, sim.rng.dev, "large_job", { spec: spec(), timing: "back", needIn: 300 });
    talkTo(sim, c);
    makeReady(sim, sim.state.jobs[0]);
  });
});
