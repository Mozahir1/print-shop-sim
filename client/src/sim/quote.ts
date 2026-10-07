// What you know when someone reaches the counter: what it costs (fees itemized), whether self-serve is an option,
// when they need it, when it could be ready, and how much of your time each way of doing it takes.
import type { Customer, GameState, Job, JobSpec, Machine, Timing } from "./types";
import { CLOSING, DURATIONS, MACHINES, PRINTER, RESPOND_MINUTES, RUSH_BUFFER, STANDARD_LEAD, WORTH_MIN_CENTS } from "./config";
import { finishMinutes, fullServiceQuote, machineFor, selfServeBlocker, selfServePriceCents, shipQuote, totalSheets, type FullServiceQuote, type ShipQuote } from "./orders";
import { isPrintKind, morningTime } from "./customers";
import { jobById } from "./util";

export interface CounterQuote {
  // print requests
  standard: FullServiceQuote | null;
  rush: FullServiceQuote | null; // only when they need it sooner than standard turnaround
  selfServeCents: number | null; // null when it isn't an option...
  selfServeBlocker: string | null; // ...and why
  timing: Timing | null;
  needBy: number | null; // null: tomorrow is fine
  standardReadyAt: number;
  rushReadyAt: number;
  tomorrow: boolean; // it can't be ready in time today (or they're fine with tomorrow): it's promised for tomorrow morning
  morningAt: number; // when, tomorrow
  yourMinutes: number; // your time if you take it (a walk-up job: all at once, and you can't leave it)
  printMinutes: number; // the production printer's time (it runs on its own)
  selfServeMinutes: number; // your time if they go to self-serve: just showing them the copier
  // shipping
  ship: ShipQuote | null;
  // for deciding whether turning them away loses a sale
  doable: boolean; // can be done by when they need it (as a rush if need be)
  worth: boolean; // brings in enough to be worth doing
  valueCents: number; // what doing it would bring in
}

// Machine time, start to finish (it runs on its own): the production printer, the card machine, or the wide-format
// printer (slow: a large print is the longest wait in the shop).
export function printMinutes(spec: JobSpec): number {
  return machineFor(spec) === "printer" ? PRINTER.warmup + totalSheets(spec) / PRINTER.sheetsPerMinute : machineMinutes(spec);
}

export function machineMinutes(spec: JobSpec): number {
  return machineFor(spec) === "cards" ? MACHINES.cards.warmup + spec.copies / MACHINES.cards.perMinute : MACHINES.wide.warmup + spec.copies * MACHINES.wide.minutesEach;
}

// Minutes still owed to a job that's printing (on whichever machine).
function remaining(state: GameState, j: Job): number {
  const m = machineFor(j.spec);
  if (m === "printer") return (j.sheets - j.sheetsPrinted) / PRINTER.sheetsPerMinute;
  const mc = state.machines[m];
  return mc.currentJobId === j.id ? mc.left : printMinutes(j.spec);
}

// Your time on a production order from entering it to bagging it (the printing itself runs on its own).
export function handlingMinutes(spec: JobSpec): number {
  const take = machineFor(spec) === "wide" ? DURATIONS.trim + DURATIONS.roll : DURATIONS.collect;
  return DURATIONS.enter_order + DURATIONS.send_job + take + finishMinutes(spec) + DURATIONS.bag;
}

// Printer time still owed to what's in the printer queue: whatever's printing, plus what's waiting to print (only
// other rushes, for a rush). It's a simple estimate: orders you haven't sent yet aren't in the queue, so if you've
// taken on more than you've sent, it's optimistic.
function printerBacklog(state: GameState, rush: boolean, machine: Machine): number {
  let seconds = 0;
  for (const j of state.jobs) {
    if (machineFor(j.spec) !== machine) continue; // (each machine has its own queue)
    if (j.status === "printing") seconds += remaining(state, j);
    else if (j.status === "queued" && (!rush || j.rush)) seconds += printMinutes(j.spec);
  }
  return seconds;
}

// A simple estimate of when a new order could be ready, from the printer queue.
// The latest anything's promised for today: a little before close, so it's ready and they can get here.
export function lastDueAt(state: GameState): number {
  return state.closeAt - CLOSING.dueBuffer;
}

