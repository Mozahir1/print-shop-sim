// The flow director: brings in the day's 6 to 12 customers (budgeted by how much work they are), spread over the day,
// and the truck, rarely more than two or three things at once. Every roll comes from its own stream.
import { emit } from "./bus";
import type { Customer, GameState } from "./types";
import { BUSINESS, CREW, DIRECTOR, MOOD, REACTIONS, SHIPPING, WORK_COST, type Arrival } from "./config";
import { keyedRoll, randInt } from "./rng";
import { deliverPackages, isPrintKind, onTheShelf, placeWebOrder, returnCustomer, spawnCustomer, weighted } from "./customers";
import { activeCount, isActive } from "./todo";
import { selfServeBlocker } from "./orders";
import { leave } from "./mood";
import { startSelfServe } from "./sim";
import { jobById, log } from "./util";
import { crewTakesNew } from "./coworker";
import type { Sim } from "./sim";

export interface DirectorState {
  enabled: boolean; // dev mode and tests can hold arrivals
  nextAt: number; // the next arrival
  arrivals: number; // new customers today (see DIRECTOR.perDay)
  budget: number; // minutes of work today brings in...
  spent: number; // ...and how much of it has come in so far
  businessAt: number[]; // when today's business clients show up (on their own schedule, whatever you're doing)
  perDay: [number, number]; // new customers today (DIRECTOR.perDay, more with a coworker)
  crewShare: number; // the share of new customers that are your coworker's
}

// With a coworker on, the day brings in more (their capacity: 0.5 is half as many again), and that extra share goes
// to them, so your own load is what it always is.
export function createDirector(rng: () => number, business: () => number, dayLength: number, crewCapacity = 0): DirectorState {
  const count = Number(weighted(business(), BUSINESS.perDay as Record<string, number>));
  const [lo, hi] = BUSINESS.window;
  const businessAt = Array.from({ length: count }, () => Math.round(dayLength * (lo + business() * (hi - lo)))).sort((a, b) => a - b);
  const more = 1 + crewCapacity;
  const perDay: [number, number] = [Math.round(DIRECTOR.perDay[0] * more), Math.round(DIRECTOR.perDay[1] * more)];
  return { enabled: true, nextAt: randInt(rng, ...DIRECTOR.firstArrival), arrivals: 0, budget: Math.round(randInt(rng, ...DIRECTOR.workBudget) * more), spent: 0, businessAt, perDay, crewShare: crewCapacity / more };
}

// The average work a walk-in brings, from the mix.
const MEAN_COST = (() => {
  const e = Object.entries(DIRECTOR.mix).filter(([k, w]) => w > 0 && WORK_COST[k as Arrival] > 0) as [Arrival, number][];
  return e.reduce((a, [k, w]) => a + w * WORK_COST[k], 0) / e.reduce((a, [, w]) => a + w, 0);
})();

// Someone who turned out to be hardly any work (turned away, balked, sent to self-serve) gives their work back to the
// day's budget: the director can bring in someone else instead (within the day's headcount).
export function refundArrival(state: GameState, c: Customer): void {
  state.director.spent = Math.max(0, state.director.spent - WORK_COST[c.kind]);
}

// Whether today's customers are all in: the most there can be, or the work budget's spent and there are enough.
function dayIsFull(d: DirectorState): boolean {
  const [min, max] = d.perDay;
  return d.arrivals + d.businessAt.length >= max || (d.spent >= d.budget && d.arrivals + d.businessAt.length >= min);
}

