// The flow director: brings in the next customer (or the truck) so there's always something to do, but rarely
// more than two or three things at once. Every roll comes from its own stream.
import type { Customer, GameState } from "./types";
import { BUSINESS, DIRECTOR, MOOD, REACTIONS, SHIPPING, type Arrival } from "./config";
import { keyedRoll, randInt } from "./rng";
import { isPrintKind, placeWebOrder, returnCustomer, spawnCustomer, weighted } from "./customers";
import { activeCount, isActive } from "./todo";
import { selfServeBlocker } from "./orders";
import { leave } from "./mood";
import { startSelfServe } from "./sim";
import { jobById, log } from "./util";
import type { Sim } from "./sim";

export interface DirectorState {
  enabled: boolean; // dev mode and tests can hold arrivals
  nextAt: number; // the next arrival at the regular pace
  floorAt: number | null; // set when active things dropped below the floor: arrive at this time instead
  arrivals: number; // new customers today (see DIRECTOR.maxPerDay)
  businessAt: number[]; // when today's business clients show up (on their own schedule, whatever you're doing)
}

export function createDirector(rng: () => number, business: () => number, dayLength: number): DirectorState {
  const count = Number(weighted(business(), BUSINESS.perDay as Record<string, number>));
  const [lo, hi] = BUSINESS.window;
  const businessAt = Array.from({ length: count }, () => Math.round(dayLength * (lo + business() * (hi - lo)))).sort((a, b) => a - b);
  return { enabled: true, nextAt: randInt(rng, ...DIRECTOR.firstArrival), floorAt: null, arrivals: 0, businessAt };
}

// Someone who turned out to be hardly any work (turned away, balked, sent to self-serve) doesn't use up one of the
// day's customers: the director brings in someone else instead.
export function refundArrival(state: GameState, c: Customer): void {
  if (c.kind === "order_pickup" || c.kind === "complaint") return; // they never counted
  state.director.arrivals = Math.max(0, state.director.arrivals - 1);
}

// Customers who left an order and could come back for it now: it's ready, or it's past when they said they'd come.
// Oldest first.
export function readyToReturn(state: GameState): Customer[] {
  return state.customers.filter((c) => {
    if (c.state !== "away" || c.jobId === null) return false;
    const job = jobById(state, c.jobId);
    if (!job || job.status === "picked_up" || job.dueDay > state.day) return false; // not due back today
    return job.status === "bagged" || state.time >= job.pickupAt;
  });
}

