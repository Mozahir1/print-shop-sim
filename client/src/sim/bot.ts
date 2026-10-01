// An automated employee, used by batch-sim.ts and the tests to check the day is workable.
// It plays on true state (no need to check things) and never makes mistakes: it enters what customers ask for
// and walks every job the whole physical path. reactionTime is how long it takes to decide on the next thing.
import type { Carry, Customer, GameState, Job, PaperStock, Printer, StockItem, TaskRequest } from "./types";
import {
  canStart,
  counterCustomer,
  estimateReadyAt,
  isInterruptible,
  jobById,
  printerBacklog,
  printerCanRun,
  printerSupports,
  quoteDue,
  selfServeBlockerFor,
  servingCustomerId,
  startTask,
} from "./sim";
import { stockFor, takeOrderSeconds } from "./orders";
import { itemForTray, paperShortfall } from "./inventory";
import { ringingCalls } from "./phone";
import { printerStopped } from "./upkeep";
import { packageById, truckNeedsHandoff, unsortedPackages } from "./shipping";

// careful: the baseline employee. careless: same reaction time, but on purpose it leaves the inbox until something's
// late, collects output only when a printer stops, forgets "double-sided" on some orders, and sets packages down on the
// counter instead of staging them when someone's waiting. It's for measuring how much carelessness costs.
export type BotStyle = "careful" | "careless";

export interface Bot {
  reactionTime: number;
  cooldown: number;
  style: BotStyle;
}

export function createBot(reactionTime = 10, style: BotStyle = "careful"): Bot {
  return { reactionTime, cooldown: 0, style };
}

export function botAct(bot: Bot, state: GameState, dt: number): void {
  bot.cooldown -= dt;
  if (bot.cooldown > 0) return;
  const req = chooseAction(state, bot.style);
  if (req && startTask(state, req) === null) bot.cooldown = bot.reactionTime;
}

