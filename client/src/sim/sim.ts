// The heart of the game. tick() advances the world by dt sim seconds.
// You are one employee. Everything you do is a task that takes time (walk there, then work).
// The UI and the bot both act through canStart()/startTask()/stopTask().

import type { Copier, Customer, GameState, Job, JobSpec, Printer, PrinterStatus, Task, TaskRequest, Vec } from "./types";
import { createRng, type Rng } from "./rng";
import { DOOR, FINISHING_STATION, PICKUP_SHELF, REGISTER, SELF_SERVE_HELP_SPOT, lineSlot, seatFor, selfServeQueueSlot } from "./layout";
import { DURATIONS, DUPLEX_JAM_FACTOR, MEDIA_JAM_FACTOR, MEDIA_SPEED, MISTAKES, SELF_SERVE, STOCK, TUNING, createPrinters } from "./config";
import { generateDay } from "./schedule";
import {
  buildUpkeepTask,
  canStartUpkeep,
  completeUpkeepTask,
  createCopiers,
  printerStopped,
  rollBreakdowns,
  rollCopierJam,
  rollFixSeconds,
  rollJamWaste,
  runBreakdowns,
} from "./upkeep";
import {
  appSwitchSeconds,
  buildComputerTask,
  canStartComputer,
  completeComputerTask,
  createComputer,
  deliverWebOrder,
  emailPenalty,
  jobMismatches,
  runInbox,
} from "./computer";
import { buildAnswerTask, canAnswer, completeAnswer, generateCalls, runPhone } from "./phone";
import { countStock, observeFinishing, observePanel, observeShelf, observeTray } from "./knowledge";
import { generateStockroom, itemForTray, paperShortfall } from "./inventory";
import { buildHandsTask, canStartHands, carryLabel, completeHandsTask, handsBlocker, holdingFits, putOnTable } from "./hands";
import { buildShippingTask, canStartShipping, completeShippingTask, createTruck, generateShipping, purposeText, runTruck } from "./shipping";
import {
  FINISHING_VERB,
  describeQuantity,
  finishCostCents,
  finishSeconds,
  finishingSpec,
  impressions,
  isWide,
  printCostPerSheet,
  fullServiceQuote,
  selfServeBlocker,
  selfServePriceCents,
  selfServeSeconds,
  sqFt,
  stockFor,
  stockPerSheet,
  takeOrderSeconds,
  totalSheets,
} from "./orders";
import { formatClock, formatDuration } from "./time";
import {
  beginServing,
  clampRating,
  counterCustomer,
  customerById,
  jobById,
  joinLine,
  lineCustomers,
  log,
  money,
  near,
  printerById,
  sendAway,
  servingCustomerId,
  walk,
  asYou,
  mistake,
} from "./util";

// Re-exported so existing imports from "./sim" keep working.
export { counterCustomer, customerById, jobById, lineCustomers, money, printerById, servingCustomerId } from "./util";

const MIN = 60;
const ROLL_CHANGE_FEET = 15; // a roll gets swapped when it's this close to empty, not before (the rest would be wasted)

// Separate random streams: the day's customers are fixed by the seed, machine luck is separate.
export interface SimRng {
  day: Rng;
  machine: Rng;
  ship: Rng; // shipping customers and the morning delivery
  stock: Rng; // stockroom starting levels
  phone: Rng; // calls, and the web orders answered quote calls turn into
  upkeep: Rng; // copier jams, printer breakdowns, jam waste
}

export interface Sim {
  state: GameState;
  rng: SimRng;
}

export function createSim(seed: number): Sim {
  const rng: SimRng = { day: createRng(seed), machine: createRng(seed ^ 0x9e3779b9), ship: createRng(seed ^ 0x27d4eb2f), stock: createRng(seed ^ 0x165667b1), phone: createRng(seed ^ 0x61c88647),
    upkeep: createRng(seed ^ 0x2545f491),
  };
  const printers = createPrinters();
  // Supplies are wherever the last shift left them.
  for (const p of printers) {
    for (const t of p.trays) t.level = Math.round(t.capacity * (0.25 + 0.75 * rng.machine()));
    p.toner = Math.round(15 + 75 * rng.machine());
    p.sheetsUntilJam = rollJamInterval(rng.machine, p);
  }

  const customers = generateDay(rng.day);
  const shipping = generateShipping(rng.ship, customers.length + 1, TUNING.shiftLength);
  const phone = generateCalls(rng.phone, customers.length + shipping.customers.length + 1);

  const state: GameState = {
    seed,
    time: 0,
    closeAt: TUNING.shiftLength,
    revenueCents: 0,
    costCents: 0,
    customers: [...customers, ...shipping.customers, ...phone.leads],
    jobs: [],
    printers,
    copiers: createCopiers(rng.upkeep),
    packages: shipping.packages,
    nextPackageId: shipping.packages.length + 1,
    truck: createTruck(),
    calls: phone.calls,
    stockroom: generateStockroom(rng.stock),
    employee: { pos: { ...REGISTER }, task: null, busySeconds: 0, hands: null },
    counterItems: [],
    log: [],
    nextJobId: 101,
    nextLineNo: 1,
    stats: {
      ordersTaken: 0,
      webOrders: 0,
      pickups: 0,
      selfServed: 0,
      selfServeRevenueCents: 0,
      walkouts: 0,
      balks: 0,
      turnedAway: 0,
      canceled: 0,
      sheets: 0,
      jams: 0,
      paperLoads: 0,
      tonerChanges: 0,
      shipments: 0,
      shippingRevenueCents: 0,
      dropoffs: 0,
      dropoffPackages: 0,
      packagePickups: 0,
      missedTruckPackages: 0,
      refundsCents: 0,
      carrierCostCents: 0,
      serviceFeesCents: 0,
      rushFeesCents: 0,
      callsAnswered: 0,
      missedCalls: 0,
      quoteLeads: 0,
      callbacks: 0,
      copierJams: 0,
      copierRefills: 0,
      copierGaveUp: 0,
      breakdowns: 0,
      recalls: 0,
      wastedSheets: 0,
      checks: 0,
    },
    over: false,
    knowledge: {},
    mistakes: [],
    computer: createComputer(),
    devUsed: false,
  };
  rollBreakdowns(rng.upkeep, state.printers, state.closeAt);
  log(state, `Store open. Hours today ${formatClock(0)} to ${formatClock(state.closeAt)}.`);
  return { state, rng };
}

export function isShiftOver(state: GameState): boolean {
  return state.over;
}

// ---------- main loop ----------

export function tick(sim: Sim, dt: number): void {
  const { state } = sim;
  if (state.over) return;
  const wasOpen = state.time < state.closeAt;
  state.time += dt;
  if (wasOpen && state.time >= state.closeAt) {
    log(state, "Closing time. The door is locked; finish up with anyone still inside.");
  }

  placeWebOrders(state);
  runInbox(state);
  for (const j of state.jobs) {
    if (j.channel === "web" && !j.opened && !j.dueTomorrow && state.time > j.dueAt && j.status !== "canceled") {
      mistake(state, "unread_order", `Online order #${j.id} sat unread in the inbox past its pickup time.`, j.id);
    }
  }
  arrivals(state);
  updateEmployee(state, dt);
  runTruck(state);
  runPhone(state);
  runBreakdowns(state);
  for (const p of state.printers) runPrinter(sim, p, dt);
  runSelfServe(sim, dt);
  updateCustomers(state);
  moveCustomers(state, dt);
  checkEnd(state);
}

