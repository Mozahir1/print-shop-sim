// The heart of the game. tick() advances the world by dt sim seconds.
// You are one employee. Everything you do is a short task at one of the stations.
// The UI and the bot both act through canStart()/startTask()/stopTask().

import type { CounterAction, Customer, EventKind, Workflow, WorkflowKind, Flag, GameState, Job, MessageDraft, Package, Station, Task, TaskRequest, TaskType } from "./types";
import { createRng, keyedRoll, randInt, type Rng } from "./rng";
import { ANSWER_WITHIN, CLOSING, SALES, DURATIONS, MOOD, PRINTER, REACTIONS, RESPOND_MINUTES, SHIPPING, SMUDGE_CHANCE, STANDARD_LEAD, TUNING } from "./config";
import { choiceType, leave, recordChoice, resetPatience, runPatience } from "./mood";
import { quoteFor, type CounterQuote } from "./quote";
import { formatClock } from "./time";
import { finishMinutes, selfServePriceCents, selfServeSeconds, walkUpMinutes } from "./orders";
import { ALT_OF, STEP, WORKFLOWS, currentStep, isChoice, isCurrentStep, lockMessage, workflowFor } from "./workflow";
import { recordFailure } from "./failures";
import { closeEvents, onPacked, resolveEvent, rollEvent, runEvents, wifiBack } from "./events";
import { addHeat, lostBusiness, createManager, deliver, onIgnore, onLate, onSmudgedHandedOver, onTapedBoxShipped, onTurnAway, onUnfinished, runConsequences } from "./consequences";
import { createJob, createShipment, isPrintKind, morningTime, weighted } from "./customers";
import { FINISHING_LABEL } from "./orders";
import { customerById, isOverdue, jobById, log, money, packageById } from "./util";
import { createDirector, refundArrival, runDirector } from "./director";
import { activeCount } from "./todo";
import { pickLine, POOLS } from "./lines";
import { customerSay, mcSay, type Reaction } from "./mc";

// Separate random streams, so adding a system never changes what the others roll.
export interface SimRng {
  director: Rng; // who comes in and what they want
  supply: Rng; // the paper tray running out
  dev: Rng; // dev mode spawns, so they never shift the day's own rolls
  events: Rng; // the day's bad luck
  business: Rng; // when business clients come in
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
    business: createRng(seed ^ 0x2545f491),
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
    failures: [],
    workflow: null,
    wentHome: null,
    captions: [],
    manager: createManager(opts.heat ?? 0, opts.flags ?? []),
    director: createDirector(rng.director, rng.business, dayLength),
    employee: { task: null, busySeconds: 0 },
    log: [],
    nextId: opts.nextId ?? 1,
    nextLineNo: 1,
    stats: { served: 0, left: 0, happy: 0, neutral: 0, angry: 0, selfServed: 0, selfServeCents: 0, turnedAway: 0, lostSales: 0, lostSalesCents: 0, balked: 0, rushOrders: 0, lateOrders: 0, refundsCents: 0, surveys: 0, badSurveys: 0, businessWon: 0, businessLost: 0, ordersTaken: 0, webOrders: 0, sheets: 0, shipments: 0, dropoffs: 0, packagePickups: 0, jams: 0, idleSeconds: 0, activeSeconds: 0, maxActive: 0 },
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
  if (wasOpen && state.time >= state.closeAt) closeTheStore(state);
  runDirector(sim);
  runEvents(sim);
  updateEmployee(state, dt);
  runPatience(state, dt);
  runAnswerTimeouts(state);
  runConsequences(state);
  runPrinter(state, dt);
  runSelfServe(state);
  runTruck(state);
  if (wasOpen) sampleLoad(state, dt);
  if (!wasOpen) runOvertime(state);
}

function sampleLoad(state: GameState, dt: number): void {
  const n = activeCount(state);
  if (n === 0) state.stats.idleSeconds += dt;
  state.stats.activeSeconds += n * dt;
  state.stats.maxActive = Math.max(state.stats.maxActive, n);
}

// ---------- closing time ----------

