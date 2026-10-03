// Choices, customer mood, and patience. Your attitude isn't graded: customers feel what happens to them.
import type { Choice, ChoiceType, CounterAction, Customer, CustomerOutcome, GameState, Mood, RequestKind } from "./types";
import { LEAVE_AFTER, MOOD, PATIENCE, PATIENCE_RAMP } from "./config";
import { jobById, log } from "./util";
import { onLeave } from "./consequences";
import { customerSay } from "./mc";

export function moodOf(c: Customer): Mood {
  return c.mood >= 1 ? "happy" : c.mood <= -1 ? "angry" : "neutral";
}

export function patienceFor(kind: RequestKind, day: number): number {
  return Math.round(PATIENCE[kind] * Math.max(PATIENCE_RAMP.min, 1 - PATIENCE_RAMP.perDay * (day - 1)));
}

export function choiceType(action: CounterAction): ChoiceType {
  return action === "turn_away" ? "dont" : action === "ignore" ? "ignore" : "do";
}

export function recordChoice(state: GameState, type: ChoiceType, what: Choice["what"], customerId?: number, extra: { action?: CounterAction; auto?: boolean } = {}): void {
  const c: Choice = { time: state.time, type, what, customerId };
  if (extra.action) c.action = extra.action;
  if (extra.auto) c.auto = true;
  state.choices.push(c);
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
export function leave(state: GameState, c: Customer, outcome: CustomerOutcome): void {
  c.state = "gone";
  c.outcome = outcome;
  c.leftAt = state.time;
  c.answerBy = null;
  if (outcome === "left") customerSay(c, "leaving_angry");
  else if (outcome === "served") customerSay(c, "mood", { mood: moodOf(c) });
  if (outcome === "served") state.stats.served++;
  if (outcome === "left") state.stats.left++;
  state.stats[moodOf(c)]++;
  const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
  if (outcome === "left" && job && job.status !== "picked_up") {
    const p = state.printer;
    p.queue = p.queue.filter((id) => id !== job.id); // nobody's coming for it
  }
  onLeave(state, c, outcome === "left");
}
