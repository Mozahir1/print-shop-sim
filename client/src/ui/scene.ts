// The store, drawn on a canvas: counter in front, stations behind, self-serve to the side, customers lining up in
// front. The MC walks to the station of whatever step they're on, holding what that step needs, with a thought
// bubble. Positions animate here (the sim has no walking); all drawing goes through sprites.ts.
import type { Customer, GameState, Station } from "../sim/types";
import { currentCustomer } from "../sim/sim";
import { currentStep, STEP } from "../sim/workflow";
import { sprites, type Palette, type Rect } from "./sprites";

export const W = 800;
export const H = 440;

type Place = Station | "truck";

// (Drawn in this order: the counter before the computer that sits on it.)
export const STATION_RECT: Record<Place, Rect> = {
  counter: { x: 140, y: 190, w: 470, h: 26 },
  printer: { x: 60, y: 30, w: 140, h: 70 },
  finishing: { x: 230, y: 30, w: 120, h: 60 },
  shipping: { x: 380, y: 30, w: 160, h: 60 },
  computer: { x: 470, y: 172, w: 76, h: 36 },
  self_serve: { x: 16, y: 250, w: 70, h: 80 },
  truck: { x: 680, y: 24, w: 104, h: 76 },
};

// Where the MC stands to work at each station.
const STAND: Record<Station, { x: number; y: number }> = {
  printer: { x: 130, y: 140 },
  finishing: { x: 290, y: 135 },
  shipping: { x: 460, y: 135 },
  computer: { x: 505, y: 160 },
  counter: { x: 370, y: 160 },
  self_serve: { x: 110, y: 290 },
};

const FRONT = { x: 370, y: 262 }; // the customer at the counter
const DOOR = { x: 780, y: 420 };

interface Anim {
  x: number;
  y: number;
}

export interface SceneState {
  mc: Anim;
  people: Map<number, Anim & { leaving: number }>;
  last: number; // performance.now() of the last frame
}

export function createScene(): SceneState {
  return { mc: { ...STAND.counter }, people: new Map(), last: performance.now() };
}

function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { ink: v("--ink"), muted: v("--muted"), card: v("--card"), line: v("--line"), accent: v("--accent"), warn: v("--warn"), bad: v("--bad"), ok: v("--ok"), floor: v("--floor"), counter: v("--counter"), wall: v("--wall") };
}

// Where each customer belongs right now.
function spotFor(state: GameState, c: Customer, lineIndex: Map<number, number>, seat: Map<number, number>): { x: number; y: number } | null {
  switch (c.state) {
    case "line":
    case "talking": {
      const i = lineIndex.get(c.id) ?? 0;
      return { x: FRONT.x + i * 62, y: FRONT.y + (i ? 6 : 0) };
    }
    case "waiting":
      return { x: 170 + (seat.get(c.id) ?? 0) * 58, y: 385 };
    case "self_serve":
      return { x: 110, y: 345 };
    default:
      return null;
  }
}

// What needs you, by station (they pulse).
export function needsAttention(state: GameState): Set<Place> {
  const s = new Set<Place>();
  const p = state.printer;
  if (p.status === "jammed" || p.status === "tray_empty" || state.jobs.some((j) => j.status === "printed")) s.add("printer");
  if (state.jobs.some((j) => j.status === "collected" || j.status === "finished")) s.add("finishing");
  if (state.truck.status === "waiting") s.add("truck");
  if (state.packages.some((x) => x.status === "labeled" || x.status === "scanned")) s.add("shipping");
  if (state.copier.status === "broken") s.add("self_serve");
  if (state.cardReader === "down" || state.wifi.down || state.messages.some((m) => !m.read && !m.snoozed && m.kind === "web_order")) s.add("computer");
  if (state.customers.some((c) => c.state === "line")) s.add("counter");
  return s;
}

function statusOf(state: GameState, place: Place): string | undefined {
  switch (place) {
    case "printer": {
      const p = state.printer;
      if (p.status === "jammed") return "Jammed";
      if (p.status === "tray_empty") return "Tray empty";
      const ready = state.jobs.filter((j) => j.status === "printed").length;
      if (ready) return `${ready} ready to collect`;
      return p.status === "printing" ? `Printing #${p.currentJobId}` : "Idle";
    }
    case "finishing": {
      const n = state.jobs.filter((j) => j.status === "collected" || j.status === "finished").length;
      return n ? `${n} to finish` : undefined;
    }
    case "shipping": {
      const bin = state.packages.filter((x) => x.status === "binned").length;
      return `${bin} in the bin`;
    }
    case "self_serve":
      return state.copier.status === "ok" ? undefined : state.copier.sign ? "Out of order" : "Broken";
    case "computer": {
      const unread = state.messages.filter((m) => !m.read && !m.snoozed).length;
      return state.cardReader === "down" ? "Reader down" : state.wifi.down ? "Wi-Fi down" : unread ? `${unread} unread` : undefined;
    }
    case "truck":
      return "Waiting";
    default:
      return undefined;
  }
}