// ---------- your actions ----------

// Returns why you can't do this right now, or null if you can.
export function canStart(state: GameState, req: TaskRequest): string | null {
  if (state.over) return "The shift is over.";
  const cur = state.employee.task;
  if (cur && sameTask(cur, req)) return "You're already doing that.";
  if (cur && !isInterruptible(state, cur)) return `You're busy: ${cur.label.toLowerCase()}.`;
  const handsFull = handsBlocker(state, req);
  if (handsFull) return handsFull;

  switch (req.type) {
    case "take_order": {
      const c = counterCustomer(state);
      if (!c) return "Nobody is at the counter.";
      if (c.purpose !== "order") return `${c.name} isn't here to order (${purposeText(c)}).`;
      return null;
    }
    case "turn_away": {
      const c = counterCustomer(state);
      if (!c) return "Nobody is at the counter.";
      if (c.purpose !== "order" && c.purpose !== "ship") return `There's nothing to turn away: ${c.name} is here for a ${purposeText(c)}.`;
      return null;
    }
    case "ship_package":
    case "accept_dropoff":
    case "release_package":
    case "check_in_packages":
    case "hand_off_truck":
      return canStartShipping(state, req);
    case "answer_phone":
      return canAnswer(state, req);
    case "fix_copier":
    case "refill_copier":
    case "recall_job":
      return canStartUpkeep(state, req);
    case "walk_to":
      return req.to ? null : "Walk where?";
    case "acknowledge_copier": {
      const c = counterCustomer(state);
      if (!c) return "Nobody is at the counter.";
      if (c.purpose !== "copier_help") return `${c.name} isn't here about a copier.`;
      return null;
    }
    case "take_stock":
    case "put_back":
    case "glance_stock":
    case "count_stock":
    case "check_trays":
    case "check_panel":
    case "check_copier":
    case "check_shelf":
    case "scan_package_room":
    case "check_finishing":
    case "collect_output":
    case "drop_output":
    case "shelve":
    case "stage_packages":
    case "set_down":
    case "pick_up":
      return canStartHands(state, req);
    case "open_app":
    case "refresh_app":
    case "open_message":
    case "reply_email":
    case "call_back":
    case "move_job":
    case "cancel_job":
      return canStartComputer(state, req);
    case "usher_self_serve": {
      const c = counterCustomer(state);
      if (!c) return "Nobody is at the counter.";
      if (c.purpose !== "order") return `${c.name} isn't here for copies (${purposeText(c)}).`;
      if (c.selfServeDeclined) return `${c.name} already said they want full service.`;
      return selfServeBlockerFor(c);
    }
    case "ring_up":
    case "explain_delay": {
      const c = counterCustomer(state);
      if (!c) return "Nobody is at the counter.";
      if (c.purpose !== "pickup") return `${c.name} isn't here for a print pickup (${purposeText(c)}).`;
      const job = jobById(state, c.jobId!)!;
      if (req.type === "ring_up" && job.status !== "ready") return `Order #${job.id} isn't on the pickup shelf.`;
      if (req.type === "explain_delay" && job.status === "ready") return `Order #${job.id} is ready. Ring them up.`;
      return null;
    }
    case "send_job": {
      const job = jobById(state, req.jobId ?? -1);
      const p = printerById(state, req.printerId ?? "");
      if (!job || !p) return "No such order or printer.";
      if (job.status !== "unsent") return `Order #${job.id} was already sent.`;
      if (!job.opened) return `Online order #${job.id} hasn't been opened yet. Read it in the inbox first.`;
      if (!printerSupports(p, { spec: req.spec ?? job.ticket })) return `The ${p.short} printer can't print with those settings.`;
      if (p.status === "needs_service") return `The ${p.short} printer is down until the technician fixes it (about ${formatClock(p.breakdown!.fixedAt)}).`;
      return null;
    }
    case "finish_job": {
      const job = jobById(state, req.jobId ?? -1);
      if (!job) return "No such order.";
      if (job.status !== "printed") return `Order #${job.id} isn't printed yet.`;
      const h = state.employee.hands;
      const holding = h?.kind === "output" && h.jobId === job.id ? h.sheets : 0;
      if (h && !holding) return `Your hands are full (${carryLabel(state, h)}).`;
      const here = job.tableSheets + holding;
      if (here < job.sheets - 1e-6) return `Only ${Math.floor(here)} of ${job.sheets} sheets are here. Collect the rest from the printer's output tray.`;
      return null;
    }
    case "load_paper": {
      const p = printerById(state, req.printerId ?? "");
      const tray = p?.trays.find((t) => t.stock === req.stock);
      if (!p || !tray) return "That printer has no tray for this paper.";
      if (tray.level >= tray.capacity - 0.5) return "That tray is already full.";
      if (tray.stock === "roll" && tray.level >= ROLL_CHANGE_FEET) {
        return `The roll still has ${Math.floor(tray.level)} ft on it. Rolls get changed when they run out (under ${ROLL_CHANGE_FEET} ft).`;
      }
      if (!holdingFits(state, tray.stock)) return `You need ${tray.stock === "roll" ? "a roll" : `${tray.stock} paper`} in your hands. Get it from the stockroom.`;
      return null;
    }
    case "replace_toner": {
      const p = printerById(state, req.printerId ?? "");
      if (!p) return "No such printer.";
      if (p.toner > 25) return `Still ${Math.round(p.toner)}% left. Cartridges get swapped when they're low (25% or less).`;
      const h = state.employee.hands;
      if (!(h?.kind === "supply" && h.item === p.supply)) return `You need a ${STOCK[p.supply].label.toLowerCase()} from the stockroom in your hands.`;
      return null;
    }
    case "clear_jam": {
      const p = printerById(state, req.printerId ?? "");
      if (!p) return "No such printer.";
      if (p.status !== "jammed") return `The ${p.short} printer isn't jammed.`;
      return null;
    }
  }
}

// Starts a task, interrupting finishing work or a walk if needed. Returns an error, or null on success.
export function startTask(state: GameState, req: TaskRequest): string | null {
  const err = canStart(state, req);
  if (err) return err;
  if (state.employee.task) stopTask(state);

  const task = buildTask(state, req);
  if (task.customerId !== undefined) beginServing(state, customerById(state, task.customerId)!);
  const h = state.employee.hands;
  if (req.type === "finish_job" && h?.kind === "output" && h.jobId === req.jobId) {
    putOnTable(state, jobById(state, h.jobId)!, h.sheets); // set the stack down and get to work
    state.employee.hands = null;
  }
  state.employee.task = task;
  return null;
}

// Drops what you're doing. Finishing progress is kept; a customer you were helping goes back to waiting.
export function stopTask(state: GameState): void {
  const t = state.employee.task;
  if (!t) return;
  if (t.type === "finish_job") {
    const job = jobById(state, t.jobId!)!;
    job.finishWorkDone += t.elapsed;
  }
  if (t.customerId !== undefined) {
    const c = customerById(state, t.customerId)!;
    if (c.state === "line") c.waitStart = state.time;
  }
  state.employee.task = null;
}

