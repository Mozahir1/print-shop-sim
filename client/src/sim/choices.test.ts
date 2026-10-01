import { describe, expect, it } from "vitest";
import { canStart, createSim, isDayOver, tick, type Sim } from "./sim";
import { botAct, createBot } from "./bot";
import { placeWebOrder, spawnCustomer } from "./customers";
import { moodOf } from "./mood";
import { todoList, activeCount } from "./todo";
import { ANSWER_WITHIN, DURATIONS, LEAVE_AFTER } from "./config";
import { collect, doTask, runUntil, talkTo } from "./testkit";
import type { CounterChoice, JobSpec } from "./types";

const plain = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "document", originals: 1, copies: 1, color: "bw", media: "letter", duplex: false, finishing: "none", ...s });

function quiet(seed = 1): Sim {
  const sim = createSim(seed);
  sim.state.printer.paperOutAt = Infinity;
  sim.state.director.enabled = false;
  return sim;
}

// Serve a quick-copies customer start to finish with one counter choice, and see how they leave.
function visit(seed: number, choice: CounterChoice) {
  const sim = quiet(seed);
  const c = spawnCustomer(sim.state, sim.rng.dev, "quick_copies", { spec: plain({ copies: 5 }) });
  talkTo(sim, c, choice);
  const job = sim.state.jobs.find((j) => j.id === c.jobId)!;
  doTask(sim, { type: "enter_order", jobId: job.id });
  doTask(sim, { type: "send_job", jobId: job.id });
  collect(sim, job);
  doTask(sim, { type: "bag", jobId: job.id });
  doTask(sim, { type: "ring_up", customerId: c.id });
  return { sim, c };
}

function moods(choice: CounterChoice) {
  const tally = { happy: 0, neutral: 0, angry: 0 };
  for (let seed = 1; seed <= 200; seed++) tally[moodOf(visit(seed, choice).c)]++;
  return tally;
}

describe("counter choices and mood", () => {
  it("proper: happy", () => {
    expect(moods("proper")).toEqual({ happy: 200, neutral: 0, angry: 0 });
  });

  it("minimum: usually neutral", () => {
    const m = moods("minimum");
    expect(m.happy).toBe(0);
    expect(m.neutral).toBeGreaterThan(150);
    expect(m.angry).toBeGreaterThan(0);
  });

  it("rude: usually angry, and the job still gets done", () => {
    const m = moods("rude");
    expect(m.happy).toBe(0);
    expect(m.angry).toBeGreaterThan(130);
    expect(m.neutral).toBeGreaterThan(0);
    expect(visit(1, "rude").c.outcome).toBe("served");
  });

  it("the same choices always give the same result", () => {
    for (let seed = 1; seed <= 20; seed++) expect(visit(seed, "minimum").c.mood).toBe(visit(seed, "minimum").c.mood);
  });

  it("ignore: they keep standing there, a bit worse off, and you can still help them", () => {
    const sim = quiet();
    const c = spawnCustomer(sim.state, sim.rng.dev, "dropoff");
    talkTo(sim, c, "ignore");
    expect(c.state).toBe("line");
    expect(c.ignored).toBe(1);
    expect(c.mood).toBe(-1);
    talkTo(sim, c, "proper");
    doTask(sim, { type: "scan_dropoff", customerId: c.id });
    expect(moodOf(c)).toBe("neutral"); // ignored once, then treated right
  });

  it("not answering for long enough counts as ignoring them", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "ship");
    doTask(sim, { type: "talk", customerId: c.id });
    expect(c.state).toBe("talking");
    for (let i = 0; i < ANSWER_WITHIN; i++) tick(sim, 1);
    expect(c.state).toBe("line");
    expect(s.choices).toEqual([{ time: s.time, type: "ignore", what: "counter", customerId: c.id, auto: true }]);
  });

  it("every choice is recorded with its type", () => {
    const sim = quiet();
    const s = sim.state;
    const kinds: CounterChoice[] = ["proper", "minimum", "rude"];
    for (const choice of kinds) talkTo(sim, spawnCustomer(s, sim.rng.dev, "self_serve_help"), choice);
    expect(s.choices.map((c) => c.type)).toEqual(kinds);
  });
});

describe("patience", () => {
  it("waiting too long: fed up first, then they walk out angry", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "package_pickup");
    runUntil(sim, () => c.fedUp);
    expect(c.waited).toBeGreaterThan(c.patience);
    expect(c.state).toBe("line");
    runUntil(sim, () => c.state === "gone");
    expect(c.waited).toBeGreaterThan(c.patience * LEAVE_AFTER);
    expect(c.outcome).toBe("left");
    expect(moodOf(c)).toBe("angry");
  });

  it("waiting for their order uses it too", () => {
    const sim = quiet();
    const c = spawnCustomer(sim.state, sim.rng.dev, "quick_copies", { spec: plain() });
    talkTo(sim, c);
    runUntil(sim, () => c.state === "gone"); // nobody ever makes it
    expect(c.outcome).toBe("left");
  });

  it("is generous: an attentive player never runs out of anyone's patience", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = createSim(seed, { day: 20 });
      const bot = createBot();
      while (!isDayOver(sim.state)) {
        botAct(bot, sim.state, 1);
        tick(sim, 1);
      }
      expect(sim.state.customers.filter((c) => c.fedUp)).toEqual([]);
    }
  });
});

