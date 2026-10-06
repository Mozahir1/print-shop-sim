// Who walks in and what they want. Every roll here comes from the rng you pass in, so the caller decides which
// stream pays for it (the flow director's own stream during a day, a separate one for dev mode).
import { emit } from "./bus";
import type { Customer, FlagKind, GameState, Job, JobSpec, RequestKind, ShipService, Timing } from "./types";
import { FLAGS, MOOD, PAYS_CASH, PICKUP_AFTER, PRINT_REQUESTS, RUSH_BUFFER, SHIPPING, TIMING } from "./config";
import { estimateReadyAt } from "./quote";
import { keyedRoll, randInt, pick, type Rng } from "./rng";
import { giveUpFor, resetPatience } from "./mood";
import { boxFor, fullServiceQuote, shipQuote, totalSheets } from "./orders";
import names from "../data/names.json";
import { pickLine, POOLS } from "./lines";
import { fill } from "./util";

export type PrintKind = "quick_copies" | "large_job" | "poster" | "business";
export const PRINT_KINDS: RequestKind[] = ["quick_copies", "large_job", "poster", "business"];

export function isPrintKind(kind: RequestKind): kind is PrintKind {
  return PRINT_KINDS.includes(kind);
}

// Picks a key by weight, given a roll in [0, 1).
export function weighted<T extends string>(roll: number, weights: Partial<Record<T, number>>): T {
  const entries = (Object.entries(weights) as [T, number][]).filter(([, w]) => w > 0);
  let r = roll * entries.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function rollSpec(rng: Rng, kind: PrintKind): JobSpec {
  const d = PRINT_REQUESTS[kind];
  return {
    item: d.item,
    originals: randInt(rng, ...d.originals),
    copies: randInt(rng, ...d.copies),
    color: rng() < d.colorChance ? "color" : "bw",
    media: weighted(rng(), d.media),
    duplex: rng() < d.duplexChance,
    finishing: weighted(rng(), d.finishing),
  };
}

export function rollName(rng: Rng): string {
  return `${pick(rng, names.first)} ${pick(rng, names.last)}`;
}

export interface SpawnOptions {
  spec?: JobSpec;
  timing?: Timing;
  needIn?: number; // seconds from now: the latest it's any use to them (wait and back)
  weightLb?: number;
  service?: ShipService;
  name?: string;
  about?: FlagKind; // complaint: what they're back about
}

// Walks a new customer in. Package pickups bring a held package into existence (it came on this morning's
// delivery). Order pickups need an existing order: use returnCustomer() for those.
export function spawnCustomer(state: GameState, rng: Rng, kind: Exclude<RequestKind, "order_pickup">, opts: SpawnOptions = {}): Customer {
  const c = newCustomer(state, opts.name ?? rollName(rng), kind);
  c.state = "line";
  c.lineTicket = state.nextLineNo++;
  if (isPrintKind(kind)) {
    c.spec = opts.spec ?? rollSpec(rng, kind);
    const t = TIMING[kind];
    const timingRoll = rng();
    const inRoll = rng();
    c.timing = opts.timing ?? weighted<Timing>(timingRoll, { wait: t.wait, back: t.back, tomorrow: t.tomorrow });
    if (c.timing !== "tomorrow") {
      const [lo, hi] = c.timing === "wait" ? t.waitIn : t.backIn;
      c.needBy = state.time + (opts.needIn ?? lo + Math.floor(inRoll * (hi - lo + 1)));
    }
  }
  if (kind === "complaint") {
    c.about = opts.about ?? "damaged_box";
    c.mood = -1; // they come in angry
  }
  if (kind === "ship") {
    c.weightLb = opts.weightLb ?? randInt(rng, ...SHIPPING.weightLb);
    c.service = opts.service ?? weighted<ShipService>(rng(), SHIPPING.serviceWeights);
  }
  if (kind === "package_pickup") {
    c.packageId = state.nextId++;
    state.packages.push({ id: c.packageId, customerId: c.id, kind: "held", weightLb: randInt(rng, 1, 10), service: null, box: null, priceCents: 0, status: "held", taped: false, paid: true, label: null });
  }
  state.customers.push(c);
  emit("customer_arrived", { customerId: c.id });
  return c;
}

function newCustomer(state: GameState, name: string, kind: RequestKind): Customer {
  return {
    id: state.nextId++,
    name,
    kind,
    state: "away",
    spec: null,
    timing: "wait",
    needBy: null,
    refusedSelfServe: false,
    goingToSelfServe: false,
    lingering: false,
    couldSelfServe: false,
    selfServeUntil: null,
    helpAt: null,
    weightLb: 0,
    service: "ground",
    jobId: null,
    packageId: null,
    fetched: null,
    pays: keyedRoll(state.seed, "pays", state.nextId) < PAYS_CASH ? "cash" : "card",
    arrivedAt: state.time,
    lineTicket: 0,
    mood: MOOD.start,
    choices: 0,
    ignored: 0,
    giveUp: giveUpFor(kind, state.day),
    waited: 0,
    stage: "fine",
    answerBy: null,
    about: null,
    said: null,
    saidAt: null,
    outcome: null,
    leftAt: null,
  };
}

// A customer who left an order comes back in for it: a new visit, with fresh patience.
export function returnCustomer(state: GameState, c: Customer): void {
  c.kind = "order_pickup";
  c.state = "line";
  c.arrivedAt = state.time;
  c.lineTicket = state.nextLineNo++;
  resetPatience(state, c);
  emit("customer_arrived", { customerId: c.id });
}

export interface JobTerms {
  rush: boolean;
  walkUp?: boolean; // you make it yourself while they wait
  dueDay: number;
  dueAt: number;
}

// Creates the order for a print request, on the terms agreed at the counter (or online).
export function createJob(state: GameState, c: Customer, channel: Job["channel"], terms: JobTerms): Job {
  const spec = c.spec!;
  const q = fullServiceQuote(spec, terms.rush);
  const job: Job = {
    id: state.nextId++,
    customerId: c.id,
    kind: c.kind,
    channel,
    spec: { ...spec },
    asked: spec,
    sheets: totalSheets(spec),
    priceCents: q.totalCents,
    printCents: q.printCents,
    serviceFeeCents: q.serviceFeeCents,
    rushCents: q.rushCents,
    rush: terms.rush,
    walkUp: terms.walkUp ?? false,
    prepaid: channel === "web" || c.kind === "business", // businesses are billed on account
    status: channel === "web" ? "unread" : "new",
    sheetsPrinted: 0,
    orderedAt: state.time,
    dueDay: terms.dueDay,
    dueAt: terms.dueAt,
    late: false,
    pickupAt: terms.dueAt,
    attempt: 0,
    smudge: "none",
    skipped: false,
    closedAt: null,
  };
  state.jobs.push(job);
  c.jobId = job.id;
  return job;
}

// A time early in the day, keyed (choices never consume randomness).
export function morningTime(seed: number, key: number): number {
  const [lo, hi] = FLAGS.morningAt;
  return lo + Math.floor(keyedRoll(seed, "morning", key) * (hi - lo + 1));
}

// An order placed online: it lands in the inbox, and the customer comes in to pick it up later.
// Online orders can't be turned away.
export function placeWebOrder(state: GameState, rng: Rng, opts: SpawnOptions = {}): Job {
  const kind = rng() < 0.5 ? "quick_copies" : "large_job";
  const c = newCustomer(state, opts.name ?? rollName(rng), "order_pickup");
  c.spec = opts.spec ?? rollSpec(rng, kind);
  c.timing = "back";
  state.customers.push(c);
  const [lo, hi] = PICKUP_AFTER;
  // (The website promises a time it can actually be done by: what's printing ahead of it, then making it.)
  const dueAt = Math.max(state.time + lo + Math.floor(rng() * (hi - lo + 1)), estimateReadyAt(state, c.spec, false) + RUSH_BUFFER);
  c.needBy = dueAt;
  const job = createJob(state, c, "web", { rush: false, dueDay: state.day, dueAt });
  const text = pickLine(POOLS.messages, "web_order");
  const vars = { job: job.id, name: c.name };
  const msg = { id: state.nextId++, kind: "web_order" as const, at: state.time, subject: fill(text.subject ?? "", vars), body: fill(text.text, vars), jobId: job.id, read: false, snoozed: false };
  (state.wifi.down ? state.heldMessages : state.messages).push(msg);
  state.stats.webOrders++;
  return job;
}

// The package for a shipping customer, once you take it on. It's priced at what the store keeps.
export function createShipment(state: GameState, c: Customer): void {
  const q = shipQuote(c.weightLb, c.service);
  c.packageId = state.nextId++;
  state.packages.push({ id: c.packageId, customerId: c.id, kind: "ship", weightLb: c.weightLb, service: c.service, box: boxFor(c.weightLb), priceCents: q.storeCents, status: "new", taped: false, paid: false, label: null });
}