// Finishing work can be put down to help the counter. Anything you're still walking to can be dropped.
export function isInterruptible(state: GameState, task: Task): boolean {
  return task.type === "finish_job" || task.type === "walk_to" || !near(state.employee.pos, task.station);
}

// What a request would turn into (label, duration), without starting it. Only valid when canStart() is null.
export function previewTask(state: GameState, req: TaskRequest): Task {
  return buildTask(state, req);
}

function sameTask(a: TaskRequest, b: TaskRequest): boolean {
  if (a.type === "walk_to" || b.type === "walk_to") return false; // walking somewhere else is always a new walk
  return a.type === b.type && a.jobId === b.jobId && a.printerId === b.printerId && a.stock === b.stock && a.callId === b.callId && a.copierId === b.copierId;
}

function buildTask(state: GameState, req: TaskRequest): Task {
  const base = { ...req, elapsed: 0 };
  switch (req.type) {
    case "take_order": {
      const c = counterCustomer(state)!;
      const duration = appSwitchSeconds(state, "pos") + takeOrderSeconds(req.spec ?? c.request!.spec);
      return { ...base, label: `Entering ${c.name}'s order in the POS`, station: REGISTER, duration, customerId: c.id };
    }
    case "turn_away": {
      const c = counterCustomer(state)!;
      return { ...base, label: `Telling ${c.name} you can't help them today`, station: REGISTER, duration: DURATIONS.turnAway, customerId: c.id };
    }
    case "ship_package":
    case "accept_dropoff":
    case "release_package":
    case "check_in_packages":
    case "hand_off_truck":
      return buildShippingTask(state, req);
    case "answer_phone":
      return buildAnswerTask(state, req);
    case "fix_copier":
    case "refill_copier":
    case "recall_job":
      return buildUpkeepTask(state, req);
    case "walk_to":
      return { ...base, label: "Walking over", station: { ...req.to! }, duration: 0 };
    case "acknowledge_copier": {
      const c = counterCustomer(state)!;
      return { ...base, label: `Telling ${c.name} you'll fix the copier`, station: REGISTER, duration: MISTAKES.acknowledgeSeconds, customerId: c.id };
    }
    case "take_stock":
    case "put_back":
    case "glance_stock":
    case "count_stock":
    case "check_trays":
    case "check_panel":
    case "check_copier":
    case "check_shelf":
    case "scan_package_room":
    case "check_finishing":
    case "collect_output":
    case "drop_output":
    case "shelve":
    case "stage_packages":
    case "set_down":
    case "pick_up":
      return buildHandsTask(state, req);
    case "open_app":
    case "refresh_app":
    case "open_message":
    case "reply_email":
    case "call_back":
    case "move_job":
    case "cancel_job":
      return buildComputerTask(state, req);
    case "ring_up": {
      const c = counterCustomer(state)!;
      const job = jobById(state, c.jobId!)!;
      // Fetching it from the pickup shelf and back is part of it.
      const fetch = Math.round((2 * Math.hypot(REGISTER.x - PICKUP_SHELF.x, REGISTER.y - PICKUP_SHELF.y)) / TUNING.walkSpeed);
      const search = job.filedUnder !== job.customerId ? MISTAKES.searchSeconds : 0; // it isn't under their name
      const duration = appSwitchSeconds(state, "pos") + (job.prepaid ? DURATIONS.handOver : DURATIONS.ringUp) + fetch + search;
      return { ...base, label: `Ringing up ${c.name} for order #${job.id}`, station: REGISTER, duration, customerId: c.id, jobId: job.id };
    }
    case "usher_self_serve": {
      const c = counterCustomer(state)!;
      return { ...base, label: `Showing ${c.name} to the self-serve copiers`, station: SELF_SERVE_HELP_SPOT, duration: DURATIONS.usherSelfServe, customerId: c.id };
    }
    case "explain_delay": {
      const c = counterCustomer(state)!;
      return { ...base, label: `Telling ${c.name} order #${c.jobId} isn't ready`, station: REGISTER, duration: DURATIONS.explainDelay, customerId: c.id, jobId: c.jobId! };
    }
    case "send_job": {
      const p = printerById(state, req.printerId!)!;
      return { ...base, label: `Sending order #${req.jobId} to the ${p.short} printer`, station: REGISTER, duration: appSwitchSeconds(state, "printserver") + DURATIONS.sendJob };
    }
    case "finish_job": {
      const job = jobById(state, req.jobId!)!;
      const left = finishSeconds(finishingSpec(job)) - job.finishWorkDone;
      return { ...base, label: `${FINISHING_VERB[job.ticket.finishing]}: order #${job.id}`, station: FINISHING_STATION, duration: left };
    }
    case "load_paper": {
      const p = printerById(state, req.printerId!)!;
      const roll = req.stock === "roll";
      const what = roll ? "a new paper roll" : `${req.stock} paper`;
      const duration = roll ? DURATIONS.loadRoll : DURATIONS.loadPaper;
      return { ...base, label: `Loading ${what} in the ${p.short} printer`, station: p.station, duration };
    }
    case "replace_toner": {
      const p = printerById(state, req.printerId!)!;
      const what = p.wideSecondsPerSqFt ? "ink" : "toner";
      const duration = DURATIONS.replaceToner;
      return { ...base, label: `Replacing ${what} in the ${p.short} printer`, station: p.station, duration };
    }
    case "clear_jam": {
      const p = printerById(state, req.printerId!)!;
      return { ...base, label: `Clearing a jam in the ${p.short} printer`, station: p.station, duration: p.jamClearSeconds };
    }
  }
}

