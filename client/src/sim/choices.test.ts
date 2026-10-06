import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canStart, createSim, isDayOver, tick, type Sim } from "./sim";
import { botAct, createBot } from "./bot";
import { placeWebOrder, returnCustomer, spawnCustomer } from "./customers";
import { moodOf } from "./mood";
import { quoteFor } from "./quote";
import { activeCount, todoList } from "./todo";
import { ANSWER_WITHIN, DURATIONS, FULL_SERVICE, GIVE_UP, HEAT, REACTIONS, RESPOND_MINUTES, STANDARD_LEAD, WORTH_MIN_CENTS } from "./config";
import { handlingMinutes } from "./quote";
import { calm, doTask, makeReady, runUntil, talkTo } from "./testkit";
import type { Customer, JobSpec } from "./types";

const plain = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "document", originals: 1, copies: 1, color: "bw", media: "letter", duplex: false, finishing: "none", ...s });

function quiet(seed = 1, day = 1): Sim {
  const sim = createSim(seed, { day });
  sim.state.printer.paperOutAt = Infinity;
  sim.state.director.enabled = false;
  sim.state.event = null;
  return sim;
}

// Customers who never balk unless a test says so.
let restore: () => void;
beforeEach(() => (restore = calm()));
afterEach(() => restore());

function at(sim: Sim, c: Customer) {
  doTask(sim, { type: "talk", customerId: c.id });
  return quoteFor(sim.state, c);
}

function make(sim: Sim, c: Customer) {
  const job = sim.state.jobs.find((j) => j.id === c.jobId)!;
  makeReady(sim, job);
  return job;
}

describe("the counter quote", () => {
  it("a small job: full service like any other (with the small-order fee), against self-serve's price and your time", () => {
    const sim = quiet();
    const c = spawnCustomer(sim.state, sim.rng.dev, "quick_copies", { spec: plain({ originals: 4, copies: 10 }), timing: "wait", needIn: 300 });
    const q = at(sim, c);
    expect(q.standard).toEqual({ printCents: 600, serviceFeeCents: FULL_SERVICE.serviceFeeCents, rushCents: 0, totalCents: 600 + FULL_SERVICE.serviceFeeCents });
    expect(q.yourMinutes).toBe(RESPOND_MINUTES.take + handlingMinutes(c.spec!) + DURATIONS.ring_up); // the whole production job
    expect(q.printMinutes).toBeGreaterThan(0); // on the production printer, not the copier
    expect(q.selfServeCents!).toBeLessThan(q.standard!.totalCents); // less money...
    expect(q.selfServeMinutes).toBeLessThanOrEqual(2); // ...but almost none of your time
    expect(q.rush).toBeNull();
  });

  it("a production job: standard turnaround from the printer queue, your time spread out", () => {
    const sim = quiet();
    const c = spawnCustomer(sim.state, sim.rng.dev, "large_job", { spec: plain({ copies: 10, media: "cardstock" }), timing: "back", needIn: 300 });
    const q = at(sim, c);
    expect(q.standardReadyAt).toBe(sim.state.time + STANDARD_LEAD);
    expect(q.selfServeCents).toBeNull();
    expect(q.printMinutes).toBeGreaterThan(0);
  });

  it("the estimate grows with what's in the printer queue", () => {
    const sim = quiet();
    const s = sim.state;
    for (let i = 0; i < 2; i++) {
      const big = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 600, originals: 2 }), timing: "back", needIn: 1000 });
      talkTo(sim, big); // entered and sent
    }
    const c = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: plain({ copies: 10, media: "cardstock" }), timing: "wait", needIn: 60 });
    const q = at(sim, c);
    expect(q.standardReadyAt).toBeGreaterThan(s.time + STANDARD_LEAD);
    expect(q.rush).not.toBeNull(); // needed sooner than standard
    expect(q.rushReadyAt).toBeLessThan(q.standardReadyAt);
  });

  it("no self-serve for cardstock, back-counter finishing, or someone who isn't staying", () => {
    const sim = quiet();
    const s = sim.state;
    for (const [spec, timing] of [
      [plain({ media: "cardstock" }), "wait"],
      [plain({ finishing: "cut" }), "wait"],
      [plain(), "back"],
    ] as const) {
      const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec, timing, needIn: 500 });
      expect(quoteFor(s, c).selfServeCents).toBeNull();
      s.customers = [];
    }
  });
});

