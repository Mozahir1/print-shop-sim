// Who walks in and what they want. Every roll here comes from the rng you pass in, so the caller decides which
// stream pays for it (the flow director's own stream during a day, a separate one for dev mode).
import { emit } from "./bus";
import type { Customer, FlagKind, GameState, Job, JobSpec, Package, RequestKind, ShipService, Timing, Trait } from "./types";
import { FLAGS, LATEST_ASK, TRAITS, MOOD, PAYS_CASH, PICKUP_AFTER, PRINT_REQUESTS, RUSH_BUFFER, SHIPPING, TIMING } from "./config";
import { estimateReadyAt, lastDueAt, morningDueAt } from "./quote";
import { keyedRoll, randInt, pick, type Rng } from "./rng";
import { giveUpFor, resetPatience } from "./mood";
import { boxFor, fullServiceQuote, shipQuote, totalSheets } from "./orders";
import names from "../data/names.json";
import { pickLine, POOLS } from "./lines";
import { customerById, fill, log, money } from "./util";
import { describeSpec, postMessage } from "./messages";
import { formatClock } from "./time";

export type PrintKind = "quick_copies" | "large_job" | "poster" | "business" | "business_cards" | "large_format";
export const PRINT_KINDS: RequestKind[] = ["quick_copies", "large_job", "poster", "business", "business_cards", "large_format"];

export function isPrintKind(kind: RequestKind): kind is PrintKind {
  return PRINT_KINDS.includes(kind);
}

// A light personality tag (frantic, confused, cheapskate, chatty), or none: a keyed roll per customer, so it costs no
// randomness from anything else.
export function rollTrait(seed: number, id: number): Trait | null {
  if (keyedRoll(seed, "trait", id) >= TRAITS.chance) return null;
  return weighted<Trait>(keyedRoll(seed, "trait-kind", id), TRAITS.weights);
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
    copies: randInt(rng, ...d.copies) * (d.copiesStep ?? 1),
    color: rng() < d.colorChance ? "color" : "bw",
    media: weighted(rng(), d.media),
    duplex: rng() < d.duplexChance,
    finishing: weighted(rng(), d.finishing),
  };
}

export function rollName(rng: Rng): string {
  return `${pick(rng, names.first)} ${pick(rng, names.last)}`;
}

