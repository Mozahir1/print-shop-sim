// Dev mode actions. Anything that changes the day marks it as dev-assisted (it can't be submitted).
import { tick, type Sim } from "./sim";
import { placeWebOrder, spawnCustomer } from "./customers";
import { triggerEvent } from "./events";
import type { EventKind, RequestKind } from "./types";

// Runs the clock ahead. `act` runs before each second (e.g. a bot taking its turn).
export function skipSeconds(sim: Sim, seconds: number, act?: () => void): void {
  sim.state.devUsed = true;
  for (let i = 0; i < seconds && !sim.state.over; i++) {
    act?.();
    tick(sim, 1);
  }
}

// Runs the clock to the end of the day.
export function skipToClose(sim: Sim, act?: () => void): void {
  skipSeconds(sim, Infinity, act);
}

export function devEvent(sim: Sim, kind: EventKind): string | null {
  sim.state.devUsed = true;
  return triggerEvent(sim, kind);
}

// Sends someone in now, from the dev stream (it doesn't change who else comes in).
export function devSpawn(sim: Sim, kind: Exclude<RequestKind, "order_pickup"> | "web_order"): void {
  sim.state.devUsed = true;
  if (kind === "web_order") placeWebOrder(sim.state, sim.rng.dev);
  else spawnCustomer(sim.state, sim.rng.dev, kind);
}

export function setArrivals(sim: Sim, on: boolean): void {
  sim.state.devUsed = true;
  sim.state.director.enabled = on;
}