// 5 PM: the door's locked. People in line head out (now and then one stays anyway); people waiting on an order stay
// until it's done or you show them out. The day ends when you go home (goHome).
function closeTheStore(state: GameState): void {
  log(state, "Closing time. No one else comes in.");
  mcSay(state, "closing");
  let lingerer = false;
  for (const c of state.customers) {
    if (c.state !== "line" && c.state !== "talking") continue;
    if (state.workflow?.customerId === c.id) continue; // you're helping them
    if (!lingerer && keyedRoll(state.seed, "linger", c.id) < CLOSING.lingerChance) {
      lingerer = true;
      c.lingering = true;
      customerSay(c, "linger", {}, state.time);
      log(state, `${c.name} isn't leaving.`);
      continue;
    }
    customerSay(c, "closed", {}, state.time);
    leave(state, c, "closed");
  }
}

// After close the MC wants to go home, and says so. Eventually the manager locks up and sends you home.
function runOvertime(state: GameState): void {
  const over = state.time - state.closeAt;
  if (over > CLOSING.onTimeGrace && over % CLOSING.overtimeLineEvery < 1) mcSay(state, "overtime");
  if (over >= CLOSING.sentHomeAfter) goHome(state, true);
}

// What you'd be leaving behind if you went home now.
export function workLeft(state: GameState): string[] {
  const left: string[] = [];
  for (const c of state.customers) if (c.state === "line" || c.state === "talking" || c.state === "waiting") left.push(`${c.name} still in the store`);
  for (const j of state.jobs) {
    const owner = customerById(state, j.customerId);
    if (j.dueDay <= state.day && !["bagged", "picked_up", "canceled"].includes(j.status) && owner?.state !== "gone") left.push(`order #${j.id} not done`);
  }
  for (const p of state.packages) if (p.status === "labeled" || p.status === "scanned") left.push(`package #${p.id} not in the bin`);
  if (state.event?.status === "active") left.push("today's problem not dealt with");
  return left;
}

export function canGoHome(state: GameState): string | null {
  if (state.over) return "You already went home.";
  return state.time < state.closeAt ? "It's not closing time yet." : null;
}

// Go home: the day is over. Leaving on time with everything done is rewarded; overtime annoys the manager; anything
// left undone is penalized (and orders due today count as late).
export function goHome(state: GameState, sentHome = false): string | null {
  const err = canGoHome(state);
  if (err) return err;
  const left = workLeft(state);
  const overtime = state.time - state.closeAt;
  const onTime = !sentHome && left.length === 0 && overtime <= CLOSING.onTimeGrace;
  state.employee.task = null;
  state.workflow = null;
  for (const c of state.customers) if (c.state === "self_serve") finishSelfServe(state, c);
  for (const c of state.customers) if (c.state === "line" || c.state === "talking" || c.state === "waiting") showOut(state, c);
  closeEvents(state);
  for (const j of state.jobs) {
    const owner = customerById(state, j.customerId);
    if (j.dueDay <= state.day && !j.late && !["bagged", "picked_up", "canceled"].includes(j.status) && owner?.state !== "gone") {
      onUnfinished(state, j);
      recordFailure(state, "late_order", { name: owner?.name ?? "a customer", job: j.id }, { customerId: owner?.id, jobId: j.id });
    }
  }
  const extra = Math.max(0, overtime - CLOSING.onTimeGrace);
  if (extra > 0) addHeat(state, (extra / 10) * CLOSING.overtimeHeatPer10Min, "overtime");
  if (left.length) {
    addHeat(state, left.length * CLOSING.leftUndoneHeat, "ignoring");
    recordFailure(state, "left_work", { count: `${left.length} thing${left.length === 1 ? "" : "s"}` });
  }
  if (onTime) addHeat(state, -CLOSING.onTimeReward, "complaints");
  // Sales against the day's target.
  const short = SALES.targetCents - state.revenueCents;
  if (short > 0) addHeat(state, Math.ceil(short / 2500) * SALES.shortfallHeatPer25, "lost_sales");
  else if (state.revenueCents >= SALES.strongDayCents) addHeat(state, -SALES.strongDayCool, "complaints");
  state.wentHome = { at: state.time, onTime, overtime, leftUndone: left, sentHome };
  state.over = true;
  if (sentHome) {
    mcSay(state, "sent_home");
    log(state, "The manager locks up and sends you home.");
  } else if (onTime) mcSay(state, "on_time");
  mcSay(state, "end_of_day");
  log(state, "That's the day.");
  return null;
}

