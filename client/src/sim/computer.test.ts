import { describe, expect, it } from "vitest";
import { canStart, createSim, isShiftOver, startTask, tick, type Sim } from "./sim";
import { botAct, createBot } from "./bot";
import { appView, emailPenalty, jobMismatches, specsEqual, type PrintServerView } from "./computer";
import { spawnCustomer } from "./dev";
import { COMPUTER } from "./config";
import { fullServiceQuote } from "./orders";
import { FINISHING_STATION, REGISTER } from "./layout";
import { counterCustomer } from "./util";
import type { Customer, Job, JobSpec } from "./types";

function runUntil(sim: Sim, cond: () => boolean, limit = 6 * 3600) {
  for (let i = 0; i < limit && !cond(); i++) tick(sim, 1);
  expect(cond()).toBe(true);
}

function quiet(seed = 1): Sim {
  const sim = createSim(seed);
  sim.state.customers = [];
  sim.state.calls = [];
  sim.state.packages = [];
  for (const p of sim.state.printers) {
    p.breakdown = null;
    p.sheetsUntilJam = Infinity;
    for (const t of p.trays) t.level = t.capacity;
    p.toner = 100;
  }
  return sim;
}

const plain = (s: Partial<JobSpec> = {}): JobSpec => ({ item: "document", originals: 1, copies: 1, color: "bw", media: "letter", duplex: false, finishing: "none", ...s });

// A counter customer who wants exactly `want`, standing at the register.
function customerWanting(sim: Sim, want: JobSpec): Customer {
  const c = spawnCustomer(sim.state, "quick_copies", "back", false, "full_service");
  c.request!.spec = want;
  runUntil(sim, () => counterCustomer(sim.state)?.id === c.id);
  return c;
}

function takeOrder(sim: Sim, c: Customer, entered?: JobSpec): Job {
  expect(startTask(sim.state, { type: "take_order", spec: entered })).toBeNull();
  runUntil(sim, () => c.jobId !== null);
  return sim.state.jobs.find((j) => j.id === c.jobId)!;
}

describe("the computer is at the register", () => {
  it("every action is a task you walk to the register for", () => {
    const sim = quiet();
    const s = sim.state;
    s.employee.pos = { ...FINISHING_STATION };
    expect(startTask(s, { type: "open_app", app: "printserver" })).toBeNull();
    expect(s.employee.task!.station).toEqual(REGISTER);
    expect(s.employee.task!.duration).toBe(COMPUTER.openAppSeconds);
    tick(sim, 1);
    expect(s.employee.task).not.toBeNull(); // still walking
    runUntil(sim, () => !s.employee.task);
    expect(s.computer.app).toBe("printserver");
    expect(appView(s, "printserver")).toBeDefined();
  });

  it("switching apps takes time; staying in one doesn't", () => {
    const sim = quiet();
    const c = customerWanting(sim, plain({ copies: 10 }));
    startTask(sim.state, { type: "take_order" });
    const cold = sim.state.employee.task!.duration;
    sim.state.employee.task = null;
    sim.state.computer.app = "pos";
    c.waitStart = sim.state.time;
    startTask(sim.state, { type: "take_order" });
    expect(cold - sim.state.employee.task!.duration).toBe(COMPUTER.openAppSeconds);
  });

  it("app views are snapshots: they don't update until you refresh", () => {
    const sim = quiet();
    const s = sim.state;
    startTask(s, { type: "open_app", app: "printserver" });
    runUntil(sim, () => !s.employee.task);
    s.printers[0].status = "jammed";
    expect(appView<PrintServerView>(s, "printserver")!.data.printers[0].code).toBe("Ready");
    startTask(s, { type: "refresh_app" });
    runUntil(sim, () => !s.employee.task);
    expect(appView<PrintServerView>(s, "printserver")!.data.printers[0].code).toBe("Error: paper jam");
  });

  it("the print server shows error codes and queues, never paper levels or toner", () => {
    const sim = quiet();
    const s = sim.state;
    s.printers[1].trays[0].level = 0;
    s.printers[1].status = "out_of_paper";
    startTask(s, { type: "open_app", app: "printserver" });
    runUntil(sim, () => !s.employee.task);
    const json = JSON.stringify(appView(s, "printserver")!.data);
    expect(json).toContain("paper out (letter tray)");
    for (const leak of ["level", "toner", "capacity", "%"]) expect(json).not.toContain(leak);
  });
});

describe("taking an order in the POS", () => {
  it("what you enter is what the system knows; enter it right and it matches", () => {
    const sim = quiet();
    const want = plain({ originals: 3, copies: 25, media: "cardstock" });
    const c = customerWanting(sim, want);
    const job = takeOrder(sim, c, want);
    expect(specsEqual(job.ticket, want)).toBe(true);
    expect(jobMismatches(job)).toEqual([]);
  });

  it("enter it wrong (plain defaults left in place) and the job is wrong", () => {
    const sim = quiet();
    const want = plain({ originals: 3, copies: 25, media: "cardstock", duplex: false });
    const c = customerWanting(sim, want);
    const entered = plain({ originals: 3, copies: 25 }); // forgot cardstock
    const job = takeOrder(sim, c, entered);
    expect(jobMismatches(job)).toEqual(["letter instead of cardstock"]);
    expect(job.priceCents).toBe(fullServiceQuote(entered, true).totalCents); // and it's charged as plain paper
  });

  it("the print server settings can also be entered wrong", () => {
    const sim = quiet();
    const want = plain({ originals: 2, copies: 20, color: "color" });
    const c = customerWanting(sim, want);
    const job = takeOrder(sim, c, want);
    expect(startTask(sim.state, { type: "send_job", jobId: job.id, printerId: "color", spec: plain({ originals: 2, copies: 20 }) })).toBeNull();
    runUntil(sim, () => job.status === "queued" || job.status === "printing");
    expect(job.spec.color).toBe("bw");
    expect(jobMismatches(job)).toEqual(["B&W instead of color"]);
  });
});