function completeTask(state: GameState, task: Task): void {
  const c = task.customerId !== undefined ? customerById(state, task.customerId)! : null;
  switch (task.type) {
    case "take_order": {
      state.computer.app = "pos";
      const job = createJob(state, c!, "counter", task.spec);
      state.stats.ordersTaken++;
      c!.purpose = "pickup";
      c!.lineTicket = null;
      const what = `${describeQuantity(job.spec)} (order #${job.id}, ${money(job.priceCents)})`;
      if (job.dueTomorrow) {
        sendAway(c!, null);
        log(state, `Took ${c!.name}'s order: ${what}. Paid now, picking up tomorrow.`);
      } else if (c!.request!.timing.kind === "wait") {
        c!.state = "seated";
        c!.seatedUntil = job.dueAt + c!.lateTolerance;
        log(state, `Took ${c!.name}'s order: ${what}. They're waiting for it, needs to be ready by ${formatClock(job.dueAt)}.`);
      } else {
        sendAway(c!, Math.max(state.time + 10 * MIN, job.dueAt + c!.arrivalJitter));
        log(state, `Took ${c!.name}'s order: ${what}. Coming back at ${formatClock(job.dueAt)}.`);
      }
      return;
    }
    case "usher_self_serve": {
      if (selfServePreference(c!) === "full_service") {
        // They hear the pitch and still want it done for them. Back to the front of the line for a regular order.
        c!.selfServeDeclined = true;
        c!.waitStart = state.time;
        log(state, `${c!.name} would rather have it done for them. Full service, then.`);
        return;
      }
      goToSelfServe(state, c!);
      log(state, `Set ${c!.name} up at self-serve.`);
      return;
    }
    case "turn_away": {
      c!.outcome = "turned_away";
      c!.rating = clampRating(3 - c!.penalty);
      state.stats.turnedAway++;
      sendAway(c!, null);
      log(state, `Turned away ${c!.name} (they'll go somewhere else).`);
      return;
    }
    case "ship_package":
    case "accept_dropoff":
    case "release_package":
    case "check_in_packages":
    case "hand_off_truck":
      completeShippingTask(state, task);
      return;
    case "answer_phone":
      completeAnswer(state, task);
      return;
    case "fix_copier":
    case "refill_copier":
    case "recall_job":
      completeUpkeepTask(state, task);
      return;
    case "walk_to":
      return;
    case "acknowledge_copier": {
      // They go back and wait at their copier; their patience is still running from when it stopped.
      c!.purpose = "order";
      c!.state = "self_serve";
      c!.lineTicket = null;
      c!.waitStart = null;
      log(state, `Told ${c!.name} you'd come fix their copier.`);
      return;
    }
    case "take_stock":
    case "put_back":
    case "glance_stock":
    case "count_stock":
    case "check_trays":
    case "check_panel":
    case "check_copier":
    case "check_shelf":
    case "scan_package_room":
    case "check_finishing":
    case "collect_output":
    case "drop_output":
    case "shelve":
    case "stage_packages":
    case "set_down":
    case "pick_up":
      completeHandsTask(state, task);
      return;
    case "open_app":
    case "refresh_app":
    case "open_message":
    case "reply_email":
    case "call_back":
    case "move_job":
    case "cancel_job":
      completeComputerTask(state, task);
      return;
    case "ring_up": {
      const job = jobById(state, task.jobId!)!;
      state.computer.app = "pos";
      if (job.filedUnder !== job.customerId) {
        c!.penalty += MISTAKES.searchPenalty;
        mistake(state, "misfiled", `Order #${job.id} was shelved under the wrong name; ${c!.name} waited while you searched for it.`, job.id);
      }
      const wrong = jobMismatches(job);
      if (wrong.length) return refuseJob(state, c!, job, wrong);
      job.status = "picked_up";
      job.location = "gone";
      c!.penalty += emailPenalty(state, job);
      observeShelf(state); // you were just at the shelf
      job.closedAt = state.time;
      if (!job.prepaid) state.revenueCents += job.priceCents;
      c!.penalty += latePenalty(job);
      c!.outcome = "picked_up";
      c!.rating = clampRating(5 - c!.penalty);
      state.stats.pickups++;
      sendAway(c!, null);
      log(state, `${c!.name} picked up order #${job.id}${job.prepaid ? " (already paid)" : ` and paid ${money(job.priceCents)}`}.`);
      return;
    }
    case "explain_delay": {
      const job = jobById(state, task.jobId!)!;
      c!.lineTicket = null;
      if (job.dueAt - state.time > 20 * MIN) {
        // They're early. They'll come back when it was promised.
        sendAway(c!, job.dueAt + 5 * MIN);
        log(state, `Told ${c!.name} order #${job.id} will be ready at ${formatClock(job.dueAt)}. They'll come back then.`);
      } else {
        if (state.time > job.dueAt) c!.penalty += 0.5;
        c!.state = "seated";
        c!.seatedUntil = Math.max(state.time, job.dueAt) + c!.lateTolerance;
        log(state, `Told ${c!.name} order #${job.id} isn't ready yet. They're waiting.`);
      }
      return;
    }
    case "send_job": {
      const job = jobById(state, task.jobId!)!;
      if (job.status !== "unsent") return; // canceled while you were at it
      const p = printerById(state, task.printerId!)!;
      state.computer.app = "printserver";
      // The printer makes what it's told. Sheets already printed (before a recall) still count if they still fit.
      const settings = { ...(task.spec ?? job.ticket), item: job.ticket.item };
      job.spec = settings;
      job.sheets = totalSheets(settings);
      job.sheetsPrinted = Math.min(job.sheetsPrinted, job.sheets);
      job.status = "queued";
      job.printerId = p.id;
      // The print server runs its queue by due time; the job already printing keeps going.
      const at = p.queue.findIndex((id) => jobById(state, id)!.dueAt > job.dueAt);
      if (at === -1) p.queue.push(job.id);
      else p.queue.splice(at, 0, job.id);
      const ahead = at === -1 ? p.queue.length - 1 : at;
      log(state, `Sent order #${job.id} to the ${p.short} printer${ahead ? ` (${ahead} ahead of it in the queue)` : ""}.`);
      return;
    }
    case "finish_job": {
      const job = jobById(state, task.jobId!)!;
      if (job.status !== "printed" || state.employee.hands) return;
      job.finishWorkDone = finishSeconds(finishingSpec(job));
      job.status = "bagged";
      job.location = "hands";
      job.tableSheets = 0;
      state.employee.hands = { kind: "bag", jobId: job.id };
      state.costCents += finishCostCents(finishingSpec(job));
      observeFinishing(state);
      log(state, `Finished and bagged order #${job.id}. It goes on the pickup shelf next.`);
      return;
    }
    case "load_paper": {
      const p = printerById(state, task.printerId!)!;
      const tray = p.trays.find((t) => t.stock === task.stock)!;
      const h = state.employee.hands;
      if (!holdingFits(state, tray.stock) || !h) return;
      let amount: number;
      if (h.kind === "paper") tray.loaded = h.stock; // whatever you put in is what it'll print on
      if (h.kind === "roll") {
        amount = tray.capacity;
        tray.level = tray.capacity;
        state.employee.hands = null;
      } else {
        const paper = h as Extract<typeof h, { kind: "paper" }>;
        amount = Math.min(Math.floor(tray.capacity - tray.level), paper.sheets);
        tray.level += amount;
        paper.sheets -= amount;
        if (paper.sheets <= 0) state.employee.hands = null;
      }
      observeTray(state, p, tray);
      state.stats.paperLoads++;
      const what = tray.stock === "roll" ? "a new roll" : `${amount.toLocaleString("en-US")} sheets of ${tray.stock} paper`;
      log(state, `Loaded ${what} in the ${p.short} printer.`);
      if (p.status === "out_of_paper") resume(p);
      return;
    }
    case "replace_toner": {
      const p = printerById(state, task.printerId!)!;
      const h = state.employee.hands;
      if (!(h?.kind === "supply" && h.item === p.supply)) return;
      state.employee.hands = null;
      p.toner = 100;
      state.stats.tonerChanges++;
      log(state, `Replaced the ${p.wideSecondsPerSqFt ? "ink" : "toner"} in the ${p.short} printer.`);
      if (p.status === "out_of_toner") resume(p);
      observePanel(state, p);
      return;
    }
    case "clear_jam": {
      const p = printerById(state, task.printerId!)!;
      log(state, `Cleared the jam in the ${p.short} printer.`);
      if (p.status === "jammed") resume(p);
      observePanel(state, p);
      return;
    }
  }
}

// ---------- systems ----------

function placeWebOrders(state: GameState): void {
  for (const c of state.customers) {
    if (c.webOrderAt === null || c.jobId !== null || state.time < c.webOrderAt || c.webOrderAt >= state.closeAt) continue;
    const job = createJob(state, c, "web");
    deliverWebOrder(state, job, c);
    state.stats.webOrders++;
    c.visitAt = job.dueTomorrow ? null : Math.max(state.time + 30 * MIN, job.dueAt + c.arrivalJitter);
    const when = job.dueTomorrow ? "pickup tomorrow" : `pickup at ${formatClock(job.dueAt)}`;
    log(state, `Online order #${job.id} came in from ${c.name} (${describeQuantity(job.spec)}, ${when}). It's in the inbox.`);
  }
}

