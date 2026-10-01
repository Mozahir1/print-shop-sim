// The heart of the game. tick() advances the world by dt sim seconds.
// You are one employee. Everything you do is a short task at one of the stations.
// The UI and the bot both act through canStart()/startTask()/stopTask().

import type { CounterChoice, Customer, EventKind, Flag, GameState, Job, MessageDraft, Package, Station, Task, TaskRequest, TaskType } from "./types";
import { createRng, keyedRoll, randInt, type Rng } from "./rng";
import { ANSWER_WITHIN, DURATIONS, FINISH_SECONDS, MOOD, PACKING_FEE_CENTS, PRINTER, RESPOND_SECONDS, SHIPPING, SMUDGE_CHANCE, TUNING } from "./config";
import { counterMoodChange, leave, recordChoice, runPatience } from "./mood";
import { closeEvents, onPacked, resolveEvent, rollEvent, runEvents, wifiBack } from "./events";
import { createManager, deliver, onAnswer, onSmudgedHandedOver, onTapedBoxShipped, runConsequences } from "./consequences";
import { createJob, isPrintKind, shipPriceCents } from "./customers";
import { FINISHING_LABEL } from "./orders";
import { customerById, jobById, log, money, packageById } from "./util";
import { createDirector, runDirector } from "./director";
import { activeCount } from "./todo";
import { pickLine, POOLS } from "./lines";
import { answerLine, customerSay, mcSay } from "./mc";

// Separate random streams, so adding a system never changes what the others roll.
export interface SimRng {
  director: Rng; // who comes in and what they want
  supply: Rng; // the paper tray running out
  dev: Rng; // dev mode spawns, so they never shift the day's own rolls
  events: Rng; // the day's bad luck
}

export interface Sim {
  state: GameState;
  rng: SimRng;
}

// What carries over from yesterday (see game.ts). Everything else starts fresh each day.
export interface DayOptions {
  day?: number;
  nextId?: number;
  customers?: Customer[]; // people with orders still to pick up
  jobs?: Job[];
  packages?: Package[]; // outgoing packages that didn't go out
  heat?: number;
  flags?: Flag[];
  morning?: MessageDraft[]; // messages that arrive first thing
}

export function createSim(seed: number, opts: DayOptions = {}): Sim {
  const rng: SimRng = {
    director: createRng(seed),
    supply: createRng(seed ^ 0x9e3779b9),
    dev: createRng(seed ^ 0x27d4eb2f),
    events: createRng(seed ^ 0x61c88647),
  };
  const dayLength = TUNING.dayLength;
  const day = opts.day ?? 1;
  const arrivesAt = Math.round(dayLength * SHIPPING.truckArrives);
  const state: GameState = {
    seed,
    day,
    time: 0,
    closeAt: dayLength,
    revenueCents: 0,
    customers: opts.customers ?? [],
    jobs: opts.jobs ?? [],
    packages: opts.packages ?? [],
    printer: {
      status: "idle",
      queue: [],
      currentJobId: null,
      warmupLeft: 0,
      sheetsToday: 0,
      paperOutAt: rng.supply() < PRINTER.paperOutChance ? randInt(rng.supply, ...PRINTER.paperOutSheets) : Infinity,
    },
    copier: { status: "ok", sign: false },
    truck: { arrivesAt, leavesAt: arrivesAt + SHIPPING.truckWaits, status: "coming", handedOff: false },
    messages: [],
    heldMessages: [],
    event: rollEvent(rng.events, dayLength),
    cardReader: "ok",
    wifi: { down: false, backAt: 0 },
    choices: [],
    captions: [],
    manager: createManager(opts.heat ?? 0, opts.flags ?? []),
    director: createDirector(rng.director),
    employee: { task: null, busySeconds: 0 },
    log: [],
    nextId: opts.nextId ?? 1,
    nextLineNo: 1,
    stats: { served: 0, left: 0, happy: 0, neutral: 0, angry: 0, upsellsMissed: 0, ordersTaken: 0, webOrders: 0, sheets: 0, shipments: 0, dropoffs: 0, packagePickups: 0, jams: 0, idleSeconds: 0, activeSeconds: 0, maxActive: 0 },
    over: false,
    devUsed: false,
  };
  mcSay(state, "start_of_day");
  const note = pickLine(POOLS.messages, "corporate_note", {}, day - 1);
  state.messages.push({ id: state.nextId++, kind: "note", at: 0, subject: note.subject ?? "", body: note.text, jobId: null, read: false, snoozed: false });
  for (const d of opts.morning ?? []) deliver(state, d);
  log(state, `Day ${day}. Store open.`);
  return { state, rng };
}

