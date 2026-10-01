// Consequences: manager heat (hidden), complaints, and things you did that come back later.
// "Usually" outcomes are keyed rolls, so the same choices always lead to the same consequences.
import type { CounterChoice, Customer, Flag, GameState, HeatCause, ManagerState, MessageDraft, MessageKind } from "./types";
import { COMPLAINT_CHANCE, COMPLAINT_DELAY, COMPLAINT_SAME_DAY, FLAGS, HEAT } from "./config";
import { keyedRoll } from "./rng";
import { fill, log } from "./util";
import { moodOf } from "./mood";
import { pickLine, POOLS } from "./lines";
import { mcSay } from "./mc";

type MessagePool = Exclude<MessageKind, "web_order" | "note"> | "packages_left";

export function createManager(heat = 0, flags: Flag[] = [], morning: MessageDraft[] = []): ManagerState {
  return { heat, heatBy: { complaints: 0, ignoring: 0, rude: 0 }, complaints: 0, flags, scheduled: [], morning, visitsDue: [] };
}

export function addHeat(state: GameState, amount: number, cause: HeatCause): void {
  const m = state.manager;
  m.heat = Math.max(0, Math.min(100, m.heat + amount));
  m.heatBy[cause] += amount;
}

// A message from the pool for this kind. `index` picks a variant deterministically.
export function draft(pool: MessagePool, vars: Record<string, string | number>, at: number, heat: number, cause: HeatCause, index = 0): MessageDraft {
  const line = pickLine(POOLS.messages, pool, {}, index);
  const kind: MessageKind = pool === "packages_left" ? "complaint" : pool;
  return { kind, subject: fill(line.subject ?? "", vars), body: fill(line.text, vars), at, heat, cause };
}

export function deliver(state: GameState, d: MessageDraft): void {
  state.messages.push({ id: state.nextId++, kind: d.kind, at: state.time, subject: d.subject, body: d.body, jobId: null, read: false, snoozed: false });
  if (d.heat) addHeat(state, d.heat, d.cause);
  if (d.kind === "reward") mcSay(state, "hollow_reward");
  if (d.kind === "warning") mcSay(state, "warning");
  if (d.kind === "write_up") mcSay(state, "write_up");
}

function between(roll: number, [lo, hi]: [number, number]): number {
  return lo + Math.floor(roll * (hi - lo + 1));
}

// ---------- hooks: called where things happen ----------

export function onAnswer(state: GameState, c: Customer, choice: CounterChoice): void {
  if (choice === "ignore") addHeat(state, HEAT.ignore, "ignoring");
  if (choice === "rude") {
    addHeat(state, HEAT.rude, "rude");
    if (keyedRoll(state.seed, "review", c.id, c.choices) < FLAGS.rudeReviewChance) {
      addFlag(state, { kind: "bad_review", dueDay: state.day + 1, dueAt: 0, name: c.name });
    }
  }
}

// A customer left the store for good: how they felt decides whether the manager hears about it.
export function onLeave(state: GameState, c: Customer, walkedOut: boolean): void {
  const mood = moodOf(c);
  if (walkedOut) addHeat(state, HEAT.walkout, "ignoring");
  if (mood === "angry") addHeat(state, HEAT.angryLeft, angerCause(state, c));
  const roll = keyedRoll(state.seed, "complaint", c.id, state.day);
  if (roll >= COMPLAINT_CHANCE[mood]) return;
  state.manager.complaints++;
  const cause = angerCause(state, c);
  const timing = keyedRoll(state.seed, "complaint-when", c.id, state.day);
  const at = state.time + between(keyedRoll(state.seed, "complaint-delay", c.id), COMPLAINT_DELAY);
  const msg = draft("complaint", { name: c.name }, at, HEAT.complaint, cause);
  if (timing < COMPLAINT_SAME_DAY && at < state.closeAt) state.manager.scheduled.push(msg);
  else state.manager.morning.push({ ...msg, at: 0 });
}

// What a customer is mostly unhappy about, for when getting fired needs a reason.
function angerCause(state: GameState, c: Customer): HeatCause {
  const mine = state.choices.filter((x) => x.customerId === c.id);
  if (mine.some((x) => x.type === "rude")) return "rude";
  if (c.ignored > 0 || c.outcome === "left") return "ignoring";
  return "complaints";
}

// Smudged copies went out the door: they come back, today or tomorrow.
export function onSmudgedHandedOver(state: GameState, c: Customer): void {
  const sameDay = keyedRoll(state.seed, "smudge-back", c.id) < FLAGS.smudgeSameDay;
  const at = state.time + between(keyedRoll(state.seed, "smudge-delay", c.id), FLAGS.smudgeDelay);
  if (sameDay && at < state.closeAt) addFlag(state, { kind: "smudged_return", dueDay: state.day, dueAt: at, name: c.name });
  else addFlag(state, { kind: "smudged_return", dueDay: state.day + 1, dueAt: morningAt(state, c.id), name: c.name });
}

// A taped-shut box went out: it comes back damaged in a day or two.
export function onTapedBoxShipped(state: GameState, packageId: number, name: string): void {
  const days = between(keyedRoll(state.seed, "box-days", packageId), FLAGS.damagedBoxDays);
  addFlag(state, { kind: "damaged_box", dueDay: state.day + days, dueAt: morningAt(state, packageId), name });
}

function morningAt(state: GameState, key: number): number {
  return between(keyedRoll(state.seed, "morning", key), FLAGS.morningAt);
}

function addFlag(state: GameState, f: Flag): void {
  state.manager.flags.push(f);
}

// ---------- every tick ----------

export function runConsequences(state: GameState): void {
  const m = state.manager;
  const now = m.scheduled.filter((d) => d.at <= state.time);
  if (now.length) {
    m.scheduled = m.scheduled.filter((d) => d.at > state.time);
    for (const d of now) deliver(state, d);
  }
  const due = m.flags.filter((f) => f.dueDay <= state.day && f.dueAt <= state.time);
  if (!due.length) return;
  m.flags = m.flags.filter((f) => !due.includes(f));
  for (const f of due) fire(state, f);
}

function fire(state: GameState, f: Flag): void {
  switch (f.kind) {
    case "bad_review":
      return deliver(state, draft("review", { name: f.name }, state.time, HEAT.complaint, "rude"));
    case "packages_left":
      return deliver(state, draft("packages_left", { name: f.name }, state.time, HEAT.flag, "ignoring"));
    case "damaged_box":
    case "smudged_return":
      addHeat(state, HEAT.flag, "complaints");
      state.manager.visitsDue.push({ name: f.name, about: f.kind });
      log(state, `${f.name} is coming back about ${f.kind === "damaged_box" ? "a damaged box" : "smudged copies"}.`);
      return;
  }
}