describe("Do / Don't / Ignore at the counter", () => {
  it("Do: take the order, standard turnaround, paid at pickup", () => {
    const sim = quiet();
    const c = spawnCustomer(sim.state, sim.rng.dev, "quick_copies", { spec: plain({ copies: 10, media: "cardstock" }), timing: "wait", needIn: 300 });
    talkTo(sim, c, "take");
    const job = sim.state.jobs[0];
    expect(job.rush).toBe(false);
    expect(job.dueAt).toBeGreaterThanOrEqual(sim.state.time + STANDARD_LEAD - 10);
    expect(sim.state.choices.at(-1)).toMatchObject({ type: "do", action: "take", what: "counter" });
    make(sim, c);
    doTask(sim, { type: "fetch_bag", customerId: c.id, jobId: job.id }); // then rung up
    expect(sim.state.revenueCents).toBe(job.priceCents);
    expect(moodOf(c)).toBe("happy");
  });

  it("Do: take it as a rush, only when they need it sooner; it costs more and prints first", () => {
    const sim = quiet();
    const s = sim.state;
    const first = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 200 }), timing: "back", needIn: 1000 });
    talkTo(sim, first);
    const later = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 200 }), timing: "back", needIn: 1000 });
    talkTo(sim, later);
    expect(canStart(s, { type: "talk", customerId: later.id })).not.toBeNull();
    const hurry = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: plain({ copies: 10, media: "cardstock" }), timing: "wait", needIn: 60 });
    doTask(sim, { type: "talk", customerId: hurry.id });
    expect(canStart(s, { type: "respond", customerId: hurry.id, choice: "rush" })).toBeNull();
    doTask(sim, { type: "respond", customerId: hurry.id, choice: "rush" });
    const rush = s.jobs.find((j) => j.customerId === hurry.id)!;
    doTask(sim, { type: "enter_order", jobId: rush.id });
    expect(rush.rush).toBe(true);
    expect(rush.rushCents).toBeGreaterThanOrEqual(FULL_SERVICE.rushMinCents);
    expect(s.printer.queue[0] === rush.id || s.printer.currentJobId === rush.id).toBe(true); // ahead of the others
    expect(s.stats.rushOrders).toBe(1);

    const relaxed = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain(), timing: "back", needIn: 1000 });
    runUntil(sim, () => s.customers.filter((x) => x.state === "line" || x.state === "talking").length === 1 && s.employee.task === null);
    doTask(sim, { type: "talk", customerId: relaxed.id });
    expect(canStart(s, { type: "respond", customerId: relaxed.id, choice: "rush" })).toMatch(/soon enough/);
  });

  it("Do: send them to self-serve; most go, some want full service and it's back to you", () => {
    const sim = quiet();
    const s = sim.state;
    const ok = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: plain({ copies: 20 }), timing: "wait", needIn: 300 });
    talkTo(sim, ok, "self_serve");
    expect(ok.state).toBe("self_serve");
    expect(activeCount(s)).toBe(0); // no work for you
    runUntil(sim, () => ok.state === "gone");
    expect(ok.outcome).toBe("served");
    expect(s.stats.selfServed).toBe(1);
    expect(s.revenueCents).toBeGreaterThan(0);

    REACTIONS.acceptSelfServe = 0;
    const no = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: plain({ copies: 20 }), timing: "wait", needIn: 300 });
    talkTo(sim, no, "self_serve");
    expect(no.state).toBe("talking");
    expect(no.refusedSelfServe).toBe(true);
    expect(canStart(s, { type: "respond", customerId: no.id, choice: "self_serve" })).toMatch(/full service/);
    doTask(sim, { type: "respond", customerId: no.id, choice: "take" });
    expect(no.jobId).not.toBeNull();
  });

  it("some go straight to self-serve without ever coming to the counter", () => {
    REACTIONS.goAlone = 1;
    const sim = createSim(4);
    const s = sim.state;
    runUntil(sim, () => s.customers.some((c) => c.state === "self_serve"), 300);
    const c = s.customers.find((x) => x.state === "self_serve")!;
    expect(s.choices.some((x) => x.customerId === c.id)).toBe(false);
  });

  it("Don't: turn them away. No heat if it couldn't be done in time or wasn't worth it", () => {
    const sim = quiet();
    const s = sim.state;
    const tiny = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: plain({ media: "cardstock" }), timing: "wait", needIn: 300 });
    expect(quoteFor(s, tiny).worth).toBe(false);
    talkTo(sim, tiny, "turn_away");
    expect(tiny.outcome).toBe("turned_away");
    expect(s.choices.at(-1)).toMatchObject({ type: "dont", action: "turn_away" });
    const impossible = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 300, originals: 6, color: "color" }), timing: "wait", needIn: 20 });
    expect(quoteFor(s, impossible).doable).toBe(false);
    talkTo(sim, impossible, "turn_away");
    expect(s.manager.heatBy.lost_sales).toBe(0);
    expect(s.stats.lostSales).toBe(0);
    expect(s.stats.turnedAway).toBe(2);
  });

  it("Don't: turning away a doable job worth doing is a lost sale (a little heat)", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 50, color: "color" }), timing: "back", needIn: 600 });
    const q = quoteFor(s, c);
    expect(q.doable && q.worth).toBe(true);
    expect(q.valueCents).toBeGreaterThanOrEqual(WORTH_MIN_CENTS);
    talkTo(sim, c, "turn_away");
    expect(s.manager.heatBy.lost_sales).toBe(HEAT.lostSale);
    expect(s.stats.lostSales).toBe(1);
    expect(s.stats.lostSalesCents).toBe(q.valueCents);
    expect(moodOf(c)).toBe("neutral");
  });

  it("online orders can't be turned away when they come for them", () => {
    const sim = quiet();
    const s = sim.state;
    const job = placeWebOrder(s, sim.rng.dev, { spec: plain() });
    doTask(sim, { type: "open_message", messageId: s.messages.find((m) => m.jobId === job.id)!.id });
    makeReady(sim, job);
    const c = s.customers.find((x) => x.id === job.customerId)!;
    returnCustomer(s, c);
    doTask(sim, { type: "talk", customerId: c.id });
    expect(canStart(s, { type: "respond", customerId: c.id, choice: "turn_away" })).toMatch(/can't be turned away/);
  });

  it("Ignore: they keep waiting, a little worse off; and you can still help them", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "dropoff");
    talkTo(sim, c, "ignore");
    expect(c.state).toBe("line");
    expect(c.ignored).toBe(1);
    expect(s.manager.heatBy.ignoring).toBe(HEAT.ignore);
    expect(s.choices.at(-1)).toMatchObject({ type: "ignore", action: "ignore" });
    talkTo(sim, c, "take"); // scanned and binned
    expect(moodOf(c)).toBe("neutral"); // ignored once, then helped
  });

  it("not answering for long enough counts as ignoring them", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "ship");
    doTask(sim, { type: "talk", customerId: c.id });
    for (let i = 0; i < ANSWER_WITHIN; i++) tick(sim, 1);
    expect(c.state).toBe("line");
    expect(s.choices.at(-1)).toMatchObject({ type: "ignore", what: "counter", auto: true });
  });

  it("your attitude isn't graded: the same Do gets the same mood, whoever you are", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const sim = quiet(seed);
      const c = spawnCustomer(sim.state, sim.rng.dev, "self_serve_help");
      talkTo(sim, c); // and helped
      expect(moodOf(c)).toBe("happy");
    }
  });
});