function arrivals(state: GameState): void {
  for (const c of state.customers) {
    if (c.state !== "outside" || c.visitAt === null || state.time < c.visitAt) continue;
    c.visitAt = null;
    if (state.time >= state.closeAt) continue; // locked out, they'll come tomorrow

    c.pos = { ...DOOR };
    if (c.purpose === "order" && selfServeBlockerFor(c) === null && selfServePreference(c) === "alone") {
      goToSelfServe(state, c);
      log(state, `${c.name} came in and went straight to self-serve.`);
      continue;
    }
    const canBalk = c.purpose === "order" || c.purpose === "ship" || c.purpose === "dropoff";
    if (canBalk && lineCustomers(state).length >= c.balkLineLength) {
      c.outcome = "balked";
      state.stats.balks++;
      log(state, `Someone looked at the line and left without coming in.`);
      continue;
    }
    c.pos = { ...DOOR };
    joinLine(state, c);
    const why = {
      order: "with a print order",
      pickup: `to pick up order #${c.jobId}`,
      ship: "to ship a package",
      dropoff: `to drop off ${c.dropoffCount} prepaid package${c.dropoffCount === 1 ? "" : "s"}`,
      package: "to pick up a held package",
      copier_help: "",
    }[c.purpose];
    log(state, `${c.name} came in ${why} and got in line.`);
  }
}

function updateEmployee(state: GameState, dt: number): void {
  const e = state.employee;
  const task = e.task;
  if (!task) {
    walk(e.pos, REGISTER, TUNING.walkSpeed * dt); // drift back to the counter when there's nothing to do
    return;
  }
  e.busySeconds += dt;
  if (!near(e.pos, task.station)) {
    walk(e.pos, task.station, TUNING.walkSpeed * dt);
    return;
  }
  task.elapsed += dt;
  if (task.elapsed >= task.duration) {
    e.task = null;
    asYou(() => completeTask(state, task));
  }
}

function runPrinter(sim: Sim, p: Printer, dt: number): void {
  const { state, rng } = sim;
  if (printerStopped(p)) return;

  if (p.currentJobId === null) {
    const next = p.queue.shift();
    if (next === undefined) {
      p.status = "idle";
      return;
    }
    p.currentJobId = next;
    const started = jobById(state, next)!;
    started.status = "printing";
    started.location = "printer";
    p.status = "warming_up";
    p.warmupLeft = p.warmup;
  }
  const job = jobById(state, p.currentJobId)!;

  if (p.status === "warming_up") {
    p.warmupLeft -= dt;
    if (p.warmupLeft > 0) return;
    p.status = "printing";
    return;
  }

  const tray = p.trays.find((t) => t.stock === stockFor(job.spec.media))!;
  if (tray.loaded !== tray.stock && tray.level > 1e-6) job.printedOn = tray.loaded; // the wrong paper is in that tray
  const perSheet = stockPerSheet(job.spec.media);
  if (job.takenShort && (p.toner <= 0 || tray.level < 1e-6) && state.stockroom[p.toner <= 0 ? p.supply : itemForTray(tray.stock)] < 1) {
    mistake(state, "couldnt_fill", `Took order #${job.id} without enough supplies on hand to finish it.`, job.id);
  }
  if (p.toner <= 0) return block(state, p, "out_of_toner", `The ${p.short} printer is out of ${p.wideSecondsPerSqFt ? "ink" : "toner"}.`);
  if (tray.level < 1e-6) return block(state, p, "out_of_paper", `The ${p.short} printer is out of ${tray.stock === "roll" ? "roll paper" : `${tray.stock} paper`}.`);
  const inTray = p.output.reduce((a, o) => a + o.sheets, 0);
  if (inTray >= p.outputCapacity - 1e-6) {
    // A big job fills the tray no matter what. Leaving a finished job sitting in there for a while is the mistake.
    const leftover = p.output.find((o) => {
      const done = jobById(state, o.jobId)!;
      return o.jobId !== job.id && done.printedAt !== null && state.time - done.printedAt >= MISTAKES.outputLeftAfter;
    });
    if (leftover) mistake(state, "output_left", `Left order #${leftover.jobId}'s printed sheets in the ${p.short} printer's tray until it filled up and stopped the printer.`, leftover.jobId);
    return block(state, p, "output_full", `The ${p.short} printer's output tray is full.`);
  }

  let sheets = Math.min(sheetsPerSecond(p, job) * dt, job.sheets - job.sheetsPrinted, tray.level / perSheet, p.outputCapacity - inTray);
  sheets = Math.max(0, sheets);
  job.sheetsPrinted += sheets;
  addOutput(p, job.id, sheets);
  tray.level -= sheets * perSheet;
  p.toner = Math.max(0, p.toner - sheets * tonerPerSheet(p, job.spec));
  p.sheetsToday += sheets;
  state.stats.sheets += sheets;
  state.costCents += sheets * printCostPerSheet(job.spec);
  p.sheetsUntilJam -= sheets * jamFactor(job);

  if (job.sheetsPrinted >= job.sheets - 1e-6) {
    addOutput(p, job.id, job.sheets - job.sheetsPrinted); // the same rounding snap for the stack in the tray
    job.sheetsPrinted = job.sheets;
    job.status = "printed";
    job.printedAt = state.time;
    job.location = p.output.some((o) => o.jobId === job.id) ? "output" : "finishing";
    p.currentJobId = null;
    p.status = "idle";
    log(state, `Order #${job.id} finished printing on the ${p.short} printer.`);
    return;
  }
  if (p.sheetsUntilJam <= 0) {
    p.sheetsUntilJam = rollJamInterval(rng.machine, p);
    p.jamClearSeconds = Math.round(DURATIONS.jamClear[0] + rng.machine() * (DURATIONS.jamClear[1] - DURATIONS.jamClear[0]));
    p.jamsToday++;
    state.stats.jams++;
    // The sheets caught in the jam are ruined and get printed again (their paper and toner are already spent).
    const waste = Math.min(Math.floor(job.sheetsPrinted), rollJamWaste(rng.upkeep));
    job.sheetsPrinted -= waste;
    addOutput(p, job.id, -waste); // the ruined ones never made it to the tray
    state.stats.wastedSheets += waste;
    block(state, p, "jammed", `Paper jam in the ${p.short} printer (order #${job.id}, ${Math.floor(job.sheetsPrinted)} of ${job.sheets} sheets good, ${waste} ruined).`);
  }
}

function addOutput(p: Printer, jobId: number, sheets: number): void {
  const last = p.output[p.output.length - 1];
  if (last && last.jobId === jobId) last.sheets = Math.max(0, last.sheets + sheets);
  else if (sheets > 0) p.output.push({ jobId, sheets });
}

function block(state: GameState, p: Printer, status: PrinterStatus, msg: string): void {
  p.status = status;
  log(state, msg);
}

function resume(p: Printer): void {
  p.status = p.currentJobId !== null ? "printing" : "idle";
}

// ---------- self-serve ----------