const LABEL: Record<Place, string> = { printer: "Printer", finishing: "Finishing", shipping: "Shipping", computer: "Computer", counter: "", self_serve: "Self-serve", truck: "Truck" };

// What the MC is doing right now: where, holding what, thinking what.
function mcNow(state: GameState): { station: Station; held: string | null; pose: string; thought: string | null } {
  const t = state.employee.task;
  if (t) return { station: STEP[t.type].station, held: STEP[t.type].held, pose: STEP[t.type].pose, thought: STEP[t.type].thought };
  const step = currentStep(state);
  if (step) return { station: step.data.station, held: step.data.held, pose: "stand", thought: step.data.thought };
  return { station: "counter", held: null, pose: "stand", thought: null }; // empty hands: free
}

function approach(a: Anim, to: { x: number; y: number }, step: number): void {
  const dx = to.x - a.x;
  const dy = to.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d <= step) {
    a.x = to.x;
    a.y = to.y;
  } else {
    a.x += (dx / d) * step;
    a.y += (dy / d) * step;
  }
}

export function drawScene(ctx: CanvasRenderingContext2D, state: GameState, scene: SceneState, now: number): void {
  const p = palette();
  const dt = Math.min(0.1, (now - scene.last) / 1000);
  scene.last = now;
  const pulse = 0.5 + 0.5 * Math.sin(now / 250);
  const attention = needsAttention(state);

  // Floor and back wall.
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = p.floor;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = p.wall;
  ctx.fillRect(0, 0, W, 112);

  for (const place of Object.keys(STATION_RECT) as Place[]) {
    if (place === "truck" && state.truck.status !== "waiting") continue;
    sprites.station(ctx, place, STATION_RECT[place], { pulse: attention.has(place) ? pulse : 0, label: LABEL[place], status: statusOf(state, place), p });
  }

  // Customers.
  const line = state.customers.filter((c) => c.state === "line" || c.state === "talking").sort((a, b) => a.lineTicket - b.lineTicket);
  const lineIndex = new Map(line.map((c, i) => [c.id, i]));
  const seat = new Map(state.customers.filter((c) => c.state === "waiting").map((c, i) => [c.id, i]));
  const front = currentCustomer(state);
  const seen = new Set<number>();
  for (const c of state.customers) {
    const spot = spotFor(state, c, lineIndex, seat);
    let a = scene.people.get(c.id);
    if (spot) {
      if (!a) a = { x: DOOR.x, y: DOOR.y, leaving: 0 };
      a.leaving = 0;
      scene.people.set(c.id, a);
      approach(a, spot, 260 * dt);
    } else if (a) {
      a.leaving += dt;
      approach(a, DOOR, 220 * dt);
      if (a.leaving > 2) {
        scene.people.delete(c.id);
        continue;
      }
    } else continue;
    seen.add(c.id);
    sprites.person(ctx, a.x, a.y, { body: c.kind === "business" ? "#2f3a48" : c.lingering ? "#8d6aa8" : c.id === front?.id ? "#5d8bb8" : "#7d93a8", label: c.name, p });
    if (spot) sprites.mood(ctx, c.stage, a.x + 14, a.y - 26, p);
    const recent = c.saidAt !== null && state.time - c.saidAt < 6;
    if (c.said && (recent || c.state === "talking")) sprites.bubble(ctx, c.said, a.x, a.y - 30, { thought: false, p, maxWidth: 150 });
  }
  for (const id of [...scene.people.keys()]) if (!seen.has(id)) scene.people.delete(id);

  // The MC.
  const mc = mcNow(state);
  approach(scene.mc, STAND[mc.station], 320 * dt);
  sprites.person(ctx, scene.mc.x, scene.mc.y, { body: "#c2723a", pose: mc.pose, p });
  if (mc.held) sprites.item(ctx, mc.held, scene.mc.x + 16, scene.mc.y + 2, p);
  const said = state.captions.at(-1);
  if (said && state.time - said.time < 6) sprites.bubble(ctx, said.text, scene.mc.x, scene.mc.y - 30, { thought: false, p });
  else if (mc.thought) sprites.bubble(ctx, mc.thought, scene.mc.x, scene.mc.y - 30, { thought: true, p });
}

// What's under a point on the canvas (in scene coordinates).
export type Hit = { kind: "station"; place: Place } | { kind: "customer"; id: number };

export function hitTest(state: GameState, scene: SceneState, x: number, y: number): Hit | null {
  for (const [id, a] of scene.people) {
    if (Math.abs(x - a.x) < 16 && y > a.y - 28 && y < a.y + 24) return { kind: "customer", id };
  }
  for (const place of Object.keys(STATION_RECT) as Place[]) {
    if (place === "truck" && state.truck.status !== "waiting") continue;
    const r = STATION_RECT[place];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { kind: "station", place };
  }
  return null;
}
