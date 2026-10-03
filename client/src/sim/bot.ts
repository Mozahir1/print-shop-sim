// An automated employee for batch runs and dev autoplay. It works from the same to-do list the player sees, and
// handles every choice by its style:
//   do_everything  says yes to everything: takes every job, rushes whenever they need it sooner, works first come
//                  first served (never turns anyone away or sends them to self-serve)
//   smart          sends simple jobs to self-serve, rushes only when that won't make another order late, turns away
//                  what can't be done in time or isn't worth doing, works on whatever's due soonest, and does
//                  everything properly
//   turn_away      says no to new business (print and shipping) and cuts corners on the work
//   ignore         ignores people and problems
//   random         a different answer every time (from its own stream, never the game's)
import type { CounterAction, GameState, TaskRequest } from "./types";
import { createRng, type Rng } from "./rng";
import { abandonWorkflow, goHome, startTask, workLeft } from "./sim";
import { currentStep } from "./workflow";
import { DONT, todoList, type TodoItem } from "./todo";
import { quoteFor, rushBumpsSomeone } from "./quote";
import { isPrintKind } from "./customers";
import { customerById, jobById } from "./util";

export type BotStyle = "do_everything" | "smart" | "turn_away" | "ignore" | "random";
export const BOT_STYLES: BotStyle[] = ["smart", "do_everything", "turn_away", "ignore", "random"];

export interface Bot {
  style: BotStyle;
  rng: Rng;
  reaction: number; // seconds between looks at the store when idle
  cooldown: number;
}

export function createBot(reaction = 1, style: BotStyle = "smart", seed = 1): Bot {
  return { style, rng: createRng(seed ^ 0x5bd1e995), reaction, cooldown: 0 };
}

export function botAct(bot: Bot, state: GameState, dt: number): void {
  if (state.employee.task || state.over) return;
  bot.cooldown -= dt;
  if (bot.cooldown > 0) return;
  bot.cooldown = bot.reaction;
  // In a workflow: its next step is the only thing you can do (or walk away from).
  const step = currentStep(state);
  if (step) {
    const req = choose(bot, state, step.req, step.type === "respond" ? todoList(state)[0]?.alts ?? [] : step.alts);
    if (req && startTask(state, req) === null) return;
    if (!req) abandonWorkflow(state);
    return;
  }
  // After close: finish today's work, then go home. Tomorrow's work waits for tomorrow; someone who stayed past
  // closing gets shown out (served, if you do everything).
  const closed = state.time >= state.closeAt;
  if (closed && bot.style === "ignore") return void goHome(state);
  let items = todoList(state); // soonest due first
  if (closed) {
    items = items.filter((i) => {
      const job = i.req.jobId !== undefined ? jobById(state, i.req.jobId) : undefined;
      return !job || job.dueDay <= state.day;
    });
    for (const i of items) {
      const c = i.customerId !== undefined ? customerById(state, i.customerId) : undefined;
      if (i.req.type === "talk" && c?.lingering && bot.style !== "do_everything") i.req = { type: "usher_out", customerId: c.id };
    }
    if (!items.length) {
      if (!workLeft(state).length) goHome(state); // otherwise something's still printing: wait for it
      return;
    }
  }
  if (bot.style === "do_everything") items.sort((a, b) => arrivalOrder(state, a) - arrivalOrder(state, b));
  for (const item of items) {
    const req = choose(bot, state, item.req, item.alts);
    if (req && startTask(state, req) === null) return;
  }
}

// First come, first served: when the order (or the person) came in. Someone waiting for an answer still comes first.
function arrivalOrder(state: GameState, item: TodoItem): number {
  if (item.req.type === "respond") return -2;
  const job = item.req.jobId !== undefined ? jobById(state, item.req.jobId) : undefined;
  if (job) return job.orderedAt;
  const c = item.customerId !== undefined ? customerById(state, item.customerId) : undefined;
  return c ? c.arrivedAt : -1;
}

// Which way to handle a to-do item, or null to leave it.
function choose(bot: Bot, state: GameState, req: TaskRequest, alts: TaskRequest[]): TaskRequest | null {
  if (req.type === "respond") return { ...req, choice: answer(bot, state, req, alts) };
  switch (bot.style) {
    case "do_everything":
    case "smart":
      return req;
    case "turn_away":
      return alts.find((a) => DONT.has(a.type)) ?? req;
    case "ignore":
      if (req.type === "talk") return (customerById(state, req.customerId!)?.ignored ?? 0) > 0 ? null : req; // once is enough
      return alts.length ? null : req; // leaves problems alone
    case "random": {
      const options = [req, ...alts, null];
      return options[Math.floor(bot.rng() * options.length)];
    }
  }
}

function answer(bot: Bot, state: GameState, req: TaskRequest, alts: TaskRequest[]): CounterAction {
  const c = customerById(state, req.customerId!)!;
  const has = (a: CounterAction) => alts.some((x) => x.choice === a);
  switch (bot.style) {
    case "do_everything":
      return has("rush") ? "rush" : "take";
    case "ignore":
      return "ignore";
    case "turn_away":
      return (isPrintKind(c.kind) || c.kind === "ship") && has("turn_away") ? "turn_away" : "take";
    case "random": {
      const options: CounterAction[] = ["take", ...alts.map((a) => a.choice!)];
      return options[Math.floor(bot.rng() * options.length)];
    }
    case "smart": {
      if (!isPrintKind(c.kind)) return "take";
      if (has("self_serve")) return "self_serve";
      const q = quoteFor(state, c);
      const rushOk = has("rush") && !rushBumpsSomeone(state, c.spec!);
      const doable = q.doable && (!has("rush") || rushOk || q.needBy === null || q.standardReadyAt <= q.needBy);
      if ((!doable || !q.worth) && has("turn_away")) return "turn_away";
      return rushOk ? "rush" : "take";
    }
  }
}