// Why this customer can't be sent to self-serve, or null if they can.
export function selfServeBlockerFor(c: Customer): string | null {
  if (!c.request) return "They aren't here for copies.";
  if (c.request.timing.kind !== "wait") return "They're dropping it off for us to do, not staying to make copies.";
  return selfServeBlocker(c.request.spec);
}

// What an eligible customer does about self-serve. Rolled with the day, so it's the same every time for a seed.
// What an eligible customer does about self-serve. Their roll is fixed with the day; whether it lands on "full service"
// depends on how much more full service would cost them (fees included) than doing it themselves.
export function selfServePreference(c: Customer): "alone" | "with_help" | "full_service" {
  if (c.selfServeRoll < SELF_SERVE.needsHelp) return "with_help";
  if (c.selfServeRoll >= 1 - fullServiceShare(c.request!.spec)) return "full_service";
  return "alone";
}

// Share of eligible customers who'd insist on full service for this job.
export function fullServiceShare(spec: Job["spec"]): number {
  const extra = fullServiceQuote(spec, true).totalCents - selfServePriceCents(spec); // they're waiting for it: same day
  const timeSaved = (selfServeSeconds(spec) / 60) * SELF_SERVE.timeValueCentsPerMinute;
  const share = SELF_SERVE.maxRefuse * Math.exp(-Math.max(0, extra - timeSaved) / SELF_SERVE.refuseScaleCents);
  return Math.max(SELF_SERVE.minRefuse, share);
}

// Customers waiting for a copier (not yet assigned one), first in line first.
export function selfServeQueue(state: GameState): Customer[] {
  return state.customers
    .filter((c) => c.state === "self_serve" && !state.copiers.some((cp) => cp.userId === c.id))
    .sort((a, b) => a.selfServeTicket! - b.selfServeTicket!);
}

function goToSelfServe(state: GameState, c: Customer): void {
  c.state = "self_serve";
  c.lineTicket = null;
  c.selfServeTicket = state.nextLineNo++;
  c.waitStart = state.time;
}

function runSelfServe(sim: Sim, dt: number): void {
  const { state } = sim;
  for (const cp of state.copiers) {
    if (cp.userId === null) continue;
    const c = customerById(state, cp.userId)!;
    if (!cp.work) {
      if (!near(c.pos, cp.spot)) continue; // still walking over
      if (c.waitStart !== null) {
        const waited = state.time - c.waitStart;
        c.lineWaitTotal += waited;
        c.penalty += Math.max(0, waited - SELF_SERVE.queueGrace) / (5 * MIN); // stuck behind a long job
        c.waitStart = null;
      }
      const spec = c.request!.spec;
      cp.work = { setupLeft: SELF_SERVE.setupSeconds, sidesLeft: impressions(spec), sheetsPerSide: totalSheets(spec) / impressions(spec) };
    }
    runCopier(sim, cp, c, dt);
  }

  const queue = selfServeQueue(state);
  for (const cp of state.copiers) {
    if (cp.userId === null && queue.length) cp.userId = queue.shift()!.id;
  }

  // Nobody has to give the next person a turn: a long job ties up a copier and the queue gets restless.
  for (const c of queue) {
    if (c.waitStart === null || state.time - c.waitStart <= c.linePatience) continue;
    c.lineWaitTotal += state.time - c.waitStart;
    c.penalty += 1;
    c.selfServeTicket = null;
    c.selfServeDeclined = true;
    joinLine(state, c);
    log(state, `${c.name} got tired of waiting for a self-serve copier and got in line at the counter instead.`);
  }
}

// One copier's progress on its current customer's job. It can stop mid-job (jam, out of paper);
// the customer waits there for you, up to their patience.
function runCopier(sim: Sim, cp: Copier, c: Customer, dt: number): void {
  const { state, rng } = sim;
  const work = cp.work!;
  if (work.setupLeft > 0) {
    work.setupLeft -= dt;
    return;
  }
  if (cp.status !== "ok") {
    cp.stoppedSince ??= state.time;
    if (state.time - cp.stoppedSince > c.linePatience) return copierGaveUp(state, cp, c);
    // After a bit they come and tell you, rather than the store announcing it.
    if (!cp.complained && c.state === "self_serve" && state.time - cp.stoppedSince >= MISTAKES.copierComplaintAfter) {
      cp.complained = true;
      c.purpose = "copier_help";
      joinLine(state, c);
      log(state, `${c.name} came up to the counter about self-serve copier ${cp.id}.`);
    }
    return;
  }
  if (c.state === "line") {
    // It got fixed while they were in line: back to it.
    c.purpose = "order";
    c.state = "self_serve";
    c.lineTicket = null;
    c.waitStart = null;
  }
  if (!near(c.pos, cp.spot)) return; // walking back to it
  const spec = c.request!.spec;
  const ppm = SELF_SERVE.ppm[spec.color] * (spec.media === "tabloid" ? 0.5 : 1);
  let sides = Math.min((ppm / 60) * dt, work.sidesLeft);
  let sheets = sides * work.sheetsPerSide;
  if (sheets > cp.paper) {
    sheets = cp.paper;
    sides = sheets / work.sheetsPerSide;
  }
  work.sidesLeft -= sides;
  cp.paper -= sheets;
  cp.sheetsToday += sheets;
  cp.sheetsUntilJam -= sheets;
  state.costCents += sheets * printCostPerSheet(spec);

  if (work.sidesLeft <= 1e-6) {
    finishSelfServe(state, cp, c);
  } else if (cp.sheetsUntilJam <= 0) {
    cp.status = "jammed";
    cp.sheetsUntilJam = rollCopierJam(rng.upkeep);
    cp.fixSeconds = rollFixSeconds(rng.upkeep);
    cp.stoppedSince = state.time;
    cp.jamsToday++;
    state.stats.copierJams++;
    log(state, `Self-serve copier ${cp.id} jammed while ${c.name} was using it. They're waiting for someone to clear it.`);
  } else if (cp.paper < 1e-6) {
    cp.status = "out_of_paper";
    cp.stoppedSince = state.time;
    log(state, `Self-serve copier ${cp.id} ran out of paper while ${c.name} was using it. They're waiting for a refill.`);
  }
}

function finishSelfServe(state: GameState, cp: Copier, c: Customer): void {
  const price = selfServePriceCents(c.request!.spec);
  state.revenueCents += price;
  state.stats.selfServed++;
  state.stats.selfServeRevenueCents += price;
  releaseCopier(cp);
  c.outcome = "self_served";
  c.rating = clampRating(5 - c.penalty);
  sendAway(c, null);
  log(state, `${c.name} finished at self-serve copier ${cp.id} and paid ${money(price)} at the machine.`);
}

// The copier stopped on them and nobody came. No sale, and they're not happy.
function copierGaveUp(state: GameState, cp: Copier, c: Customer): void {
  releaseCopier(cp);
  c.outcome = "copier_gave_up";
  c.rating = 1;
  state.stats.copierGaveUp++;
  sendAway(c, null);
  log(state, `${c.name} gave up on self-serve copier ${cp.id} (it's ${cp.status === "jammed" ? "jammed" : "out of paper"}) and left without paying.`);
}

function releaseCopier(cp: Copier): void {
  cp.userId = null;
  cp.work = null;
  cp.stoppedSince = null;
  cp.complained = false;
}

