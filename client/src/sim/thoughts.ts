// The MC's thought bubbles: short, dry, never changing in tone. Lines live in src/data/mc_thoughts.json, keyed by
// trigger (day start, a coworker's request, a coworker gone missing, a customer's trait, bad luck, a failure, a hollow
// reward) and conditions (which coworker, which trait): the most specific line that fits wins. A cooldown keeps them
// from piling up. Which line is the count of thoughts so far: never how you've been playing.
import type { GameState } from "./types";
import { THOUGHTS } from "./config";
import { pickLine, type Line } from "./lines";
import data from "../data/mc_thoughts.json";

export const THOUGHT_LINES = data.lines as Line[];

export function think(state: GameState, trigger: string, ctx: Record<string, string | undefined> = {}): void {
  const last = state.thoughts[state.thoughts.length - 1];
  if (last && trigger !== "day_start" && state.time - last.time < THOUGHTS.cooldown) return;
  if (!THOUGHT_LINES.some((l) => l.moment === trigger)) return;
  const text = pickLine(THOUGHT_LINES, trigger, ctx, state.day + state.thoughts.length).text;
  state.thoughts.push({ time: state.time, trigger, text });
}

// The thought that's up now (they last a little while), or null.
export function currentThought(state: GameState): string | null {
  const last = state.thoughts[state.thoughts.length - 1];
  return last && state.time - last.time <= THOUGHTS.shownFor ? last.text : null;
}
