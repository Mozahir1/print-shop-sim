import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSim, tick, type Sim } from "./sim";
import { returnCustomer, spawnCustomer, uniqueName } from "./customers";
import { requestLines } from "./dialogue";
import { calm, makeReady, runUntil, talkTo } from "./testkit";
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
  cw.nextChatAt = cw.nextRequestAt = cw.nextChatUpAt = Infinity;
  return sim;
}

const spec = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "flyer", originals: 1, copies: 8, color: "color", media: "letter", duplex: false, finishing: "staple", ...s });

describe("breaks and the coworker's line", () => {
  it("no customers wait at their register while they're on break; they finish with their line first", () => {
    const sim = day("A");
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: spec(), timing: "back", needIn: 300 });
    c.crew = true;
    s.coworker!.breaks = [s.time];
    tick(sim, 1);
    expect(s.coworker!.at).not.toBe("break"); // not with someone in line
    runUntil(sim, () => s.coworker!.at === "break", 30);
    expect(s.customers.some((x) => x.crew && x.state === "line")).toBe(false);
    s.director.enabled = true;
    s.director.crewShare = 1; // (anyone new would be theirs)
    for (let i = 0; i < 10; i++) tick(sim, 1);
    expect(s.customers.some((x) => x.crew && x.state === "line")).toBe(false);
  });

  it("a long line at a busy coworker's register: people get fed up and come over to yours", () => {
    const sim = day("B");
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: spec(), timing: "back", needIn: 300 });
    c.crew = true;
    s.coworker!.idleUntil = Infinity; // (he's standing around)
    runUntil(sim, () => !c.crew, 200);
    expect(c.state).toBe("line");
    expect(c.stage).toBe("annoyed");
  });

  it("pickups say their order number (it's on their bag too)", () => {
    const sim = day("A");
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: spec(), timing: "back", needIn: 300 });
    talkTo(sim, c);
    const job = s.jobs.find((j) => j.customerId === c.id)!;
    makeReady(sim, job);
    returnCustomer(s, c);
    expect(requestLines(s, c).join(" ")).toContain(`order #${job.id}`);
  });
});

describe("names", () => {
  it("nobody around today shares a name and initial: the next initial along instead", () => {
    const sim = day("A");
    const s = sim.state;
    const a = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: spec(), name: "Dana R." });
    expect(uniqueName(s, "Dana R.")).toBe("Dana T.");
    expect(uniqueName(s, "Tom K.")).toBe("Tom K.");
    a.state = "gone";
    expect(uniqueName(s, "Dana R.")).toBe("Dana R.");
  });
});