// Someone's shown out (or leaves because you went home). An order they're waiting on is still theirs: they'll be
// back for it.
function showOut(state: GameState, c: Customer): void {
  c.lingering = false;
  c.answerBy = null;
  c.mood += MOOD.turnedAway;
  const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
  if (job && !["picked_up", "canceled"].includes(job.status)) {
    c.state = "away";
    return;
  }
  leave(state, c, "closed");
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

// ---------- self-serve ----------

function runSelfServe(state: GameState): void {
  for (const c of state.customers) {
    if (c.state !== "self_serve") continue;
    if (state.copier.status === "broken") {
      // It died on them: they give up on it (they got some of their copies).
      c.mood += MOOD.turnedAway;
      c.selfServeUntil = null;
      leave(state, c, "balked");
      log(state, `${c.name} gave up on the dead copier.`);
    } else if (state.time >= (c.selfServeUntil ?? 0)) finishSelfServe(state, c);
  }
}

function finishSelfServe(state: GameState, c: Customer): void {
  const cents = selfServePriceCents(c.spec!);
  state.revenueCents += cents;
  state.stats.selfServed++;
  state.stats.selfServeCents += cents;
  c.selfServeUntil = null;
  leave(state, c, "served");
}

// Sends someone to the self-serve copier (they agreed to go, or went on their own).
export function startSelfServe(state: GameState, c: Customer): void {
  c.state = "self_serve";
  c.answerBy = null;
  c.selfServeUntil = state.time + selfServeSeconds(c.spec!);
  log(state, `${c.name} is using the self-serve copier.`);
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
  const n = Math.min(PRINTER.sheetsPerMinute * left, job.sheets - job.sheetsPrinted, room);
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
    truckGone(state);
  }
}

// Whatever's still in the outbound bin when the truck goes is a failure you see right then.
function truckGone(state: GameState): void {
  const left = state.packages.filter((p) => p.status === "binned").length;
  if (left) recordFailure(state, "packages_left", { count: `${left} package${left === 1 ? " was" : "s were"}` });
}

// ---------- your actions ----------

