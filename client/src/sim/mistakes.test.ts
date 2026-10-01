import { describe, expect, it } from "vitest";
import { createSim, isShiftOver, startTask, tick, type Sim } from "./sim";
import { botAct, createBot } from "./bot";
import { spawnCustomer, spawnShippingCustomer, truckNow } from "./dev";
import { MISTAKES } from "./config";
import { collectAll, doTask, fetch, finishAndShelve, runUntil } from "./testkit";
import { counterCustomer } from "./util";
import type { Customer, Job, JobSpec, MistakeKind } from "./types";

function quiet(): Sim {
  const sim = createSim(1);
  const s = sim.state;
  s.customers = [];
  s.calls = [];
  s.packages = [];
  for (const p of s.printers) {
    p.breakdown = null;
    p.sheetsUntilJam = Infinity;
    p.toner = 100;
    for (const t of p.trays) t.level = t.capacity;
  }
  for (const cp of s.copiers) cp.sheetsUntilJam = Infinity;
  return sim;
}

const plain = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "document", originals: 1, copies: 1, color: "bw", media: "letter", duplex: false, finishing: "none", ...s });
const kinds = (sim: Sim): MistakeKind[] => sim.state.mistakes.map((m) => m.kind);

// A customer who wants `want`, comes back for it later; you enter `entered` and send it with `settings`.
function order(sim: Sim, want: JobSpec, entered = want, printerId = "bw"): { c: Customer; job: Job } {
  const c = spawnCustomer(sim.state, "quick_copies", "back", false, "full_service");
  c.request!.spec = want;
  c.linePatience = 3 * 3600;
  c.lateTolerance = 3 * 3600;
  runUntil(sim, () => counterCustomer(sim.state)?.id === c.id);
  doTask(sim, { type: "take_order", spec: entered });
  const job = sim.state.jobs.find((j) => j.id === c.jobId)!;
  doTask(sim, { type: "send_job", jobId: job.id, printerId });
  return { c, job };
}

// Bring them back now and ring them up (they inspect it at the counter).
function pickUp(sim: Sim, c: Customer) {
  c.visitAt = sim.state.time;
  runUntil(sim, () => counterCustomer(sim.state)?.id === c.id);
  doTask(sim, { type: "ring_up" });
}

describe("mistakes and what they cost", () => {
  it("wrong job settings: printed wrong, refused at pickup, reprinted at your cost, and a star or two gone", () => {
    const sim = quiet();
    const s = sim.state;
    const { c, job } = order(sim, plain({ copies: 20, duplex: true, originals: 4 }), plain({ copies: 20, originals: 4 })); // forgot double-sided
    runUntil(sim, () => job.status === "printed");
    finishAndShelve(sim, job);
    const spent = s.costCents;
    pickUp(sim, c);
    expect(kinds(sim)).toEqual(["wrong_settings"]);
    expect(job.status).toBe("unsent"); // back to the start, with what they actually asked for
    expect(job.ticket.duplex).toBe(true);
    expect(job.redos).toBe(1);
    expect(s.revenueCents).toBe(0); // they don't pay for the wrong one
    expect(spent).toBeGreaterThan(0); // and its paper and toner are gone
    expect(c.penalty).toBeGreaterThanOrEqual(MISTAKES.refusalPenalty);
    expect(c.visitAt).toBe(job.dueAt); // they'll come back for the reprint
  });

  it("wrong paper in a tray: the job prints on it, and the customer refuses it", () => {
    const sim = quiet();
    const s = sim.state;
    s.printers[0].trays[0].level = 0; // B&W letter tray empty
    fetch(sim, "cardstock");
    doTask(sim, { type: "load_paper", printerId: "bw", stock: "letter" }); // cardstock in the letter tray
    expect(s.printers[0].trays[0].loaded).toBe("cardstock");
    if (s.employee.hands) doTask(sim, { type: "put_back" });
    const { c, job } = order(sim, plain({ copies: 30 }));
    runUntil(sim, () => job.status === "printed");
    expect(job.printedOn).toBe("cardstock");
    finishAndShelve(sim, job);
    pickUp(sim, c);
    expect(kinds(sim)).toEqual(["wrong_paper"]);
    expect(job.status).toBe("unsent");
  });

  it("output left in the tray: it fills up behind the next job and stops the printer", () => {
    const sim = quiet();
    const s = sim.state;
    const first = order(sim, plain({ copies: 200 })).job;
    runUntil(sim, () => first.status === "printed");
    for (let i = 0; i < MISTAKES.outputLeftAfter; i++) tick(sim, 1); // forget about it
    order(sim, plain({ copies: 600 }));
    runUntil(sim, () => s.printers[0].status === "output_full");
    expect(kinds(sim)).toContain("output_left");
  });

  it("shelved under the wrong name: a long search at ring-up and a lost star", () => {
    const sim = quiet();
    const s = sim.state;
    const { c, job } = order(sim, plain({ copies: 5 }));
    const other = spawnCustomer(s, "resume", "back", false, "full_service");
    other.visitAt = null;
    runUntil(sim, () => job.status === "printed");
    collectAll(sim, job);
    doTask(sim, { type: "finish_job", jobId: job.id });
    doTask(sim, { type: "shelve", filedUnder: other.id });
    c.visitAt = s.time;
    runUntil(sim, () => counterCustomer(s)?.id === c.id);
    startTask(s, { type: "ring_up" });
    const slow = s.employee.task!.duration;
    runUntil(sim, () => c.outcome !== null);
    expect(kinds(sim)).toEqual(["misfiled"]);
    expect(slow).toBeGreaterThanOrEqual(MISTAKES.searchSeconds);
    expect(c.rating).toBeLessThanOrEqual(5 - MISTAKES.searchPenalty);
  });

  it("a package that never went in the outbound bin misses the truck", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnShippingCustomer(s, "ship", { service: "ground", packed: true });
    runUntil(sim, () => counterCustomer(s)?.id === c.id);
    doTask(sim, { type: "ship_package" });
    doTask(sim, { type: "set_down" }); // left it on the counter
    truckNow(s);
    runUntil(sim, () => s.truck.status === "gone");
    expect(kinds(sim)).toEqual(["not_staged"]);
    expect(s.stats.missedTruckPackages).toBe(1);
  });

  it("missing the truck with staged packages", () => {
    const sim = quiet();
    const s = sim.state;
    const c = spawnShippingCustomer(s, "ship", { service: "overnight", packed: true });
    runUntil(sim, () => counterCustomer(s)?.id === c.id);
    doTask(sim, { type: "ship_package" });
    doTask(sim, { type: "stage_packages" });
    truckNow(s);
    runUntil(sim, () => s.truck.status === "gone");
    expect(kinds(sim)).toEqual(["missed_truck"]);
    expect(s.stats.refundsCents).toBeGreaterThan(0);
  });

  it("an online order nobody opened starts late and is a mistake once it's past due", () => {
    const sim = createSim(3);
    const s = sim.state;
    runUntil(sim, () => s.jobs.some((j) => j.channel === "web" && !j.dueTomorrow), 9 * 3600);
    const job = s.jobs.find((j) => j.channel === "web" && !j.dueTomorrow)!;
    runUntil(sim, () => s.time > job.dueAt + 1, 9 * 3600);
    expect(s.mistakes.some((m) => m.kind === "unread_order" && m.jobId === job.id)).toBe(true);
  });

  it("taking an order you can't fill leaves it stuck mid-job", () => {
    const sim = quiet();
    const s = sim.state;
    s.stockroom.cardstock = 0;
    s.printers[1].trays[2].level = 40; // a few sheets of cardstock left in the tray
    const { job } = order(sim, plain({ copies: 200, media: "cardstock" }), undefined, "color");
    expect(job.takenShort).toBe(true);
    runUntil(sim, () => s.printers[1].status === "out_of_paper");
    expect(kinds(sim)).toContain("couldnt_fill");
    expect(job.status).toBe("printing"); // stuck
  });
});

