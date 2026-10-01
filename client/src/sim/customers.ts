// Who walks in and what they want. Every roll here comes from the rng you pass in, so the caller decides which
// stream pays for it (the flow director's own stream during a day, a separate one for dev mode).
import type { Customer, FlagKind, GameState, Job, JobSpec, RequestKind } from "./types";
import { PICKUP_AFTER, PRINT_REQUESTS, SHIPPING, SHIP_RATE } from "./config";
import { keyedRoll, randInt, pick, type Rng } from "./rng";
import { patienceFor } from "./mood";
import { fullServiceQuote, totalSheets } from "./orders";
import names from "../data/names.json";
import { pickLine, POOLS } from "./lines";
import { fill } from "./util";

export const PRINT_KINDS: RequestKind[] = ["quick_copies", "large_job", "poster"];

export function isPrintKind(kind: RequestKind): kind is "quick_copies" | "large_job" | "poster" {
  return PRINT_KINDS.includes(kind);
}

function weighted<T extends string>(rng: Rng, weights: Partial<Record<T, number>>): T {
  const entries = Object.entries(weights) as [T, number][];
  let r = rng() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function rollSpec(rng: Rng, kind: "quick_copies" | "large_job" | "poster"): JobSpec {
  const d = PRINT_REQUESTS[kind];
  return {
    item: d.item,
    originals: randInt(rng, ...d.originals),
    copies: randInt(rng, ...d.copies),
    color: rng() < d.colorChance ? "color" : "bw",
    media: weighted(rng, d.media),
    duplex: rng() < d.duplexChance,
    finishing: weighted(rng, d.finishing),
  };
}

export function rollName(rng: Rng): string {
  return `${pick(rng, names.first)} ${pick(rng, names.last)}`;
}

export function shipPriceCents(weightLb: number): number {
  return SHIP_RATE.base + SHIP_RATE.perLb * Math.ceil(weightLb);
}

export interface SpawnOptions {
  spec?: JobSpec;
  waits?: boolean;
  weightLb?: number;
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
    const waitChance = PRINT_REQUESTS[kind].waitChance;
    c.waits = opts.waits ?? (waitChance >= 1 || rng() < waitChance);
  }
  if (kind === "complaint") {
    c.about = opts.about ?? "damaged_box";
    c.mood = -1; // they come in angry
  }
  if (kind === "ship") c.weightLb = opts.weightLb ?? randInt(rng, ...SHIPPING.weightLb);
  if (kind === "package_pickup") {
    c.packageId = state.nextId++;
    state.packages.push({ id: c.packageId, customerId: c.id, kind: "held", weightLb: randInt(rng, 1, 10), priceCents: 0, status: "held", taped: false });
  }
  state.customers.push(c);
  return c;
}

function newCustomer(state: GameState, name: string, kind: RequestKind): Customer {
  return {
    id: state.nextId++,
    name,
    kind,
    state: "away",
    spec: null,
    waits: true,
    weightLb: 0,
    jobId: null,
    packageId: null,
    arrivedAt: state.time,
    lineTicket: 0,
    mood: 0,
    choices: 0,
    ignored: 0,
    patience: patienceFor(kind, state.day),
    waited: 0,
    fedUp: false,
    answerBy: null,
    about: null,
    said: null,
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
  c.patience = patienceFor("order_pickup", state.day);
  c.waited = 0;
  c.fedUp = false;
}

// Creates the order for a print request.
export function createJob(state: GameState, c: Customer, channel: Job["channel"]): Job {
  const spec = c.spec!;
  const job: Job = {
    id: state.nextId++,
    customerId: c.id,
    kind: c.kind,
    channel,
    spec,
    sheets: totalSheets(spec),
    priceCents: fullServiceQuote(spec, true).totalCents,
    prepaid: channel === "web",
    status: channel === "web" ? "unread" : "new",
    sheetsPrinted: 0,
    orderedAt: state.time,
    pickupAt: 0,
    attempt: 0,
    smudge: "none",
    closedAt: null,
  };
  // Keyed, not drawn from a stream: taking an order is your doing, and must not shift anyone's rolls.
  const [lo, hi] = PICKUP_AFTER;
  job.pickupAt = state.time + lo + Math.floor(keyedRoll(state.seed, "pickup", job.id) * (hi - lo + 1));
  state.jobs.push(job);
  c.jobId = job.id;
  return job;
}

// An order placed online: it lands in the inbox, and the customer comes in to pick it up later.
export function placeWebOrder(state: GameState, rng: Rng, opts: SpawnOptions = {}): Job {
  const kind = rng() < 0.5 ? "quick_copies" : "large_job";
  const c = newCustomer(state, opts.name ?? rollName(rng), "order_pickup");
  c.spec = opts.spec ?? rollSpec(rng, kind);
  c.waits = false;
  state.customers.push(c);
  const job = createJob(state, c, "web");
  const text = pickLine(POOLS.messages, "web_order");
  const vars = { job: job.id, name: c.name };
  const msg = { id: state.nextId++, kind: "web_order" as const, at: state.time, subject: fill(text.subject ?? "", vars), body: fill(text.text, vars), jobId: job.id, read: false, snoozed: false };
  (state.wifi.down ? state.heldMessages : state.messages).push(msg);
  state.stats.webOrders++;
  return job;
}
