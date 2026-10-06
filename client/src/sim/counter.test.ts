import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canStart, createSim, tick, type Sim } from "./sim";
import { rollSpec, returnCustomer, spawnCustomer, type PrintKind } from "./customers";
import { requestLines } from "./dialogue";
import { notes } from "./notes";
import { currentStep, isChoice } from "./workflow";
import { createRng } from "./rng";
import { formatClock } from "./time";
import { ASK_AGAIN_PATIENCE } from "./config";
import { calm, doTask, makeReady, talkTo } from "./testkit";
import dialogue from "../data/dialogue.json";
import type { JobSpec } from "./types";

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

const plain = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "resume", originals: 2, copies: 25, color: "bw", media: "cardstock", duplex: false, finishing: "staple", ...s });

// The one line said about a field, and which value it gives away. Each value's phrasings are its own, so hearing
// the line is enough to know the value.
function heard(lines: string[], field: keyof typeof dialogue.lines): string[] {
  const variants = dialogue.lines[field] as Record<string, string[]>;
  const match = (line: string, v: string) => new RegExp(`^${v.replace(/[.?*()]/g, "\\$&").replace(/\{\w+\}/g, ".+")}$`).test(line);
  return Object.keys(variants).filter((value) => lines.some((l) => variants[value].some((v) => match(l, v))));
}

describe("the customer says what they want, in words", () => {
  it("every print request states every field, one line each, and each line gives away exactly one value", () => {
    const sim = quiet();
    const rng = createRng(7);
    for (const kind of ["quick_copies", "large_job", "poster", "business"] as PrintKind[]) {
      for (let i = 0; i < 25; i++) {
        const c = spawnCustomer(sim.state, rng, kind, { spec: rollSpec(rng, kind) });
        const s = c.spec!;
        const lines = requestLines(sim.state, c);
        expect(lines.length).toBe(8); // what they came for, then seven details
        const all = lines.join(" ");
        expect(all).toMatch(s.copies === 1 ? /one copy/i : `${s.copies} copies`);
        expect(all).toContain(s.item);
        expect(heard(lines, "pages")).toEqual([s.originals === 1 ? "one" : "many"]);
        if (s.originals > 1) expect(all).toContain(`${s.originals} pages`);
        expect(heard(lines, "color")).toEqual([s.color]);
        expect(heard(lines, "duplex")).toEqual([String(s.duplex)]);
        expect(heard(lines, "media")).toEqual([s.media]);
        expect(heard(lines, "finishing")).toEqual([s.finishing]);
        expect(heard(lines, "timing")).toEqual([c.timing]);
        if (c.needBy !== null) expect(all).toContain(formatClock(c.needBy));
        expect(lines.every((l) => !l.includes("—") && !/\{\w+\}/.test(l))).toBe(true); // no em dashes, nothing unfilled
      }
    }
  });

  it("shipping says the service; pickups give their name", () => {
    const sim = quiet();
    for (const service of ["ground", "two_day", "overnight"] as const) {
      const c = spawnCustomer(sim.state, sim.rng.dev, "ship", { service });
      expect(heard(requestLines(sim.state, c), "service")).toEqual([service]);
    }
    const p = spawnCustomer(sim.state, sim.rng.dev, "package_pickup", { name: "Dana Reyes" });
    expect(requestLines(sim.state, p).join(" ")).toContain("Dana Reyes");
  });

  it("'What was that?' says it all again: it takes a moment and a bit of their patience", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain(), timing: "back", needIn: 300 });
    doTask(sim, { type: "talk", customerId: c.id });
    const before = requestLines(s, c);
    const t = s.time;
    const waited = c.waited;
    doTask(sim, { type: "ask_again", customerId: c.id });
    expect(s.time).toBeGreaterThan(t);
    expect(c.waited).toBe(waited + ASK_AGAIN_PATIENCE);
    expect(c.state).toBe("talking"); // still waiting for your answer
    expect(requestLines(s, c)).toEqual(before);
    expect(currentStep(s)?.type).toBe("respond");
  });
});

describe("the order form and the notes", () => {
  it("taking a print order stops at the order form; nothing's entered until you fill it in", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain(), timing: "back", needIn: 300 });
    doTask(sim, { type: "talk", customerId: c.id });
    doTask(sim, { type: "respond", customerId: c.id, choice: "take" });
    const step = currentStep(s)!;
    expect(step.type).toBe("enter_order");
    expect(isChoice(step)).toBe(true);
    for (let i = 0; i < 5; i++) tick(sim, 1);
    expect(s.jobs[0].status).toBe("new");
    expect(notes(s)[0]).toMatchObject({ text: `Resume for ${c.name.split(" ")[0]}, due ${formatClock(s.jobs[0].dueAt)}. Not in the computer yet.`, hint: "Enter it on the computer" });
  });

  it("the note is what you entered, not what they asked for, and its hint follows the work", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain(), timing: "back", needIn: 300, name: "Dana Reyes" });
    talkTo(sim, c, "take", { copies: 52, media: "letter" }); // misheard
    const job = s.jobs[0];
    const due = formatClock(job.dueAt);
    expect(notes(s)[0].text).toBe(`Resume x52, B&W, letter, staple, due ${due}. Dana.`);
    expect(job.asked.copies).toBe(25); // what they actually said
    expect(notes(s)[0].hint).toBe("Printing. You can leave it."); // sent on by itself
    while (job.status !== "printed") tick(sim, 1);
    expect(notes(s)[0].hint).toBe("Collect");
    job.status = "collected";
    expect(notes(s)[0].hint).toBe(job.smudge === "found" ? "Reprint or use anyway" : "Staple");
    makeReady(sim, job);
    expect(notes(s)[0].hint).toBe("Ring up");
  });

  it("a mistake on the form comes back at pickup: 'This isn't what I asked for', and they don't pay", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ finishing: "none" }), timing: "back", needIn: 300 });
    talkTo(sim, c, "take", { color: "color" });
    const job = s.jobs[0];
    makeReady(sim, job);
    returnCustomer(s, c);
    const paid = s.revenueCents;
    talkTo(sim, c); // and on to ringing them up
    expect(c.said).toBe("This isn't what I asked for.");
    expect(s.revenueCents).toBe(paid);
    expect(s.failures.at(-1)).toMatchObject({ kind: "wrong_order", jobId: job.id });
    expect(s.failures.at(-1)!.text).toContain("color");
    expect(c.mood).toBeLessThan(0);
    // The note is crossed off, then fades.
    expect(notes(s)[0]).toMatchObject({ done: true, hint: "Done" });
    for (let i = 0; i < 60; i++) tick(sim, 1);
    expect(notes(s)).toEqual([]);
  });

  it("entered right, it goes out without a word", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ finishing: "none" }), timing: "back", needIn: 300 });
    talkTo(sim, c);
    makeReady(sim, s.jobs[0]);
    returnCustomer(s, c);
    talkTo(sim, c);
    expect(c.outcome).toBe("served");
    expect(s.failures).toEqual([]);
  });

  it("you can't answer from the computer: 'What was that?' only works while they're talking", () => {
    const sim = quiet();
    const c = spawnCustomer(sim.state, sim.rng.dev, "dropoff");
    expect(canStart(sim.state, { type: "ask_again", customerId: c.id })).toMatch(/not talking/);
  });
});
