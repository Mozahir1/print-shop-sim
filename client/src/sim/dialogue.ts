// What a customer says at the counter, one line at a time: what they came for, then every detail in words. Built
// from their request plus the phrasing templates in src/data/dialogue.json. Which variant is said is keyed to them,
// so "What was that?" gets the same words again.
import type { Customer, GameState } from "./types";
import data from "../data/dialogue.json";
import { isPrintKind } from "./customers";
import { sceneOf } from "./sim";
import { POOLS, say } from "./lines";
import { formatClock } from "./time";
import { fill } from "./util";

type Field = keyof typeof data.lines;
const LINES = data.lines as Record<Field, Record<string, string[]>>;
const ORDER = data.order as Record<string, Field[]>;

export function requestLines(state: GameState, c: Customer): string[] {
  const scene = sceneOf(state, c) ?? undefined;
  const lines = [say(POOLS.customers, "request", { request: c.kind, about: c.about ?? undefined, scene }, c.id)];
  if (c.trait && !scene) lines.unshift(say(POOLS.customers, "trait", { trait: c.trait }, c.id)); // (how they come across)
  if (scene && scene !== "missing_order") return lines; // they're here about something else
  const spec = c.spec;
  const ref = c.kind === "package_pickup" ? `package #${c.packageId}` : `order #${c.jobId}`; // (what's on the bag or the box)
  const vars = { copies: spec?.copies ?? 0, item: spec?.item ?? "", originals: spec?.originals ?? 0, needBy: c.needBy === null ? "" : formatClock(c.needBy), name: c.name, ref };
  const fields = scene ? ORDER.order_pickup : (ORDER[c.kind] ?? (isPrintKind(c.kind) ? ORDER.print : []));
  fields.forEach((f, i) => {
    const variants = LINES[f][keyOf(c, f)];
    lines.push(fill(variants[(c.id + i) % variants.length], vars));
  });
  return lines;
}

// Which set of variants fits: the value they want for that field.
function keyOf(c: Customer, f: Field): string {
  const spec = c.spec!;
  switch (f) {
    case "quantity":
    case "prints":
      return spec.copies === 1 ? "one" : "any";
    case "pages":
      return spec.originals === 1 ? "one" : "many";
    case "color":
    case "media":
    case "finishing":
      return spec[f];
    case "duplex":
      return String(spec.duplex);
    case "timing":
      return c.timing;
    case "service":
      return c.service;
    default:
      return "any";
  }
}
