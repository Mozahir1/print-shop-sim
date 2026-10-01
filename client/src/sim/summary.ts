// End-of-day numbers. report() is the satirical corporate report the player sees; summarize() is what the server
// stores (its shape is fixed: the server and SQL don't change).
import type { GameState, Job } from "./types";
import type { DayResult } from "./game";
import { POOLS, say } from "./lines";

export interface JobRecord {
  customerType: string;
  kind: string; // "bw" | "color"
  pages: number; // sheets
  priceCents: number;
  outcome: "picked_up" | "abandoned" | "ready" | "unfinished";
  waitSeconds: number;
}

// The shape the server's POST /api/shifts accepts. Don't change it without changing the server.
export interface ShiftSummary {
  playerName: string;
  source: "human" | "bot";
  seed: number;
  score: number;
  cashCents: number;
  satisfaction: number;
  customersServed: number;
  customersLost: number;
  jams: number;
  jobs: JobRecord[];
}

// Share of customers who left happy, 0 to 100.
export function happyPct(state: GameState): number {
  const s = state.stats;
  const all = s.happy + s.neutral + s.angry;
  return all ? Math.round((s.happy / all) * 100) : 100;
}

function badLuckCount(state: GameState): number {
  return state.event && state.event.status !== "pending" ? 1 : 0;
}

export function summarize(state: GameState, playerName: string, source: "human" | "bot"): ShiftSummary {
  return {
    playerName,
    source,
    seed: state.seed,
    score: state.stats.served,
    cashCents: Math.max(0, state.revenueCents),
    satisfaction: happyPct(state),
    customersServed: state.stats.served,
    customersLost: state.stats.angry,
    jams: badLuckCount(state),
    jobs: state.jobs.map((j) => ({
      customerType: j.kind,
      kind: j.spec.color,
      pages: j.sheets,
      priceCents: j.priceCents,
      outcome: jobOutcome(state, j),
      waitSeconds: Math.round(((j.closedAt ?? state.time) - j.orderedAt) * 10) / 10,
    })),
  };
}

function jobOutcome(state: GameState, j: Job): JobRecord["outcome"] {
  if (j.status === "picked_up") return "picked_up";
  if (state.customers.find((c) => c.id === j.customerId)?.outcome === "left") return "abandoned";
  if (j.status === "bagged") return "ready";
  return "unfinished";
}

export interface DayReport {
  day: number;
  served: number;
  happyPct: number;
  complaints: number;
  upsellsMissed: number;
  teamSpirit: number; // meaningless, on purpose
  revenueCents: number;
  sheets: number;
  tone: string; // a line from the manager outcome; never the heat itself
}

export function report(state: GameState, result: DayResult): DayReport {
  return {
    day: state.day,
    served: state.stats.served,
    happyPct: happyPct(state),
    complaints: state.manager.complaints,
    upsellsMissed: state.stats.upsellsMissed,
    teamSpirit: 60 + ((state.seed * 37 + Math.round(state.stats.sheets)) % 39),
    revenueCents: state.revenueCents,
    sheets: Math.round(state.stats.sheets),
    tone: say(POOLS.messages, "tone", { outcome: result.outcome }),
  };
}