describe("customer reactions", () => {
  it("some balk at the service fee on a small order: they do it themselves, or leave", () => {
    REACTIONS.serviceFeeBalk = 1;
    REACTIONS.balkInstead = { standard: 0, self_serve: 1, leave: 0 };
    const sim = quiet();
    const s = sim.state;
    const diy = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: plain({ copies: 5 }), timing: "wait", needIn: 300 });
    talkTo(sim, diy, "take");
    expect(diy.state).toBe("self_serve");
    expect(diy.jobId).toBeNull();

    REACTIONS.balkInstead = { standard: 0, self_serve: 0, leave: 1 };
    const gone = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: plain({ copies: 5 }), timing: "wait", needIn: 300 });
    talkTo(sim, gone, "take");
    expect(gone.outcome).toBe("balked");
    expect(s.manager.heat).toBe(0); // their call, not yours

    const big = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 100 }), timing: "back", needIn: 600 });
    talkTo(sim, big, "take"); // no service fee on bigger orders: nothing to balk at
    expect(big.jobId).not.toBeNull();
  });

  it("some balk at a rush fee and take the standard time instead", () => {
    REACTIONS.rushBalk = 1;
    REACTIONS.balkInstead = { standard: 1, self_serve: 0, leave: 0 };
    const sim = quiet();
    const c = spawnCustomer(sim.state, sim.rng.dev, "quick_copies", { spec: plain({ copies: 20, media: "cardstock" }), timing: "wait", needIn: 60 });
    talkTo(sim, c, "rush");
    const job = sim.state.jobs[0];
    expect(job.rush).toBe(false);
    expect(job.rushCents).toBe(0);
  });

  it("if it can't be ready in time, some take the later time and some leave", () => {
    const sim = quiet();
    const s = sim.state;
    const ok = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 20, media: "cardstock" }), timing: "wait", needIn: 40 });
    talkTo(sim, ok, "take");
    const job = s.jobs[0];
    expect(job.dueAt).toBeGreaterThan(ok.needBy!); // they took the later time
    REACTIONS.acceptLater = 0;
    const no = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 20, media: "cardstock" }), timing: "wait", needIn: 40 });
    talkTo(sim, no, "take");
    expect(no.outcome).toBe("balked");
  });

  it("the same choices always get the same reactions", () => {
    restore();
    const run = () => {
      const sim = quiet(9);
      const out: string[] = [];
      for (let i = 0; i < 8; i++) {
        const c = spawnCustomer(sim.state, sim.rng.dev, "quick_copies");
        talkTo(sim, c, "take");
        out.push(`${c.state}:${c.outcome}`);
      }
      return out.join(",");
    };
    expect(run()).toBe(run());
    restore = calm();
  });
});