export function chooseAction(state: GameState, style: BotStyle = "careful"): TaskRequest | null {
  const careless = style === "careless";
  const cur = state.employee.task;
  const front = counterCustomer(state);
  const can = (req: TaskRequest | null): req is TaskRequest => !!req && canStart(state, req) === null;

  if (cur) {
    if (!isInterruptible(state, cur) || cur.type !== "finish_job") return null;
    // Put finishing down for the truck, the phone, or someone at the counter.
    const handOff: TaskRequest = { type: "hand_off_truck" };
    if (truckNeedsHandoff(state) && can(handOff)) return handOff;
    const call = ringingCalls(state)[0];
    if (call) return { type: "answer_phone", callId: call.id };
    if (front && servingCustomerId(state) !== front.id) {
      const r = counterAction(state, front);
      if (can(r)) return r;
    }
    // Get finished sheets out before the next job buries them.
    for (const p of careless ? [] : state.printers) {
      const collect: TaskRequest = { type: "collect_output", printerId: p.id };
      if (p.currentJobId !== null && p.output.some((o) => o.jobId !== p.currentJobId) && can(collect)) return collect;
    }
    return null;
  }

  // The driver won't wait long. Anything in your hands goes in the bin first, or it misses the truck.
  const h = state.employee.hands;
  if (h?.kind === "packages") return careless && front ? { type: "set_down" } : { type: "stage_packages" };
  const handOff: TaskRequest = { type: "hand_off_truck" };
  if (truckNeedsHandoff(state) && can(handOff)) return handOff;

  // Whatever you're carrying goes where it belongs before anything else.
  if (h) {
    const r = deliver(state, h);
    if (can(r)) return r;
    return can({ type: "set_down" }) ? { type: "set_down" } : null;
  }
  // Pick back up anything left on the counter.
  if (state.counterItems.length && !careless) return { type: "pick_up", index: 0 };

  // A stopped machine is losing time every second; a nearly full output tray is about to stop one.
  for (const p of state.printers) {
    const fix = fixPrinter(state, p);
    if (can(fix)) return fix;
    const inTray = p.output.reduce((a, o) => a + o.sheets, 0);
    const collect: TaskRequest = { type: "collect_output", printerId: p.id };
    const finishedSitting = p.currentJobId !== null && p.output.some((o) => o.jobId !== p.currentJobId);
    if (!careless && (inTray >= p.outputCapacity * 0.9 || finishedSitting) && can(collect)) return collect;
  }
  for (const cp of state.copiers) {
    const fix: TaskRequest | null = cp.status === "jammed" ? { type: "fix_copier", copierId: cp.id } : cp.status === "out_of_paper" ? { type: "take_stock", item: "letter" } : null;
    if (can(fix)) return fix;
  }
  // Jobs stuck on a printer that won't be running soon (broken, or no supplies to fix it) go to another one.
  for (const p of state.printers) {
    if (!printerStopped(p) || p.status === "jammed" || p.status === "output_full") continue;
    if (p.status === "out_of_paper" && state.stockroom[itemForTray(emptyTrayStock(state, p))] > 0) continue;
    if (p.status === "out_of_toner" && state.stockroom[p.supply] > 0) continue;
    for (const id of [p.currentJobId, ...p.queue]) {
      if (id === null) continue;
      const job = jobById(state, id)!;
      const elsewhere = state.printers.some((o) => o !== p && usable(state, o, job.spec));
      const recall: TaskRequest = { type: "recall_job", jobId: id };
      if (elsewhere && can(recall)) return recall;
    }
  }

  const call = ringingCalls(state)[0];
  if (call) return { type: "answer_phone", callId: call.id };

  if (front) {
    const r = counterAction(state, front, careless);
    if (can(r)) return r;
  }

  // Online orders can't be printed until they've been read. The careless one only looks once something's late.
  const somethingLate = state.jobs.some((j) => j.channel === "web" && !j.opened && !j.dueTomorrow && state.time > j.dueAt);
  const unreadOrder = state.computer.messages.find((m) => m.kind === "web_order" && !m.read);
  if (unreadOrder && (!careless || somethingLate)) return { type: "open_message", messageId: unreadOrder.id };

  const byDue = (a: { dueAt: number }, b: { dueAt: number }) => a.dueAt - b.dueAt;
  for (const unsent of state.jobs.filter((j) => j.status === "unsent" && j.opened).sort(byDue)) {
    const printer = state.printers
      .filter((p) => usable(state, p, unsent.ticket) && can({ type: "send_job", jobId: unsent.id, printerId: p.id }))
      .sort((a, b) => printerBacklog(state, a, unsent.dueAt) - printerBacklog(state, b, unsent.dueAt))[0];
    if (printer) return { type: "send_job", jobId: unsent.id, printerId: printer.id };
  }

  // Printed sheets don't walk to the finishing table on their own. Go when a job is done or the tray is filling up,
  // not for every few sheets.
  const ready = (p: Printer) => {
    if (!p.output.length) return false;
    const first = jobById(state, p.output[0].jobId)!;
    const inTray = p.output.reduce((a, o) => a + o.sheets, 0);
    return first.status === "printed" || p.output.length > 1 || inTray >= p.outputCapacity * 0.8;
  };
  const withOutput = state.printers
    .filter((p) => !careless && ready(p))
    .sort((a, b) => jobById(state, a.output[0].jobId)!.dueAt - jobById(state, b.output[0].jobId)!.dueAt)[0];
  if (withOutput) return { type: "collect_output", printerId: withOutput.id };

  const finishable = state.jobs.filter((j) => j.status === "printed" && j.tableSheets >= j.sheets - 1e-6).sort(byDue)[0];
  if (finishable) return { type: "finish_job", jobId: finishable.id };

  if (unsortedPackages(state).length) return { type: "check_in_packages" };

  if (careless) {
    // Gets around to the output trays and the counter when there's nothing else going on.
    const anyOutput = state.printers.find((p) => p.output.length);
    if (anyOutput) return { type: "collect_output", printerId: anyOutput.id };
    if (state.counterItems.length) return { type: "pick_up", index: 0 };
    return restock(state);
  }

  // Catch up on messages: voicemails first (quote callers may still order), then email.
  const voicemail = state.computer.voicemails.find((v) => !v.calledBack);
  if (voicemail) return { type: "call_back", voicemailId: voicemail.id };
  const email = state.computer.messages.find((m) => m.kind === "email" && !m.replied);
  if (email) return email.read ? { type: "reply_email", messageId: email.id } : { type: "open_message", messageId: email.id };

  return restock(state);
}

// Quiet moment: bring supplies out to whatever's running low.
function restock(state: GameState): TaskRequest | null {
  const can = (req: TaskRequest) => canStart(state, req) === null;
  for (const cp of state.copiers) {
    const take: TaskRequest = { type: "take_stock", item: "letter" };
    if (cp.paper < cp.capacity * 0.25 && can(take)) return take;
  }
  for (const p of state.printers) {
    const toner: TaskRequest = { type: "take_stock", item: p.supply };
    if (p.toner <= 10 && can(toner)) return toner;
    for (const t of p.trays) {
      const low = t.stock === "roll" ? t.level < 15 : t.level < t.capacity * 0.2;
      const take: TaskRequest = { type: "take_stock", item: itemForTray(t.stock) };
      if (low && can(take)) return take;
    }
  }
  return null;
}

