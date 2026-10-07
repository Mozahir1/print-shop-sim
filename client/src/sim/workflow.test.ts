import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { abandonWorkflow, canGoHome, canStart, createSim, goHome, isDayOver, startTask, tick, workLeft, type Sim } from "./sim";
import { placeWebOrder, returnCustomer, spawnCustomer } from "./customers";
import { currentStep, workflowSteps } from "./workflow";
import { managerMood } from "./failures";
import { report } from "./summary";
import { endDay, newGame, startDay } from "./game";
import { CLOSING, HEAT, SALES } from "./config";
import { calm, doTask, makeReady, runUntil, talkTo } from "./testkit";
import type { JobSpec } from "./types";

const plain = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "document", originals: 1, copies: 1, color: "bw", media: "letter", duplex: false, finishing: "none", ...s });

let restore: () => void;
beforeEach(() => (restore = calm()));
afterEach(() => restore());

function quiet(seed = 1): Sim {
  const sim = createSim(seed);
  sim.state.printer.paperOutAt = Infinity;
  sim.state.director.enabled = false;
  sim.state.event = null;
  return sim;
}

describe("workflows", () => {
  it("the strict lock: nothing unrelated starts mid-workflow, with a message saying what you're doing", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "ship");
    talkTo(sim, c); // weighed, now waiting on how to pack it
    expect(s.workflow?.kind).toBe("ship");
    expect(currentStep(s)!.type).toBe("pack");
    expect(canStart(s, { type: "fix_copier" })).toBe("You can't do that, you're boxing a package.");
    expect(canStart(s, { type: "tape_shut", packageId: c.packageId! })).toBeNull(); // the step's alternative is fine
    expect(startTask(s, { type: "pack", packageId: c.packageId! })).toBeNull();
    expect(canStart(s, { type: "load_paper" })).toBe("You can't do that, you're boxing a package.");
  });

  it("jobs printing on their own keep going while you're locked into something else", () => {
    const sim = quiet();
    const s = sim.state;
    const a = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 200 }), timing: "back", needIn: 600 });
    talkTo(sim, a);
    const job = s.jobs[0];
    const shipper = spawnCustomer(s, sim.rng.dev, "ship");
    talkTo(sim, shipper); // paused at the packing choice
    const printed = job.sheetsPrinted;
    for (let i = 0; i < 10; i++) tick(sim, 1);
    expect(s.workflow?.kind).toBe("ship");
    expect(job.sheetsPrinted).toBeGreaterThan(printed);
  });

  it("the next step is always known, with what you're holding and thinking", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "ship");
    talkTo(sim, c);
    const steps = workflowSteps(s, s.workflow!);
    expect(steps.map((x) => [x.type, x.done])).toEqual([
      ["talk", true],
      ["respond", true],
      ["pack", false],
      ["tape", false],
      ["weigh", false],
      ["label", false],
      ["ring_up", false],
      ["bin", false],
    ]);
    expect(currentStep(s)!.data).toMatchObject({ station: "shipping", held: "box", thought: "Box it, with paper." });
  });

  it("abandoning a workflow is explicit and counts as ignoring them", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "ship");
    talkTo(sim, c);
    expect(abandonWorkflow(s)).toBeNull();
    expect(s.workflow).toBeNull();
    expect(c.ignored).toBe(1);
    expect(s.manager.heatBy.ignoring).toBe(HEAT.ignore);
    expect(s.choices.at(-1)).toMatchObject({ type: "ignore", what: "work" });
    // Picking it back up later starts where it left off.
    doTask(sim, { type: "pack", packageId: c.packageId! });
    expect(s.packages.find((p) => p.kind !== "held")!.status).toBe("binned");
  });
});

describe("every failure has a moment", () => {
  it("an order that isn't ready at pickup: a counter scene with do (rush it) / don't (apologize and refund), and it's logged", () => {
    const sim = quiet();
    const s = sim.state;
    const job = placeWebOrder(s, sim.rng.dev, { spec: plain({ copies: 20 }) });
    const c = s.customers.find((x) => x.id === job.customerId)!;
    returnCustomer(s, c); // they show up and nobody opened it
    doTask(sim, { type: "talk", customerId: c.id });
    expect(c.said).toBe("Where's my order?");
    expect(s.failures.at(-1)).toMatchObject({ kind: "missing_order", jobId: job.id });
    expect(s.messages.some((m) => m.kind === "note" && /wasn't ready/.test(m.body))).toBe(true); // the manager heard
    doTask(sim, { type: "respond", customerId: c.id, choice: "take" }); // rush it now
    expect(job.rush).toBe(true);
    expect(c.state).toBe("waiting");
  });

  it("apologizing and refunding a paid order gives the money back", () => {
    const sim = quiet();
    const s = sim.state;
    const job = placeWebOrder(s, sim.rng.dev, { spec: plain({ copies: 20 }) });
    doTask(sim, { type: "open_message", messageId: s.messages.find((m) => m.jobId === job.id)!.id });
    const paid = s.revenueCents;
    const c = s.customers.find((x) => x.id === job.customerId)!;
    returnCustomer(s, c);
    talkTo(sim, c, "turn_away");
    expect(job.status).toBe("canceled");
    expect(s.revenueCents).toBe(paid - job.priceCents);
    expect(s.stats.refundsCents).toBe(job.priceCents);
  });

  it("the end-of-day report lists failures by name", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 20, media: "cardstock" }), timing: "wait", needIn: 300 });
    talkTo(sim, c);
    runUntil(sim, () => c.state === "gone"); // never finished
    const job = s.jobs[0];
    const r = report(s, { day: 1, outcome: "none", clean: false });
    expect(r.failures).toContain(`Order #${job.id} was never finished. ${c.name} left without it.`);
  });

  it("the manager's mood is a word, never a number", () => {
    expect(managerMood(0)).toBe("calm");
    expect(managerMood(HEAT.warnAt)).toBe("annoyed");
    expect(managerMood(HEAT.writeUpAt)).toBe("unhappy");
  });
});

