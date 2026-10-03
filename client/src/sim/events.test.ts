import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canStart, createSim, isDayOver, tick, type Sim } from "./sim";
import { devEvent } from "./dev";
import { botAct, createBot } from "./bot";
import { spawnCustomer } from "./customers";
import { activeCount, todoList } from "./todo";
import { EVENTS } from "./config";
import { collect, doTask, runUntil, talkTo, calm } from "./testkit";
import type { JobSpec } from "./types";

// These are about the work, not how customers react: nobody balks.
let restore: () => void;
beforeEach(() => (restore = calm()));
afterEach(() => restore());

const plain = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "document", originals: 1, copies: 1, color: "bw", media: "letter", duplex: false, finishing: "none", ...s });

function quiet(seed = 1): Sim {
  const sim = createSim(seed);
  sim.state.director.enabled = false;
  sim.state.printer.paperOutAt = Infinity;
  sim.state.event = null; // only what the test triggers
  return sim;
}

function closeDay(sim: Sim) {
  while (!isDayOver(sim.state)) tick(sim, 1);
}

// A customer whose order is printing right now.
function printing(sim: Sim, copies = 200) {
  const c = spawnCustomer(sim.state, sim.rng.dev, "quick_copies", { spec: plain({ copies }) });
  talkTo(sim, c);
  const job = sim.state.jobs.find((j) => j.id === c.jobId)!;
  doTask(sim, { type: "enter_order", jobId: job.id });
  doTask(sim, { type: "send_job", jobId: job.id });
  runUntil(sim, () => job.sheetsPrinted > 0);
  return { c, job };
}

describe("the day's bad luck", () => {
  it("about one a day, sometimes none, decided by the seed alone", () => {
    let none = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const e = createSim(seed).state.event;
      if (!e) none++;
      else expect(e.status).toBe("pending");
    }
    expect(none).toBeGreaterThan(10);
    expect(none).toBeLessThan(60);
  });

  it("happens during a normal day, and an attentive player handles it", () => {
    let rolled = 0;
    let fired = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const sim = createSim(seed);
      const bot = createBot();
      while (!isDayOver(sim.state)) {
        botAct(bot, sim.state, 1);
        tick(sim, 1);
      }
      const e = sim.state.event;
      if (!e) continue;
      rolled++;
      if (e.status === "pending") continue; // e.g. no box got packed after it was due to rip
      fired++;
      expect(e.status).toBe("fixed");
    }
    expect(fired).toBeGreaterThan(rolled / 2);
  });

  it("doesn't pile on: it waits while you're at the ceiling", () => {
    const sim = createSim(2);
    sim.state.event = { kind: "card_reader_down", at: 0, status: "pending", firedAt: null };
    for (let i = 0; i < 3; i++) spawnCustomer(sim.state, sim.rng.dev, "dropoff");
    sim.state.director.enabled = false;
    for (let i = 0; i < 20; i++) tick(sim, 1);
    expect(sim.state.event.status).toBe("pending");
  });

  it("you can't trigger a second one while one is going on", () => {
    const sim = quiet();
    expect(devEvent(sim, "copier_dies")).toBeNull();
    expect(devEvent(sim, "card_reader_down")).toMatch(/already/);
  });
});

describe("printer jam", () => {
  it("stalls the job until you clear it", () => {
    const sim = quiet();
    const s = sim.state;
    const { job } = printing(sim);
    expect(devEvent(sim, "printer_jam")).toBeNull();
    expect(s.printer.status).toBe("jammed");
    const at = job.sheetsPrinted;
    for (let i = 0; i < 30; i++) tick(sim, 1);
    expect(job.sheetsPrinted).toBe(at); // ignored: nothing moves
    expect(todoList(s)[0].req).toEqual({ type: "clear_jam" });
    doTask(sim, { type: "clear_jam" });
    expect(s.event!.status).toBe("fixed");
    expect(s.choices.at(-1)).toMatchObject({ type: "do", what: "event" });
    runUntil(sim, () => job.status === "printed");
  });

  it("left jammed at close: the manager hears about it", () => {
    const sim = quiet();
    printing(sim);
    devEvent(sim, "printer_jam");
    const before = sim.state.manager.heat;
    closeDay(sim);
    expect(sim.state.event!.status).toBe("ignored");
    expect(sim.state.manager.heat).toBeGreaterThanOrEqual(before + EVENTS.unhandledHeat);
  });
});