describe("lazy options", () => {
  it("are faster than doing it properly", () => {
    expect(DURATIONS.use_anyway).toBeLessThan(DURATIONS.reprint + DURATIONS.collect);
    expect(DURATIONS.out_of_order_sign).toBeLessThan(DURATIONS.fix_copier);
    expect(DURATIONS.tape_shut).toBeLessThan(DURATIONS.pack);
    expect(DURATIONS.leave_unread).toBeLessThan(DURATIONS.open_message);
    expect(DURATIONS.let_truck_go).toBeLessThan(DURATIONS.hand_off);
  });

  it("smudged copies: reprint them, or hand them over anyway and the customer notices", () => {
    // Find an order that comes out smudged the first time.
    for (let seed = 1; ; seed++) {
      const sim = quiet(seed);
      const s = sim.state;
      const c = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: plain({ copies: 5 }) });
      talkTo(sim, c);
      const job = s.jobs[0];
      doTask(sim, { type: "enter_order", jobId: job.id });
      doTask(sim, { type: "send_job", jobId: job.id });
      runUntil(sim, () => job.status === "printed");
      doTask(sim, { type: "collect", jobId: job.id });
      if (job.smudge !== "found") continue;
      expect(canStart(s, { type: "bag", jobId: job.id })).toMatch(/smudged/);
      expect(todoList(s)[0].req).toEqual({ type: "reprint", jobId: job.id });
      expect(todoList(s)[0].alts).toEqual([{ type: "use_anyway", jobId: job.id }]);
      doTask(sim, { type: "use_anyway", jobId: job.id });
      doTask(sim, { type: "bag", jobId: job.id });
      const before = c.mood;
      doTask(sim, { type: "ring_up", customerId: c.id });
      expect(c.mood).toBe(before - 1);
      expect(s.choices.at(-1)).toMatchObject({ type: "lazy", what: "smudge" });
      return;
    }
  });

  it("broken copier: fix it, or tape a sign on it and point people at it", () => {
    const sim = quiet();
    const s = sim.state;
    s.copier.status = "broken";
    const c = spawnCustomer(s, sim.rng.dev, "self_serve_help");
    talkTo(sim, c);
    doTask(sim, { type: "out_of_order_sign" });
    expect(s.copier.status).toBe("broken");
    doTask(sim, { type: "help_self_serve", customerId: c.id });
    expect(c.outcome).toBe("served");
    expect(moodOf(c)).toBe("neutral"); // happy at the counter, then pointed at a sign
    expect(s.choices.at(-1)).toMatchObject({ type: "lazy", what: "copier" });
    doTask(sim, { type: "fix_copier" });
    expect(s.copier).toEqual({ status: "ok", sign: false });
  });

  it("packing: pack it properly, or just tape it shut (they see you do it)", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "ship");
    talkTo(sim, c);
    doTask(sim, { type: "weigh", packageId: c.packageId! });
    doTask(sim, { type: "tape_shut", packageId: c.packageId! });
    doTask(sim, { type: "label", packageId: c.packageId! });
    expect(s.packages[0].taped).toBe(true);
    expect(moodOf(c)).toBe("neutral");
    expect(s.choices.at(-1)).toMatchObject({ type: "lazy", what: "pack" });
  });

  it("inbox: leave a web order unread, and it's off your list until they come in for it", () => {
    const sim = quiet();
    const s = sim.state;
    const job = placeWebOrder(s, sim.rng.dev, { spec: plain() });
    const msg = s.messages.find((m) => m.jobId === job.id)!;
    expect(activeCount(s)).toBe(1);
    doTask(sim, { type: "leave_unread", messageId: msg.id });
    expect(activeCount(s)).toBe(0);
    expect(todoList(s).some((t) => t.req.type === "open_message")).toBe(false);
    expect(s.choices.at(-1)).toMatchObject({ type: "lazy", what: "inbox" });
    s.director.enabled = true;
    const owner = s.customers.find((c) => c.id === job.customerId)!;
    runUntil(sim, () => owner.state === "line"); // they come anyway, at their pickup time
    expect(s.time).toBeGreaterThanOrEqual(job.pickupAt);
    expect(job.status).toBe("unread");
  });

  it("truck: hand off the packages, or let the driver leave without them", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "dropoff");
    talkTo(sim, c);
    doTask(sim, { type: "scan_dropoff", customerId: c.id });
    doTask(sim, { type: "bin", packageId: s.packages[0].id });
    runUntil(sim, () => s.truck.status === "waiting");
    doTask(sim, { type: "let_truck_go" });
    expect(s.truck.status).toBe("gone");
    expect(s.packages[0].status).toBe("binned");
    expect(s.choices.at(-1)).toMatchObject({ type: "lazy", what: "truck" });
  });

  it("not dealing with the truck at all is ignoring it", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "dropoff");
    talkTo(sim, c);
    doTask(sim, { type: "scan_dropoff", customerId: c.id });
    doTask(sim, { type: "bin", packageId: s.packages[0].id });
    runUntil(sim, () => s.truck.status === "gone");
    expect(s.choices.at(-1)).toMatchObject({ type: "ignore", what: "truck" });
  });
});