function updateCustomers(state: GameState): void {
  const serving = servingCustomerId(state);
  for (const c of state.customers) {
    if (c.state === "line") {
      if (c.id === serving || c.waitStart === null || c.purpose === "copier_help") continue;
      if (state.time - c.waitStart > c.linePatience) leaveLine(state, c);
    } else if (c.state === "seated") {
      const job = jobById(state, c.jobId!)!;
      if (job.status === "ready") {
        joinLine(state, c);
        log(state, `${c.name} saw order #${job.id} was ready and came up to the counter.`);
      } else if (state.time > c.seatedUntil!) {
        giveUpWaiting(state, c, job);
      }
    } else if (c.state === "leaving" && near(c.pos, DOOR)) {
      c.state = "outside";
    }
  }
}

function leaveLine(state: GameState, c: Customer): void {
  c.lineTicket = null;
  c.waitStart = null;
  if (c.purpose === "order" || c.purpose === "ship" || c.purpose === "dropoff") {
    c.outcome = "walked_out";
    c.rating = 1;
    state.stats.walkouts++;
    sendAway(c, null);
    log(state, `${c.name} gave up waiting in line and left.`);
    return;
  }
  c.penalty += 1;
  c.returns++;
  const again = c.returns <= 1 && state.time + c.returnDelay < state.closeAt;
  sendAway(c, again ? state.time + c.returnDelay : null);
  const what = c.purpose === "package" ? "their package" : `order #${c.jobId}`;
  log(state, `${c.name} got tired of the line and left without ${what}. ${again ? "They'll try again later." : "They'll come back another day."}`);
}

function giveUpWaiting(state: GameState, c: Customer, job: Job): void {
  if (c.returns === 0 && state.time + c.returnDelay < state.closeAt) {
    c.returns++;
    c.penalty += 1;
    sendAway(c, state.time + c.returnDelay);
    log(state, `${c.name} got tired of waiting for order #${job.id} and left. They'll come back later.`);
    return;
  }
  cancelJob(state, job);
  c.outcome = "canceled";
  c.rating = 1;
  state.stats.canceled++;
  sendAway(c, null);
  log(state, `${c.name} canceled order #${job.id}${job.prepaid ? " and was refunded" : ""}.`);
}

function cancelJob(state: GameState, job: Job): void {
  job.status = "canceled";
  job.location = "gone"; // whatever was printed is recycled
  job.closedAt = state.time;
  if (job.prepaid) state.revenueCents -= job.priceCents;
  for (const p of state.printers) {
    p.queue = p.queue.filter((id) => id !== job.id);
    if (p.currentJobId === job.id) {
      p.currentJobId = null;
      // A jam or a broken printer stays that way. Anything else was about this job; the next one re-checks supplies.
      if (p.status !== "jammed" && p.status !== "needs_service") p.status = "idle";
    }
  }
  if (state.employee.task?.jobId === job.id) state.employee.task = null;
}

function moveCustomers(state: GameState, dt: number): void {
  const step = TUNING.walkSpeed * dt;
  lineCustomers(state).forEach((c, i) => walk(c.pos, lineSlot(i), step));
  selfServeQueue(state).forEach((c, i) => walk(c.pos, selfServeQueueSlot(i), step));
  for (const cp of state.copiers) {
    const user = cp.userId !== null ? customerById(state, cp.userId)! : null;
    if (user && user.state === "self_serve") walk(user.pos, cp.spot, step);
  }
  for (const c of state.customers) {
    if (c.state === "seated") walk(c.pos, seatFor(c.id), step);
    else if (c.state === "leaving") walk(c.pos, DOOR, step);
  }
}

function checkEnd(state: GameState): void {
  if (state.time < state.closeAt) return;
  const inside = state.customers.some((c) => c.state === "line" || c.state === "seated" || c.state === "self_serve");
  if (inside && state.time < state.closeAt + TUNING.overtimeLimit) return;
  finalize(state);
}

// Close out the day: everyone who still has an order open gets rated on how it went so far.
function finalize(state: GameState): void {
  stopTask(state);
  for (const cp of state.copiers) {
    if (cp.userId !== null && cp.work && cp.status === "ok") finishSelfServe(state, cp, customerById(state, cp.userId)!); // let them finish
  }
  for (const c of state.customers) {
    if (c.outcome !== null) continue;
    if (c.purpose === "package" && c.returns > 0 && c.state !== "line") {
      c.outcome = "pickup_later"; // came in, didn't get their package, will try another day
      c.rating = clampRating(5 - c.penalty);
      continue;
    }
    if (c.jobId === null) {
      if (c.state === "line" || c.state === "self_serve") {
        c.outcome = "walked_out";
        c.rating = 1;
        state.stats.walkouts++;
      }
      continue; // never made it in today
    }
    const job = jobById(state, c.jobId)!;
    c.outcome = "pickup_later";
    if (job.readyAt === null) c.penalty += job.dueTomorrow ? 1 : 2;
    else c.penalty += latePenalty(job);
    c.rating = clampRating(5 - c.penalty);
  }
  state.over = true;
  log(state, "Shift over.");
}

// ---------- jobs ----------

// When an order taken (or placed online) at time `at` is due.
export function quoteDue(state: GameState, c: Customer, at = state.time): { dueAt: number; tomorrow: boolean } {
  const t = c.request!.timing;
  if (t.kind === "tomorrow") return { dueAt: state.closeAt, tomorrow: true };
  if (t.kind === "wait") return { dueAt: at + t.minutes * MIN, tomorrow: false };
  const quarter = 15 * MIN;
  const dueAt = Math.ceil((at + t.minutes * MIN) / quarter) * quarter;
  if (dueAt > state.closeAt - TUNING.backOrderCutoff) return { dueAt: state.closeAt, tomorrow: true };
  return { dueAt, tomorrow: false };
}

// entered: what you put in the POS (defaults to exactly what they asked for). Web orders are typed in by the customer.
function createJob(state: GameState, c: Customer, channel: "counter" | "web", entered?: JobSpec): Job {
  const { dueAt, tomorrow } = quoteDue(state, c);
  const requested = c.request!.spec;
  const spec = { ...(entered ?? requested), item: requested.item };
  const quote = fullServiceQuote(spec, !tomorrow);
  const job: Job = {
    id: state.nextJobId++,
    customerId: c.id,
    profileId: c.profileId,
    channel,
    spec,
    ticket: { ...spec },
    requested: { ...requested },
    opened: channel === "counter",
    sheets: totalSheets(spec),
    priceCents: quote.totalCents,
    serviceFeeCents: quote.serviceFeeCents,
    rushCents: quote.rushCents,
    prepaid: channel === "web" || tomorrow,
    status: "unsent",
    printerId: null,
    sheetsPrinted: 0,
    finishWorkDone: 0,
    orderedAt: state.time,
    dueAt,
    dueTomorrow: tomorrow,
    printedAt: null,
    readyAt: null,
    closedAt: null,
    location: "none",
    printedOn: null,
    takenShort: channel === "counter" && paperShortfall(state, spec) !== null,
    redos: 0,
    tableSheets: 0,
    filedUnder: null,
  };
  if (job.prepaid) state.revenueCents += job.priceCents;
  state.stats.serviceFeesCents += quote.serviceFeeCents;
  state.stats.rushFeesCents += quote.rushCents;
  state.jobs.push(job);
  c.jobId = job.id;
  return job;
}

