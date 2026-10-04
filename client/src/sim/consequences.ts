// Consequences: manager heat (hidden), complaints, and things you did that come back later.
// The manager cares about the work getting done and sales, not manners. Heat comes from ignoring people and
// problems, late or unfinished orders, complaints about bad work, and lost sales.
// "Usually" outcomes are keyed rolls, so the same choices always lead to the same consequences.
import type { Customer, Flag, GameState, HeatCause, Job, ManagerState, MessageDraft, MessageKind } from "./types";
import type { CounterQuote } from "./quote";
import { BUSINESS, SURVEY, COMPLAINT_CHANCE, COMPLAINT_DELAY, COMPLAINT_SAME_DAY, FLAGS, HEAT } from "./config";
import { keyedRoll } from "./rng";
import { fill, log, money } from "./util";
import { moodOf } from "./mood";
import { pickLine, POOLS } from "./lines";
import { mcSay } from "./mc";
import { morningTime } from "./customers";
import { recordFailure } from "./failures";

type MessagePool = Exclude<MessageKind, "web_order" | "note"> | "packages_left";

export function createManager(heat = 0, flags: Flag[] = [], morning: MessageDraft[] = []): ManagerState {
  return { heat, heatBy: { complaints: 0, ignoring: 0, lost_sales: 0, overtime: 0 }, complaints: 0, flags, scheduled: [], morning, visitsDue: [] };
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

export function onIgnore(state: GameState): void {
  addHeat(state, HEAT.ignore, "ignoring");
}

// Turning someone away costs nothing if it couldn't be done in time, wasn't worth doing, or it's after closing.
// Otherwise it's a lost sale.
export function onTurnAway(state: GameState, q: CounterQuote): void {
  state.stats.turnedAway++;
  if (!q.doable || !q.worth || state.time >= state.closeAt) return; // (after closing, no one expects you to)
  state.stats.lostSales++;
  state.stats.lostSalesCents += q.valueCents;
  addHeat(state, HEAT.lostSale, "lost_sales");
}

// A business client gone, and their order with them: the manager hears about that one.
export function lostBusiness(state: GameState, c: Customer, valueCents: number): void {
  state.stats.businessLost++;
  addHeat(state, BUSINESS.lostHeat, "lost_sales");
  recordFailure(state, "lost_business", { name: c.name, money: money(valueCents) }, { customerId: c.id });
}

// An order wasn't ready when promised.
export function onLate(state: GameState, job: Job): void {
  if (job.late) return;
  job.late = true;
  state.stats.lateOrders++;
  addHeat(state, HEAT.late, "complaints");
}

// At close: orders due today that still aren't done.
export function onUnfinished(state: GameState, job: Job): void {
  job.late = true;
  state.stats.lateOrders++;
  addHeat(state, HEAT.unfinished, "complaints");
}

// A customer left the store for good: how they felt decides whether the manager hears about it.
export function onLeave(state: GameState, c: Customer, walkedOut: boolean): void {
  maybeSurvey(state, c, walkedOut);
  const mood = moodOf(c);
  if (walkedOut) addHeat(state, HEAT.walkout, angerCause(c));
  const roll = keyedRoll(state.seed, "complaint", c.id, state.day);
  if (roll >= COMPLAINT_CHANCE[mood]) return;
  state.manager.complaints++;
  const cause = angerCause(c);
  const timing = keyedRoll(state.seed, "complaint-when", c.id, state.day);
  const at = state.time + between(keyedRoll(state.seed, "complaint-delay", c.id), COMPLAINT_DELAY);
  const msg = draft("complaint", { name: c.name }, at, HEAT.complaint, cause);
  if (timing < COMPLAINT_SAME_DAY && at < state.closeAt) state.manager.scheduled.push(msg);
  else state.manager.morning.push({ ...msg, at: 0 });
}

// Now and then (rarely, like real life) someone fills out the survey. How it reads depends on their visit.
function maybeSurvey(state: GameState, c: Customer, walkedOut: boolean): void {
  if (keyedRoll(state.seed, "survey", c.id, state.day) >= SURVEY.chance) return;
  const mood = moodOf(c);
  const reason = c.couldSelfServe ? "could_self_serve" : walkedOut ? "walked_out" : c.jobId !== null && state.jobs.find((j) => j.id === c.jobId)?.walkUp ? "full_service" : undefined;
  const result = c.couldSelfServe || walkedOut || mood === "angry" ? "bad" : mood === "happy" && c.outcome === "served" ? "good" : null;
  if (!result) return;
  const line = pickLine(POOLS.messages, "survey", { result, reason });
  state.stats.surveys++;
  if (result === "bad") state.stats.badSurveys++;
  deliver(state, { kind: "survey", subject: fill(line.subject ?? "", { name: c.name }), body: line.text, at: state.time, heat: result === "bad" ? SURVEY.badHeat : SURVEY.goodHeat, cause: "complaints" });
}

// What a customer is mostly unhappy about, for when getting fired needs a reason.
function angerCause(c: Customer): HeatCause {
  return c.ignored > 0 ? "ignoring" : "complaints";
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

// A label printed wrong (weight or service): the package bounces, and they come back about it in a day or two.
export function onWrongLabel(state: GameState, packageId: number, name: string): void {
  const days = between(keyedRoll(state.seed, "label-days", packageId), FLAGS.damagedBoxDays);
  addFlag(state, { kind: "wrong_label", dueDay: state.day + days, dueAt: morningAt(state, packageId), name });
}

function morningAt(state: GameState, key: number): number {
  return morningTime(state.seed, key);
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
    case "packages_left":
      return deliver(state, draft("packages_left", { name: f.name }, state.time, HEAT.flag, "ignoring"));
    case "damaged_box":
    case "smudged_return":
    case "wrong_label": {
      addHeat(state, HEAT.flag, "complaints");
      state.manager.visitsDue.push({ name: f.name, about: f.kind });
      recordFailure(state, f.kind === "damaged_box" ? "damaged_package" : f.kind, { name: f.name });
      const what = { damaged_box: "a damaged box", smudged_return: "smudged copies", wrong_label: "a package that came back" }[f.kind];
      log(state, `${f.name} is coming back about ${what}.`);
      return;
    }
  }
}