// Spreads the rest of the day's customers evenly over what's left of it (give or take).
function nextGap(state: GameState, rng: () => number): number {
  const d = state.director;
  const [min, max] = d.perDay;
  const left = Math.min(max, Math.max(min, d.arrivals + Math.ceil(Math.max(0, d.budget - d.spent) / MEAN_COST))) - d.arrivals - d.businessAt.length;
  const span = state.closeAt - DIRECTOR.truckHold - state.time;
  const [lo, hi] = DIRECTOR.jitter;
  return Math.max(5, Math.round((span / Math.max(1, left)) * (lo + rng() * (hi - lo))));
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
    emit("truck_arrived", {});
    t.arrivesAt = state.time;
    t.leavesAt = state.time + SHIPPING.truckWaits;
    deliverPackages(state, rng.shelf);
    log(state, "The carrier truck is here.");
    return;
  }

  const truckDue = (t.status === "coming" && state.time >= t.arrivesAt - DIRECTOR.truckHold) || t.status === "waiting"; // make room for it, and nobody new while it's here
  if (!d.enabled || !open) return;
  // A business client comes in when they come in: busy or not (just never into a full store).
  if (d.businessAt.length && state.time >= d.businessAt[0] && active < DIRECTOR.ceiling) {
    d.businessAt.shift();
    const c = spawnCustomer(state, rng.director, "business");
    d.arrivals++;
    d.spent += WORK_COST.business;
    log(state, `${c.name}, a business client, came in.`);
    return;
  }
  // People coming back for an order come at the time they said, whatever today's count. Someone back for an order
  // that isn't done yet doesn't add to the load (the order already counts), so they come in even when you're busy.
  const back = readyToReturn(state).find((c) => state.time >= jobById(state, c.jobId!)!.pickupAt && (active < DIRECTOR.ceiling || isActive(state, c) || c.crew));
  if (back) {
    returnCustomer(state, back);
    log(state, `${back.name} came back for their order.`);
    return;
  }
  if (state.time < d.nextAt || truckDue) return;
  // Your coworker's next customer, or yours? (A keyed roll per arrival. Theirs come when they have room; yours when you
  // do. Theirs never turn into yours: your load is what it'd be on your own.)
  const toCrew = d.crewShare > 0 && keyedRoll(state.seed, "crew", d.arrivals) < d.crewShare;
  if (toCrew ? !crewTakesNew(state) : active >= DIRECTOR.ceiling) return;
  const visit = toCrew ? undefined : state.manager.visitsDue.shift(); // people coming back to complain go first (they aren't new customers)
  if (visit) {
    const c = spawnCustomer(state, rng.director, "complaint", { name: visit.name, about: visit.about });
    log(state, `${c.name} came back, unhappy.`);
  } else if (!dayIsFull(d)) {
    const what = pickArrival(sim, toCrew);
    if (arrive(sim, what, toCrew)) {
      d.arrivals++;
      d.spent += WORK_COST[what];
    }
  } else return;
  d.nextAt = state.time + nextGap(state, rng.director);
}

function pickArrival(sim: Sim, crew: boolean): Arrival {
  const { state, rng } = sim;
  const ramp = Math.min(DIRECTOR.multiStepMax, DIRECTOR.multiStepPerDay * (state.day - 1));
  const weights = { ...DIRECTOR.mix };
  for (const k of DIRECTOR.multiStep) weights[k] *= 1 + ramp;
  weights.complaint = 0; // only ever from something you did (manager.visitsDue)
  weights.order_pickup = 0; // they come back on their own (runDirector)
  weights.package_pickup *= Math.min(onTheShelf(state).length, 3) / 2; // only for what's on the shelf
  if (state.printer.status === "printing") for (const k of DIRECTOR.quick) weights[k] *= DIRECTOR.interleave;
  if (crew) for (const k of Object.keys(weights) as Arrival[]) if (!CREW.kinds.includes(k)) weights[k] = 0; // (what they take)
  const entries = Object.entries(weights) as [Arrival, number][];
  let r = rng.director() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return "quick_copies";
}

// Brings them in. Returns whether they count toward the day's customers.
function arrive(sim: Sim, what: Arrival, crew: boolean): boolean {
  const { state, rng } = sim;
  if (crew) {
    const c = spawnCustomer(state, rng.director, what as Exclude<Arrival, "order_pickup" | "web_order">);
    c.crew = true;
    log(state, `${c.name} came in (${state.coworker!.name} is helping them).`);
    return true;
  }
  if (what === "web_order") {
    const job = placeWebOrder(state, rng.director);
    log(state, `Web order #${job.id} came in.`);
    return true;
  }
  const c = spawnCustomer(state, rng.director, what as Exclude<Arrival, "order_pickup" | "web_order">);
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