// A promise for tomorrow morning, with time to make it first (nothing prints overnight), and still inside open hours.
export function morningDueAt(state: GameState, spec: JobSpec, key: number): number {
  return Math.min(lastDueAt(state), Math.max(morningTime(state.seed, key), Math.round(printMinutes(spec) + handlingMinutes(spec) + RUSH_BUFFER)));
}

export function estimateReadyAt(state: GameState, spec: JobSpec, rush: boolean): number {
  return Math.round(state.time + printerBacklog(state, rush, machineFor(spec)) + printMinutes(spec) + handlingMinutes(spec));
}

// Would rushing this push an order that's already waiting to print past its due time? (Rushes print first.)
export function rushBumpsSomeone(state: GameState, spec: JobSpec): boolean {
  const extra = printMinutes(spec);
  const machine = machineFor(spec);
  let ahead = 0;
  for (const j of state.jobs) if (j.status === "printing" && machineFor(j.spec) === machine) ahead += remaining(state, j);
  for (const id of machine === "printer" ? state.printer.queue : state.machines[machine].queue) {
    const j = jobById(state, id);
    if (!j) continue;
    ahead += printMinutes(j.spec);
    if (!j.rush && j.dueDay === state.day && state.time + ahead + extra + handlingMinutes(j.spec) > j.dueAt) return true;
  }
  return false;
}

export function quoteFor(state: GameState, c: Customer): CounterQuote {
  const q: CounterQuote = {
    standard: null,
    rush: null,
    selfServeCents: null,
    selfServeBlocker: null,
    timing: null,
    needBy: null,
    standardReadyAt: state.time,
    rushReadyAt: state.time,
    tomorrow: false,
    morningAt: 0,
    yourMinutes: 0,
    printMinutes: 0,
    selfServeMinutes: RESPOND_MINUTES.self_serve + DURATIONS.escort,
    ship: null,
    doable: true,
    worth: false,
    valueCents: 0,
  };
  if (isPrintKind(c.kind) && c.spec) {
    const spec = c.spec;
    q.timing = c.timing;
    q.needBy = c.needBy;
    q.standard = fullServiceQuote(spec, false);
    // Taking it is always full service, 2 pages or 200: enter it, print it, finish it, bag it, ring it up.
    q.printMinutes = Math.round(printMinutes(spec));
    q.yourMinutes = RESPOND_MINUTES.take + handlingMinutes(spec) + DURATIONS.ring_up;
    q.standardReadyAt = Math.max(estimateReadyAt(state, spec, false), state.time + STANDARD_LEAD);
    q.rushReadyAt = estimateReadyAt(state, spec, true) + RUSH_BUFFER;
    q.tomorrow = c.timing === "tomorrow" || q.standardReadyAt > lastDueAt(state);
    q.morningAt = morningDueAt(state, spec, c.id);
    // A rush is offered when they need it sooner than standard, and a rush would actually get it to them sooner.
    if (c.needBy !== null && c.needBy < q.standardReadyAt && q.rushReadyAt < q.standardReadyAt && q.rushReadyAt <= lastDueAt(state)) q.rush = fullServiceQuote(spec, true);
    q.selfServeBlocker = selfServeBlocker(spec) ?? (c.timing !== "wait" ? "They aren't staying in the store." : null) ?? (c.refusedSelfServe ? "They want full service." : null) ?? (state.copier.status !== "ok" ? "The self-serve copier is broken." : null);
    if (!q.selfServeBlocker) q.selfServeCents = selfServePriceCents(spec);
    q.doable = c.needBy === null || Math.min(q.standardReadyAt, q.rushReadyAt) <= c.needBy;
    q.valueCents = q.standard.totalCents;
    q.worth = q.valueCents >= WORTH_MIN_CENTS;
  } else if (c.kind === "ship") {
    q.ship = shipQuote(c.weightLb, c.service);
    q.valueCents = q.ship.storeCents;
    q.worth = q.valueCents >= WORTH_MIN_CENTS;
  } else if (c.kind === "order_pickup" && c.jobId !== null) {
    const job = jobById(state, c.jobId) as Job | undefined;
    q.valueCents = job && !job.prepaid ? job.priceCents : 0;
    q.worth = q.valueCents >= WORTH_MIN_CENTS;
  }
  return q;
}