describe("late orders", () => {
  it("an order bagged after it was due is late: heat, and the customer notices", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 20 }), timing: "back", needIn: 150 });
    talkTo(sim, c, "take");
    const job = s.jobs[0];
    runUntil(sim, () => s.time > job.dueAt); // you got to it too late
    make(sim, c);
    expect(job.late).toBe(true);
    expect(s.stats.lateOrders).toBe(1);
    expect(s.manager.heatBy.complaints).toBe(HEAT.late);
  });

  it("an order due today and still not done at close counts against you", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 20 }), timing: "back", needIn: 200 });
    talkTo(sim, c, "take");
    while (!isDayOver(s)) tick(sim, 1);
    expect(s.jobs[0].late).toBe(true);
    expect(s.manager.heatBy.complaints).toBeGreaterThanOrEqual(HEAT.unfinished);
  });

  it("anything that can't be ready before close is promised for tomorrow", () => {
    const sim = quiet();
    const s = sim.state;
    runUntil(sim, () => s.time >= s.closeAt - 30);
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 100 }), timing: "back", needIn: 10 });
    expect(quoteFor(s, c).tomorrow).toBe(true);
  });
});

describe("patience", () => {
  it("nobody helping them: annoyed, then angry (each said out loud), then they leave within the give-up time", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "package_pickup");
    const seen: string[] = [];
    runUntil(sim, () => {
      if (seen.at(-1) !== c.stage) seen.push(c.stage);
      return c.state === "gone";
    });
    expect(seen).toEqual(["fine", "annoyed", "angry", "gone"]);
    expect(s.time).toBeLessThanOrEqual(GIVE_UP.package_pickup + 1);
    expect(c.outcome).toBe("left");
    expect(moodOf(c)).toBe("angry");
    expect(s.failures.map((f) => f.kind)).toEqual(["walked_out"]);
  });

  it("an ignored customer leaves within the configured window", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: plain(), timing: "wait", needIn: 300 });
    talkTo(sim, c, "ignore");
    const ignoredAt = s.time;
    runUntil(sim, () => c.state === "gone");
    expect(s.time - ignoredAt).toBeLessThanOrEqual(GIVE_UP.quick_copies);
    expect(c.said).toBe("I'll go somewhere else.");
  });

  it("someone who gives up in line says how long they waited, and it's on the report", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: plain(), timing: "wait", needIn: 300 });
    runUntil(sim, () => c.state === "gone");
    expect(s.failures.at(-1)!.text).toMatch(new RegExp(`^${c.name} left the line after waiting \\d+ min\\.$`));
  });

  it("waiting for an order only counts once it's overdue", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { spec: plain({ copies: 20, media: "cardstock" }), timing: "wait", needIn: 300 });
    talkTo(sim, c);
    const job = s.jobs[0];
    runUntil(sim, () => s.time >= job.dueAt);
    expect(c.stage).toBe("fine");
    runUntil(sim, () => c.state === "gone"); // nobody ever finishes it
    expect(s.failures.at(-1)).toMatchObject({ kind: "never_ready", jobId: job.id });
    expect(s.failures.at(-1)!.text).toBe(`Order #${job.id} was never finished. ${c.name} left without it.`);
  });

  it("is generous: an attentive player never runs out of anyone's patience", () => {
    restore();
    for (let seed = 1; seed <= 15; seed++) {
      const sim = createSim(seed, { day: 20 });
      const bot = createBot(1, "smart", seed);
      while (!isDayOver(sim.state)) {
        botAct(bot, sim.state, 1);
        tick(sim, 1);
      }
      expect(sim.state.customers.filter((c) => c.outcome === "left")).toEqual([]);
    }
    restore = calm();
  });
});