describe("the inbox", () => {
  // The first online order of a real day.
  function withOnlineOrder(): { sim: Sim; job: Job } {
    const sim = createSim(3);
    runUntil(sim, () => sim.state.jobs.some((j) => j.channel === "web"), 9 * 3600);
    return { sim, job: sim.state.jobs.find((j) => j.channel === "web")! };
  }

  it("online orders arrive unread and can't be printed until you open them", () => {
    const { sim, job } = withOnlineOrder();
    const s = sim.state;
    expect(job.opened).toBe(false);
    const msg = s.computer.messages.find((m) => m.jobId === job.id && m.kind === "web_order")!;
    expect(msg.read).toBe(false);
    const printer = s.printers.find((p) => p.colors.includes(job.ticket.color) && p.media.includes(job.ticket.media))!;
    expect(canStart(s, { type: "send_job", jobId: job.id, printerId: printer.id })).toMatch(/hasn't been opened/);

    s.employee.task = null;
    expect(startTask(s, { type: "open_message", messageId: msg.id })).toBeNull();
    runUntil(sim, () => job.opened);
    expect(canStart(s, { type: "send_job", jobId: job.id, printerId: printer.id })).toBeNull();
  });

  it("customers email to check on online orders; ignoring one and being late costs a bit more", () => {
    const sim = createSim(3);
    const s = sim.state;
    runUntil(sim, () => s.computer.messages.some((m) => m.kind === "email"), 9 * 3600);
    const email = s.computer.messages.find((m) => m.kind === "email")!;
    const job = s.jobs.find((j) => j.id === email.jobId)!;
    job.readyAt = job.dueAt + 3600; // say it ended up late
    expect(emailPenalty(s, job)).toBe(COMPUTER.unansweredLatePenalty);
    email.read = true;
    s.employee.task = null;
    startTask(s, { type: "reply_email", messageId: email.id });
    runUntil(sim, () => email.replied);
    expect(emailPenalty(s, job)).toBe(0);
  });
});

describe("voicemail", () => {
  it("missed calls leave a message you can call back, and a quote callback can still become an order", () => {
    for (let seed = 1; seed < 100; seed++) {
      const sim = createSim(seed);
      const s = sim.state;
      const call = s.calls.find((c) => c.leadCustomerId !== null && c.ringsAt < 3 * 3600);
      if (!call) continue;
      runUntil(sim, () => call.status === "missed");
      const vm = s.computer.voicemails.find((v) => v.callId === call.id)!;
      expect(vm.from).toBe(s.customers.find((c) => c.id === call.leadCustomerId)!.name);
      s.employee.task = null;
      expect(startTask(s, { type: "call_back", voicemailId: vm.id })).toBeNull();
      expect(s.employee.task!.duration).toBeGreaterThanOrEqual(call.talkSeconds);
      runUntil(sim, () => vm.calledBack);
      const lead = s.customers.find((c) => c.id === call.leadCustomerId)!;
      expect(lead.webOrderAt).not.toBeNull();
      return;
    }
    throw new Error("no seed with a quote lead");
  });
});

describe("the print queue", () => {
  it("jobs can be moved up and down, or taken back out", () => {
    const sim = quiet();
    const s = sim.state;
    const jobs: Job[] = [];
    for (let i = 0; i < 3; i++) {
      const c = customerWanting(sim, plain({ copies: 400 }));
      const job = takeOrder(sim, c);
      startTask(s, { type: "send_job", jobId: job.id, printerId: "bw" });
      runUntil(sim, () => job.status !== "unsent");
      jobs.push(job);
    }
    const q = s.printers[0].queue;
    expect(q).toEqual([jobs[1].id, jobs[2].id]); // the first one is printing
    startTask(s, { type: "move_job", jobId: jobs[2].id, dir: "up" });
    runUntil(sim, () => !s.employee.task);
    expect(s.printers[0].queue).toEqual([jobs[2].id, jobs[1].id]);
    startTask(s, { type: "cancel_job", jobId: jobs[1].id });
    runUntil(sim, () => !s.employee.task);
    expect(jobs[1].status).toBe("unsent");
    expect(s.printers[0].queue).toEqual([jobs[2].id]);
  });
});

describe("the bot uses the computer", () => {
  it("opens every online order and enters every order correctly", () => {
    const sim = createSim(5);
    const bot = createBot(10);
    while (!isShiftOver(sim.state)) {
      botAct(bot, sim.state, 1);
      tick(sim, 1);
    }
    const s = sim.state;
    const web = s.jobs.filter((j) => j.channel === "web");
    expect(web.length).toBeGreaterThan(0);
    expect(web.every((j) => j.opened)).toBe(true);
    for (const j of s.jobs) expect(jobMismatches(j)).toEqual([]);
  });
});
