// The MC: apathetic, dry, and exactly the same no matter what you do. You choose actions, not attitude, and the MC's
// lines are reactions and monologue only. Which variant is said is picked deterministically.
import type { Customer, GameState } from "./types";
import { POOLS, say } from "./lines";

export type Moment = "greeting" | "bad_luck" | "hollow_reward" | "warning" | "write_up" | "start_of_day" | "end_of_day" | "fired";

export function mcSay(state: GameState, moment: Moment, ctx: Record<string, string | undefined> = {}): string {
  // Variant by day and by how often this moment has come up: never by how you've been playing.
  const n = state.day + state.captions.filter((x) => x.moment === moment).length;
  const text = say(POOLS.mc, moment, ctx, n);
  state.captions.push({ time: state.time, moment, text });
  return text;
}

export type CustomerMoment = "request" | "waiting_too_long" | "mood" | "leaving_angry" | "reaction";

// How a customer responds at the counter.
export type Reaction = "accept_self_serve" | "refuse_self_serve" | "balk_fee" | "balk_rush" | "too_late" | "accept_later" | "turned_away";

// The customer says something. Their mood only ever shows through what they say.
export function customerSay(c: Customer, moment: CustomerMoment, extra: { mood?: string; reaction?: Reaction } = {}): void {
  c.said = say(POOLS.customers, moment, { request: c.kind, about: c.about ?? undefined, ...extra }, c.id);
}
