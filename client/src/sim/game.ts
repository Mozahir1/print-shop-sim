// A game is a run of days. Only a few things carry over from one day to the next: the day number, manager heat,
// write-ups, things still to come back (flags), orders not picked up yet, and packages that didn't go out.
// Money, supplies, and machines start fresh every morning.
import { coworkerDef, newCrew, planSchedule, type Crew } from "./schedule";
import { fill } from "./util";
import type { Customer, Flag, HeatCause, Job, MessageDraft, Package } from "./types";
import { createSim, type Sim } from "./sim";
import { FLAGS, HEAT } from "./config";
import { keyedRoll } from "./rng";
import { draft } from "./consequences";
import { pickLine, POOLS, say } from "./lines";

export type ManagerOutcome = "none" | "warning" | "write_up" | "fired";

// How the day went, for the end-of-day screen. Heat itself is never shown.
export interface DayResult {
  day: number;
  outcome: ManagerOutcome;
  clean: boolean; // no complaints: a hollow reward is waiting tomorrow
}

// The end scene, once you're fired. The only ending, for now.
export interface Ending {
  cause: HeatCause;
  text: string; // what happened
  message: string; // the manager's last message
  mc: string; // what the MC says about it
}

export interface Game {
  version: 3; // bumped when saved state changes shape (old saves just don't load)
  baseSeed: number;
  day: number; // the day being played (or next to play)
  nextId: number; // ids stay unique across days
  carried: { customers: Customer[]; jobs: Job[]; packages: Package[] };
  heat: number; // hidden
  writeUps: number;
  flags: Flag[];
  morning: MessageDraft[]; // tomorrow's inbox
  causes: Record<HeatCause, number>; // all heat ever added, by cause: picks the ending if you're fired
  rewards: number; // hollow rewards given (picks the next one)
  fired: boolean;
  ending: Ending | null;
  results: DayResult[];
  crew: Crew; // the schedule (who's on with you each day), and how things stand with each coworker
}

export function newGame(baseSeed: number): Game {
  return {
    version: 3,
    baseSeed,
    day: 1,
    nextId: 1,
    carried: { customers: [], jobs: [], packages: [] },
    heat: 0,
    writeUps: 0,
    flags: [],
    morning: [],
    causes: { complaints: 0, ignoring: 0, lost_sales: 0, overtime: 0 },
    rewards: 0,
    fired: false,
    ending: null,
    results: [],
    crew: newCrew(),
  };
}

// What got you fired: whichever cause added the most heat over the whole game.
export function firedFor(game: Game): HeatCause {
  const c = game.causes;
  return (Object.keys(c) as HeatCause[]).reduce((a, b) => (c[b] > c[a] ? b : a));
}

export function daySeed(game: Game): number {
  return (game.baseSeed + game.day) >>> 0;
}

export function startDay(game: Game): Sim {
  const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
  const schedule = planSchedule(game.crew, game.baseSeed, game.day + 2); // (posted ahead: today and the next two days)
  const coworker = schedule[game.day - 1];
  return createSim(daySeed(game), {
    coworker,
    crewRelationship: game.crew.relationship[coworker] ?? 0,
    crewStory: game.crew.story[coworker] ?? 0,
    schedule: schedule.slice(game.day - 1, game.day + 2),
    day: game.day,
    nextId: game.nextId,
    ...copy(game.carried),
    heat: game.heat,
    flags: copy(game.flags),
    morning: copy(game.morning),
  });
}

