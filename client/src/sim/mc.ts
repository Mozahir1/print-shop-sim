// The MC: apathetic, dry, and exactly the same no matter what you do. You choose actions, not attitude.
// Monologue lines show as captions; which variant is said is picked deterministically.
import type { CounterChoice, Customer, GameState } from "./types";
import { POOLS, say } from "./lines";

export type Moment =
  | "greeting"
  | CounterChoice
  | "lazy"
  | "bad_luck"
  | "hollow_reward"
  | "warning"
  | "write_up"
  | "start_of_day"
  | "end_of_day"
  | "fired";

export function mcSay(state: GameState, moment: Moment, ctx: Record<string, string | undefined> = {}): string {
  // Variant by day and by how often this moment has come up: never by how you've been playing.
  const n = state.day + state.captions.filter((x) => x.moment === moment).length;
  const text = say(POOLS.mc, moment, ctx, n);
  state.captions.push({ time: state.time, moment, text });
  return text;
}

// What the MC would say for each answer to this customer (the choice buttons read exactly this).
export function answerLine(state: GameState, c: Customer, choice: CounterChoice): string {
  return say(POOLS.mc, choice, { request: c.kind }, c.id + c.choices);
}

export type CustomerMoment = "request" | "waiting_too_long" | "mood" | "leaving_angry";

// The customer says something. Their mood only ever shows through what they say.
export function customerSay(c: Customer, moment: CustomerMoment, mood?: string): void {
  c.said = say(POOLS.customers, moment, { request: c.kind, about: c.about ?? undefined, mood }, c.id);
}
