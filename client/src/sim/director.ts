// The flow director: brings in the next customer (or the truck) so there's always something to do, but rarely
// more than two or three things at once. Every roll comes from its own stream.
import type { Customer, GameState } from "./types";
import { DIRECTOR, SHIPPING, type Arrival } from "./config";
import { randInt } from "./rng";
import { placeWebOrder, returnCustomer, spawnCustomer } from "./customers";
import { activeCount, isActive } from "./todo";
import { jobById, log } from "./util";
import type { Sim } from "./sim";

export interface DirectorState {
  enabled: boolean; // dev mode and tests can hold arrivals
  nextAt: number; // the next arrival at the regular pace
  floorAt: number | null; // set when active things dropped below the floor: arrive at this time instead
  arrivals: number; // new customers today (see DIRECTOR.maxPerDay)
}

export function createDirector(rng: () => number): DirectorState {
  return { enabled: true, nextAt: randInt(rng, ...DIRECTOR.firstArrival), floorAt: null, arrivals: 0 };
}

// Customers who left an order and could come back for it now: it's ready, or it's past when they said they'd come.
// Oldest first.
export function readyToReturn(state: GameState): Customer[] {
  return state.customers.filter((c) => {
    if (c.state !== "away" || c.jobId === null) return false;
    const job = jobById(state, c.jobId);
    return job !== undefined && job.status !== "picked_up" && (job.status === "bagged" || state.time >= job.pickupAt);
  });
}

export function runDirector(sim: Sim): void {
  const { state, rng } = sim;
  const d = state.director;
  const open = state.time < state.closeAt;
  const active = activeCount(state);

  // The truck comes at its time, unless you're at the ceiling; then it waits for room, or comes just after close
  // (the day doesn't end until it's been and gone).
  const t = state.truck;
  if (t.status === "coming" && state.time >= t.arrivesAt && (active < DIRECTOR.ceiling || state.time > state.closeAt)) {
    t.status = "waiting";
    t.leavesAt = state.time + SHIPPING.truckWaits;
    log(state, "The carrier truck is here.");
    return;
  }

  const truckDue = t.status === "coming" && state.time >= t.arrivesAt - DIRECTOR.truckHold; // make room for it
  const full = d.arrivals >= DIRECTOR.maxPerDay && state.manager.visitsDue.length === 0;
  if (!d.enabled || !open) return;
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
    arrive(sim, what);
    if (what !== "order_pickup") d.arrivals++;
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

function arrive(sim: Sim, what: Arrival): void {
  const { state, rng } = sim;
  if (what === "order_pickup") {
    const c = readyToReturn(state)[0];
    returnCustomer(state, c);
    log(state, `${c.name} came back for their order.`);
  } else if (what === "web_order") {
    const job = placeWebOrder(state, rng.director);
    log(state, `Web order #${job.id} came in.`);
  } else {
    const c = spawnCustomer(state, rng.director, what);
    log(state, `${c.name} came in.`);
  }
}
