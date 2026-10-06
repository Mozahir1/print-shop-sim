// A bot that plays at a person's speed, for tuning patience, due times, and day length. It decides like the other
// bots (bot.ts), but every step takes it the real seconds a first-time player needs: a few seconds a click, a pause
// to find the right station, forms typed out, now and then a wrong tap. Meanwhile the clock runs the way the UI runs
// it (clock.ts): slowly while a step waits on you, not at all while a customer explains. Its own random stream, so
// the game plays the same as with any other bot.
import type { GameState, Station, TaskRequest, TaskType } from "./types";
import { botAct, createBot, type Bot, type BotStyle } from "./bot";
import { createRng, type Rng } from "./rng";
import { begin, isDayOver, tick, type Sim } from "./sim";
import { currentStep, STEP, type Hand } from "./workflow";
import { suggested, todoList } from "./todo";
import { clockRate } from "./clock";
import { jobById } from "./util";
import { CLOCK } from "./config";

// Real seconds (ranges are [least, most]).
export const HUMAN = {
  click: [2, 4] as [number, number], // each distinct thing you do: pick up, put down, a button, a tool
  tap: 0.7, // each repeat tap after the first (staple, staple, staple)
  hold: 1.2, // holding a tool down (HOLD_MS in the view)
  look: [1, 3] as [number, number], // finding the right one (the bag with their name, the box that fits)
  read: [4, 8] as [number, number], // what a customer says (the clock's stopped)
  orderForm: [15, 25] as [number, number],
  labelForm: [8, 14] as [number, number],
  keypad: [5, 9] as [number, number],
  search: [1, 3] as [number, number], // getting to another station and finding things there
  wrongTap: 0.1, // chance a click goes to the wrong thing first...
  wrongCost: [2, 3] as [number, number], // ...and what that costs
  react: 1, // how often you look up when there's nothing to do
  speed: CLOCK.speeds[0], // 1x
  dt: 0.25, // the loop's step, real seconds
};

export interface Human {
  bot: Bot;
  rng: Rng;
  station: Station | null; // where you are
  wait: number | null; // real seconds until the next thing's done by hand (null: nothing in hand)
  handsDone: string | null; // the step whose hands-on part you've just done
}

export function createHuman(style: BotStyle = "smart", seed = 1): Human {
  const h: Human = { bot: { ...createBot(0, style, seed), guided: true }, rng: createRng(seed ^ 0x2c1b3c6d), station: "counter", wait: null, handsDone: null };
  // A step done by hand is done the way the UI does it: into its workflow first (so you're visibly busy, and the
  // clock slows while it waits on you), then the hands-on part, then the step.
  h.bot.ready = (state, req) => {
    const key = `${req.type}:${req.customerId}:${req.jobId}:${req.packageId}`;
    if (!STEP[req.type].hands?.length) return true;
    if (h.handsDone === key) {
      h.handsDone = null;
      return true;
    }
    if (begin(state, req) !== null) return true; // (let the step say why not)
    h.handsDone = key;
    h.wait = hands(h, state, req);
    return false;
  };
  return h;
}

const between = (h: Human, [lo, hi]: [number, number]) => lo + h.rng() * (hi - lo);

// One click, maybe after a wrong one.
function click(h: Human): number {
  return between(h, HUMAN.click) + (h.rng() < HUMAN.wrongTap ? between(h, HUMAN.wrongCost) : 0);
}

// What doing one hands-on part takes.
function part(h: Human, state: GameState, p: Hand, jobId: number | undefined): number {
  if (p.finish) {
    const spec = jobId !== undefined ? jobById(state, jobId)?.spec : undefined;
    return spec?.finishing === "staple" && spec.copies <= 10 ? click(h) + (spec.copies - 1) * HUMAN.tap : click(h) + HUMAN.hold;
  }
  if (p.drag) return click(h) + (p.to === "hands" ? 0 : click(h));
  if (p.tap) return click(h) + ((p.n ?? 1) - 1) * HUMAN.tap;
  if (p.hold) return click(h) + HUMAN.hold;
  if (p.pick) return between(h, HUMAN.look) + click(h);
  if (p.form) return between(h, p.form === "order" ? HUMAN.orderForm : HUMAN.labelForm);
  if (p.pay) return between(h, HUMAN.keypad);
  return click(h);
}

// The hands-on part of a step, in real seconds.
function hands(h: Human, state: GameState, req: TaskRequest): number {
  return (STEP[req.type].hands ?? []).reduce((t, p) => t + part(h, state, p, req.jobId), 0);
}

// How long until you start the next thing, in real seconds: getting there, reading, the click that starts it (its
// hands-on part comes after: see createHuman). Null when there's nothing to do.
export function effort(h: Human, state: GameState): number | null {
  const step = currentStep(state);
  const next = step?.req ?? suggested(todoList(state))[0]?.req;
  if (!next) return state.time >= state.closeAt ? click(h) : null; // (going home)
  const type: TaskType = next.type;
  const data = STEP[type];
  let t = 0;
  if (data.station !== h.station) {
    t += between(h, HUMAN.search);
    h.station = data.station;
  }
  if (type === "respond") t += between(h, HUMAN.read);
  return t + (data.hands?.length ? 0 : click(h));
}

// Plays the day to its end at a person's pace. (each: called every step, for measuring.)
export function humanDay(sim: Sim, h: Human, each?: () => void): void {
  const s = sim.state;
  let acc = 0;
  for (let guard = 0; guard < 400000 && !isDayOver(s); guard++) {
    if (!s.employee.task && !s.over) {
      if (h.wait === null) h.wait = effort(h, s) ?? HUMAN.react;
      h.wait -= HUMAN.dt;
      if (h.wait <= 0) {
        h.wait = null;
        botAct(h.bot, s, 1); // (a step done by hand sets the next wait: its hands-on part)
      }
    }
    acc += HUMAN.dt * clockRate(s, HUMAN.speed);
    for (; acc >= 1 && !isDayOver(s); acc--) tick(sim, 1);
    each?.();
  }
}