export function isDayOver(state: GameState): boolean {
  return state.over;
}

// ---------- main loop ----------

export function tick(sim: Sim, dt: number): void {
  const { state } = sim;
  if (state.over) return;
  const wasOpen = state.time < state.closeAt;
  state.time += dt;
  if (wasOpen && state.time >= state.closeAt) log(state, "Closing time. No one else comes in.");
  runDirector(sim);
  runEvents(sim);
  updateEmployee(state, dt);
  runPatience(state, dt);
  runAnswerTimeouts(state);
  runConsequences(state);
  runPrinter(state, dt);
  runTruck(state);
  if (wasOpen) sampleLoad(state, dt);
  if (state.time >= state.closeAt) runClose(state);
}

function sampleLoad(state: GameState, dt: number): void {
  const n = activeCount(state);
  if (n === 0) state.stats.idleSeconds += dt;
  state.stats.activeSeconds += n * dt;
  state.stats.maxActive = Math.max(state.stats.maxActive, n);
}

// After close: finish up with whoever's inside. Once they're gone (or the wrap-up time is up), the day is over.
function runClose(state: GameState): void {
  const inside = state.customers.filter((c) => c.state === "line" || c.state === "talking" || c.state === "waiting");
  const wrapUpOver = state.time >= state.closeAt + TUNING.wrapUp;
  const busy = inside.length > 0 || state.employee.task !== null || state.truck.status !== "gone";
  if (busy && !wrapUpOver) return;
  for (const c of inside) leaveAtClose(state, c);
  closeEvents(state);
  state.employee.task = null;
  state.over = true;
  mcSay(state, "end_of_day");
  log(state, "That's the day.");
}

// Someone still inside at the very end goes home. An order they're waiting on is still theirs: they'll be back.
function leaveAtClose(state: GameState, c: Customer): void {
  const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
  if (job && job.status !== "picked_up") {
    c.state = "away";
    c.answerBy = null;
    return;
  }
  leave(state, c, "left");
}

// You started talking to someone and then didn't answer: that's ignoring them.
function runAnswerTimeouts(state: GameState): void {
  for (const c of state.customers) {
    if (c.state !== "talking" || c.answerBy === null || state.time < c.answerBy) continue;
    const t = state.employee.task;
    if (t?.type === "respond" && t.customerId === c.id) continue; // you're answering
    answer(state, c, "ignore", true);
  }
}

function updateEmployee(state: GameState, dt: number): void {
  const t = state.employee.task;
  if (!t) return;
  t.elapsed += dt;
  state.employee.busySeconds += dt;
  if (t.elapsed >= t.duration - 1e-9) {
    state.employee.task = null;
    completeTask(state, t);
  }
}

// ---------- the printer ----------

function runPrinter(state: GameState, dt: number): void {
  const p = state.printer;
  if (p.status === "jammed" || p.status === "tray_empty") return;
  if (p.currentJobId === null) {
    const next = p.queue.shift();
    if (next === undefined) {
      p.status = "idle";
      return;
    }
    p.currentJobId = next;
    p.warmupLeft = PRINTER.warmup;
    const starting = jobById(state, next)!;
    starting.status = "printing";
    starting.attempt++;
  }
  p.status = "printing";
  const job = jobById(state, p.currentJobId)!;
  let left = dt;
  if (p.warmupLeft > 0) {
    const w = Math.min(p.warmupLeft, left);
    p.warmupLeft -= w;
    left -= w;
  }
  if (left <= 0) return;
  const room = Math.max(0, p.paperOutAt - p.sheetsToday);
  const n = Math.min(PRINTER.sheetsPerSecond * left, job.sheets - job.sheetsPrinted, room);
  job.sheetsPrinted += n;
  p.sheetsToday += n;
  state.stats.sheets += n;
  if (job.sheetsPrinted >= job.sheets - 1e-9) {
    job.sheetsPrinted = job.sheets;
    job.status = "printed";
    if (keyedRoll(state.seed, "smudge", job.id, job.attempt) < SMUDGE_CHANCE) job.smudge = "found"; // you'll see it when you collect it
    p.currentJobId = null;
    p.status = p.queue.length ? "printing" : "idle";
    log(state, `Order #${job.id} finished printing.`);
  } else if (p.sheetsToday >= p.paperOutAt) {
    p.status = "tray_empty";
    log(state, "The printer stopped: tray empty.");
  }
}