// The customer looks it over at pickup and it isn't what they asked for. It's reprinted at your cost; they wait.
function refuseJob(state: GameState, c: Customer, job: Job, wrong: string[]): void {
  const paperOnly = wrong.length === 1 && wrong[0].startsWith("printed on");
  mistake(state, paperOnly ? "wrong_paper" : "wrong_settings", `${c.name} refused order #${job.id}: ${wrong.join(", ")}.`, job.id);
  log(state, `${c.name} looked at order #${job.id} and refused it (${wrong.join(", ")}). It has to be redone.`);
  c.penalty += MISTAKES.refusalPenalty;
  // Start over with exactly what they asked for. They pay the right price, once, when it's right.
  const right = { ...job.requested };
  job.spec = { ...right };
  job.ticket = { ...right };
  job.sheets = totalSheets(right);
  job.sheetsPrinted = 0;
  job.finishWorkDone = 0;
  job.tableSheets = 0;
  job.printedOn = null;
  job.filedUnder = null;
  job.readyAt = null;
  job.printedAt = null;
  job.status = "unsent";
  job.location = "none";
  job.redos++;
  if (!job.prepaid) job.priceCents = fullServiceQuote(right, !job.dueTomorrow).totalCents;
  job.dueAt = state.time + MISTAKES.redoPatience;
  c.lineTicket = null;
  if (c.request?.timing.kind === "wait") {
    c.state = "seated";
    c.seatedUntil = job.dueAt + c.lateTolerance;
  } else {
    sendAway(c, job.dueAt);
  }
}

function latePenalty(job: Job): number {
  if (job.dueTomorrow || job.readyAt === null) return 0;
  const late = job.readyAt - job.dueAt;
  return Math.max(0, late - TUNING.lateGrace) / (10 * MIN); // a star per 10 minutes late
}

// ---------- printers ----------

export function printerSupports(p: Printer, job: { spec: Job["spec"] }): boolean {
  return p.colors.includes(job.spec.color) && p.media.includes(job.spec.media);
}

export function sheetsPerSecond(p: Printer, job: { spec: Job["spec"] }): number {
  const spec = job.spec;
  if (isWide(spec.media)) return 1 / (sqFt(spec.media) * p.wideSecondsPerSqFt![spec.color]);
  const sidesPerSheet = spec.duplex ? 2 : 1;
  return ((p.ppm / 60) * MEDIA_SPEED[spec.media]) / sidesPerSheet;
}

function tonerPerSheet(p: Printer, spec: Job["spec"]): number {
  if (isWide(spec.media)) return sqFt(spec.media) * p.tonerUse[spec.color];
  const sides = (spec.originals * spec.copies) / totalSheets(spec);
  return sides * (spec.media === "tabloid" ? 2 : 1) * p.tonerUse[spec.color];
}

function jamFactor(job: Job): number {
  return MEDIA_JAM_FACTOR[job.spec.media] * (job.spec.duplex ? DUPLEX_JAM_FACTOR : 1);
}

function rollJamInterval(rng: Rng, p: Printer): number {
  return -p.meanSheetsBetweenJams * Math.log(1 - rng());
}

// Seconds until this printer has worked through everything sent to it (assuming nobody fixes anything faster).
// With dueBy, only queued jobs that would print before an order due then are counted.
export function printerBacklog(state: GameState, p: Printer, dueBy = Infinity): number {
  let s = 0;
  if (p.status === "jammed") s += p.jamClearSeconds + 60;
  if (p.status === "out_of_paper" || p.status === "out_of_toner") s += 180;
  if (p.status === "needs_service") s += Math.max(0, p.breakdown!.fixedAt - state.time);
  if (p.currentJobId !== null) {
    const job = jobById(state, p.currentJobId)!;
    s += (p.status === "warming_up" ? p.warmupLeft : 0) + (job.sheets - job.sheetsPrinted) / sheetsPerSecond(p, job);
  }
  for (const id of p.queue) {
    const job = jobById(state, id)!;
    if (job.dueAt > dueBy) break;
    s += p.warmup + job.sheets / sheetsPerSecond(p, job);
  }
  return s;
}

// Rough time an order due at dueAt would be ready if you took it now. Assumes you work in due-date order:
// only printer queue and hands-on work due before it gets in the way.
export function estimateReadyAt(state: GameState, spec: Job["spec"], dueAt: number, lead = takeOrderSeconds(spec)): { at: number; printerId: string | null } {
  const sheets = totalSheets(spec);
  const t = state.time;
  const cur = state.employee.task;
  const curLeft = cur ? cur.duration - cur.elapsed : 0;
  const sentAt = t + curLeft + lead + DURATIONS.sendJob;

  let best: { end: number; id: string } | null = null;
  for (const p of state.printers) {
    if (!printerSupports(p, { spec }) || !printerCanRun(state, p, spec)) continue;
    const end = Math.max(sentAt, t + printerBacklog(state, p, dueAt)) + p.warmup + sheets / sheetsPerSecond(p, { spec });
    if (!best || end < best.end) best = { end, id: p.id };
  }
  if (!best) return { at: Infinity, printerId: null };
  const ready = Math.max(best.end, t + curLeft + lead + yourBacklog(state, dueAt)) + finishSeconds(spec);
  return { at: ready, printerId: best.id };
}

// Whether a printer could get through a job with what's on hand: toner in it or a spare on the shelf.
export function printerCanRun(state: GameState, p: Printer, spec: Job["spec"]): boolean {
  if (p.status === "needs_service" && p.breakdown!.fixedAt >= state.closeAt) return false; // down for the day
  const tonerNeeded = totalSheets(spec) * tonerPerSheet(p, spec);
  return p.toner >= tonerNeeded || state.stockroom[p.supply] >= 1;
}

// Seconds of hands-on work already waiting for you (sending and finishing open orders), optionally only orders due by dueBy.
export function yourBacklog(state: GameState, dueBy = Infinity): number {
  let s = 0;
  for (const j of state.jobs) {
    if (j.dueAt > dueBy) continue;
    if (j.status === "unsent") s += DURATIONS.sendJob;
    if (j.status === "unsent" || j.status === "queued" || j.status === "printing" || j.status === "printed") {
      s += finishSeconds(finishingSpec(j)) - j.finishWorkDone;
    }
  }
  return s;
}

// ---------- results ----------

export function ratedCustomers(state: GameState): Customer[] {
  return state.customers.filter((c) => c.rating !== null);
}

export function averageRating(state: GameState): number | null {
  const rated = ratedCustomers(state);
  if (!rated.length) return null;
  return rated.reduce((s, c) => s + c.rating!, 0) / rated.length;
}

// 0..100, from the average star rating.
export function satisfaction(state: GameState): number {
  const avg = averageRating(state);
  return avg === null ? 100 : ((avg - 1) / 4) * 100;
}

export function profitCents(state: GameState): number {
  return state.revenueCents - Math.round(state.costCents);
}

// Gross profit, weighted by satisfaction squared: a well-run day keeps most of its profit; a sloppy one loses a real share.
export function score(state: GameState): number {
  const sat = satisfaction(state) / 100;
  return Math.max(0, Math.round((profitCents(state) / 100) * sat * sat));
}
