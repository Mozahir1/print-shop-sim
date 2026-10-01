// Dev mode: shortcuts for testing and balancing. Pure functions on the sim, like the rest of src/sim/.
// Anything that changes the shift sets state.devUsed, so the result can't go on the leaderboard.
import type { CallKind, Customer, GameState, PaperStock, ShipService, Timing } from "./types";
import { PHONE, SELF_SERVE, SHIPPING, STOCK, profileById } from "./config";
import { CALL_LABEL } from "./phone";
import { printerStopped } from "./upkeep";
import { SERVICE_LABEL, boxFor, makeShippingCustomer, purposeText } from "./shipping";
import { createRng } from "./rng";
import { makeCustomer } from "./schedule";
import { formatClock } from "./time";
import { botAct, type Bot } from "./bot";
import { isShiftOver, jobById, printerById, tick, type Sim } from "./sim";

function devLog(state: GameState, text: string): void {
  state.devUsed = true;
  state.log.push({ time: state.time, text: `[dev] ${text}` });
}

// Sends a customer through the door right now. Its order is random within the profile unless you force the timing.
// selfServe forces what they do about self-serve if their job qualifies.
export function spawnCustomer(
  state: GameState,
  profileId: string,
  timing?: Timing["kind"],
  web = false,
  selfServe?: "alone" | "with_help" | "full_service",
): Customer {
  const id = Math.max(0, ...state.customers.map((c) => c.id)) + 1;
  const rng = createRng((state.seed ^ (id * 7919) ^ Math.floor(state.time)) >>> 0); // its own stream: the day's schedule is untouched
  const c = makeCustomer(rng, id, Math.ceil(state.time), web, { profile: profileById(profileId), timing });
  // Rolls that land in each band for any job: help is [0, needsHelp), full service is at least the top minRefuse.
  if (selfServe) c.selfServeRoll = { with_help: SELF_SERVE.needsHelp / 2, alone: 0.5, full_service: 1 - SELF_SERVE.minRefuse / 2 }[selfServe];
  state.customers.push(c);
  devLog(state, `Sent in ${c.name} (${profileById(profileId).name}${web ? ", web order" : ""}).`);
  return c;
}

// Sends in a shipping-counter customer now. A "package" customer's package lands in the unsorted delivery pile.
export function spawnShippingCustomer(
  state: GameState,
  purpose: "ship" | "dropoff" | "package",
  opts: { service?: ShipService; packed?: boolean; weightLb?: number } = {},
): Customer {
  const id = Math.max(0, ...state.customers.map((c) => c.id)) + 1;
  const rng = createRng((state.seed ^ (id * 104729) ^ Math.floor(state.time)) >>> 0);
  const c = makeShippingCustomer(rng, id, Math.ceil(state.time), purpose);
  if (c.ship) {
    if (opts.service) c.ship.service = opts.service;
    if (opts.packed !== undefined) c.ship.packed = opts.packed;
    if (opts.weightLb !== undefined) c.ship.weightLb = opts.weightLb;
    c.ship.box = boxFor(c.ship.weightLb);
  }
  if (purpose === "package") {
    const pkg = {
      id: state.nextPackageId++,
      customerId: c.id,
      direction: "in" as const,
      kind: "held" as const,
      service: null,
      weightLb: 3,
      pricePaidCents: 0,
      status: "unsorted" as const,
      createdAt: state.time,
      shippedAt: null,
      releasedAt: null,
      missedTrucks: 0,
    };
    state.packages.push(pkg);
    c.packageId = pkg.id;
  }
  state.customers.push(c);
  const detail = c.ship ? `, ${c.ship.weightLb} lb ${SERVICE_LABEL[c.ship.service].toLowerCase()}${c.ship.packed ? ", packed" : ", needs a box"}` : "";
  devLog(state, `Sent in ${c.name} (${purposeText(c)}${detail}).`);
  return c;
}

// The phone rings now. Dev calls don't turn into web orders.
export function ringNow(state: GameState, kind: CallKind): void {
  const [lo, hi] = PHONE.talkSeconds[kind];
  state.calls.push({
    id: Math.max(0, ...state.calls.map((c) => c.id)) + 1,
    kind,
    ringsAt: Math.ceil(state.time),
    talkSeconds: Math.round((lo + hi) / 2),
    status: "scheduled",
    leadCustomerId: null,
    leadDelay: 0,
    answeredAt: null,
  });
  devLog(state, `Made the phone ring (${kind}).`);
}

// The carrier truck pulls up now and waits its usual time.
export function truckNow(state: GameState): string | null {
  const t = state.truck;
  if (t.status === "gone") return "The truck already came today.";
  t.arrivesAt = Math.ceil(state.time);
  t.leavesAt = t.arrivesAt + SHIPPING.truckWaits;
  t.warned = false;
  devLog(state, "Called the truck in early.");
  return null;
}