// No two people around today with the same name and initial (on the shelf, in the store, or coming back for an
// order): the next initial along instead. (No extra roll, so nothing else the day rolls changes.)
export function uniqueName(state: GameState, name: string): string {
  const taken = new Set([...state.customers.filter((c) => c.state !== "gone").map((c) => c.name), ...state.packages.filter((p) => p.kind === "held" && p.to && (p.status === "held" || p.status === "found")).map((p) => p.to!)]);
  if (!taken.has(name)) return name;
  const [first, last] = name.split(" ");
  const i = Math.max(0, names.last.indexOf(last));
  for (let k = 1; k < names.last.length; k++) {
    const other = `${first} ${names.last[(i + k) % names.last.length]}`;
    if (!taken.has(other)) return other;
  }
  return name;
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

// ---------- the pickup shelf ----------

// Packages people pick up here come on the truck (it drops them off when it comes for the outbound bin), and wait on
// the shelf, day after day, until whoever they're for comes in. The shelf starts the game with a few on it: it's
// your first day, not the shop's.
export function shelve(state: GameState, rng: Rng, n: number): Package[] {
  const room = Math.max(0, SHIPPING.shelfMax - state.packages.filter((p) => p.kind === "held" && (p.status === "held" || p.status === "found")).length);
  const out: Package[] = [];
  for (let i = 0; i < Math.min(n, room); i++) {
    const p: Package = { id: state.nextId++, customerId: 0, kind: "held", to: uniqueName(state, rollName(rng)), weightLb: randInt(rng, 1, 10), service: null, box: null, priceCents: 0, status: "held", taped: false, paid: true, label: null };
    state.packages.push(p);
    out.push(p);
  }
  return out;
}

// The truck's delivery, onto the shelf.
export function deliverPackages(state: GameState, rng: Rng): void {
  const got = shelve(state, rng, randInt(rng, ...SHIPPING.deliveries));
  if (got.length) log(state, `The driver dropped off ${got.length} package${got.length === 1 ? "" : "s"} for pickup.`);
}

// What's on the shelf that nobody here has come for (yet).
export function onTheShelf(state: GameState): Package[] {
  return state.packages.filter((p) => p.kind === "held" && p.status === "held" && (customerById(state, p.customerId)?.state ?? "gone") === "gone");
}

// Walks a new customer in. Someone picking up a package is whoever one on the shelf is for (dev mode, with an empty
// shelf: one gets put there). Order pickups need an existing order: use returnCustomer() for those.
export function spawnCustomer(state: GameState, rng: Rng, kind: Exclude<RequestKind, "order_pickup">, opts: SpawnOptions = {}): Customer {
  const pkg = kind === "package_pickup" ? (onTheShelf(state)[0] ?? shelve(state, rng, 1)[0]) : undefined;
  const c = newCustomer(state, opts.name ?? pkg?.to ?? uniqueName(state, rollName(rng)), kind);
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
      // What they ask for is inside open hours. Too close to closing for anything today: they'll take tomorrow.
      c.needBy = Math.min(state.time + (opts.needIn ?? lo + Math.floor(inRoll * (hi - lo + 1))), lastDueAt(state));
      if (c.needBy < state.time + LATEST_ASK) {
        c.timing = "tomorrow";
        c.needBy = null;
      }
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
  if (pkg) {
    c.packageId = pkg.id;
    pkg.customerId = c.id;
    pkg.to = c.name;
  }
  state.customers.push(c);
  emit("customer_arrived", { customerId: c.id });
  return c;
}

function newCustomer(state: GameState, name: string, kind: RequestKind): Customer {
  const trait = rollTrait(state.seed, state.nextId);
  return {
    trait,
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
    giveUp: giveUpFor(kind, state.day) * (trait ? TRAITS.patience[trait] : 1),
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
  const c = newCustomer(state, opts.name ?? uniqueName(state, rollName(rng)), "order_pickup");
  c.spec = opts.spec ?? rollSpec(rng, kind);
  c.timing = "back";
  state.customers.push(c);
  const [lo, hi] = PICKUP_AFTER;
  // (The website promises a time it can actually be done by: what's printing ahead of it, then making it. Past what
  // today's open hours allow, it's tomorrow morning.)
  const today = Math.max(state.time + lo + Math.floor(rng() * (hi - lo + 1)), estimateReadyAt(state, c.spec, false) + RUSH_BUFFER);
  const tomorrow = today > lastDueAt(state);
  const dueAt = tomorrow ? morningDueAt(state, c.spec, c.id) : today;
  c.needBy = tomorrow ? null : dueAt;
  const job = createJob(state, c, "web", { rush: false, dueDay: tomorrow ? state.day + 1 : state.day, dueAt });
  const text = pickLine(POOLS.messages, "web_order");
  const vars = { job: job.id, name: c.name, specs: describeSpec(c.spec), due: `${tomorrow ? "tomorrow " : ""}${formatClock(dueAt)}`, price: money(job.priceCents) };
  postMessage(state, { kind: "web_order", from: "Website", subject: fill(text.subject ?? "", vars), body: fill(text.text, vars), jobId: job.id }, { held: state.wifi.down });
  state.stats.webOrders++;
  return job;
}

// The package for a shipping customer, once you take it on. It's priced at what the store keeps.
export function createShipment(state: GameState, c: Customer): void {
  const q = shipQuote(c.weightLb, c.service);
  c.packageId = state.nextId++;
  state.packages.push({ id: c.packageId, customerId: c.id, kind: "ship", weightLb: c.weightLb, service: c.service, box: boxFor(c.weightLb), priceCents: q.storeCents, status: "new", taped: false, paid: false, label: null });
}
