import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { begin, canStart, createSim, goHome, startTask, tick, type Sim } from "./sim";
import { returnCustomer, spawnCustomer } from "./customers";
import { currentStep } from "./workflow";
import { calm, runUntil } from "./testkit";
import type { JobSpec, TaskRequest, TaskType } from "./types";

// Doing it by hand: every step waits for you (the UI does the tapping and dragging, then starts the step with what
// you did). These walk each workflow one step at a time, the way the player does.
let restore: () => void;
beforeEach(() => (restore = calm()));
afterEach(() => restore());

function handsOn(seed = 1): Sim {
  const sim = createSim(seed);
  sim.state.printer.paperOutAt = Infinity;
  sim.state.director.enabled = false;
  sim.state.event = null;
  sim.state.handsOn = true;
  return sim;
}

const spec = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "flyer", originals: 1, copies: 8, color: "color", media: "cardstock", duplex: false, finishing: "staple", ...s });

// Does the step you're on (with whatever you did by hand) and waits until it's done. Returns its type.
function step(sim: Sim, extra: Partial<TaskRequest> = {}): TaskType {
  if (!currentStep(sim.state) && extra.type) expect(begin(sim.state, extra as TaskRequest)).toBeNull();
  const st = currentStep(sim.state);
  if (!st) throw new Error("no step");
  const req = { ...st.req, ...extra };
  expect(startTask(sim.state, req)).toBeNull();
  runUntil(sim, () => sim.state.employee.task === null);
  return st.type;
}

// Starts a workflow the way a station's button does (begin), then does its steps until it ends or stops.
function from(sim: Sim, req: TaskRequest, extras: Partial<Record<TaskType, Partial<TaskRequest>>> = {}): TaskType[] {
  expect(begin(sim.state, req)).toBeNull();
  const done: TaskType[] = [];
  while (currentStep(sim.state)) {
    const t = currentStep(sim.state)!.type;
    done.push(step(sim, extras[t] ?? {}));
  }
  return done;
}

describe("each workflow, step by step, by hand", () => {
  it("steps wait for you: nothing runs on by itself", () => {
    const sim = handsOn();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "dropoff");
    step(sim, { type: "talk", customerId: c.id } as TaskRequest);
    expect(currentStep(s)?.type).toBe("respond");
    step(sim, { choice: "take" });
    for (let i = 0; i < 20; i++) tick(sim, 1);
    expect(currentStep(s)?.type).toBe("scan_dropoff"); // still waiting for you
    expect(s.packages).toEqual([]);
  });

  it("a print job: talk, answer, the form, send (then it prints on its own), collect, staple, bag; then pickup: the shelf, ring up", () => {
    const sim = handsOn();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec(), timing: "back", needIn: 300 });
    expect(from(sim, { type: "talk", customerId: c.id }, { respond: { choice: "take" }, enter_order: { entry: { copies: 8, color: "color", media: "cardstock", duplex: false, finishing: "staple" } } })).toEqual(["talk", "respond", "enter_order", "send_job"]);
    const job = s.jobs[0];
    expect(s.workflow).toBeNull(); // printing is a wait: you're free
    runUntil(sim, () => job.status === "printed");
    const work = from(sim, { type: "collect", jobId: job.id });
    expect(work.filter((t) => t !== "reprint")).toEqual(["collect", "finish", "bag"]);
    returnCustomer(s, c);
    expect(from(sim, { type: "talk", customerId: c.id }, { respond: { choice: "take" } })).toEqual(["talk", "respond", "fetch_bag", "ring_up"]);
    expect(c.outcome).toBe("served");
    expect(s.drawerOffCents).toBe(0);
    expect(s.failures).toEqual([]);
  });

  it("shipping: box (with paper), tape, weigh, label, ring up, bin", () => {
    const sim = handsOn();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "ship", { weightLb: 3, service: "overnight" });
    const steps = from(sim, { type: "talk", customerId: c.id }, { respond: { choice: "take" }, pack: { box: "small" }, label: { shipLabel: { weightLb: 3, service: "overnight" } } });
    expect(steps).toEqual(["talk", "respond", "pack", "tape", "weigh", "label", "ring_up", "bin"]);
    expect(s.packages[0]).toMatchObject({ status: "binned", paid: true, taped: false });
    expect(c.outcome).toBe("served");
    expect(s.manager.flags).toEqual([]);
  });

  it("shipping, lazy: tape it shut (no paper, no separate taping)", () => {
    const s2 = handsOn();
    const d = spawnCustomer(s2.state, s2.rng.dev, "ship", { weightLb: 3 });
    step(s2, { type: "talk", customerId: d.id } as TaskRequest);
    step(s2, { choice: "take" });
    expect(currentStep(s2.state)!.alts.map((a) => a.type)).toEqual(["tape_shut"]);
    step(s2, { type: "tape_shut" } as TaskRequest);
    expect(currentStep(s2.state)!.type).toBe("weigh"); // straight to the scale
    expect(s2.state.packages[0].taped).toBe(true);
  });

  it("drop-off: scan, bin. Held package: find it on the shelf, hand it over", () => {
    const sim = handsOn();
    const d = spawnCustomer(sim.state, sim.rng.dev, "dropoff");
    expect(from(sim, { type: "talk", customerId: d.id }, { respond: { choice: "take" } })).toEqual(["talk", "respond", "scan_dropoff", "bin"]);
    const p = spawnCustomer(sim.state, sim.rng.dev, "package_pickup");
    expect(from(sim, { type: "talk", customerId: p.id }, { respond: { choice: "take" } })).toEqual(["talk", "respond", "find_package", "hand_over"]);
    expect(p.outcome).toBe("served");
  });

  it("self-serve: send them over and show them the copier; now and then they come back for help (one tap)", () => {
    const sim = handsOn();
    const s = sim.state;
    let back = null;
    for (let i = 0; i < 30 && !back; i++) {
      const c = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: spec({ media: "letter", finishing: "none", copies: 40 }), timing: "wait", needIn: 200 });
      expect(from(sim, { type: "talk", customerId: c.id }, { respond: { choice: "self_serve" } })).toEqual(["talk", "respond", "escort"]);
      if (c.helpAt !== null) back = c;
      else runUntil(sim, () => c.state === "gone");
    }
    expect(back).not.toBeNull();
    runUntil(sim, () => back!.state === "line");
    const cents = s.revenueCents;
    expect(from(sim, { type: "talk", customerId: back!.id }, { respond: { choice: "take" } })).toEqual(["talk", "respond", "help_self_serve"]);
    expect(back!.outcome).toBe("served");
    expect(s.revenueCents).toBeGreaterThan(cents); // they finished their copies and paid
  });
});