export function runDirector(sim: Sim): void {
  const { state, rng } = sim;
  const d = state.director;
  const open = state.time < state.closeAt;
  const active = activeCount(state);

  // The truck comes at its time, unless you're at the ceiling; then it waits for room, or comes just after close
  // (the day doesn't end until it's been and gone). If things go quiet just before it's due, it comes a bit early.
  const t = state.truck;
  const early = state.time >= t.arrivesAt - DIRECTOR.truckHold && active < DIRECTOR.floor; // quiet while we wait for it
  if (t.status === "coming" && (early || (state.time >= t.arrivesAt && (active < DIRECTOR.ceiling || state.time > state.closeAt)))) {
    t.status = "waiting";
    t.leavesAt = state.time + SHIPPING.truckWaits;
    log(state, "The carrier truck is here.");
    return;
  }

  const truckDue = t.status === "coming" && state.time >= t.arrivesAt - DIRECTOR.truckHold; // make room for it
  const full = d.arrivals >= DIRECTOR.maxPerDay && state.manager.visitsDue.length === 0;
  if (!d.enabled || !open) return;
  // A business client comes in when they come in: busy or not (just never into a full store).
  if (d.businessAt.length && state.time >= d.businessAt[0] && active < DIRECTOR.ceiling) {
    d.businessAt.shift();
    const c = spawnCustomer(state, rng.director, "business");
    log(state, `${c.name}, a business client, came in.`);
    return;
  }
  if (full || active >= DIRECTOR.ceiling || truckDue) {
    d.floorAt = null;
    // Someone coming back for an order that isn't done yet doesn't add to the load (the order already counts),
    // so they still come in at the regular pace. Otherwise unfinished orders could hold their own customers out.
    const owed = readyToReturn(state).filter((c) => isActive(state, c));
    if (owed.length && state.time >= d.nextAt) {
      returnCustomer(state, owed[0]);
      d.nextAt = state.time + randInt(rng.director, ...DIRECTOR.pace);
    }
    return;
  }
  if (active < DIRECTOR.floor && d.floorAt === null) d.floorAt = state.time + randInt(rng.director, ...DIRECTOR.floorGap);
  const due = state.time >= d.nextAt || (d.floorAt !== null && state.time >= d.floorAt);
  if (!due) return;

  const visit = state.manager.visitsDue.shift(); // people coming back to complain go first
  const overdue = readyToReturn(state).filter((c) => state.time >= jobById(state, c.jobId!)!.pickupAt); // then anyone past their pickup time
  if (visit) {
    const c = spawnCustomer(state, rng.director, "complaint", { name: visit.name, about: visit.about });
    log(state, `${c.name} came back, unhappy.`);
  } else if (overdue.length) {
    returnCustomer(state, overdue[0]);
    log(state, `${overdue[0].name} came back for their order.`);
  } else {
    const what = pickArrival(sim);
    const counted = arrive(sim, what);
    if (counted) d.arrivals++;
  }
  d.floorAt = null;
  d.nextAt = state.time + randInt(rng.director, ...DIRECTOR.pace);
}

function pickArrival(sim: Sim): Arrival {
  const { state, rng } = sim;
  const ramp = Math.min(DIRECTOR.multiStepMax, DIRECTOR.multiStepPerDay * (state.day - 1));
  const weights = { ...DIRECTOR.mix };
  for (const k of DIRECTOR.multiStep) weights[k] *= 1 + ramp;
  weights.complaint = 0; // only ever from something you did (manager.visitsDue)
  if (readyToReturn(state).length === 0) weights.order_pickup = 0;
  const entries = Object.entries(weights) as [Arrival, number][];
  let r = rng.director() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return "quick_copies";
}

// Brings them in. Returns whether they count toward the day's customers.
function arrive(sim: Sim, what: Arrival): boolean {
  const { state, rng } = sim;
  if (what === "order_pickup") {
    const c = readyToReturn(state)[0];
    returnCustomer(state, c);
    log(state, `${c.name} came back for their order.`);
    return false;
  }
  if (what === "web_order") {
    const job = placeWebOrder(state, rng.director);
    log(state, `Web order #${job.id} came in.`);
    return true;
  }
  const c = spawnCustomer(state, rng.director, what);
  log(state, `${c.name} came in.`);
  return !goStraightToSelfServe(state, c);
}

// Some people with a simple job don't come to the counter at all: they go straight to the self-serve copier.
// If it's broken, they come and ask about it; if there's an out of order sign on it, they leave unhappy.
// Returns whether they went (they don't count toward the day's customers then: they're no work for you).
function goStraightToSelfServe(state: GameState, c: Customer): boolean {
  if (!isPrintKind(c.kind) || c.timing !== "wait" || selfServeBlocker(c.spec!) !== null) return false;
  if (keyedRoll(state.seed, "go-alone", c.id) >= REACTIONS.goAlone) return false;
  if (state.copier.status === "ok") {
    startSelfServe(state, c);
    return true;
  }
  if (state.copier.sign) {
    c.mood += MOOD.badWork;
    leave(state, c, "balked");
    log(state, `${c.name} saw the out of order sign and left.`);
    return true;
  }
  c.kind = "self_serve_help"; // "this machine isn't doing anything"
  c.spec = null;
  return false;
}
