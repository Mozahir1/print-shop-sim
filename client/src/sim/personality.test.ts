import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canStart, createSim, isDayOver, startTask, tick, workLeft, goHome, type Sim } from "./sim";
import { endDay, newGame, startDay } from "./game";
import { spawnCustomer } from "./customers";
import { answerRequest, runCoworker } from "./coworker";
import { coworkerDef } from "./schedule";
import { think, currentThought } from "./thoughts";
import { todoList } from "./todo";
import { requestLines } from "./dialogue";
import { CREW, THOUGHTS, TRAITS } from "./config";
import { calm, doTask, runUntil, talkTo } from "./testkit";
import type { JobSpec } from "./types";

let restore: () => void;
beforeEach(() => (restore = calm()));
afterEach(() => restore());

function day(coworker: string, seed = 1, n = 3): Sim {
  const sim = createSim(seed, { coworker, day: n });
  sim.state.director.enabled = false;
  sim.state.event = null;
  sim.state.printer.paperOutAt = Infinity;
  const cw = sim.state.coworker!;
  cw.breaks = [];
  cw.missingAt = null;
  cw.reorganizeAt = null;
  cw.nextChatAt = cw.nextRequestAt = cw.nextChatUpAt = Infinity; // (quiet unless a test wants them)
  return sim;
}

const spec = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "flyer", originals: 1, copies: 8, color: "color", media: "letter", duplex: false, finishing: "staple", ...s });

// Asks the way their schedule would, now.
function askNow(sim: Sim): void {
  sim.state.coworker!.nextRequestAt = sim.state.time;
  runCoworker(sim.state, 0);
  expect(sim.state.request).not.toBeNull();
}

describe("A: the corporate believer", () => {
  function upsell(choice: "do" | "dont" | "ignore") {
    const sim = day("A");
    const s = sim.state;
    coworkerDef("A").rates.upsell = 1; // (always, for the test)
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec(), timing: "back", needIn: 300 });
    talkTo(sim, c);
    expect(s.request?.kind).toBe("upsell");
    expect(s.request!.text).toContain(c.name);
    const revenue = s.revenueCents;
    const mood = c.mood;
    const rel = s.coworker!.relationship;
    if (choice === "ignore") runUntil(sim, () => s.request === null, CREW.requestWait + 2);
    else {
      expect(answerRequest(s, choice)).toBeNull();
      runUntil(sim, () => s.request === null && s.employee.task === null);
    }
    coworkerDef("A").rates.upsell = 0.5;
    return { s, c, revenue, mood, rel };
  }

  it("the upsell nag. Do: a little extra revenue, a little annoyed customer, A delighted", () => {
    const { s, c, revenue, mood, rel } = upsell("do");
    expect(s.revenueCents).toBeGreaterThan(revenue);
    expect(c.mood).toBeLessThan(mood);
    expect(s.coworker!.relationship).toBe(rel + 1);
    expect(s.coworker!.said?.text).toMatch(/attach|shareholder/i);
    expect(s.choices.at(-1)).toMatchObject({ type: "do", what: "coworker" });
  });

  it("Don't, or Ignore: A frets (the MC doesn't care either way)", () => {
    for (const how of ["dont", "ignore"] as const) {
      const { s, revenue, rel } = upsell(how);
      expect(s.revenueCents).toBe(revenue);
      expect(s.coworker!.relationship).toBe(rel - 1);
      expect(s.coworker!.said?.text).toMatch(/fine|opportunity/i);
      expect(s.choices.at(-1)).toMatchObject({ type: how, what: "coworker" });
    }
  });

  it("double-checks your order and catches a wrong entry before it prints", () => {
    const sim = day("A");
    const s = sim.state;
    coworkerDef("A").rates.doubleCheck = 1;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec({ copies: 30 }), timing: "back", needIn: 300 });
    talkTo(sim, c, "take", { color: "bw" }); // (you got the color wrong; A catches it while it's sent)
    const job = s.jobs[0];
    runUntil(sim, () => s.coworker!.checked.includes(job.id), 10);
    expect(job.spec.color).toBe("color");
    expect(job.status).not.toBe("printed");
    expect(s.coworker!.said?.text).toMatch(new RegExp(`#${job.id}.*color`));
    coworkerDef("A").rates.doubleCheck = 0.6;
  });

  it("clears a jam before you get to it", () => {
    const sim = day("A");
    const s = sim.state;
    s.printer.status = "jammed";
    s.event = { kind: "printer_jam", at: 0, status: "active", firedAt: 7 };
    coworkerDef("A").rates.fixJam = 1;
    runUntil(sim, () => s.printer.status !== "jammed", 30);
    expect(s.event.status).toBe("fixed");
    expect(s.coworker!.said?.text).toMatch(/jam/i);
    coworkerDef("A").rates.fixJam = 0.8;
  });

  it("re-sorts the pickup shelf (the bags move)", () => {
    const sim = day("A");
    const s = sim.state;
    s.coworker!.reorganizeAt = s.time + 1;
    runUntil(sim, () => s.shelfOrder !== 0, 5);
    expect(s.coworker!.said?.text).toMatch(/shelf/i);
  });
});

