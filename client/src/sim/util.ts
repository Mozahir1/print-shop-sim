// Small helpers shared by sim.ts and the systems it calls, kept here to avoid circular imports.
import type { Customer, GameState, Job, Package } from "./types";

export function log(state: GameState, text: string): void {
  state.log.push({ time: state.time, text });
  if (state.log.length > 400) state.log.shift();
}

// Fills {placeholders} in content text.
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------- lookups ----------

export function jobById(state: GameState, id: number): Job | undefined {
  return state.jobs.find((j) => j.id === id);
}

export function customerById(state: GameState, id: number): Customer | undefined {
  return state.customers.find((c) => c.id === id);
}

export function packageById(state: GameState, id: number): Package | undefined {
  return state.packages.find((p) => p.id === id);
}