// ---------- the truck ----------

// It arrives through the director (it waits for room); once here, it doesn't wait long.
function runTruck(state: GameState): void {
  const t = state.truck;
  if (t.status === "waiting" && state.time >= t.leavesAt) {
    t.status = "gone";
    log(state, "The truck left.");
    if (state.packages.some((p) => p.status === "binned")) recordChoice(state, "ignore", "truck");
  }
}

// ---------- your actions ----------

export const STATION: Record<TaskType, Station> = {
  talk: "counter",
  respond: "counter",
  hand_over: "counter",
  ring_up: "counter",
  manual_ring_up: "counter",
  fix_card_reader: "computer",
  restart_router: "computer",
  enter_order: "computer",
  send_job: "computer",
  open_message: "computer",
  leave_unread: "computer",
  collect: "printer",
  reprint: "printer",
  use_anyway: "printer",
  clear_jam: "printer",
  load_paper: "printer",
  finish: "finishing",
  bag: "finishing",
  help_self_serve: "self_serve",
  fix_copier: "self_serve",
  out_of_order_sign: "self_serve",
  weigh: "shipping",
  pack: "shipping",
  tape_shut: "shipping",
  label: "shipping",
  bin: "shipping",
  scan_dropoff: "shipping",
  find_package: "shipping",
  hand_off: "shipping",
  let_truck_go: "shipping",
};

// The customer at the front of the line: the one you're talking to, or would talk to next.
export function currentCustomer(state: GameState): Customer | undefined {
  return state.customers.filter((c) => c.state === "line" || c.state === "talking").sort((a, b) => a.lineTicket - b.lineTicket)[0];
}

function waitingCustomer(state: GameState, req: TaskRequest): Customer | string {
  const c = customerById(state, req.customerId ?? -1);
  if (!c) return "No such customer.";
  if (c.state === "line" || c.state === "talking") return `Talk to ${c.name} first.`;
  if (c.state !== "waiting") return `${c.name} isn't in the store.`;
  return c;
}

function jobFor(state: GameState, req: TaskRequest): Job | string {
  return jobById(state, req.jobId ?? -1) ?? "No such order.";
}

function packageFor(state: GameState, req: TaskRequest): Package | string {
  return packageById(state, req.packageId ?? -1) ?? "No such package.";
}

const SMUDGED = "Some of the copies came out smudged. Reprint it, or use them anyway.";