describe("Do / Don't / Ignore on the work", () => {
  it("cutting the corner is always faster than doing it properly", () => {
    expect(DURATIONS.use_anyway).toBeLessThan(DURATIONS.reprint + DURATIONS.collect);
    expect(DURATIONS.out_of_order_sign).toBeLessThan(DURATIONS.fix_copier);
    expect(DURATIONS.tape_shut).toBeLessThan(DURATIONS.pack);
    expect(DURATIONS.let_truck_go).toBeLessThan(DURATIONS.hand_off);
  });

  it("smudged copies: reprint (Do), or hand them over anyway (Don't) and the customer is unhappy", () => {
    for (let seed = 1; seed < 500; seed++) {
      const sim = quiet(seed, 4); // (no smudges on day 1: bad luck eases in)
      const s = sim.state;
      const c = spawnCustomer(s, sim.rng.dev, "quick_copies", { spec: plain({ copies: 5, media: "cardstock" }), timing: "wait", needIn: 300 });
      talkTo(sim, c);
      const job = s.jobs[0];
      runUntil(sim, () => job.status === "printed");
      doTask(sim, { type: "collect", jobId: job.id });
      if (job.smudge !== "found") continue;
      // The collect-and-finish workflow stops at the choice.
      expect(todoList(s)[0]).toMatchObject({ req: { type: "reprint", jobId: job.id }, alts: [{ type: "use_anyway", jobId: job.id }] });
      doTask(sim, { type: "use_anyway", jobId: job.id }); // and bags it
      expect(job.status).toBe("bagged");
      expect(s.choices.find((x) => x.what === "smudge")).toMatchObject({ type: "dont" });
      doTask(sim, { type: "fetch_bag", customerId: c.id, jobId: job.id }); // then rung up
      expect(moodOf(c)).toBe("angry");
      return;
    }
    throw new Error("no smudged run in 500 seeds");
  });

  it("broken copier: fix it (Do), or tape a sign on it (Don't) and whoever needed it is unhappy", () => {
    const sim = quiet();
    const s = sim.state;
    s.copier.status = "broken";
    doTask(sim, { type: "out_of_order_sign" });
    expect(s.choices.at(-1)).toMatchObject({ type: "dont", what: "copier" });
    const c = spawnCustomer(s, sim.rng.dev, "self_serve_help");
    talkTo(sim, c, "turn_away"); // "Sorry, it's broken."
    expect(moodOf(c)).toBe("angry");
    expect(s.failures.map((f) => f.kind)).toContain("copier_broken");
    doTask(sim, { type: "fix_copier" });
    expect(s.choices.at(-1)).toMatchObject({ type: "do", what: "copier" });
    expect(s.copier).toEqual({ status: "ok", sign: false });
  });

  it("packing: pack it properly (Do), or just tape it shut (Don't) while they watch", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnCustomer(s, sim.rng.dev, "ship");
    talkTo(sim, c); // weighed, then it stops: box it, or just tape it shut?
    doTask(sim, { type: "tape_shut", packageId: c.packageId! }); // labeled and binned
    expect(s.packages[0]).toMatchObject({ taped: true, status: "binned" });
    expect(moodOf(c)).toBe("angry");
    expect(s.choices.find((x) => x.what === "pack")).toMatchObject({ type: "dont" });
  });

  it("inbox: open a web order (Do) or leave it unread (Ignore); it's off your list until they come in", () => {
    const sim = quiet();
    const s = sim.state;
    const job = placeWebOrder(s, sim.rng.dev, { spec: plain() });
    const msg = s.messages.find((m) => m.jobId === job.id)!;
    doTask(sim, { type: "leave_unread", messageId: msg.id });
    expect(activeCount(s)).toBe(0);
    expect(s.choices.at(-1)).toMatchObject({ type: "ignore", what: "inbox" });
    s.director.enabled = true;
    const owner = s.customers.find((c) => c.id === job.customerId)!;
    runUntil(sim, () => owner.state === "line");
    expect(s.time).toBeGreaterThanOrEqual(job.pickupAt);
  });

  it("truck: hand off (Do), let the driver leave (Don't), or leave it (Ignore)", () => {
    for (const how of ["dont", "ignore"] as const) {
      const sim = quiet();
      const s = sim.state;
      const c = spawnCustomer(s, sim.rng.dev, "dropoff");
      talkTo(sim, c); // scanned and binned
      runUntil(sim, () => s.truck.status === "waiting");
      if (how === "dont") doTask(sim, { type: "let_truck_go" });
      runUntil(sim, () => s.truck.status === "gone");
      expect(s.packages[0].status).toBe("binned");
      expect(s.choices.at(-1)).toMatchObject({ type: how, what: "truck" });
      expect(s.failures.at(-1)).toMatchObject({ kind: "packages_left" });
    }
  });
});
