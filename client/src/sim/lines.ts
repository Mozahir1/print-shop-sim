// All dialogue, MC lines, messages, event text, and endings live in src/data/*.json as tagged lines:
//   { "speaker": "customer", "moment": "request", "request": "ship", "text": "..." }
// A line fits a situation when every tag it has matches (a tag it doesn't have matches anything). The most specific
// fitting lines win, and n picks among them, so the same situation always gets the same line. New tags (a customer
// trait, a coworker as speaker) need only data, no code. Speaker only filters when the situation names one.
import mc from "../data/mc.json";
import customers from "../data/customers.json";
import messages from "../data/messages.json";
import endings from "../data/endings.json";
import events from "../data/events.json";
import failures from "../data/failures.json";
import { fill } from "./util";

export interface Line {
  moment: string;
  text: string;
  subject?: string;
  [tag: string]: string | undefined;
}

export const POOLS = {
  mc: mc.lines as Line[],
  customers: customers.lines as Line[],
  messages: messages.lines as Line[],
  endings: endings.lines as Line[],
  events: events.lines as Line[],
  failures: failures.lines as Line[],
};

const NOT_TAGS = new Set(["moment", "text", "subject"]);

export function pickLine(pool: Line[], moment: string, ctx: Record<string, string | undefined> = {}, n = 0): Line {
  let best: Line[] = [];
  let bestScore = -1;
  for (const line of pool) {
    if (line.moment !== moment) continue;
    // Speaker narrows things down only when you ask for one (everything has one).
    const tags = Object.keys(line).filter((k) => !NOT_TAGS.has(k) && (k !== "speaker" || ctx.speaker !== undefined));
    if (!tags.every((k) => ctx[k] === line[k])) continue;
    if (tags.length > bestScore) {
      best = [line];
      bestScore = tags.length;
    } else if (tags.length === bestScore) best.push(line);
  }
  if (!best.length) throw new Error(`No line for ${moment} ${JSON.stringify(ctx)}`);
  return best[Math.abs(n) % best.length];
}

// The line's text with {placeholders} filled.
export function say(pool: Line[], moment: string, ctx: Record<string, string | undefined> = {}, n = 0, vars: Record<string, string | number> = {}): string {
  return fill(pickLine(pool, moment, ctx, n).text, vars);
}