// Returns why you can't do this right now, or null if you can.
export function canStart(state: GameState, req: TaskRequest): string | null {
  if (state.over) return "The day is over.";
  const cur = state.employee.task;
  if (cur) return `You're busy: ${cur.label.toLowerCase()}.`;
  switch (req.type) {
    case "talk": {
      const c = customerById(state, req.customerId ?? -1);
      if (c?.state === "talking") return `You're already talking to ${c.name}.`;
      if (!c || c.state !== "line") return "They're not waiting to be helped.";
      if (currentCustomer(state)?.id !== c.id) return `${c.name} isn't at the front of the line.`;
      return null;
    }
    case "respond": {
      const c = customerById(state, req.customerId ?? -1);
      if (!c || c.state !== "talking") return "You're not talking to them.";
      return req.choice ? null : "Answer how?";
    }
    case "hand_over":
    case "ring_up":
    case "manual_ring_up": {
      if (req.type === "ring_up" && state.cardReader === "down") return "The card reader is down. Ring them up by hand, or fix the reader.";
      if (req.type === "manual_ring_up" && state.cardReader === "ok") return "The card reader works.";
      const c = waitingCustomer(state, req);
      if (typeof c === "string") return c;
      if (c.kind === "package_pickup") {
        if (req.type === "ring_up") return "Held packages are already paid for. Hand it over.";
        const pkg = packageById(state, c.packageId!)!;
        return pkg.status === "found" ? null : `Find ${c.name}'s package first.`;
      }
      const job = c.jobId === null ? undefined : jobById(state, c.jobId);
      if (!job) return `${c.name} has no order to pick up.`;
      if (job.status !== "bagged") return `Order #${job.id} isn't ready yet.`;
      if (req.type !== "hand_over" && job.prepaid) return `Order #${job.id} was paid online. Hand it over.`;
      if (req.type === "hand_over" && !job.prepaid) return `Order #${job.id} hasn't been paid for. Ring it up.`;
      return null;
    }
    case "enter_order": {
      const job = jobFor(state, req);
      if (typeof job === "string") return job;
      return job.status === "new" ? null : `Order #${job.id} is already in the computer.`;
    }
    case "send_job": {
      const job = jobFor(state, req);
      if (typeof job === "string") return job;
      if (job.status === "new") return `Enter order #${job.id} first.`;
      if (job.status === "unread") return `Open web order #${job.id} in the inbox first.`;
      return job.status === "entered" ? null : `Order #${job.id} was already sent.`;
    }
    case "open_message":
    case "leave_unread": {
      const m = state.messages.find((x) => x.id === req.messageId);
      if (!m) return "No such message.";
      if (m.read) return "You already read that.";
      if (req.type === "leave_unread" && (m.kind !== "web_order" || m.snoozed)) return "It's already sitting there unread.";
      return null;
    }
    case "collect": {
      const job = jobFor(state, req);
      if (typeof job === "string") return job;
      return job.status === "printed" ? null : `Order #${job.id} isn't waiting at the printer.`;
    }
    case "reprint":
    case "use_anyway": {
      const job = jobFor(state, req);
      if (typeof job === "string") return job;
      return job.status === "collected" && job.smudge === "found" ? null : `Order #${job.id} came out fine.`;
    }
    case "clear_jam":
      return state.printer.status === "jammed" ? null : "The printer isn't jammed.";
    case "load_paper":
      return state.printer.status === "tray_empty" ? null : "The tray isn't empty.";
    case "fix_card_reader":
      return state.cardReader === "down" ? null : "The card reader works.";
    case "restart_router":
      return state.wifi.down ? null : "The Wi-Fi is fine.";
    case "finish": {
      const job = jobFor(state, req);
      if (typeof job === "string") return job;
      if (job.spec.finishing === "none") return `Order #${job.id} doesn't need finishing.`;
      if (job.status === "collected" && job.smudge === "found") return SMUDGED;
      return job.status === "collected" ? null : `Order #${job.id} isn't on the finishing table.`;
    }
    case "bag": {
      const job = jobFor(state, req);
      if (typeof job === "string") return job;
      if (job.status === "collected" && job.smudge === "found") return SMUDGED;
      if (job.status === "collected" && job.spec.finishing !== "none") return `Order #${job.id} needs to be ${FINISHING_LABEL[job.spec.finishing].toLowerCase()}d first.`;
      return job.status === "collected" || job.status === "finished" ? null : `Order #${job.id} isn't on the finishing table.`;
    }
    case "help_self_serve": {
      const c = waitingCustomer(state, req);
      if (typeof c === "string") return c;
      if (c.kind !== "self_serve_help") return `${c.name} isn't here about self-serve.`;
      if (state.copier.status === "broken" && !state.copier.sign) return "The copier is broken. Fix it, or put an out of order sign on it.";
      return null;
    }
    case "fix_copier":
      return state.copier.status === "broken" ? null : "The copier is working.";
    case "out_of_order_sign":
      if (state.copier.status !== "broken") return "The copier is working.";
      return state.copier.sign ? "There's already a sign on it." : null;
    case "weigh":
    case "pack":
    case "tape_shut":
    case "label":
    case "bin": {
      const pkg = packageFor(state, req);
      if (typeof pkg === "string") return pkg;
      const need = { weigh: ["new"], pack: ["weighed"], tape_shut: ["weighed"], label: ["packed"], bin: ["labeled", "scanned"] }[req.type];
      if (need.includes(pkg.status)) return null;
      return `Package #${pkg.id} isn't ready for that (${pkg.status}).`;
    }
    case "scan_dropoff": {
      const c = waitingCustomer(state, req);
      if (typeof c === "string") return c;
      return c.kind === "dropoff" ? null : `${c.name} isn't dropping anything off.`;
    }
    case "find_package": {
      const c = waitingCustomer(state, req);
      if (typeof c === "string") return c;
      if (c.kind !== "package_pickup") return `${c.name} isn't here for a package.`;
      return packageById(state, c.packageId!)!.status === "held" ? null : "You already found it.";
    }
    case "hand_off":
    case "let_truck_go":
      return state.truck.status === "waiting" ? null : "The truck isn't here.";
  }
}