// Call once the day is over. The manager reacts to how the day went, then whatever carries over is kept and the
// game moves on to the next day (unless you were fired).
export function endDay(game: Game, sim: Sim): DayResult {
  const s = sim.state;
  const m = s.manager;
  const morning: MessageDraft[] = [...m.morning, ...m.scheduled.map((d) => ({ ...d, at: 0 }))];
  const flags = [...m.flags];
  // Packages that missed the truck (you let it go, or left it waiting): someone hears about it. (Ones that came in
  // after it had been just go tomorrow.)
  const left = s.packages.filter((p) => p.status === "binned" || p.status === "labeled");
  if (left.length && !s.truck.handedOff) {
    const owner = s.customers.find((c) => c.id === left[0].customerId);
    flags.push({ kind: "packages_left", dueDay: s.day + 1, dueAt: 0, name: owner?.name ?? "A customer" });
  }

  // The manager looks at the day (heat at close).
  let heat = m.heat;
  let outcome: ManagerOutcome = "none";
  if (heat >= HEAT.writeUpAt) {
    game.writeUps++;
    heat -= HEAT.writeUpRelief;
    outcome = game.writeUps >= HEAT.writeUpsToFire ? "fired" : "write_up";
  } else if (heat >= HEAT.warnAt) outcome = "warning";
  // (The note says why: whatever added the most heat today.)
  const why = (Object.keys(m.heatBy) as HeatCause[]).reduce((a, b) => (m.heatBy[b] > m.heatBy[a] ? b : a));
  const reason = say(POOLS.messages, "reason", { cause: why });
  if (outcome === "write_up") morning.push(draft("write_up", { reason, count: game.writeUps }, 0, 0, "complaints"));
  if (outcome === "warning") morning.push(draft("warning", { reason }, 0, 0, "complaints"));
  // The coworker: how things stand with them, and how far into their story, carry over. And if they're the kind who
  // never gets in trouble (the owner's son), the manager's memo praises them whatever happened.
  const cw = s.coworker;
  if (cw) {
    game.crew.relationship[cw.id] = cw.relationship;
    game.crew.story[cw.id] = cw.story;
    if (coworkerDef(cw.id).hooks.includes("never_in_trouble")) {
      const line = pickLine(POOLS.messages, "crew_praise", {}, s.day);
      morning.push({ kind: "note", from: "Manager", subject: fill(line.subject ?? "", { name: cw.name }), body: fill(line.text, { name: cw.name }), at: 0, heat: 0, cause: "complaints" });
    }
  }
  const clean = m.complaints === 0;
  if (clean) {
    heat -= HEAT.cleanDayCool;
    morning.push(draft("reward", {}, 0, 0, "complaints", game.rewards++));
  }
  for (const k of Object.keys(m.heatBy) as HeatCause[]) game.causes[k] += m.heatBy[k];
  game.heat = Math.max(0, Math.round(heat * (1 - HEAT.overnightCool)));
  game.morning = morning;
  game.flags = flags;
  const result: DayResult = { day: s.day, outcome, clean };
  game.results.push(result);
  if (outcome === "fired") {
    game.fired = true;
    const cause = firedFor(game);
    game.ending = {
      cause,
      text: say(POOLS.endings, "ending", { cause }),
      message: say(POOLS.messages, "fired", {}, 0, { reason: say(POOLS.messages, "reason", { cause }) }),
      mc: say(POOLS.mc, "fired", {}, game.day),
    };
  }

  const jobs = s.jobs.filter((j) => j.status !== "picked_up" && s.customers.some((c) => c.id === j.customerId && c.state === "away"));
  for (const j of jobs) {
    // Nothing stays in the printer overnight: whatever was queued or half-printed gets sent again.
    if (j.status === "queued" || j.status === "printing") {
      j.status = "entered";
      j.sheetsPrinted = 0;
    }
    // Times are per day: they come back for it in the morning.
    j.pickupAt = Math.floor(FLAGS.morningAt[0] + keyedRoll(s.seed, "carried", j.id) * (FLAGS.morningAt[1] - FLAGS.morningAt[0] + 1));
  }
  const customers = s.customers.filter((c) => jobs.some((j) => j.customerId === c.id));
  const packages = s.packages.filter((p) => p.status === "labeled" || p.status === "scanned" || p.status === "binned");
  // The pickup shelf stays as it is: whatever nobody came for is still there tomorrow.
  for (const p of s.packages) if (p.kind === "held" && (p.status === "held" || p.status === "found")) packages.push({ ...p, status: "held", customerId: 0 });
  game.carried = { customers, jobs, packages };
  game.nextId = s.nextId;
  if (!game.fired) game.day++;
  return result;
}

// Saving is just JSON; the UI keeps it in localStorage.
export function saveGame(game: Game): string {
  return JSON.stringify(game);
}

export function loadGame(text: string | null): Game | null {
  if (!text) return null;
  try {
    const g = JSON.parse(text) as Game;
    return g && g.version === 3 && typeof g.day === "number" ? g : null;
  } catch {
    return null;
  }
}