describe("cues instead of alerts", () => {
  it("a self-serve customer whose copier stopped comes and tells you, then goes back once you say you'll fix it", () => {
    const sim = quiet();
    const s = sim.state;
    s.copiers[0].sheetsUntilJam = 5;
    const c = spawnCustomer(s, "quick_copies", "wait", false, "alone");
    c.request!.spec = plain({ originals: 40 });
    c.linePatience = 3600;
    runUntil(sim, () => s.copiers[0].status === "jammed");
    expect(c.state).toBe("self_serve");
    runUntil(sim, () => counterCustomer(s)?.id === c.id);
    expect(c.purpose).toBe("copier_help");
    expect(s.time - s.copiers[0].stoppedSince!).toBeGreaterThanOrEqual(MISTAKES.copierComplaintAfter);
    doTask(sim, { type: "acknowledge_copier" });
    expect(c.state).toBe("self_serve");
    doTask(sim, { type: "fix_copier", copierId: 1 });
    runUntil(sim, () => c.outcome !== null);
    expect(c.outcome).toBe("self_served");
  });

  it("the log marks your own actions; the world's events are only for dev mode", () => {
    const sim = quiet();
    const s = sim.state;
    const { job } = order(sim, plain({ copies: 5 }));
    runUntil(sim, () => job.status === "printed");
    const mine = s.log.filter((e) => e.you).map((e) => e.text);
    const world = s.log.filter((e) => !e.you).map((e) => e.text);
    expect(mine.some((t) => t.startsWith("Took") && t.includes("order"))).toBe(true);
    expect(mine.some((t) => t.startsWith("Sent order"))).toBe(true);
    expect(world.some((t) => t.includes("finished printing"))).toBe(true); // you'd have to go look
    expect(world.some((t) => t.includes("came in"))).toBe(true);
  });

  it("nothing you can't see tells you it happened: the driver leaving isn't one of your log lines", () => {
    const sim = quiet();
    const s = sim.state;
    truckNow(s);
    runUntil(sim, () => s.truck.status === "gone");
    expect(s.log.filter((e) => e.you && e.text.includes("driver"))).toHaveLength(0);
  });
});

describe("the bot never makes these mistakes", () => {
  it("no mistakes over several full days", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const sim = createSim(seed);
      const bot = createBot(10);
      while (!isShiftOver(sim.state)) {
        botAct(bot, sim.state, 1);
        tick(sim, 1);
      }
      expect(sim.state.mistakes).toEqual([]);
    }
  });
});