export function startTask(state: GameState, req: TaskRequest): string | null {
  const err = canStart(state, req);
  if (err) return err;
  state.employee.task = buildTask(state, req);
  return null;
}

// Drops what you're doing. Tasks are short, so there's no partial progress to keep.
export function stopTask(state: GameState): void {
  state.employee.task = null;
}

// What a request would turn into (label, duration), without starting it. Only valid when canStart() is null.
export function previewTask(state: GameState, req: TaskRequest): Task {
  return buildTask(state, req);
}

export function taskDuration(state: GameState, req: TaskRequest): number {
  if (req.type === "finish") {
    const f = jobById(state, req.jobId!)!.spec.finishing;
    return f === "none" ? 0 : FINISH_SECONDS[f];
  }
  if (req.type === "respond") return RESPOND_SECONDS[req.choice!];
  return DURATIONS[req.type];
}

function buildTask(state: GameState, req: TaskRequest): Task {
  return { ...req, label: taskLabel(state, req), station: STATION[req.type], duration: taskDuration(state, req), elapsed: 0 };
}

export function taskLabel(state: GameState, req: TaskRequest): string {
  const name = req.customerId !== undefined ? customerById(state, req.customerId)?.name ?? "" : "";
  const job = req.jobId !== undefined ? `order #${req.jobId}` : "";
  const pkg = req.packageId !== undefined ? `package #${req.packageId}` : "";
  switch (req.type) {
    case "talk":
      return `Talk to ${name}`;
    case "respond":
      return `Answer ${name}`;
    case "hand_over":
      return `Hand over to ${name}`;
    case "ring_up":
      return `Ring up ${name}`;
    case "manual_ring_up":
      return `Ring up ${name} by hand`;
    case "fix_card_reader":
      return "Fix the card reader";
    case "restart_router":
      return "Restart the router";
    case "enter_order":
      return `Enter ${job}`;
    case "send_job":
      return `Send ${job} to the printer`;
    case "open_message":
      return `Open "${state.messages.find((m) => m.id === req.messageId)?.subject ?? "message"}"`;
    case "leave_unread":
      return `Leave "${state.messages.find((m) => m.id === req.messageId)?.subject ?? "it"}" unread`;
    case "collect":
      return `Collect ${job}`;
    case "reprint":
      return `Reprint ${job}`;
    case "use_anyway":
      return `Use the smudged copies of ${job}`;
    case "clear_jam":
      return "Clear the jam";
    case "load_paper":
      return "Load paper";
    case "finish": {
      const f = jobById(state, req.jobId!)?.spec.finishing ?? "none";
      return `${FINISHING_LABEL[f]} ${job}`;
    }
    case "bag":
      return `Bag ${job}`;
    case "help_self_serve":
      return `Help ${name} at self-serve`;
    case "fix_copier":
      return "Fix the copier";
    case "out_of_order_sign":
      return "Tape an out of order sign on the copier";
    case "weigh":
      return `Weigh ${pkg}`;
    case "pack":
      return `Pack ${pkg}`;
    case "tape_shut":
      return `Just tape ${pkg} shut`;
    case "label":
      return `Print the label for ${pkg}`;
    case "bin":
      return `Put ${pkg} in the outbound bin`;
    case "scan_dropoff":
      return `Scan ${name}'s drop-off`;
    case "find_package":
      return `Find ${name}'s package`;
    case "hand_off":
      return "Hand off to the driver";
    case "let_truck_go":
      return "Let the driver leave";
  }
}

// ---------- what each task does when it's done ----------