describe("self-serve copier dies", () => {
  it("fix it", () => {
    const sim = quiet();
    devEvent(sim, "copier_dies");
    expect(activeCount(sim.state)).toBe(1);
    doTask(sim, { type: "fix_copier" });
    expect(sim.state.event!.status).toBe("fixed");
    expect(activeCount(sim.state)).toBe(0);
  });

  it("or tape a sign on it", () => {
    const sim = quiet();
    devEvent(sim, "copier_dies");
    doTask(sim, { type: "out_of_order_sign" });
    expect(sim.state.event!.status).toBe("worked_around");
    expect(sim.state.copier.status).toBe("broken");
  });

  it("or ignore it: nobody can be helped, and it's on you at close", () => {
    const sim = quiet();
    devEvent(sim, "copier_dies");
    const c = spawnCustomer(sim.state, sim.rng.dev, "self_serve_help");
    talkTo(sim, c);
    expect(canStart(sim.state, { type: "help_self_serve", customerId: c.id })).toMatch(/broken/);
    closeDay(sim);
    expect(sim.state.event!.status).toBe("ignored");
  });
});

describe("card reader down", () => {
  it("ring-ups need the manual workaround (a Don't) until you fix the reader", () => {
    const sim = quiet();
    const s = sim.state;
    const { c, job } = printing(sim, 5);
    devEvent(sim, "card_reader_down");
    collect(sim, job);
    doTask(sim, { type: "bag", jobId: job.id });
    expect(canStart(s, { type: "ring_up", customerId: c.id })).toMatch(/card reader/);
    expect(todoList(s).some((t) => t.req.type === "manual_ring_up")).toBe(true);
    doTask(sim, { type: "manual_ring_up", customerId: c.id });
    expect(c.outcome).toBe("served");
    expect(s.revenueCents).toBe(job.priceCents);
    expect(s.event!.status).toBe("worked_around");
    expect(s.choices.at(-1)).toMatchObject({ type: "dont", what: "event" });
    doTask(sim, { type: "fix_card_reader" });
    expect(s.cardReader).toBe("ok");
  });

  it("fixing it straight away is a Do", () => {
    const sim = quiet();
    devEvent(sim, "card_reader_down");
    doTask(sim, { type: "fix_card_reader" });
    expect(sim.state.event!.status).toBe("fixed");
    expect(sim.state.choices.at(-1)).toMatchObject({ type: "do", what: "event" });
  });

  it("left broken at close: heat", () => {
    const sim = quiet();
    devEvent(sim, "card_reader_down");
    closeDay(sim);
    expect(sim.state.event!.status).toBe("ignored");
    expect(sim.state.manager.heatBy.ignoring).toBeGreaterThanOrEqual(EVENTS.unhandledHeat);
  });
});

describe("box rips", () => {
  function shipper(sim: Sim) {
    const c = spawnCustomer(sim.state, sim.rng.dev, "ship");
    talkTo(sim, c);
    doTask(sim, { type: "weigh", packageId: c.packageId! });
    return c;
  }

  it("the next box you pack rips: pack it again", () => {
    const sim = quiet();
    devEvent(sim, "box_rips");
    const c = shipper(sim);
    doTask(sim, { type: "pack", packageId: c.packageId! });
    const pkg = sim.state.packages[0];
    expect(pkg.status).toBe("weighed");
    expect(sim.state.event!.status).toBe("active");
    doTask(sim, { type: "pack", packageId: pkg.id });
    expect(pkg.status).toBe("packed");
    expect(sim.state.event!.status).toBe("fixed");
  });

  it("or just tape it shut this time", () => {
    const sim = quiet();
    devEvent(sim, "box_rips");
    const c = shipper(sim);
    doTask(sim, { type: "pack", packageId: c.packageId! });
    doTask(sim, { type: "tape_shut", packageId: c.packageId! });
    expect(sim.state.event!.status).toBe("worked_around");
    expect(sim.state.packages[0].taped).toBe(true);
  });
});

describe("Wi-Fi drops", () => {
  it("a web order is stuck until you restart the router", () => {
    const sim = quiet();
    const s = sim.state;
    devEvent(sim, "wifi_drop");
    expect(s.messages.some((m) => m.kind === "web_order")).toBe(false);
    expect(s.heldMessages).toHaveLength(1);
    expect(activeCount(s)).toBe(1); // the order is waiting on you, whether or not you can see it
    doTask(sim, { type: "restart_router" });
    expect(s.messages.some((m) => m.kind === "web_order")).toBe(true);
    expect(s.event!.status).toBe("fixed");
  });

  it("ignored: it comes back on its own, and the order arrives late", () => {
    const sim = quiet();
    const s = sim.state;
    devEvent(sim, "wifi_drop");
    const start = s.time;
    runUntil(sim, () => s.messages.some((m) => m.kind === "web_order"));
    expect(s.time - start).toBe(EVENTS.wifiOutage);
    expect(s.event!.status).toBe("ignored");
    expect(s.choices.at(-1)).toMatchObject({ type: "ignore", what: "event" });
  });
});
