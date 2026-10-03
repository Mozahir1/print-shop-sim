// What you know when someone reaches the counter: what it costs (fees itemized), whether self-serve is an option,
// when they need it, and when it could be ready given what's already in the printer.
import type { Customer, GameState, Job, JobSpec, Timing } from "./types";
import { DURATIONS, FINISH_SECONDS, PRINTER, RUSH_BUFFER, STANDARD_LEAD, WORTH_MIN_CENTS } from "./config";
import { fullServiceQuote, selfServeBlocker, selfServePriceCents, shipQuote, totalSheets, type FullServiceQuote, type ShipQuote } from "./orders";
import { isPrintKind } from "./customers";
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
  tomorrow: boolean; // it can't be ready before close (or they're fine with tomorrow): it's promised for tomorrow morning
  // shipping
  ship: ShipQuote | null;
  // for deciding whether turning them away loses a sale
  doable: boolean; // can be done by when they need it (as a rush if need be)
  worth: boolean; // brings in enough to be worth doing
  valueCents: number; // what doing it would bring in
}

export function printSeconds(spec: JobSpec): number {
  return PRINTER.warmup + totalSheets(spec) / PRINTER.sheetsPerSecond;
}

// Your time on an order from entering it to bagging it (the printing itself runs on its own).
export function handlingSeconds(spec: JobSpec): number {
  const finish = spec.finishing === "none" ? 0 : FINISH_SECONDS[spec.finishing];
  return DURATIONS.enter_order + DURATIONS.send_job + DURATIONS.collect + finish + DURATIONS.bag;
}

// Printer time still owed to what's in the printer queue: whatever's printing, plus what's waiting to print (only
// other rushes, for a rush). It's a simple estimate: orders you haven't sent yet aren't in the queue, so if you've
// taken on more than you've sent, it's optimistic.
function printerBacklog(state: GameState, rush: boolean): number {
  let seconds = 0;
  for (const j of state.jobs) {
    if (j.status === "printing") seconds += (j.sheets - j.sheetsPrinted) / PRINTER.sheetsPerSecond;
    else if (j.status === "queued" && (!rush || j.rush)) seconds += printSeconds(j.spec);
  }
  return seconds;
}

// A simple estimate of when a new order could be ready, from the printer queue.
export function estimateReadyAt(state: GameState, spec: JobSpec, rush: boolean): number {
  return Math.round(state.time + printerBacklog(state, rush) + printSeconds(spec) + handlingSeconds(spec));
}

// Would rushing this push an order that's already waiting to print past its due time? (Rushes print first.)
export function rushBumpsSomeone(state: GameState, spec: JobSpec): boolean {
  const extra = printSeconds(spec);
  let ahead = 0;
  for (const j of state.jobs) if (j.status === "printing") ahead += (j.sheets - j.sheetsPrinted) / PRINTER.sheetsPerSecond;
  for (const id of state.printer.queue) {
    const j = jobById(state, id);
    if (!j) continue;
    ahead += printSeconds(j.spec);
    if (!j.rush && j.dueDay === state.day && state.time + ahead + extra + handlingSeconds(j.spec) > j.dueAt) return true;
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
    const ready = estimateReadyAt(state, spec, false);
    q.standardReadyAt = Math.max(ready, state.time + STANDARD_LEAD);
    q.rushReadyAt = estimateReadyAt(state, spec, true) + RUSH_BUFFER;
    q.tomorrow = c.timing === "tomorrow" || q.standardReadyAt > state.closeAt;
    // A rush is offered when they need it sooner than standard, and a rush would actually get it to them sooner.
    if (c.needBy !== null && c.needBy < q.standardReadyAt && q.rushReadyAt < q.standardReadyAt && q.rushReadyAt <= state.closeAt) q.rush = fullServiceQuote(spec, true);
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