function completeTask(state: GameState, t: Task): void {
  const c = t.customerId !== undefined ? customerById(state, t.customerId) : undefined;
  const job = t.jobId !== undefined ? jobById(state, t.jobId) : undefined;
  const pkg = t.packageId !== undefined ? packageById(state, t.packageId) : undefined;
  switch (t.type) {
    case "talk":
      mcSay(state, "greeting");
      customerSay(c!, "request");
      c!.state = "talking";
      c!.answerBy = state.time + ANSWER_WITHIN;
      return;
    case "respond":
      if (c!.state === "talking") answer(state, c!, t.choice!, false);
      return;
    case "hand_over":
    case "ring_up":
    case "manual_ring_up": {
      if (c!.state !== "waiting") return; // they gave up while you were getting it
      if (c!.kind === "package_pickup") {
        packageById(state, c!.packageId!)!.status = "picked_up";
        state.stats.packagePickups++;
        log(state, `Handed ${c!.name} their package.`);
        return leave(state, c!, "served");
      }
      const j = jobById(state, c!.jobId!)!;
      j.status = "picked_up";
      j.closedAt = state.time;
      if (j.smudge === "accepted") {
        c!.mood += MOOD.lazyNoticed; // they look through it
        onSmudgedHandedOver(state, c!);
      }
      if (t.type !== "hand_over") {
        state.revenueCents += j.priceCents;
        log(state, `Rang up ${c!.name}: ${money(j.priceCents)}.`);
      } else log(state, `Handed ${c!.name} order #${j.id}.`);
      return leave(state, c!, "served");
    }
    case "enter_order":
      job!.status = "entered";
      return;
    case "send_job":
      job!.status = "queued";
      state.printer.queue.push(job!.id);
      return;
    case "open_message": {
      const m = state.messages.find((x) => x.id === t.messageId)!;
      m.read = true;
      const j = m.jobId !== null ? jobById(state, m.jobId) : undefined;
      if (m.kind === "web_order" && j?.status === "unread") {
        j.status = "entered";
        state.revenueCents += j.priceCents; // paid online
        if (!m.snoozed) recordChoice(state, "proper", "inbox", j.customerId); // opening it once they're here doesn't count
        log(state, `Opened web order #${j.id}.`);
      }
      return;
    }
    case "leave_unread": {
      const m = state.messages.find((x) => x.id === t.messageId)!;
      m.snoozed = true;
      mcSay(state, "lazy");
      recordChoice(state, "lazy", "inbox", m.jobId !== null ? jobById(state, m.jobId)?.customerId : undefined);
      return;
    }
    case "collect":
      job!.status = "collected";
      if (job!.smudge === "found") log(state, `Some of order #${job!.id} came out smudged.`);
      return;
    case "reprint":
      job!.status = "queued";
      job!.sheetsPrinted = 0;
      job!.smudge = "none";
      state.printer.queue.push(job!.id);
      recordChoice(state, "proper", "smudge", job!.customerId);
      return;
    case "use_anyway":
      job!.smudge = "accepted";
      mcSay(state, "lazy");
      recordChoice(state, "lazy", "smudge", job!.customerId);
      return;
    case "clear_jam":
      state.printer.status = state.printer.currentJobId !== null ? "printing" : "idle";
      fixedEvent(state, "printer_jam");
      log(state, "Cleared the jam.");
      return;
    case "fix_card_reader":
      state.cardReader = "ok";
      fixedEvent(state, "card_reader_down");
      log(state, "The card reader works again.");
      return;
    case "restart_router":
      recordChoice(state, "proper", "event");
      wifiBack(state, true);
      return;
    case "load_paper":
      state.printer.paperOutAt = Infinity;
      state.printer.status = state.printer.currentJobId !== null ? "printing" : "idle";
      log(state, "Loaded paper.");
      return;
    case "finish":
      job!.status = "finished";
      return;
    case "bag":
      job!.status = "bagged";
      log(state, `Order #${job!.id} is bagged and ready.`);
      return;
    case "help_self_serve":
      if (c!.state !== "waiting") return;
      if (state.copier.status === "broken") {
        c!.mood += MOOD.lazyNoticed; // pointed at the sign
        log(state, `Pointed ${c!.name} at the out of order sign.`);
      } else log(state, `Helped ${c!.name} at self-serve.`);
      return leave(state, c!, "served");
    case "fix_copier":
      state.copier.status = "ok";
      state.copier.sign = false;
      recordChoice(state, "proper", "copier");
      resolveEvent(state, "copier_dies", "fixed");
      log(state, "Fixed the copier.");
      return;
    case "out_of_order_sign":
      state.copier.sign = true;
      mcSay(state, "lazy");
      recordChoice(state, "lazy", "copier");
      resolveEvent(state, "copier_dies", "worked_around");
      log(state, "Taped an out of order sign on the copier.");
      return;
    case "weigh":
      pkg!.status = "weighed";
      return;
    case "pack":
    case "tape_shut": {
      pkg!.status = "packed";
      if (onPacked(state, pkg!)) return; // ripped: pack it again
      resolveEvent(state, "box_rips", t.type === "pack" ? "fixed" : "worked_around");
      const owner = customerById(state, pkg!.customerId);
      if (t.type === "tape_shut") {
        pkg!.taped = true;
        mcSay(state, "lazy");
        if (owner?.state === "waiting") owner.mood += MOOD.lazyNoticed; // they're standing right there
      }
      recordChoice(state, t.type === "pack" ? "proper" : "lazy", "pack", pkg!.customerId);
      return;
    }
    case "label": {
      pkg!.status = "labeled";
      state.revenueCents += pkg!.priceCents;
      state.stats.shipments++;
      const owner = customerById(state, pkg!.customerId)!;
      log(state, `Shipped ${owner.name}'s package: ${money(pkg!.priceCents)}.`);
      if (pkg!.taped) onTapedBoxShipped(state, pkg!.id, owner.name);
      if (owner.state === "waiting") leave(state, owner, "served");
      return;
    }
    case "bin":
      pkg!.status = "binned";
      return;
    case "scan_dropoff": {
      if (c!.state !== "waiting") return;
      const id = state.nextId++;
      state.packages.push({ id, customerId: c!.id, kind: "dropoff", weightLb: 2, priceCents: 0, status: "scanned", taped: false });
      state.stats.dropoffs++;
      log(state, `Scanned ${c!.name}'s drop-off.`);
      return leave(state, c!, "served");
    }
    case "find_package":
      packageById(state, c!.packageId!)!.status = "found";
      return;
    case "hand_off": {
      const out = state.packages.filter((p) => p.status === "binned");
      for (const p of out) p.status = "shipped";
      state.truck.handedOff = true;
      state.truck.status = "gone";
      recordChoice(state, "proper", "truck");
      log(state, `Handed ${out.length} package${out.length === 1 ? "" : "s"} to the driver.`);
      return;
    }
    case "let_truck_go":
      state.truck.status = "gone";
      recordChoice(state, "lazy", "truck");
      mcSay(state, "lazy");
      log(state, "Let the driver leave.");
      return;
  }
}

