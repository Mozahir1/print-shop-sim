// The schedule: who's on shift with you each day. It's posted ahead (you can see today and the next two days on the
// computer) and you have no say in it. Weighted random, never streaky: the longer since you worked with someone,
// the likelier they're on (by the square of the days), and nobody's on more than CREW.streak days in a row. Each day's pick is a keyed roll on
// the game's seed, so it's the same however you play.
import type { CoworkerDef } from "./types";
import { CREW } from "./config";
import { keyedRoll } from "./rng";
import data from "../data/coworkers.json";

export const COWORKERS = data.coworkers as CoworkerDef[];

export function coworkerDef(id: string): CoworkerDef {
  return COWORKERS.find((c) => c.id === id) ?? COWORKERS[0];
}

// What carries over between days about the crew (see game.ts).
export interface Crew {
  schedule: string[]; // coworker id per day (day 1 is [0]), filled in ahead
  relationship: Record<string, number>; // hidden, per coworker (phase 2)
  story: Record<string, number>; // how far into their stories (phase 2)
}

export function newCrew(): Crew {
  return { schedule: [], relationship: {}, story: {} };
}

// Fills the schedule in through `day`, and returns it.
export function planSchedule(crew: Crew, seed: number, day: number): string[] {
  const s = crew.schedule;
  while (s.length < day) {
    const d = s.length + 1;
    const streak = s.length >= CREW.streak && s.slice(-CREW.streak).every((x) => x === s[s.length - 1]) ? s[s.length - 1] : null;
    const weights = COWORKERS.map((c) => {
      if (c.id === streak) return 0;
      const last = s.lastIndexOf(c.id);
      return (1 + (last < 0 ? d : d - 1 - last)) ** 2; // days since you last worked together (squared: it adds up fast)
    });
    let r = keyedRoll(seed, "schedule", d) * weights.reduce((a, b) => a + b, 0);
    let pick = COWORKERS.findIndex((_, i) => (r -= weights[i]) < 0);
    if (pick < 0) pick = weights.findIndex((w) => w > 0);
    s.push(COWORKERS[pick].id);
  }
  return s;
}
