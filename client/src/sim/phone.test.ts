import { describe, expect, it } from "vitest";
import { canStart, counterCustomer, createSim, isShiftOver, startTask, tick, type Sim } from "./sim";
import { botAct, createBot } from "./bot";
import { ringNow, spawnCustomer } from "./dev";
import { FINISHING_STATION } from "./layout";
import type { Call } from "./types";

function runUntil(sim: Sim, cond: () => boolean, limit = 10 * 3600) {
  for (let i = 0; i < limit && !cond(); i++) tick(sim, 1);
  expect(cond()).toBe(true);
}

// A seed whose day has a quote call that would turn into a web order, and the sim for it.
function simWithLead(): { sim: Sim; call: Call } {
  for (let seed = 1; seed < 200; seed++) {
    const sim = createSim(seed);
    const call = sim.state.calls.find((c) => c.leadCustomerId !== null && c.ringsAt < 4 * 3600);
    if (call) return { sim, call };
  }
  throw new Error("no seed with a converting quote call");
}

describe("phone", () => {
  it("rings for 30 seconds, then goes to voicemail if nobody picks up", () => {
    const sim = createSim(3);
    const call = sim.state.calls[0];
    runUntil(sim, () => sim.state.time >= call.ringsAt + 29);
    expect(call.status).toBe("ringing");
    runUntil(sim, () => sim.state.time >= call.ringsAt + 31);
    expect(call.status).toBe("missed");
    expect(sim.state.stats.missedCalls).toBeGreaterThanOrEqual(1);
  });

  it("an answered quote call can turn into a web order later", () => {
    const { sim, call } = simWithLead();
    const lead = sim.state.customers.find((c) => c.id === call.leadCustomerId)!;
    expect(lead.webOrderAt).toBeNull(); // dormant until you answer
    runUntil(sim, () => call.status === "ringing");
    expect(startTask(sim.state, { type: "answer_phone", callId: call.id })).toBeNull();
    runUntil(sim, () => call.status === "answered");
    expect(lead.webOrderAt).toBe(call.answeredAt! + call.leadDelay);
    runUntil(sim, () => lead.jobId !== null);
    expect(sim.state.jobs.find((j) => j.id === lead.jobId)!.channel).toBe("web");
    expect(sim.state.stats.quoteLeads).toBe(1);
  });

  it("a missed quote call never turns into an order", () => {
    const { sim, call } = simWithLead();
    const lead = sim.state.customers.find((c) => c.id === call.leadCustomerId)!;
    runUntil(sim, () => call.status === "missed");
    runUntil(sim, () => sim.state.time > call.ringsAt + 3 * 3600);
    expect(lead.jobId).toBeNull();
  });

  it("same seed and same play give the same calls and conversions", () => {
    const play = () => {
      const sim = createSim(21);
      const bot = createBot(10);
      while (!isShiftOver(sim.state)) {
        botAct(bot, sim.state, 1);
        tick(sim, 1);
      }
      return sim.state.calls.map((c) => [c.kind, c.ringsAt, c.status, c.answeredAt]);
    };
    expect(play()).toEqual(play());
    expect(createSim(21).state.calls.map((c) => c.ringsAt)).toEqual(createSim(21).state.calls.map((c) => c.ringsAt));
  });

  it("you can't pick up in the middle of helping someone at the counter", () => {
    const sim = createSim(1);
    sim.state.customers = [];
    sim.state.calls = [];
    spawnCustomer(sim.state, "quick_copies", "wait", false, "full_service");
    runUntil(sim, () => !!counterCustomer(sim.state));
    startTask(sim.state, { type: "take_order" });
    runUntil(sim, () => sim.state.employee.task!.elapsed > 0);
    ringNow(sim.state, "hours");
    tick(sim, 1);
    expect(canStart(sim.state, { type: "answer_phone", callId: sim.state.calls[0].id })).toMatch(/busy/);
  });

  it("finishing work can be put down to answer", () => {
    const sim = createSim(1);
    sim.state.calls = [];
    sim.state.employee.task = { type: "finish_job", jobId: -1, label: "Binding", station: FINISHING_STATION, duration: 600, elapsed: 0 };
    sim.state.employee.pos = { ...FINISHING_STATION };
    sim.state.jobs.push({ id: -1, spec: { item: "x", originals: 1, copies: 1, color: "bw", media: "letter", duplex: false, finishing: "none" } } as never);
    ringNow(sim.state, "status");
    tick(sim, 1);
    expect(canStart(sim.state, { type: "answer_phone", callId: sim.state.calls[0].id })).toBeNull();
  });

  it("if you start walking to it while it's ringing, it doesn't hang up on you", () => {
    const sim = createSim(1);
    sim.state.calls = [];
    sim.state.customers = [];
    sim.state.employee.pos = { ...FINISHING_STATION }; // a long walk from the register
    ringNow(sim.state, "hours");
    runUntil(sim, () => sim.state.time >= sim.state.calls[0].ringsAt + 25);
    startTask(sim.state, { type: "answer_phone", callId: sim.state.calls[0].id });
    runUntil(sim, () => sim.state.time >= sim.state.calls[0].ringsAt + 32);
    expect(sim.state.calls[0].status).toBe("ringing");
    runUntil(sim, () => sim.state.calls[0].status === "answered");
  });

  it("the bot answers calls when it reasonably can", () => {
    const sim = createSim(4);
    const bot = createBot(10);
    while (!isShiftOver(sim.state)) {
      botAct(bot, sim.state, 1);
      tick(sim, 1);
    }
    const s = sim.state.stats;
    expect(s.callsAnswered).toBeGreaterThan(s.missedCalls);
  });
});