describe("Brody: the owner's son", () => {
  it("needs help. Do: a couple of minutes of yours, and he asks more after", () => {
    const sim = day("B");
    const s = sim.state;
    askNow(sim);
    expect(s.request!.text.length).toBeGreaterThan(5);
    expect(answerRequest(s, "do")).toBeNull();
    expect(s.employee.task?.type).toBe("help_coworker");
    runUntil(sim, () => s.request === null);
    expect(s.coworker!.relationship).toBe(1);
    expect(s.mistakes).toEqual([]);
  });

  it("Don't or Ignore: he does it wrong, and a fix turns up on your list later; left unfixed, the manager may blame you", () => {
    for (const how of ["dont", "ignore"] as const) {
      const sim = day("B");
      const s = sim.state;
      const theirs = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec(), timing: "back", needIn: 300 });
      theirs.crew = true;
      askNow(sim);
      if (how === "dont") answerRequest(s, "dont");
      else runUntil(sim, () => s.request === null, CREW.requestWait + 2);
      expect(s.mistakes).toHaveLength(1);
      const m = s.mistakes[0];
      const item = todoList(s).find((i) => i.req.type === "fix_mistake")!;
      expect(item.text).toMatch(/Brody's mistake/);
      if (how === "dont") {
        doTask(sim, item.req);
        expect(m.fixed).toBe(true);
      } else {
        runUntil(sim, () => s.time >= s.closeAt, 600);
        s.customers.forEach((c) => (c.state = "gone"));
        goHome(s, true);
        expect(s.failures.some((f) => f.kind === "crew_mistake")).toBe(true);
      }
    }
  });

  it("his mishap is the day's bad luck (instead of the usual, never as well as)", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = createSim(seed, { coworker: "B", day: 4 }).state;
      expect(s.event, `seed ${seed}`).not.toBeNull(); // (there's always one on his days)
      expect(s.event!.by).toBe("B");
    }
    const sim = createSim(5, { coworker: "B", day: 4 });
    sim.state.director.enabled = false;
    runUntil(sim, () => sim.state.event!.status === "active" || sim.state.event!.kind === "box_rips", 500);
    if (sim.state.event!.kind !== "box_rips") expect(sim.state.log.some((l) => l.text.startsWith('Brody: "'))).toBe(true);
    expect(createSim(5, { coworker: "A", day: 4 }).state.event?.by).toBeUndefined();
  });

  it("goes missing for a bit: his customers wait at his register, get angry, and come over to your line", () => {
    const sim = day("B");
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: spec(), timing: "back", needIn: 300 });
    c.crew = true;
    s.coworker!.idleUntil = Infinity; // (before he gets to them)
    s.coworker!.missingAt = s.time;
    s.coworker!.missingUntil = 60;
    tick(sim, 1);
    expect(s.coworker!.at).toBe("missing");
    expect(c.crew).toBe(true); // still waiting for him
    expect(todoList(s).some((i) => i.customerId === c.id)).toBe(false);
    runUntil(sim, () => c.stage === "annoyed", 60);
    expect(c.crew).toBe(true);
    runUntil(sim, () => !c.crew, 60);
    expect(c.state).toBe("line"); // fed up: over to yours, still annoyed
    expect(c.stage).toBe("annoyed");
    expect(c.mood).toBeLessThan(1);
    expect(todoList(s).some((i) => i.customerId === c.id)).toBe(true);
    expect(s.log.some((l) => l.text.startsWith("Done waiting for Brody"))).toBe(true);
  });

  it("never gets in trouble: the manager's memo praises him", () => {
    const game = newGame(3);
    let sim = startDay(game);
    while (sim.state.coworker?.id !== "B") {
      endDay(game, sim);
      sim = startDay(game);
    }
    sim.state.director.enabled = false;
    while (!isDayOver(sim.state)) tick(sim, 1);
    endDay(game, sim);
    const next = startDay(game).state;
    expect(next.messages.some((m) => m.from === "Manager" && m.body.includes("Brody"))).toBe(true);
  });
});