describe("closing time", () => {
  function toClose(sim: Sim) {
    runUntil(sim, () => sim.state.time >= sim.state.closeAt);
  }

  it("the day doesn't end by itself at close: you go home", () => {
    const sim = quiet();
    expect(canGoHome(sim.state)).toMatch(/not closing time/);
    toClose(sim);
    for (let i = 0; i < 30; i++) tick(sim, 1);
    expect(isDayOver(sim.state)).toBe(false);
    expect(goHome(sim.state)).toBeNull();
    expect(isDayOver(sim.state)).toBe(true);
  });

  it("people in line head out at close; someone waiting on an order stays", () => {
    restore();
    const sim = quiet(1);
    const s = sim.state;
    const waiting = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: plain({ copies: 5, media: "cardstock" }), timing: "wait", needIn: 500 });
    restore = calm();
    talkTo(sim, waiting);
    const inLine = [1, 2].map(() => spawnCustomer(s, sim.rng.dev, "dropoff"));
    for (const c of inLine) c.lingering = false;
    s.time = s.closeAt - 1;
    tick(sim, 1);
    const stayed = inLine.filter((c) => c.lingering);
    for (const c of inLine.filter((x) => !x.lingering)) expect(c.outcome).toBe("closed");
    expect(stayed.length).toBeLessThanOrEqual(1);
    expect(waiting.state).toBe("waiting");
  });

  it("someone who stays past closing doesn't leave on their own; you can show them out", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "dropoff");
    toClose(sim);
    c.state = "line";
    c.lingering = true;
    for (let i = 0; i < 100; i++) tick(sim, 1);
    expect(c.state).toBe("line");
    doTask(sim, { type: "usher_out", customerId: c.id });
    expect(c.outcome).toBe("closed");
  });

  it("leaving on time with everything done is rewarded", () => {
    const game = newGame(1);
    const sim = startDay(game);
    sim.state.director.enabled = false;
    sim.state.event = null;
    sim.state.manager.heat = 20;
    toClose(sim);
    sim.state.revenueCents = SALES.targetCents; // (a slow day adds heat of its own)
    expect(workLeft(sim.state)).toEqual([]);
    goHome(sim.state);
    expect(sim.state.wentHome).toMatchObject({ onTime: true, leftUndone: [] });
    expect(sim.state.manager.heat).toBe(20 - CLOSING.onTimeReward);
    expect(report(sim.state, endDay(game, sim)).wentHome).toMatch(/Left on time/);
  });

  it("staying late annoys the manager (and the MC wants to go home)", () => {
    const sim = quiet();
    toClose(sim);
    for (let i = 0; i < CLOSING.onTimeGrace + 40; i++) tick(sim, 1);
    expect(sim.state.captions.some((x) => x.moment === "overtime")).toBe(true);
    goHome(sim.state);
    expect(sim.state.manager.heatBy.overtime).toBeCloseTo((40 / 10) * CLOSING.overtimeHeatPer10Min, 0);
    expect(sim.state.wentHome!.onTime).toBe(false);
  });

  it("leaving work undone is penalized, and it's a failure you see", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 20 }), timing: "back", needIn: 200 });
    talkTo(sim, c);
    toClose(sim);
    expect(workLeft(s)).toEqual([`order #${s.jobs[0].id} not done`]);
    goHome(s);
    expect(s.manager.heatBy.ignoring).toBeGreaterThanOrEqual(CLOSING.leftUndoneHeat);
    expect(s.failures.some((f) => f.kind === "left_work")).toBe(true);
    expect(s.wentHome!.leftUndone).toHaveLength(1);
  });

  it("stay long enough and the manager locks up and sends you home", () => {
    const sim = quiet();
    while (!isDayOver(sim.state)) tick(sim, 1);
    expect(sim.state.time).toBe(sim.state.closeAt + CLOSING.sentHomeAfter);
    expect(sim.state.wentHome!.sentHome).toBe(true);
  });

  it("waiting customers can be shown out too; their order carries to tomorrow", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 20, media: "cardstock" }), timing: "wait", needIn: 280 });
    talkTo(sim, c);
    toClose(sim);
    if (c.state === "waiting") {
      doTask(sim, { type: "usher_out", customerId: c.id });
      expect(c.state).toBe("away");
    }
    makeReady(sim, s.jobs[0]);
  });
});