// Your current task completes on the next tick, wherever you were.
export function finishTask(state: GameState): string | null {
  const t = state.employee.task;
  if (!t) return "You're not doing anything.";
  state.employee.pos = { ...t.station };
  t.elapsed = t.duration;
  devLog(state, `Finished "${t.label}" instantly.`);
  return null;
}

// The job on this printer finishes on the next tick (no paper or toner used).
export function finishPrinting(state: GameState, printerId: string): string | null {
  const p = printerById(state, printerId);
  if (!p || p.currentJobId === null) return "Nothing is printing there.";
  if (printerStopped(p)) return "Fix the printer first (or restock everything).";
  const job = jobById(state, p.currentJobId)!;
  p.status = "printing";
  job.sheetsPrinted = job.sheets;
  devLog(state, `Finished printing order #${job.id} instantly.`);
  return null;
}

export function jamPrinter(state: GameState, printerId: string): void {
  const p = printerById(state, printerId)!;
  p.status = "jammed";
  p.jamClearSeconds = 120;
  p.jamsToday++;
  state.stats.jams++;
  devLog(state, `Jammed the ${p.short} printer.`);
}

export function emptyTray(state: GameState, printerId: string, stock: PaperStock): void {
  const p = printerById(state, printerId)!;
  const tray = p.trays.find((t) => t.stock === stock);
  if (!tray) return;
  tray.level = 0;
  devLog(state, `Emptied the ${stock} tray on the ${p.short} printer.`);
}

export function setToner(state: GameState, printerId: string, percent: number): void {
  const p = printerById(state, printerId)!;
  p.toner = Math.max(0, Math.min(100, percent));
  devLog(state, `Set ${p.short} toner to ${p.toner}%.`);
}

// Full trays, full toner, no jams, and a well-stocked stockroom.
export function restockAll(state: GameState): void {
  for (const item of Object.keys(STOCK) as (keyof typeof STOCK)[]) state.stockroom[item] = Math.max(state.stockroom[item], STOCK[item].start[1]);
  for (const p of state.printers) {
    for (const t of p.trays) t.level = t.capacity;
    p.toner = 100;
    if (printerStopped(p)) p.status = p.currentJobId !== null ? "printing" : "idle";
    if (p.breakdown && p.breakdown.phase !== "pending") p.breakdown.phase = "fixed";
  }
  for (const cp of state.copiers) {
    cp.paper = cp.capacity;
    cp.status = "ok";
    cp.stoppedSince = null;
  }
  devLog(state, "Restocked every printer, copier and the stockroom, cleared all jams and fixed broken printers.");
}

export function jamCopier(state: GameState, copierId: number): void {
  const cp = state.copiers.find((c) => c.id === copierId)!;
  cp.status = "jammed";
  cp.fixSeconds = 90;
  cp.jamsToday++;
  state.stats.copierJams++;
  devLog(state, `Jammed self-serve copier ${cp.id}.`);
}

// Breaks a printer now. The technician comes in 10 minutes and takes 10 (much faster than real, for testing).
export function breakPrinter(state: GameState, printerId: string): void {
  const p = printerById(state, printerId)!;
  const t = Math.ceil(state.time);
  p.breakdown = { at: t, techArrivesAt: t + 600, fixedAt: t + 1200, phase: "pending" };
  devLog(state, `Broke the ${p.short} printer.`);
}

// Runs the sim forward (optionally with the bot working) until the clock reads `time` or the shift ends.
export function skipTo(sim: Sim, time: number, bot?: Bot): void {
  if (time <= sim.state.time) return;
  devLog(sim.state, `Skipped ahead to ${formatClock(time)}${bot ? " with the bot working" : ""}.`);
  while (sim.state.time < time && !isShiftOver(sim.state)) {
    if (bot) botAct(bot, sim.state, 1);
    tick(sim, 1);
  }
}

// What's coming next: arrivals, web orders and the truck, soonest first. customer is null for the truck.
export function upcoming(state: GameState, limit = 10): { at: number; customer: Customer | null; what: string }[] {
  const rows: { at: number; customer: Customer | null; what: string }[] = [];
  for (const c of state.customers) {
    if (c.webOrderAt !== null && c.jobId === null && c.webOrderAt < state.closeAt) {
      rows.push({ at: c.webOrderAt, customer: c, what: "places a web order" });
    } else if (c.state === "outside" && c.visitAt !== null && c.visitAt < state.closeAt) {
      rows.push({ at: c.visitAt, customer: c, what: `comes in (${purposeText(c)})` });
    }
  }
  for (const call of state.calls) {
    if (call.status === "scheduled" && call.ringsAt < state.closeAt) rows.push({ at: call.ringsAt, customer: null, what: `Phone call (${CALL_LABEL[call.kind]})` });
  }
  const t = state.truck;
  if (t.status === "coming") {
    rows.push({ at: t.arrivesAt, customer: null, what: "Carrier truck arrives" });
  }
  return rows.sort((a, b) => a.at - b.at).slice(0, limit);
}