describe("C: the talker", () => {
  it("wants a response. Do: a minute; Don't: shrug; Ignore: they keep going, louder", () => {
    for (const how of ["do", "dont", "ignore"] as const) {
      const sim = day("C");
      const s = sim.state;
      askNow(sim);
      if (how === "ignore") runUntil(sim, () => s.request === null, CREW.requestWait + 2);
      else {
        answerRequest(s, how);
        runUntil(sim, () => s.request === null && s.employee.task === null);
      }
      if (how === "ignore") expect(s.coworker!.louderUntil).toBeGreaterThan(s.time);
      else expect(s.coworker!.louderUntil).toBe(0);
      expect(s.coworker!.relationship).toBe(how === "do" ? 1 : how === "ignore" ? -1 : 0);
    }
  });

  it("tells a story a part at a time, and it carries on tomorrow where it left off", () => {
    const game = newGame(1);
    const told: string[] = [];
    for (let d = 0; d < 12 && told.length < 5; d++) {
      const sim = startDay(game);
      const s = sim.state;
      if (s.coworker?.id === "C") {
        s.director.enabled = false;
        const before = s.coworker.story;
        while (!isDayOver(s)) tick(sim, 1);
        for (let i = before; i < s.coworker.story; i++) told.push(coworkerDef("C").story![i]);
        expect(s.coworker.story).toBeLessThanOrEqual(before + CREW.storyPerDay);
      } else while (!isDayOver(s)) tick(sim, 1);
      endDay(game, sim);
    }
    expect(told.length).toBeGreaterThan(1);
    expect(told).toEqual(coworkerDef("C").story!.slice(0, told.length)); // in order, across days
    expect(game.crew.story.C).toBe(told.length);
  });

  it("chats up the customers in your line (a little of their patience)", () => {
    const sim = day("C");
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: spec(), timing: "back", needIn: 300 });
    s.coworker!.nextChatUpAt = s.time;
    runCoworker(s, 0);
    expect(c.waited).toBe(CREW.chatUpMinutes);
    expect(s.log.some((l) => l.text.includes(`chatting up ${c.name}`))).toBe(true);
  });
});

