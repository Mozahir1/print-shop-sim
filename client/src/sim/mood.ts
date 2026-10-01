// Choices and customer mood. How you handle people decides how they feel; waiting too long does too.
import type { Choice, ChoiceType, CounterChoice, Customer, GameState, Mood, RequestKind } from "./types";
import { LEAVE_AFTER, MOOD, PATIENCE, PATIENCE_RAMP } from "./config";
import { keyedRoll } from "./rng";
import { jobById, log } from "./util";
import { onLeave } from "./consequences";
import { customerSay } from "./mc";

export function moodOf(c: Customer): Mood {
  return c.mood >= 1 ? "happy" : c.mood <= -1 ? "angry" : "neutral";
}

export function patienceFor(kind: RequestKind, day: number): number {
  return Math.round(PATIENCE[kind] * Math.max(PATIENCE_RAMP.min, 1 - PATIENCE_RAMP.perDay * (day - 1)));
}

export function recordChoice(state: GameState, type: ChoiceType, what: Choice["what"], customerId?: number, auto?: boolean): void {
  state.choices.push({ time: state.time, type, what, customerId, ...(auto ? { auto } : {}) });
}

// What answering a customer does to their mood. "Usually" outcomes are keyed rolls (see keyedRoll).
export function counterMoodChange(state: GameState, c: Customer, choice: CounterChoice): number {
  const roll = keyedRoll(state.seed, "mood", c.id, c.choices);
  switch (choice) {
    case "proper":
      return MOOD.proper;
    case "minimum":
      return roll < MOOD.minimumSourChance ? MOOD.minimumSour : MOOD.minimum;
    case "rude":
      return roll < MOOD.rudeShrugChance ? MOOD.rudeShrug : MOOD.rude;
    case "ignore":
      return MOOD.ignore;
  }
}

// Customers who are in the store use up patience while they wait, in line and for their order.
export function runPatience(state: GameState, dt: number): void {
  for (const c of state.customers) {
    if (c.state !== "line" && c.state !== "talking" && c.state !== "waiting") continue;
    if (state.employee.task?.customerId === c.id) continue; // you're helping them right now
    c.waited += dt;
    if (!c.fedUp && c.waited > c.patience) {
      c.fedUp = true;
      c.mood += MOOD.fedUp;
      customerSay(c, "waiting_too_long");
      log(state, `${c.name} has been waiting a long time.`);
    }
    if (c.waited > c.patience * LEAVE_AFTER) walkOut(state, c);
  }
}

// Waited far too long: they leave angry, and whatever they were waiting on stays here.
export function walkOut(state: GameState, c: Customer): void {
  c.mood = Math.min(c.mood, -1);
  leave(state, c, "left");
  log(state, `${c.name} gave up and left.`);
}

// A customer leaves the store for good. Their mood at that moment is how the visit went.
export function leave(state: GameState, c: Customer, outcome: "served" | "left"): void {
  c.state = "gone";
  c.outcome = outcome;
  c.leftAt = state.time;
  c.answerBy = null;
  if (outcome === "left" && moodOf(c) === "angry") customerSay(c, "leaving_angry");
  else customerSay(c, "mood", moodOf(c));
  if (outcome === "served") state.stats.served++;
  else state.stats.left++;
  state.stats[moodOf(c)]++;
  const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
  if (outcome === "left" && job && job.status !== "picked_up") {
    const p = state.printer;
    p.queue = p.queue.filter((id) => id !== job.id); // nobody's coming for it
  }
  onLeave(state, c, outcome === "left");
}
