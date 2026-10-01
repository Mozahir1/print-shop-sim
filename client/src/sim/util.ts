// Small helpers shared by sim.ts and the systems it calls (shipping.ts, ...), kept here to avoid circular imports.
import type { Customer, GameState, Job, Printer, Vec } from "./types";
import { TUNING } from "./config";
import { lineSlot } from "./layout";

const MIN = 60;

export function log(state: GameState, text: string): void {
  state.log.push({ time: state.time, text });
  if (state.log.length > 300) state.log.shift();
}

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function walk(pos: Vec, target: Vec, step: number): void {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= step) {
    pos.x = target.x;
    pos.y = target.y;
  } else {
    pos.x += (dx / dist) * step;
    pos.y += (dy / dist) * step;
  }
}

export function near(a: Vec, b: Vec): boolean {
  return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;
}

export function clampRating(r: number): number {
  return Math.round(Math.max(1, Math.min(5, r)) * 10) / 10;
}

// ---------- lookups ----------

export function jobById(state: GameState, id: number): Job | undefined {
  return state.jobs.find((j) => j.id === id);
}

export function customerById(state: GameState, id: number): Customer | undefined {
  return state.customers.find((c) => c.id === id);
}

export function printerById(state: GameState, id: string): Printer | undefined {
  return state.printers.find((p) => p.id === id);
}

// ---------- the counter line ----------

export function lineCustomers(state: GameState): Customer[] {
  return state.customers.filter((c) => c.state === "line").sort((a, b) => a.lineTicket! - b.lineTicket!);
}

// The customer standing at the register, if they've walked up to it.
export function counterCustomer(state: GameState): Customer | undefined {
  const front = lineCustomers(state)[0];
  return front && near(front.pos, lineSlot(0)) ? front : undefined;
}

export function servingCustomerId(state: GameState): number | null {
  return state.employee.task?.customerId ?? null;
}

export function joinLine(state: GameState, c: Customer): void {
  c.state = "line";
  c.lineTicket = state.nextLineNo++;
  c.waitStart = state.time;
  c.seatedUntil = null;
}

// You started helping them: the wait in line is over and gets scored.
export function beginServing(state: GameState, c: Customer): void {
  if (c.waitStart === null) return;
  const waited = state.time - c.waitStart;
  c.lineWaitTotal += waited;
  c.penalty += Math.max(0, waited - TUNING.lineWaitGrace) / (5 * MIN); // a star per 5 extra minutes
  c.waitStart = null;
}

export function sendAway(c: Customer, visitAt: number | null): void {
  c.state = "leaving";
  c.lineTicket = null;
  c.selfServeTicket = null;
  c.waitStart = null;
  c.seatedUntil = null;
  c.visitAt = visitAt;
}