describe("everyone", () => {
  it("talks, at their own rate (C the most), and their requests lapse into an Ignore on their own", () => {
    const said: Record<string, number> = {};
    for (const id of ["A", "B", "C"]) {
      const sim = createSim(2, { coworker: id, day: 3 });
      sim.state.director.enabled = false;
      runUntil(sim, () => sim.state.time >= 300, 400);
      said[id] = sim.state.log.filter((l) => l.text.startsWith(`${sim.state.coworker!.name}: "`)).length;
      expect(sim.state.log.filter((l) => /—/.test(l.text))).toEqual([]); // (no em dashes)
    }
    expect(said.C).toBeGreaterThan(said.A);
    expect(said.A).toBeGreaterThan(0);
    expect(said.B).toBeGreaterThan(0);
  });

  it("helping is a quick chore: it can interrupt a job, not a customer", () => {
    const sim = day("B");
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: spec(), timing: "back", needIn: 300 });
    doTask(sim, { type: "talk", customerId: c.id });
    askNow(sim);
    expect(answerRequest(s, "do")).toMatch(/You can't do that/);
  });

  it("their unfixed mistakes are on what you'd leave undone? No: they're theirs, but they show at close", () => {
    const sim = day("B");
    const s = sim.state;
    askNow(sim);
    answerRequest(s, "dont");
    expect(workLeft(s)).toEqual([]);
  });
});

describe("the MC's thoughts", () => {
  it("one at the start of the day, by who's on", () => {
    expect(createSim(1, { coworker: "C" }).state.thoughts[0]).toMatchObject({ trigger: "day_start" });
    expect(createSim(1, { coworker: "B" }).state.thoughts[0].text).toMatch(/Brody|owner/);
  });

  it("they cool down: never two within the cooldown", () => {
    const s = createSim(1, { coworker: "B" }).state;
    s.time = 100;
    think(s, "failure");
    think(s, "coworker_request", { coworker: "B" });
    expect(s.thoughts.filter((t) => t.time === 100)).toHaveLength(1);
    s.time = 100 + THOUGHTS.cooldown;
    think(s, "coworker_request", { coworker: "B" });
    expect(s.thoughts.at(-1)).toMatchObject({ trigger: "coworker_request" });
    expect(currentThought(s)).toBe(s.thoughts.at(-1)!.text);
    s.time += THOUGHTS.shownFor + 1;
    expect(currentThought(s)).toBeNull();
  });

  it("over real days, every thought is short, dry, and has no em dash", () => {
    const game = newGame(4);
    for (let d = 0; d < 4; d++) {
      const sim = startDay(game);
      while (!isDayOver(sim.state)) tick(sim, 1);
      for (const t of sim.state.thoughts) {
        expect(t.text.length).toBeLessThan(80);
        expect(t.text).not.toMatch(/—/);
      }
      endDay(game, sim);
    }
  });
});

describe("customer traits", () => {
  it("a few customers have one; it's in what they say, and in their patience", () => {
    const sim = createSim(1);
    sim.state.director.enabled = false;
    const cs = Array.from({ length: 200 }, () => spawnCustomer(sim.state, sim.rng.dev, "quick_copies"));
    const share = cs.filter((c) => c.trait).length / cs.length;
    expect(share).toBeGreaterThan(TRAITS.chance - 0.12);
    expect(share).toBeLessThan(TRAITS.chance + 0.12);
    const frantic = cs.find((c) => c.trait === "frantic")!;
    const plain = cs.find((c) => !c.trait)!;
    expect(frantic.giveUp).toBeCloseTo(plain.giveUp * TRAITS.patience.frantic);
    expect(requestLines(sim.state, frantic)[0]).toMatch(/rush|no time/i);
  });

  it("a confused or chatty one takes longer to answer", () => {
    const sim = createSim(1);
    sim.state.director.enabled = false;
    const cs = Array.from({ length: 100 }, () => spawnCustomer(sim.state, sim.rng.dev, "quick_copies"));
    const chatty = cs.find((c) => c.trait === "chatty")!;
    const plain = cs.find((c) => !c.trait)!;
    for (const c of [chatty, plain]) c.state = "talking";
    expect(canStart(sim.state, { type: "respond", customerId: chatty.id, choice: "take" })).toBeNull();
    startTask(sim.state, { type: "respond", customerId: plain.id, choice: "take" });
    const a = sim.state.employee.task!.duration;
    sim.state.employee.task = null;
    sim.state.workflow = null;
    startTask(sim.state, { type: "respond", customerId: chatty.id, choice: "take" });
    expect(sim.state.employee.task!.duration).toBe(a + TRAITS.extraTalk.chatty);
  });
});
