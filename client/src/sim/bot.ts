// An automated employee for batch runs and dev autoplay. It works from the same to-do list the player sees, and
// handles every choice the same way (its style).
import type { CounterChoice, GameState, TaskRequest } from "./types";
import { createRng, type Rng } from "./rng";
import { startTask } from "./sim";
import { todoList } from "./todo";
import { customerById } from "./util";

// random picks a different way each time, from its own stream (never the game's).
export type BotStyle = "proper" | "minimum" | "rude" | "ignore" | "lazy" | "random";
export const BOT_STYLES: BotStyle[] = ["proper", "minimum", "lazy", "rude", "ignore", "random"];

export interface Bot {
  style: BotStyle;
  rng: Rng;
  reaction: number; // seconds between looks at the store when idle
  cooldown: number;
}

export function createBot(reaction = 1, style: BotStyle = "proper", seed = 1): Bot {
  return { style, rng: createRng(seed ^ 0x5bd1e995), reaction, cooldown: 0 };
}

// Lazy is polite enough at the counter; it cuts corners on the work (every lazy option, every time).
const ANSWER: Record<Exclude<BotStyle, "random">, CounterChoice> = { proper: "proper", minimum: "minimum", rude: "rude", ignore: "ignore", lazy: "proper" };
const STYLES: Exclude<BotStyle, "random">[] = ["proper", "minimum", "rude", "ignore", "lazy"];

export function botAct(bot: Bot, state: GameState, dt: number): void {
  if (state.employee.task || state.over) return;
  bot.cooldown -= dt;
  if (bot.cooldown > 0) return;
  bot.cooldown = bot.reaction;
  for (const item of todoList(state)) {
    const req = choose(bot, state, item.req, item.alts);
    if (req && startTask(state, req) === null) return;
  }
}

// Which way to handle a to-do item, or null to leave it.
function choose(bot: Bot, state: GameState, req: TaskRequest, alts: TaskRequest[]): TaskRequest | null {
  const style = bot.style === "random" ? STYLES[Math.floor(bot.rng() * STYLES.length)] : bot.style;
  if (req.type === "respond") return { ...req, choice: ANSWER[style] };
  if (style === "ignore") {
    if (req.type === "talk") return (customerById(state, req.customerId!)?.ignored ?? 0) > 0 ? null : req; // once is enough
    if (alts.length) return null; // doesn't deal with it at all
    return req;
  }
  if (style === "lazy" && alts.length) return alts[0];
  return req;
}
