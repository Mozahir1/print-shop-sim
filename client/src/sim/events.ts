// Bad luck: about one thing a day goes wrong. Each one is obvious, takes a task or two to fix, and gets worse if
// you leave it. Rolled from its own stream when the day starts.
import { emit } from "./bus";
import type { BadLuck, EventKind, GameState, Package } from "./types";
import { DIRECTOR, EASE_IN, EVENTS } from "./config";
import type { Rng } from "./rng";
import { placeWebOrder } from "./customers";
import { activeCount } from "./todo";
import { recordChoice } from "./mood";
import { addHeat } from "./consequences";
import { recordFailure } from "./failures";
import { log } from "./util";
import type { Sim } from "./sim";
import { pickLine, POOLS } from "./lines";
import { mcSay } from "./mc";

export function rollEvent(rng: Rng, dayLength: number, day = 99): BadLuck | null {
  const has = rng() < (EASE_IN.eventChance[day - 1] ?? EVENTS.chance);
  const pickRoll = rng();
  const atRoll = rng();
  if (!has) return null;
  const entries = Object.entries(EVENTS.weights) as [EventKind, number][];
  let r = pickRoll * entries.reduce((a, [, w]) => a + w, 0);
  let kind = entries[0][0];
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) {
      kind = k;
      break;
    }
  }
  const [lo, hi] = EVENTS.window;
  return { kind, at: Math.round(dayLength * (lo + atRoll * (hi - lo))), status: "pending", firedAt: null };
}

export function eventText(kind: EventKind): { title: string; prompt: string } {
  const line = pickLine(POOLS.events, "event", { event: kind });
  return { title: line.subject ?? "", prompt: line.text };
}

// Events that bring their own thing to do count toward the load. The rest happen to work that's already counted
// (a jammed job, a ripped box, the web order behind the Wi-Fi outage).
export function eventIsActive(state: GameState): boolean {
  const e = state.event;
  return e?.status === "active" && (e.kind === "copier_dies" || e.kind === "card_reader_down");
}

export function runEvents(sim: Sim): void {
  const { state } = sim;
  const e = state.event;
  if (state.wifi.down && !state.wifi.restarting && state.time >= state.wifi.backAt) wifiBack(state, false);
  if (!e || e.status !== "pending" || state.time < e.at || state.time >= state.closeAt) return;
  if (e.kind === "box_rips") return; // happens on the next box you pack (see onPacked)
  if (e.kind === "printer_jam" && state.printer.status !== "printing") return; // waits for a job to jam
  if (activeCount(state) >= DIRECTOR.ceiling) return; // never piles on
  fire(sim, e);
}

// Dev mode (and tests): make it happen now. Returns why not, or null.
export function triggerEvent(sim: Sim, kind: EventKind): string | null {
  const { state } = sim;
  if (state.event?.status === "active") return "Something's already going wrong.";
  if (kind === "printer_jam" && state.printer.status !== "printing") return "The printer isn't printing anything.";
  state.event = { kind, at: state.time, status: "pending", firedAt: null };
  if (kind !== "box_rips") fire(sim, state.event);
  return null;
}

function fire(sim: Sim, e: BadLuck): void {
  const { state } = sim;
  e.status = "active";
  e.firedAt = state.time;
  switch (e.kind) {
    case "printer_jam":
      state.printer.status = "jammed";
      emit("jam", {});
      state.stats.jams++;
      break;
    case "copier_dies":
      state.copier.status = "broken";
      emit("copier_broken", {});
      state.copier.sign = false;
      break;
    case "card_reader_down":
      state.cardReader = "down";
      break;
    case "wifi_drop":
      state.wifi = { down: true, backAt: state.time + EVENTS.wifiOutage, restarting: false };
      placeWebOrder(state, sim.rng.events); // it's sitting on the server, and won't arrive until the Wi-Fi's back
      break;
    case "box_rips":
      break;
  }
  log(state, eventText(e.kind).prompt);
  mcSay(state, "bad_luck");
  emit("event_started", { kind: e.kind });
}

// A box you just packed: on a box-rips day, the first one rips and has to be packed again.
export function onPacked(state: GameState, pkg: Package): boolean {
  const e = state.event;
  if (e?.kind !== "box_rips" || e.status !== "pending" || state.time < e.at) return false;
  e.status = "active";
  e.firedAt = state.time;
  pkg.status = "new";
  pkg.taped = false;
  log(state, eventText("box_rips").prompt);
  mcSay(state, "bad_luck");
  return true;
}

// Called when the thing that went wrong is dealt with.
export function resolveEvent(state: GameState, kind: EventKind, how: "fixed" | "worked_around"): void {
  const e = state.event;
  if (e?.kind !== kind || e.status !== "active") return;
  e.status = how;
  emit("event_resolved", { kind });
}

export function wifiBack(state: GameState, restarted: boolean): void {
  state.wifi = { down: false, backAt: 0, restarting: false };
  for (const m of state.heldMessages) state.messages.push({ ...m, at: state.time });
  state.heldMessages = [];
  if (state.event?.kind === "wifi_drop" && state.event.status === "active") {
    state.event.status = restarted ? "fixed" : "ignored";
    if (!restarted) recordChoice(state, "ignore", "event");
  }
  log(state, restarted ? "The Wi-Fi is back." : "The Wi-Fi came back on its own.");
}

// At close: anything still broken is on you.
export function closeEvents(state: GameState): void {
  const e = state.event;
  if (e?.status !== "active") return;
  e.status = "ignored";
  recordChoice(state, "ignore", "event");
  addHeat(state, EVENTS.unhandledHeat, "ignoring");
  const thing = { printer_jam: "printer", copier_dies: "self-serve copier", card_reader_down: "card reader", box_rips: "packing station", wifi_drop: "Wi-Fi" }[e.kind];
  recordFailure(state, "left_broken", { thing });
}
