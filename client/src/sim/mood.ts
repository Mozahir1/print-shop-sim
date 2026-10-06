// Choices, customer mood, and patience. Your attitude isn't graded: customers feel what happens to them.
import { emit } from "./bus";
import type { Choice, ChoiceType, CounterAction, Customer, CustomerOutcome, GameState, Mood, PatienceStage, RequestKind } from "./types";
import { BUSY_PATIENCE, BUSY_PATIENCE_BUSINESS, GIVE_UP, MOOD, PATIENCE_RAMP, PATIENCE_STAGES } from "./config";
import { isOverdue, jobById, log } from "./util";
import { recordFailure } from "./failures";
import { lostBusiness, onLeave } from "./consequences";
import { fullServiceQuote } from "./orders";
import { customerSay } from "./mc";

export function moodOf(c: Customer): Mood {
  return c.mood >= 1 ? "happy" : c.mood <= -1 ? "angry" : "neutral";
}

export function giveUpFor(kind: RequestKind, day: number): number {
  return Math.round(GIVE_UP[kind] * Math.max(PATIENCE_RAMP.min, 1 - PATIENCE_RAMP.perDay * (day - 1)));
}

export function stageFor(c: Customer): PatienceStage {
  const f = c.waited / c.giveUp;
  return f >= 1 ? "gone" : f >= PATIENCE_STAGES.angry ? "angry" : f >= PATIENCE_STAGES.annoyed ? "annoyed" : "fine";
}

// A fresh visit (or a fresh promise): their patience starts over.
export function resetPatience(state: GameState, c: Customer): void {
  c.waited = 0;
  c.stage = "fine";
  c.giveUp = giveUpFor(c.kind, state.day);
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

// Customers in the store use up patience while nobody's helping them: in line, at the counter, and waiting for an
// order once it's overdue (more slowly while you're busy with someone else: they can see it). Fine, annoyed ("Hello?"), angry ("Is anyone working here?"), then they leave.
export function runPatience(state: GameState, dt: number): void {
  const helping = state.workflow?.customerId ?? state.employee.task?.customerId;
  const busy = state.workflow !== null || state.employee.task !== null;
  for (const c of state.customers) {
    if (c.state !== "line" && c.state !== "talking" && c.state !== "waiting") continue;
    if (helping === c.id || c.lingering) continue; // a lingerer isn't going anywhere
    const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
    if (c.state === "waiting" && job && job.status !== "bagged" && !isOverdue(state, job)) continue; // it isn't due yet
    wear(state, c, busy ? dt * (c.kind === "business" ? BUSY_PATIENCE_BUSINESS : BUSY_PATIENCE) : dt); // they can see you're busy
  }
}

// Uses up some of their patience, saying so as it runs out.
export function wear(state: GameState, c: Customer, minutes: number): void {
  c.waited += minutes;
  const stage = stageFor(c);
  if (stage === c.stage) return;
  c.stage = stage;
  emit("mood_changed", { customerId: c.id, stage });
  if (stage === "annoyed") customerSay(c, "annoyed", {}, state.time);
  if (stage === "angry") {
    c.mood += MOOD.fedUp;
    customerSay(c, "angry", {}, state.time);
    log(state, `${c.name} is getting angry.`);
  }
  if (stage === "gone") walkOut(state, c);
}

// Waited far too long: they leave angry, and whatever they were waiting on stays here.
export function walkOut(state: GameState, c: Customer): void {
  c.mood = Math.min(c.mood, -1);
  const inLine: Record<string, string | number> = c.state === "line" ? { where: "line", minutes: Math.max(1, Math.round(state.time - c.arrivedAt)) } : {};
  const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
  const open = job && job.status !== "picked_up" && job.status !== "canceled";
  leave(state, c, "left");
  if (c.kind === "business" && !job) return lostBusiness(state, c, fullServiceQuote(c.spec!, false).totalCents);
  recordFailure(state, open ? "never_ready" : "walked_out", open ? { name: c.name, job: job.id } : { name: c.name, ...inLine }, { customerId: c.id, jobId: job?.id });
}

// A customer leaves the store for good. Their mood at that moment is how the visit went.
export function leave(state: GameState, c: Customer, outcome: CustomerOutcome): void {
  c.state = "gone";
  c.outcome = outcome;
  c.leftAt = state.time;
  c.answerBy = null;
  if (outcome === "left") customerSay(c, "leaving_angry", {}, state.time);
  else if (outcome === "served") customerSay(c, "mood", { mood: moodOf(c) }, state.time);
  if (outcome === "served") state.stats.served++;
  if (outcome === "left") state.stats.left++;
  state.stats[moodOf(c)]++;
  const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
  if (outcome === "left" && job && job.status !== "picked_up") {
    const p = state.printer;
    p.queue = p.queue.filter((id) => id !== job.id); // nobody's coming for it
  }
  onLeave(state, c, outcome === "left");
  emit("customer_left", { customerId: c.id, mood: moodOf(c) });
}