// Where what you're holding goes.
function deliver(state: GameState, h: Carry): TaskRequest | null {
  const can = (req: TaskRequest) => canStart(state, req) === null;
  switch (h.kind) {
    case "output": {
      const job = jobById(state, h.jobId)!;
      const all = job.status === "printed" && job.tableSheets + h.sheets >= job.sheets - 1e-6;
      return all ? { type: "finish_job", jobId: job.id } : { type: "drop_output" };
    }
    case "bag":
      return { type: "shelve" };
    case "packages":
      return { type: "stage_packages" };
    case "paper":
    case "roll": {
      const stock: PaperStock = h.kind === "roll" ? "roll" : h.stock;
      // A stopped printer first, then whichever tray of this paper is lowest, then a copier (letter only).
      // Only somewhere that's actually low; topping off a nearly full tray just burns time.
      const trays = state.printers
        .flatMap((p) => p.trays.filter((t) => t.stock === stock).map((t) => ({ p, t })))
        .filter(({ p, t }) => (p.status === "out_of_paper" || t.level < t.capacity * 0.5) && can({ type: "load_paper", printerId: p.id, stock: t.stock }))
        .sort((a, b) => Number(b.p.status === "out_of_paper") - Number(a.p.status === "out_of_paper") || a.t.level / a.t.capacity - b.t.level / b.t.capacity);
      if (trays.length) return { type: "load_paper", printerId: trays[0].p.id, stock };
      const copier = state.copiers
        .filter((cp) => (cp.status === "out_of_paper" || cp.paper < cp.capacity * 0.5) && can({ type: "refill_copier", copierId: cp.id }))
        .sort((a, b) => a.paper - b.paper)[0];
      if (copier) return { type: "refill_copier", copierId: copier.id };
      return { type: "put_back" };
    }
    case "supply": {
      const p = state.printers.find((x) => x.supply === h.item && can({ type: "replace_toner", printerId: x.id }));
      return p ? { type: "replace_toner", printerId: p.id } : { type: "put_back" };
    }
    case "box": {
      const front = counterCustomer(state);
      if (front?.purpose === "ship" && !front.ship!.packed && front.ship!.box === h.size) return { type: "ship_package" };
      return { type: "put_back" };
    }
  }
}

// Whether a printer can actually get through a job: it supports it, isn't broken, and whatever it's out of can be replaced.
function usable(state: GameState, p: Printer, spec: Job["spec"]): boolean {
  if (!printerSupports(p, { spec }) || p.status === "needs_service" || !printerCanRun(state, p, spec)) return false;
  const tray = p.trays.find((t) => t.stock === stockFor(spec.media))!;
  const carrying = state.employee.hands?.kind === "paper" || state.employee.hands?.kind === "roll";
  return tray.level > 1 || state.stockroom[itemForTray(tray.stock)] > 0 || carrying;
}

// What a stopped printer needs from you.
function fixPrinter(state: GameState, p: Printer): TaskRequest | null {
  switch (p.status) {
    case "jammed":
      return { type: "clear_jam", printerId: p.id };
    case "output_full":
      return { type: "collect_output", printerId: p.id };
    case "out_of_paper":
      return { type: "take_stock", item: itemForTray(emptyTrayStock(state, p)) };
    case "out_of_toner":
      return { type: "take_stock", item: p.supply as StockItem };
    default:
      return null;
  }
}

// The tray a stopped printer needs: the one its current job prints from.
function emptyTrayStock(state: GameState, p: Printer): PaperStock {
  const job = p.currentJobId !== null ? jobById(state, p.currentJobId) : undefined;
  return job ? stockFor(job.spec.media) : p.trays.reduce((a, t) => (t.level / t.capacity < a.level / a.capacity ? t : a)).stock;
}

function counterAction(state: GameState, c: Customer, careless = false): TaskRequest | null {
  switch (c.purpose) {
    case "pickup": {
      const job = jobById(state, c.jobId!)!;
      return { type: job.status === "ready" ? "ring_up" : "explain_delay" };
    }
    case "ship": {
      if (c.ship!.packed) return { type: "ship_package" };
      // Grab the right box first; if there are none, there's nothing to put it in.
      const item = `box_${c.ship!.box}` as StockItem;
      return state.stockroom[item] > 0 ? { type: "take_stock", item } : { type: "turn_away" };
    }
    case "dropoff":
      return { type: "accept_dropoff" };
    case "copier_help":
      return { type: "acknowledge_copier" };
    case "package":
      // Their package is still in the unsorted delivery: sort it, then they can have it.
      return { type: packageById(state, c.packageId!)!.status === "unsorted" ? "check_in_packages" : "release_package" };
  }
  if (!c.selfServeDeclined && selfServeBlockerFor(c) === null) return { type: "usher_self_serve" };
  const spec = c.request!.spec;
  const due = quoteDue(state, c, state.time + takeOrderSeconds(spec));
  // Can't make it with what's on hand (with some margin for jams and other orders that come in meanwhile).
  if (paperShortfall(state, { ...spec, copies: Math.ceil(spec.copies * 1.15) })) return { type: "turn_away" };
  const est = estimateReadyAt(state, spec, due.dueAt);
  const doable = due.tomorrow ? est.at <= state.closeAt + 3600 : est.at <= due.dueAt + 10 * 60;
  if (!doable) return { type: "turn_away" };
  // The careless one rushes the POS and misses "double-sided" about half the time.
  if (careless && spec.duplex && c.id % 2 === 0) return { type: "take_order", spec: { ...spec, duplex: false } };
  return { type: "take_order" };
}
