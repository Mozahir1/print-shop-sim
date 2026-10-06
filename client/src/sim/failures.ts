// Failures: every one is a moment you can see. It's logged (with names, for the end-of-day report), and the notable
// ones get a short note from the manager in the inbox. Heat is handled separately (consequences.ts).
import { emit } from "./bus";
import type { FailureKind, GameState, ManagerMood } from "./types";
import { HEAT } from "./config";
import { POOLS, pickLine, say } from "./lines";
import { fill, log } from "./util";

// Notes from the manager during the day, for the ones they'd hear about.
const NOTE: ReadonlySet<FailureKind> = new Set(["walked_out", "missing_order", "never_ready", "packages_left", "copier_broken", "lost_sale", "lost_business", "wrong_order"]);

export function recordFailure(state: GameState, kind: FailureKind, vars: Record<string, string | number>, ids: { customerId?: number; jobId?: number } = {}): void {
  const text = say(POOLS.failures, "failure", { kind, job: vars.job !== undefined ? "yes" : undefined }, 0, vars);
  state.failures.push({ time: state.time, kind, text, ...ids });
  log(state, text);
  emit("failure", { kind, text, customerId: ids.customerId });
  // One note per kind per day is plenty.
  if (NOTE.has(kind) && state.failures.filter((f) => f.kind === kind).length === 1) {
    const note = pickLine(POOLS.failures, "manager_note", { kind });
    state.messages.push({ id: state.nextId++, kind: "note", at: state.time, subject: note.subject ?? "", body: fill(note.text, vars), jobId: null, read: false, snoozed: false });
  }
}

// How the manager seems, for the UI. Never the number.
export function managerMood(heat: number): ManagerMood {
  return heat >= HEAT.writeUpAt ? "unhappy" : heat >= HEAT.warnAt ? "annoyed" : "calm";
}
