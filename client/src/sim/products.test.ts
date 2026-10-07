import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canStart, createSim, isDayOver, tick, type Sim } from "./sim";
import { endDay, newGame, startDay } from "./game";
import { botAct, createBot } from "./bot";
import { spawnCustomer } from "./customers";
import { quoteFor, printMinutes } from "./quote";
import { machineFor, priceCents, selfServeBlocker } from "./orders";
import { currentStep } from "./workflow";
import { noteDetail } from "./notes";
import { calm, doTask, makeReady, runUntil, talkTo } from "./testkit";
import { PRINT_REQUESTS } from "./config";
import type { JobSpec } from "./types";

// Business cards (the card machine makes them: send, collect, bag) and large format (the wide-format printer, then
// cut it off the roll and trim it, roll it into a tube, bag it).
let restore: () => void;
beforeEach(() => (restore = calm()));
afterEach(() => restore());

function quiet(seed = 1): Sim {
  const sim = createSim(seed);
  sim.state.director.enabled = false;
  sim.state.event = null;
  sim.state.printer.paperOutAt = Infinity;
  return sim;
}

const cards = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "business cards", originals: 1, copies: 500, color: "color", media: "business_card", duplex: true, finishing: "none", ...s });
const big = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "large print", originals: 1, copies: 2, color: "color", media: "large_format", duplex: false, finishing: "none", ...s });

describe("business cards", () => {
  it("go to the card machine, which makes them by itself; then collect and bag", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "business_cards", { spec: cards(), timing: "back", needIn: 200 });
    expect(quoteFor(s, c).selfServeBlocker).toMatch(/card machine/);
    talkTo(sim, c);
    const job = s.jobs[0];
    expect(machineFor(job.spec)).toBe("cards");
    expect([...s.machines.cards.queue, s.machines.cards.currentJobId]).toContain(job.id);
    expect(s.printer.queue).not.toContain(job.id);
    expect(s.printer.currentJobId).not.toBe(job.id);
    runUntil(sim, () => job.status === "printing");
    expect(s.workflow).toBeNull(); // it runs on its own
    runUntil(sim, () => job.status === "printed");
    expect(canStart(s, { type: "collect", jobId: job.id })).toBeNull();
    makeReady(sim, job);
    expect(job.status).toBe("bagged");
    expect(job.priceCents).toBeGreaterThanOrEqual(priceCents(cards()));
  });

  it("come in boxes of 250", () => {
    const d = PRINT_REQUESTS.business_cards;
    const sim = quiet();
    for (let i = 0; i < 20; i++) {
      const c = spawnCustomer(sim.state, sim.rng.dev, "business_cards");
      expect(c.spec!.copies % d.copiesStep!).toBe(0);
      expect(c.spec!.media).toBe("business_card");
    }
  });
});

describe("large format", () => {
  it("prints on the wide-format printer, then by hand: trim it, roll it up, bag it", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_format", { spec: big(), timing: "back", needIn: 280 });
    talkTo(sim, c);
    const job = s.jobs[0];
    expect([...s.machines.wide.queue, s.machines.wide.currentJobId]).toContain(job.id);
    runUntil(sim, () => job.status === "printed");
    expect(canStart(s, { type: "collect", jobId: job.id })).toMatch(/trim it/);
    expect(canStart(s, { type: "roll", jobId: job.id })).toMatch(/Trim/);
    s.handsOn = true; // (each step waits for you, the way a person does it)
    const steps: string[] = [];
    doTask(sim, { type: "trim", jobId: job.id });
    steps.push("trim");
    for (let st = currentStep(s); st; st = currentStep(s)) {
      steps.push(st.type);
      doTask(sim, st.req);
    }
    expect(steps).toEqual(["trim", "roll", "bag"]);
    expect(job.status).toBe("bagged");
    expect(s.choices.filter((x) => x.what === "smudge")).toEqual([]); // (no smudges off the wide-format printer)
  });

  it("takes longer than most orders", () => {
    const typical = ["quick_copies", "large_job", "poster"] as const;
    const longest = Math.max(...typical.map((k) => printMinutes({ ...big(), item: "x", originals: PRINT_REQUESTS[k].originals[1], copies: PRINT_REQUESTS[k].copies[1], media: "letter", finishing: "none" })));
    expect(printMinutes(big({ copies: 1 }))).toBeGreaterThan(longest);
    expect(selfServeBlocker(big())).toMatch(/wide-format/);
  });

  it("its note says what to do: send it to the wide-format printer, trim it, roll it up", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_format", { spec: big(), timing: "back", needIn: 280 });
    talkTo(sim, c);
    const steps = noteDetail(s, s.jobs[0].id)!.steps.map((x) => x.text);
    expect(steps).toContain("Send it to the wide-format printer");
    expect(steps).toContain("Trim it");
    expect(steps).toContain("Roll it up");
    expect(steps).not.toContain("Collect");
  });

  it("a bag can't go on it until it's rolled up", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_format", { spec: big({ copies: 1 }), timing: "back", needIn: 280 });
    talkTo(sim, c);
    const job = s.jobs[0];
    runUntil(sim, () => job.status === "printed");
    s.handsOn = true; // (each step waits for you)
    doTask(sim, { type: "trim", jobId: job.id });
    s.workflow = null;
    expect(job.status).toBe("collected");
    expect(canStart(s, { type: "bag", jobId: job.id })).toMatch(/Roll/);
  });
});

describe("over real days", () => {
  it("both come in, and get made, picked up and paid for", () => {
    const made = { cards: 0, wide: 0 };
    for (let g = 0; g < 6; g++) {
      const game = newGame(3 + g * 1000);
      for (let d = 0; d < 5; d++) {
        const sim = startDay(game);
        const s = sim.state;
        const bot = createBot(1, "smart", s.seed);
        while (!isDayOver(s)) {
          botAct(bot, s, 1);
          tick(sim, 1);
        }
        for (const j of s.jobs) if (j.status === "picked_up" && machineFor(j.spec) !== "printer") made[machineFor(j.spec) as "cards" | "wide"]++;
        endDay(game, sim);
      }
    }
    expect(made.cards).toBeGreaterThan(0);
    expect(made.wide).toBeGreaterThan(0);
  });
});