// Where each step happens (from the workflow data).
export const STATION = Object.fromEntries(Object.entries(STEP).map(([k, v]) => [k, v.station])) as Record<TaskType, Station>;

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
  if (cur) return lockMessage(cur.type);
  // Strict lock: in the middle of a workflow, only its current step (or that step's alternatives) can start.
  if (state.workflow) {
    const step = currentStep(state);
    if (step && !isCurrentStep(state, req)) return lockMessage(step.type);
  }
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
      if (!req.choice) return "Answer how?";
      return actionBlocker(state, c, req.choice);
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
    case "usher_out": {
      const c = customerById(state, req.customerId ?? -1);
      if (state.time < state.closeAt) return "The store's still open.";
      if (!c || !["line", "talking", "waiting"].includes(c.state)) return "They're not in the store.";
      return null;
    }
    case "make_copies": {
      const job = jobFor(state, req);
      if (typeof job === "string") return job;
      return job.walkUp && job.status === "new" ? null : `Order #${job.id} isn't a job to make here.`;
    }
    case "escort": {
      const c = waitingCustomer(state, req);
      if (typeof c === "string") return c;
      return c.goingToSelfServe ? null : `${c.name} isn't going to self-serve.`;
    }
    case "make_good": {
      const c = waitingCustomer(state, req);
      if (typeof c === "string") return c;
      return c.kind === "complaint" ? null : `${c.name} isn't here about a problem.`;
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
    case "tape":
    case "tape_shut":
    case "label":
    case "bin": {
      const pkg = packageFor(state, req);
      if (typeof pkg === "string") return pkg;
      const need = { weigh: ["new"], pack: ["weighed"], tape: ["boxed"], tape_shut: ["weighed"], label: ["packed"], bin: ["labeled", "scanned"] }[req.type];
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
  if (!state.workflow) state.workflow = workflowFor(state, req);
  state.employee.task = buildTask(state, req);
  return null;
}

// Drops the step you're on (you're still in the workflow). Steps are short: there's no partial progress to keep.
export function stopTask(state: GameState): void {
  state.employee.task = null;
}

// Walks away from the workflow you're in. That's ignoring whoever (or whatever) it was for, with the usual
// consequences: a customer keeps waiting (and loses patience), a problem stays a problem.
export function abandonWorkflow(state: GameState): string | null {
  const wf = state.workflow;
  if (!wf) return "You're not in the middle of anything.";
  state.employee.task = null;
  const c = wf.customerId !== undefined ? customerById(state, wf.customerId) : undefined;
  state.workflow = null;
  if (c?.state === "talking") {
    answer(state, c, "ignore", false);
    return null;
  }
  if (c && (c.state === "waiting" || c.state === "line")) {
    c.ignored++;
    c.mood += MOOD.ignored;
    onIgnore(state);
  }
  recordChoice(state, "ignore", "work", c?.id);
  log(state, `Walked away from ${WORKFLOWS[wf.kind].label.toLowerCase()}.`);
  return null;
}

// After a step: move on to the next one by itself, unless there's a choice to make there. A workflow ends when its
// steps are done, or when the next one can't happen now (they left, it's back in the printer, ...).
function advanceWorkflow(state: GameState, done: TaskType): void {
  const wf = state.workflow;
  if (!wf || state.over) return;
  wf.done.push(done);
  const stands = ALT_OF[done];
  if (stands) wf.done.push(stands);
  const step = currentStep(state);
  if (!step) {
    state.workflow = null;
    return;
  }
  const free = canStart(state, step.req) === null || step.alts.some((a) => canStart(state, a) === null) || (step.type === "respond" && customerById(state, step.req.customerId!)?.state === "talking");
  if (!free) {
    state.workflow = null;
    return;
  }
  if (!isChoice(step)) startTask(state, step.req);
}

// What a request would turn into (label, duration), without starting it. Only valid when canStart() is null.
export function previewTask(state: GameState, req: TaskRequest): Task {
  return buildTask(state, req);
}

export function taskDuration(state: GameState, req: TaskRequest): number {
  if (req.type === "finish") return finishMinutes(jobById(state, req.jobId!)!.spec);
  if (req.type === "make_copies") return walkUpMinutes(jobById(state, req.jobId!)!.spec);
  if (req.type === "respond") {
    // Writing up a print order takes a couple of minutes; saying "sure" to anything else doesn't.
    const c = customerById(state, req.customerId!);
    return c && isPrintKind(c.kind) ? RESPOND_MINUTES[req.choice!] : 1;
  }
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
    case "escort":
      return `Show ${name} the copier`;
    case "make_copies":
      return `Make the copies for ${job}`;
    case "usher_out":
      return `Show ${name} out`;
    case "make_good":
      return `File a claim for ${name}`;
    case "tape":
      return `Tape ${pkg}`;
    case "respond":
      return ACTION_LABEL[req.choice ?? "take"].replace("{name}", name);
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
      return `Box ${pkg}`;
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
  runStep(state, t);
  advanceWorkflow(state, t.type);
}

function runStep(state: GameState, t: Task): void {
  const c = t.customerId !== undefined ? customerById(state, t.customerId) : undefined;
  const job = t.jobId !== undefined ? jobById(state, t.jobId) : undefined;
  const pkg = t.packageId !== undefined ? packageById(state, t.packageId) : undefined;
  switch (t.type) {
    case "talk": {
      mcSay(state, "greeting");
      const theirs = c!.jobId !== null ? jobById(state, c!.jobId) : undefined;
      if (c!.kind === "order_pickup" && theirs && theirs.status !== "bagged") {
        customerSay(c!, "request", { scene: "missing_order" }, state.time); // "Where's my order?"
        recordFailure(state, "missing_order", { name: c!.name, job: theirs.id }, { customerId: c!.id, jobId: theirs.id });
      } else if (c!.kind === "self_serve_help" && state.copier.status === "broken") {
        customerSay(c!, "request", { scene: "copier_broken" }, state.time);
        recordFailure(state, "copier_broken", { name: c!.name }, { customerId: c!.id });
      } else customerSay(c!, "request", {}, state.time);
      c!.state = "talking";
      c!.answerBy = state.time + ANSWER_WITHIN;
      return;
    }
    case "make_copies":
      job!.status = "bagged";
      job!.sheetsPrinted = job!.sheets;
      state.stats.sheets += job!.sheets;
      log(state, `Made the copies for order #${job!.id}.`);
      return;
    case "usher_out":
      if (!["line", "talking", "waiting"].includes(c!.state)) return;
      customerSay(c!, "ushered", {}, state.time);
      log(state, `Showed ${c!.name} out.`);
      return showOut(state, c!);
    case "escort":
      c!.goingToSelfServe = false;
      refundArrival(state, c!);
      startSelfServe(state, c!);
      return;
    case "make_good":
      c!.mood = Math.max(c!.mood, 0); // sorted out
      log(state, `Sorted out ${c!.name}'s damaged package.`);
      return leave(state, c!, "served");
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
        c!.mood += MOOD.badWork; // they look through it
        onSmudgedHandedOver(state, c!);
      }
      if (j.late) c!.mood += MOOD.late;
      if (t.type === "manual_ring_up" && state.event?.kind === "card_reader_down" && state.event.status === "active") {
        resolveEvent(state, "card_reader_down", "worked_around"); // you'll keep doing it by hand
        recordChoice(state, "dont", "event");
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
      queueJob(state, job!);
      return;
    case "open_message": {
      const m = state.messages.find((x) => x.id === t.messageId)!;
      m.read = true;
      const j = m.jobId !== null ? jobById(state, m.jobId) : undefined;
      if (m.kind === "web_order" && j?.status === "unread") {
        j.status = "entered";
        state.revenueCents += j.priceCents; // paid online
        if (!m.snoozed) recordChoice(state, "do", "inbox", j.customerId); // opening it once they're here doesn't count
        log(state, `Opened web order #${j.id}.`);
      }
      return;
    }
    case "leave_unread": {
      const m = state.messages.find((x) => x.id === t.messageId)!;
      m.snoozed = true;
      recordChoice(state, "ignore", "inbox", m.jobId !== null ? jobById(state, m.jobId)?.customerId : undefined);
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
      queueJob(state, job!);
      recordChoice(state, "do", "smudge", job!.customerId);
      return;
    case "use_anyway":
      job!.smudge = "accepted";
      recordChoice(state, "dont", "smudge", job!.customerId);
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
      recordChoice(state, "do", "event");
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
      if (isOverdue(state, job!) && !job!.late) {
        onLate(state, job!);
        const owner = customerById(state, job!.customerId);
        recordFailure(state, "late_order", { name: owner?.name ?? "a customer", job: job!.id }, { customerId: owner?.id, jobId: job!.id });
      }
      log(state, `Order #${job!.id} is bagged and ready.`);
      return;
    case "help_self_serve":
      if (c!.state !== "waiting") return;
      if (state.copier.status === "broken") {
        c!.mood += MOOD.badWork; // pointed at the sign
        log(state, `Pointed ${c!.name} at the out of order sign.`);
      } else log(state, `Helped ${c!.name} at self-serve.`);
      return leave(state, c!, "served");
    case "fix_copier":
      state.copier.status = "ok";
      state.copier.sign = false;
      recordChoice(state, "do", "copier");
      resolveEvent(state, "copier_dies", "fixed");
      log(state, "Fixed the copier.");
      return;
    case "out_of_order_sign":
      state.copier.sign = true;
      recordChoice(state, "dont", "copier");
      resolveEvent(state, "copier_dies", "worked_around");
      log(state, "Taped an out of order sign on the copier.");
      return;
    case "weigh":
      pkg!.status = "weighed";
      return;
    case "tape":
      pkg!.status = "packed";
      return;
    case "pack":
    case "tape_shut": {
      pkg!.status = t.type === "pack" ? "boxed" : "packed";
      if (onPacked(state, pkg!)) return; // ripped: pack it again
      resolveEvent(state, "box_rips", t.type === "pack" ? "fixed" : "worked_around");
      const owner = customerById(state, pkg!.customerId);
      if (t.type === "tape_shut") {
        pkg!.taped = true;
        if (owner?.state === "waiting") owner.mood += MOOD.badWork; // they're standing right there
      }
      recordChoice(state, t.type === "pack" ? "do" : "dont", "pack", pkg!.customerId);
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
      state.packages.push({ id, customerId: c!.id, kind: "dropoff", weightLb: 2, service: null, box: null, priceCents: 0, status: "scanned", taped: false });
      c!.packageId = id; // so the drop-off workflow can bin it
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
      recordChoice(state, "do", "truck");
      log(state, `Handed ${out.length} package${out.length === 1 ? "" : "s"} to the driver.`);
      return;
    }
    case "let_truck_go":
      state.truck.status = "gone";
      recordChoice(state, "dont", "truck");
      log(state, "Let the driver leave.");
      truckGone(state);
      return;
  }
}

// Dealt with today's bad luck properly.
function fixedEvent(state: GameState, kind: EventKind): void {
  if (state.event?.kind !== kind || state.event.status !== "active") return;
  resolveEvent(state, kind, "fixed");
  recordChoice(state, "do", "event");
}

// Rushes print first (in the order they were sent); everything else waits its turn.
function queueJob(state: GameState, job: Job): void {
  const q = state.printer.queue;
  if (!job.rush) return void q.push(job.id);
  const firstStandard = q.findIndex((id) => !jobById(state, id)?.rush);
  if (firstStandard < 0) q.push(job.id);
  else q.splice(firstStandard, 0, job.id);
}

// ---------- the counter ----------

export const ACTION_LABEL: Record<CounterAction, string> = {
  take: "Take the order",
  rush: "Take it as a rush",
  self_serve: "Send them to self-serve",
  turn_away: "Turn {name} away",
  ignore: "Ignore {name}",
};

// Why this answer isn't on the table for this customer, or null.
export function actionBlocker(state: GameState, c: Customer, action: CounterAction): string | null {
  const scene = sceneOf(state, c);
  if (action === "ignore") return null;
  if (action === "turn_away") {
    if (scene) return null; // apologize (and refund, for a missing order)
    return c.kind === "order_pickup" && c.jobId !== null && jobById(state, c.jobId)?.prepaid ? "They already paid online. Online orders can't be turned away." : null;
  }
  if (action === "take") return null;
  if (scene) return "Do is the only way to make this right.";
  if (!isPrintKind(c.kind)) return "That's only for print orders.";
  const q = quoteFor(state, c);
  if (action === "rush") return q.rush ? null : "Standard turnaround is soon enough for them.";
  return q.selfServeBlocker;
}

// The customer's reaction to something, keyed to them and how far into the conversation you are.
function reacts(state: GameState, c: Customer, what: string): number {
  return keyedRoll(state.seed, what, c.id, c.choices);
}

function say(c: Customer, reaction: Reaction): void {
  customerSay(c, "reaction", { reaction });
}

// What's going on at the counter, when it's not a plain request.
export type Scene = "missing_order" | "copier_broken" | "complaint";

export function sceneOf(state: GameState, c: Customer): Scene | null {
  const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
  if (c.kind === "order_pickup" && job && job.status !== "bagged") return "missing_order";
  if (c.kind === "self_serve_help" && state.copier.status === "broken") return "copier_broken";
  if (c.kind === "complaint") return "complaint";
  return null;
}

// Your answer to the customer at the counter. Do leads into the workflow for what they need.
export function answer(state: GameState, c: Customer, action: CounterAction, auto: boolean): void {
  const q = quoteFor(state, c);
  const scene = sceneOf(state, c);
  recordChoice(state, choiceType(action), "counter", c.id, { action, auto });
  c.answerBy = null;
  const follow = (kind: WorkflowKind, extra: Partial<Workflow> = {}) => {
    if (state.workflow?.customerId === c.id) Object.assign(state.workflow, { kind, ...extra });
  };
  switch (action) {
    case "ignore":
      c.ignored++;
      c.mood += MOOD.ignored;
      c.state = "line"; // still standing there
      onIgnore(state);
      break;
    case "turn_away":
      if (scene === "missing_order") apologizeAndRefund(state, c);
      else turnAway(state, c, q);
      break;
    case "self_serve":
      if (reacts(state, c, "self-serve") < REACTIONS.acceptSelfServe) {
        say(c, "accept_self_serve");
        c.state = "waiting";
        c.goingToSelfServe = true;
        follow("self_serve"); // walk them over
      } else {
        // They want full service: back to you for a do or a don't.
        c.refusedSelfServe = true;
        say(c, "refuse_self_serve");
        c.state = "talking";
        c.answerBy = state.time + ANSWER_WITHIN;
        log(state, `${c.name} wants full service.`);
      }
      break;
    case "take":
    case "rush":
      if (scene === "missing_order") {
        rushTheirOrder(state, c);
        follow("missing_order", { jobId: c.jobId! });
      } else if (scene === "complaint") {
        makeItRight(state, c);
        follow("complaint", { jobId: c.jobId ?? undefined });
      } else if (isPrintKind(c.kind)) {
        takeOrder(state, c, q, action === "rush");
        const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
        if (job && c.state !== "gone") follow(job.walkUp ? "walk_up" : "take_order", { jobId: job.id });
      } else {
        takeRequest(state, c);
        if (c.kind === "ship") follow("ship", { packageId: c.packageId! });
        if (c.kind === "dropoff") follow("dropoff");
        if (c.kind === "package_pickup") follow("release_package", { packageId: c.packageId! });
        if (c.kind === "order_pickup") follow("pickup", { jobId: c.jobId! });
        if (c.kind === "self_serve_help") follow("self_serve_help", { fixFirst: scene === "copier_broken" });
      }
      break;
  }
  // Nothing more to do for them (turned away, ignored, they left): the counter workflow is over.
  if (state.workflow?.customerId === c.id && state.workflow.kind === "counter" && c.state !== "talking") state.workflow = null;
  c.choices++;
}

// "Where's my order?" Do: rush it now while they wait.
function rushTheirOrder(state: GameState, c: Customer): void {
  const job = jobById(state, c.jobId!)!;
  job.rush = true; // no rush fee: it's on us
  const q = state.printer.queue;
  if (q.includes(job.id)) {
    state.printer.queue = q.filter((id) => id !== job.id);
    queueJob(state, job);
  }
  c.state = "waiting";
  resetPatience(state, c);
  log(state, `Rushing ${c.name}'s order #${job.id} while they wait.`);
}

// "Where's my order?" Don't: apologize and give their money back.
function apologizeAndRefund(state: GameState, c: Customer): void {
  const job = jobById(state, c.jobId!)!;
  if (job.prepaid && job.priceCents > 0) {
    state.revenueCents -= job.priceCents;
    state.stats.refundsCents += job.priceCents;
  }
  if (isOverdue(state, job)) onLate(state, job);
  job.status = "canceled";
  job.closedAt = state.time;
  state.printer.queue = state.printer.queue.filter((id) => id !== job.id);
  c.mood += MOOD.turnedAway;
  say(c, "turned_away");
  log(state, `Apologized to ${c.name} and refunded order #${job.id}.`);
  leave(state, c, "turned_away");
}

// A complaint, Do: a damaged box gets a claim filed (make_good); smudged copies get reprinted free while they wait.
function makeItRight(state: GameState, c: Customer): void {
  c.state = "waiting";
  if (c.about !== "smudged_return") return;
  c.spec = { item: "document", originals: 2, copies: 10, color: "bw", media: "letter", duplex: false, finishing: "none" };
  const job = createJob(state, c, "counter", { rush: true, dueDay: state.day, dueAt: state.time + STANDARD_LEAD });
  job.priceCents = job.printCents = job.serviceFeeCents = job.rushCents = 0; // on us
  job.prepaid = true;
  resetPatience(state, c);
  log(state, `Reprinting ${c.name}'s copies for free.`);
}

function turnAway(state: GameState, c: Customer, q: CounterQuote): void {
  // People here for something that's already theirs, to complain, or about a broken copier take it badly.
  const theirs = c.kind === "order_pickup" || c.kind === "package_pickup" || c.kind === "complaint" || (c.kind === "self_serve_help" && state.copier.status === "broken");
  c.mood += theirs ? MOOD.badWork : MOOD.turnedAway;
  c.couldSelfServe = q.selfServeCents !== null; // they could have done it themselves: that's survey material
  onTurnAway(state, q);
  if (c.kind === "business") lostBusiness(state, c, q.valueCents);
  if (state.stats.lostSales > 0 && q.doable && q.worth && isPrintKind(c.kind)) recordFailure(state, "lost_sale", { name: c.name, money: money(q.valueCents) }, { customerId: c.id });
  refundArrival(state, c);
  say(c, "turned_away");
  log(state, `Turned ${c.name} away.`);
  leave(state, c, "turned_away");
}

// Taking a print order: they might balk at a fee, or at when it'd be ready.
function takeOrder(state: GameState, c: Customer, q: CounterQuote, rush: boolean): void {
  if (rush && reacts(state, c, "rush-balk") < REACTIONS.rushBalk) return balk(state, c, q, true);
  if (!rush && q.standard!.serviceFeeCents > 0 && reacts(state, c, "fee-balk") < REACTIONS.serviceFeeBalk) return balk(state, c, q, false);
  agreeOnTime(state, c, q, rush);
}

// They don't want to pay the fee: they take standard time (instead of a rush), do it themselves, or leave.
function balk(state: GameState, c: Customer, q: CounterQuote, rush: boolean): void {
  const w = REACTIONS.balkInstead;
  const instead = weighted(reacts(state, c, "balk-instead"), { standard: rush ? w.standard : 0, self_serve: q.selfServeCents !== null ? w.self_serve : 0, leave: w.leave });
  say(c, rush ? "balk_rush" : "balk_fee");
  if (instead === "standard") return agreeOnTime(state, c, q, false);
  refundArrival(state, c);
  if (instead === "self_serve") return startSelfServe(state, c); // they know where it is
  state.stats.balked++;
  log(state, `${c.name} didn't want to pay the fee and left.`);
  leave(state, c, "balked");
}

// If it can't be ready by when they need it, some take the later time and some leave. Then it's an order.
function agreeOnTime(state: GameState, c: Customer, q: CounterQuote, rush: boolean): void {
  const promise = rush ? q.rushReadyAt : q.standardReadyAt;
  if (c.needBy !== null && promise > c.needBy) {
    // (A promise for tomorrow is later than anything they need today, too.)
    if (reacts(state, c, "later") >= REACTIONS.acceptLater) {
      say(c, "too_late");
      refundArrival(state, c);
      state.stats.balked++;
      log(state, `${c.name} couldn't wait that long and left.`);
      return leave(state, c, "balked");
    }
    say(c, "accept_later");
  }
  const tomorrow = rush ? false : q.tomorrow;
  const dueAt = tomorrow ? morningTime(state.seed, c.id) : c.timing === "back" ? Math.max(promise, c.needBy ?? promise) : promise;
  const walkUp = q.walkUp && !rush;
  const job = createJob(state, c, "counter", { rush, walkUp, dueDay: tomorrow ? state.day + 1 : state.day, dueAt });
  state.stats.ordersTaken++;
  if (c.kind === "business") {
    state.revenueCents += job.priceCents; // billed on account
    state.stats.businessWon++;
  }
  if (rush) state.stats.rushOrders++;
  if (c.timing === "wait" && !tomorrow) {
    c.state = "waiting";
    resetPatience(state, c); // happy to wait until it's due; past that, their patience runs out
  } else c.state = "away"; // (if it's tomorrow now, they'll pick it up tomorrow)
  log(state, `Took ${c.name}'s ${rush ? "rush " : ""}order #${job.id}, due ${tomorrow ? "tomorrow" : formatClock(dueAt)}.`);
}

// Everything that isn't a print order: you take it on.
function takeRequest(state: GameState, c: Customer): void {
  c.state = "waiting";
  if (c.kind === "complaint") {
    c.mood = Math.max(c.mood, 0); // heard out
    log(state, `Heard ${c.name} out.`);
    return leave(state, c, "served");
  }
  if (c.kind === "ship") createShipment(state, c);
}
