// End-of-shift numbers. summarize() is what the server stores; report() is what the player sees.
import type { GameState, Job } from "./types";
import { averageRating, profitCents, satisfaction, score } from "./sim";

export interface JobRecord {
  customerType: string;
  kind: string; // "bw" | "color" | "wide"
  pages: number; // sheets
  priceCents: number;
  outcome: "picked_up" | "abandoned" | "ready" | "unfinished";
  waitSeconds: number; // ordered -> picked up (or end of shift)
}

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

export function summarize(state: GameState, playerName: string, source: "human" | "bot"): ShiftSummary {
  const s = state.stats;
  return {
    playerName,
    source,
    seed: state.seed,
    score: score(state),
    cashCents: Math.max(0, state.revenueCents),
    satisfaction: Math.round(satisfaction(state)),
    customersServed: s.pickups + s.selfServed + s.shipments + s.dropoffs + s.packagePickups,
    customersLost: s.walkouts + s.balks + s.turnedAway + s.canceled + s.copierGaveUp,
    jams: s.jams,
    jobs: state.jobs.map((j) => ({
      customerType: j.profileId,
      kind: j.spec.media.startsWith("wide") ? "wide" : j.spec.color,
      pages: j.sheets,
      priceCents: j.priceCents,
      outcome: outcome(j),
      waitSeconds: Math.round(((j.closedAt ?? state.time) - j.orderedAt) * 10) / 10,
    })),
  };
}

function outcome(j: Job): JobRecord["outcome"] {
  if (j.status === "picked_up") return "picked_up";
  if (j.status === "canceled") return "abandoned";
  if (j.status === "ready") return "ready";
  return "unfinished";
}

export interface ShiftReport {
  revenueCents: number;
  costCents: number;
  profitCents: number;
  ordersTaken: number;
  webOrders: number;
  pickups: number;
  selfServed: number;
  selfServeRevenueCents: number;
  shipments: number;
  shippingRevenueCents: number;
  dropoffPackages: number;
  packagePickups: number;
  missedTruckPackages: number;
  refundsCents: number;
  callsAnswered: number;
  missedCalls: number;
  quoteLeads: number;
  serviceFeesCents: number;
  rushFeesCents: number;
  copierJams: number;
  copierGaveUp: number;
  breakdowns: number;
  recalls: number;
  wastedSheets: number;
  onTimePct: number | null; // orders finished by their due time, of those that were due today or finished
  avgLineWaitMin: number | null;
  avgRating: number | null;
  walkouts: number;
  balks: number;
  turnedAway: number;
  canceled: number;
  leftForTomorrow: number; // orders still open at close
  sheets: number;
  jams: number;
  busyPct: number;
  score: number;
}

export function report(state: GameState): ShiftReport {
  const s = state.stats;
  const due = state.jobs.filter((j) => j.status !== "canceled" && (j.readyAt !== null || (!j.dueTomorrow && j.dueAt <= state.time)));
  const onTime = due.filter((j) => j.readyAt !== null && (j.dueTomorrow || j.readyAt <= j.dueAt));
  const served = state.customers.filter((c) => c.lineWaitTotal > 0 || c.outcome !== null && c.outcome !== "balked" && c.outcome !== "pickup_later");
  const workedSeconds = Math.max(1, state.time);
  return {
    revenueCents: state.revenueCents,
    costCents: Math.round(state.costCents),
    profitCents: profitCents(state),
    ordersTaken: s.ordersTaken,
    webOrders: s.webOrders,
    pickups: s.pickups,
    selfServed: s.selfServed,
    selfServeRevenueCents: s.selfServeRevenueCents,
    shipments: s.shipments,
    shippingRevenueCents: s.shippingRevenueCents,
    dropoffPackages: s.dropoffPackages,
    packagePickups: s.packagePickups,
    missedTruckPackages: s.missedTruckPackages,
    refundsCents: s.refundsCents,
    callsAnswered: s.callsAnswered,
    missedCalls: s.missedCalls,
    quoteLeads: s.quoteLeads,
    serviceFeesCents: s.serviceFeesCents,
    rushFeesCents: s.rushFeesCents,
    copierJams: s.copierJams,
    copierGaveUp: s.copierGaveUp,
    breakdowns: s.breakdowns,
    recalls: s.recalls,
    wastedSheets: s.wastedSheets,
    onTimePct: due.length ? Math.round((onTime.length / due.length) * 100) : null,
    avgLineWaitMin: served.length ? served.reduce((a, c) => a + c.lineWaitTotal, 0) / served.length / 60 : null,
    avgRating: averageRating(state),
    walkouts: s.walkouts,
    balks: s.balks,
    turnedAway: s.turnedAway,
    canceled: s.canceled,
    leftForTomorrow: state.jobs.filter((j) => j.status !== "picked_up" && j.status !== "canceled" && j.status !== "ready").length,
    sheets: Math.round(s.sheets),
    jams: s.jams,
    busyPct: Math.round((state.employee.busySeconds / workedSeconds) * 100),
    score: score(state),
  };
}
