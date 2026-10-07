// Dev mode actions. Anything that changes the day marks it as dev-assisted (it can't be submitted).
import { tick, type Sim } from "./sim";
import type { GameState } from "./types";
import { formatClock } from "./time";
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

// Skipping ahead to what matters, for testing: the next thing that needs you, or a particular moment.
export type SkipTo = "next" | "customer" | "printed" | "truck" | "event" | "close";
export const SKIP_LABELS: Record<SkipTo, string> = {
  next: "Next thing (N)",
  customer: "Next customer",
  printed: "A job done printing",
  truck: "The truck",
  event: "Today's bad luck",
  close: "Closing time",
};

// What needs you right now, as keys (something new showing up is a moment worth stopping at).
function needs(s: GameState): Set<string> {
  const out = new Set<string>();
  for (const c of s.customers) if (c.state === "line") out.add(`line:${c.id}`);
  for (const j of s.jobs) if (j.status === "printed") out.add(`printed:${j.id}`);
  for (const m of s.messages) if (!m.read) out.add(`msg:${m.id}`);
  if (s.truck.status === "waiting") out.add("truck");
  if (s.event?.status === "active") out.add("event");
  if (s.printer.status === "jammed" || s.printer.status === "tray_empty") out.add(`printer:${s.printer.status}`);
  if (s.time >= s.closeAt) out.add("closed");
  return out;
}

// Runs the clock until it gets there (or the day ends). Returns what happened, for a toast.
export function skipTo(sim: Sim, to: SkipTo, act?: () => void): string {
  const s = sim.state;
  if (to === "truck" && s.truck.status !== "coming") return s.truck.status === "waiting" ? "The truck's already here." : "The truck's been and gone today.";
  if (to === "event" && s.event?.status !== "pending") return s.event?.status === "active" ? "Today's bad luck is already happening." : "No bad luck to come today. (Use the Bad luck buttons.)";
  if (to === "close" && s.time >= s.closeAt) return "It's already past closing.";
  const before = needs(s);
  const fresh = (prefix: string) => [...needs(s)].some((k) => k.startsWith(prefix) && !before.has(k));
  const done: Record<SkipTo, () => boolean> = {
    next: () => [...needs(s)].some((k) => !before.has(k)),
    customer: () => fresh("line:"),
    printed: () => fresh("printed:"),
    truck: () => s.truck.status !== "coming",
    event: () => s.event?.status !== "pending",
    close: () => s.time >= s.closeAt,
  };
  const start = s.time;
  const logged = s.log.length;
  s.devUsed = true;
  while (!s.over && !done[to]()) {
    act?.();
    tick(sim, 1);
  }
  const what = s.log.slice(logged).at(-1)?.text ?? "";
  return `Skipped ${s.time - start} min to ${formatClock(s.time)}.${what ? ` ${what}` : ""}`;
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