// Dealt with today's bad luck properly.
function fixedEvent(state: GameState, kind: EventKind): void {
  if (state.event?.kind !== kind || state.event.status !== "active") return;
  resolveEvent(state, kind, "fixed");
  recordChoice(state, "proper", "event");
}

// Your answer to the customer at the counter. Anything but ignoring them means you take on what they need.
export function answer(state: GameState, c: Customer, choice: CounterChoice, auto: boolean): void {
  state.captions.push({ time: state.time, moment: choice, text: answerLine(state, c, choice) }); // what the button said
  c.mood += counterMoodChange(state, c, choice);
  c.choices++;
  c.answerBy = null;
  recordChoice(state, choice, "counter", c.id, auto);
  onAnswer(state, c, choice);
  if (choice === "ignore") {
    c.ignored++;
    c.state = "line"; // still standing there
    return;
  }
  if ((choice === "minimum" || choice === "rude") && (isPrintKind(c.kind) || c.kind === "ship")) state.stats.upsellsMissed++;
  takeRequest(state, c);
}

// You find out what they need and take it on.
function takeRequest(state: GameState, c: Customer): void {
  c.state = "waiting";
  if (c.kind === "complaint") {
    log(state, `Heard ${c.name} out.`);
    return leave(state, c, "served");
  }
  if (isPrintKind(c.kind)) {
    const job = createJob(state, c, "counter");
    state.stats.ordersTaken++;
    if (!c.waits) c.state = "away";
    log(state, `Took ${c.name}'s order #${job.id}${c.waits ? "" : ". They'll be back for it"}.`);
  } else if (c.kind === "ship") {
    c.packageId = state.nextId++;
    state.packages.push({ id: c.packageId, customerId: c.id, kind: "ship", weightLb: c.weightLb, priceCents: shipPriceCents(c.weightLb) + PACKING_FEE_CENTS, status: "new", taped: false });
  }
}