describe("the lock", () => {
  it("wait steps release it (printing); every other step keeps it", () => {
    const sim = handsOn();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec({ copies: 200 }), timing: "back", needIn: 400 });
    step(sim, { type: "talk", customerId: c.id } as TaskRequest);
    step(sim, { choice: "take" });
    expect(canStart(s, { type: "load_paper" })).toMatch(/^You can't do that/); // at the form
    step(sim);
    expect(canStart(s, { type: "load_paper" })).toMatch(/^You can't do that/); // about to send it
    step(sim);
    expect(s.jobs[0].status).toMatch(/queued|printing/);
    const d = spawnCustomer(s, sim.rng.dev, "dropoff");
    expect(canStart(s, { type: "talk", customerId: d.id })).toBeNull(); // free while it prints
  });
});

describe("mistakes by hand come back", () => {
  function pickedUp(sim: Sim, extras: Partial<Record<TaskType, Partial<TaskRequest>>>, finishing: JobSpec["finishing"] = "staple") {
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec({ finishing }), timing: "back", needIn: 300 });
    from(sim, { type: "talk", customerId: c.id }, { respond: { choice: "take" } });
    const job = s.jobs.find((j) => j.customerId === c.id)!;
    runUntil(sim, () => job.status === "printed");
    from(sim, { type: "collect", jobId: job.id }, extras);
    returnCustomer(s, c);
    return { c, job };
  }

  it("the wrong bag off the shelf: 'This isn't mine', and you go get the right one", () => {
    const sim = handsOn();
    const s = sim.state;
    const other = pickedUp(sim, {}).c;
    other.state = "away"; // they'll come later
    const { c, job } = pickedUp(sim, {});
    const wrong = s.jobs.find((j) => j.id !== job.id)!;
    step(sim, { type: "talk", customerId: c.id } as TaskRequest);
    step(sim, { choice: "take" });
    expect(step(sim, { jobId: wrong.id })).toBe("fetch_bag");
    step(sim); // hand it over
    expect(c.said).toBe("This isn't mine.");
    expect(s.failures.at(-1)).toMatchObject({ kind: "wrong_bag", jobId: job.id });
    expect(currentStep(s)?.type).toBe("fetch_bag"); // back to the shelf
    step(sim);
    step(sim);
    expect(c.outcome).toBe("served");
  });

  it("the wrong total or the wrong change: the register's off at close", () => {
    const sim = handsOn();
    const s = sim.state;
    const { c, job } = pickedUp(sim, {});
    from(sim, { type: "talk", customerId: c.id }, { respond: { choice: "take" }, ring_up: c.pays === "cash" ? { change: 0 } : { amount: job.priceCents - 300 } });
    expect(c.outcome).toBe("served");
    expect(s.drawerOffCents).toBeGreaterThan(0);
    runUntil(sim, () => s.time >= s.closeAt);
    goHome(s);
    expect(s.failures.some((f) => f.kind === "drawer_off")).toBe(true);
  });

  it("skipping the finishing (Don't) is faster, and they notice when they pick it up", () => {
    const sim = handsOn();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec(), timing: "back", needIn: 300 });
    from(sim, { type: "talk", customerId: c.id }, { respond: { choice: "take" } });
    const job = s.jobs[0];
    runUntil(sim, () => job.status === "printed");
    begin(s, { type: "collect", jobId: job.id });
    step(sim);
    if (currentStep(s)?.type === "reprint") step(sim);
    expect(currentStep(s)!.alts.map((a) => a.type)).toEqual(["skip_finish"]);
    step(sim, { type: "skip_finish" } as TaskRequest);
    step(sim); // bag it
    returnCustomer(s, c);
    from(sim, { type: "talk", customerId: c.id }, { respond: { choice: "take" } });
    expect(c.said).toBe("These were supposed to be stapled.");
    expect(c.mood).toBeLessThan(1);
    expect(s.choices.find((x) => x.what === "finish")).toMatchObject({ type: "dont" });
  });

  it("a wrong shipping label: the package comes back, and so do they, a day or two later", () => {
    const sim = handsOn();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "ship", { weightLb: 8, service: "ground" });
    from(sim, { type: "talk", customerId: c.id }, { respond: { choice: "take" }, label: { shipLabel: { weightLb: 3, service: "ground" } } });
    expect(c.outcome).toBe("served"); // nothing shows yet
    expect(s.manager.flags).toMatchObject([{ kind: "wrong_label", name: c.name }]);
    expect(s.manager.flags[0].dueDay).toBeGreaterThan(s.day);
  });
});
