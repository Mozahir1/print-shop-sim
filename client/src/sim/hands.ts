// Your hands and your eyes. You carry one thing at a time (a case of paper, a toner, a roll, a box, a stack of
// printed output, a bagged order, packages), and you only know what's somewhere by going and looking.
import type { BoxSize, Carry, GameState, Job, PaperStock, StockItem, Task, TaskRequest, TaskType } from "./types";
import { HANDS, STOCK } from "./config";
import { FINISHING_STATION, PACKAGE_ROOM, PICKUP_SHELF, REGISTER, STOCKROOM } from "./layout";
import { take } from "./inventory";
import {
  countStock,
  glanceStock,
  observeCopier,
  observeFinishing,
  observePackageRoom,
  observePanel,
  observeShelf,
  observeTray,
} from "./knowledge";
import { customerById, jobById, log, printerById, sentence } from "./util";

// Customer-facing work at the counter needs empty hands.
export const COUNTER_WORK: TaskType[] = [
  "take_order",
  "turn_away",
  "ring_up",
  "explain_delay",
  "usher_self_serve",
  "accept_dropoff",
  "release_package",
  "ship_package",
];

export const HAND_TASKS: TaskType[] = [
  "take_stock",
  "put_back",
  "glance_stock",
  "count_stock",
  "check_trays",
  "check_panel",
  "check_copier",
  "check_shelf",
  "scan_package_room",
  "check_finishing",
  "collect_output",
  "drop_output",
  "shelve",
  "stage_packages",
  "set_down",
  "pick_up",
];

export function carryLabel(state: GameState, c: Carry): string {
  switch (c.kind) {
    case "paper":
      return `${c.sheets.toLocaleString("en-US")} sheets of ${STOCK[c.stock].label.toLowerCase()}`;
    case "roll":
      return "a wide format roll";
    case "supply":
      return `a ${STOCK[c.item].label.toLowerCase()} ${STOCK[c.item].unit === "sets" ? "set" : "cartridge"}`;
    case "box":
      return `a ${c.size} box`;
    case "output":
      return `the printed sheets for order #${c.jobId} (${Math.floor(c.sheets)})`;
    case "bag": {
      const job = jobById(state, c.jobId)!;
      return `order #${c.jobId}, bagged (${customerById(state, job.customerId)?.name ?? "?"})`;
    }
    case "packages":
      return c.packageIds.length === 1 ? "a package" : `${c.packageIds.length} packages`;
  }
}

// What you get from the stockroom: a case of paper (or what's left), or one of anything else.
export function carryFromStock(state: GameState, item: StockItem): Carry {
  if (item === "letter" || item === "legal" || item === "tabloid" || item === "cardstock") {
    return { kind: "paper", stock: item, sheets: Math.min(STOCK[item].pack, state.stockroom[item]) };
  }
  if (item === "wide_roll") return { kind: "roll" };
  if (item === "box_small" || item === "box_medium" || item === "box_large") return { kind: "box", size: item.slice(4) as BoxSize };
  return { kind: "supply", item };
}

function stockOfCarry(c: Carry): { item: StockItem; amount: number } | null {
  if (c.kind === "paper") return { item: c.stock, amount: c.sheets };
  if (c.kind === "roll") return { item: "wide_roll", amount: 1 };
  if (c.kind === "supply") return { item: c.item, amount: 1 };
  if (c.kind === "box") return { item: `box_${c.size}` as StockItem, amount: 1 };
  return null;
}

export function holdingPaper(state: GameState, stock: PaperStock): boolean {
  const h = state.employee.hands;
  return stock === "roll" ? h?.kind === "roll" : h?.kind === "paper" && h.stock === stock;
}

// Paper that physically fits a tray: the right paper, or the wrong paper in the same size (letter and cardstock
// are both 8.5x11, so either goes in either tray). Loading the wrong one is a mistake you can make.
export function holdingFits(state: GameState, stock: PaperStock): boolean {
  const h = state.employee.hands;
  if (stock === "roll") return h?.kind === "roll";
  if (h?.kind !== "paper") return false;
  const letterSize = ["letter", "cardstock"];
  return h.stock === stock || (letterSize.includes(h.stock) && letterSize.includes(stock));
}

// Why counter work can't start with what's in your hands (a box for the package at the counter is fine).
export function handsBlocker(state: GameState, req: TaskRequest): string | null {
  const h = state.employee.hands;
  if (!h || !COUNTER_WORK.includes(req.type)) return null;
  if (req.type === "ship_package" && h.kind === "box") return null;
  return `Your hands are full (${carryLabel(state, h)}). Set it down on the counter or put it where it goes first.`;
}

// ---------- tasks ----------

export function canStartHands(state: GameState, req: TaskRequest): string | null {
  const h = state.employee.hands;
  const full = h ? `Your hands are full (${carryLabel(state, h)}).` : null;
  switch (req.type) {
    case "take_stock":
      if (!req.item) return "Take what?";
      if (full) return full;
      if (state.stockroom[req.item] < 1) return `There's no ${STOCK[req.item].label.toLowerCase()} on the shelf.`;
      return null;
    case "put_back":
      if (!h || !stockOfCarry(h)) return "Only supplies go back on the stockroom shelves.";
      return null;
    case "glance_stock":
    case "check_shelf":
    case "scan_package_room":
    case "check_finishing":
      return null;
    case "count_stock":
      return req.item ? null : "Count what?";
    case "check_trays":
    case "check_panel":
      return printerById(state, req.printerId ?? "") ? null : "No such printer.";
    case "check_copier":
      return state.copiers.some((c) => c.id === req.copierId) ? null : "No such copier.";
    case "collect_output": {
      const p = printerById(state, req.printerId ?? "");
      if (!p) return "No such printer.";
      if (full) return full;
      if (!p.output.length) return `The ${p.short} printer's output tray is empty.`;
      return null;
    }
    case "drop_output":
      return h?.kind === "output" ? null : "You aren't carrying any printed sheets.";
    case "shelve":
      return h?.kind === "bag" ? null : "You aren't carrying a bagged order.";
    case "stage_packages":
      return h?.kind === "packages" ? null : "You aren't carrying any packages.";
    case "set_down":
      return h ? null : "Your hands are empty.";
    case "pick_up":
      if (full) return full;
      return state.counterItems[req.index ?? -1] ? null : "There's nothing there.";
    default:
      return "Not a hands task.";
  }
}

export function buildHandsTask(state: GameState, req: TaskRequest): Task {
  const base = { ...req, elapsed: 0 };
  const h = state.employee.hands;
  switch (req.type) {
    case "take_stock":
      return { ...base, label: `Getting ${carryLabel(state, carryFromStock(state, req.item!))}`, station: STOCKROOM, duration: HANDS.takeStockSeconds };
    case "put_back":
      return { ...base, label: `Putting back ${carryLabel(state, h!)}`, station: STOCKROOM, duration: HANDS.putBackSeconds };
    case "glance_stock":
      return { ...base, label: "Looking over the stockroom shelves", station: STOCKROOM, duration: HANDS.glanceStockSeconds };
    case "count_stock": {
      const paper = ["letter", "legal", "tabloid", "cardstock"].includes(req.item!);
      return { ...base, label: `Counting ${STOCK[req.item!].label.toLowerCase()}`, station: STOCKROOM, duration: paper ? HANDS.countStockSeconds.paper : HANDS.countStockSeconds.other };
    }
    case "check_trays": {
      const p = printerById(state, req.printerId!)!;
      return { ...base, label: `Checking the ${p.short} printer's trays`, station: p.station, duration: HANDS.checkTraySecondsPerTray * p.trays.length };
    }
    case "check_panel": {
      const p = printerById(state, req.printerId!)!;
      return { ...base, label: `Checking the ${p.short} printer's panel`, station: p.station, duration: HANDS.checkPanelSeconds };
    }
    case "check_copier": {
      const cp = state.copiers.find((c) => c.id === req.copierId)!;
      return { ...base, label: `Checking self-serve copier ${cp.id}`, station: cp.station, duration: HANDS.checkCopierSeconds };
    }
    case "check_shelf":
      return { ...base, label: "Checking the pickup shelf", station: PICKUP_SHELF, duration: HANDS.checkShelfSeconds };
    case "scan_package_room": {
      const n = state.packages.filter((p) => p.status === "staged" || p.status === "on_hold" || p.status === "unsorted").length;
      return { ...base, label: "Looking over the package room", station: PACKAGE_ROOM, duration: HANDS.scanPackageRoomBase + HANDS.scanPackageRoomPerPackage * n };
    }
    case "check_finishing":
      return { ...base, label: "Checking the finishing table", station: FINISHING_STATION, duration: HANDS.checkFinishingSeconds };
    case "collect_output": {
      const p = printerById(state, req.printerId!)!;
      const sheets = p.output[0]?.sheets ?? 0;
      return { ...base, label: `Collecting output from the ${p.short} printer`, station: p.station, duration: HANDS.collectOutputSeconds + Math.ceil(sheets / 100) * HANDS.collectPer100Sheets };
    }
    case "drop_output":
      return { ...base, label: "Putting the printed sheets on the finishing table", station: FINISHING_STATION, duration: HANDS.dropOutputSeconds };
    case "shelve": {
      const name = customerById(state, req.filedUnder ?? jobById(state, (h as Extract<Carry, { kind: "bag" }>).jobId)!.customerId)?.name ?? "?";
      return { ...base, label: `Shelving the order under ${name}`, station: PICKUP_SHELF, duration: HANDS.shelveSeconds };
    }
    case "stage_packages": {
      const n = (h as Extract<Carry, { kind: "packages" }>).packageIds.length;
      return { ...base, label: `Putting ${n === 1 ? "the package" : `${n} packages`} in the outbound bin`, station: PACKAGE_ROOM, duration: HANDS.stageBase + HANDS.stagePerPackage * n };
    }
    case "set_down":
      return { ...base, label: `Setting ${carryLabel(state, h!)} down on the counter`, station: REGISTER, duration: HANDS.setDownSeconds };
    case "pick_up":
      return { ...base, label: `Picking up ${carryLabel(state, state.counterItems[req.index!])}`, station: REGISTER, duration: HANDS.setDownSeconds };
    default:
      throw new Error(`not a hands task: ${req.type}`);
  }
}

export function completeHandsTask(state: GameState, task: Task): void {
  const e = state.employee;
  switch (task.type) {
    case "take_stock": {
      if (e.hands || state.stockroom[task.item!] < 1) return;
      const carry = carryFromStock(state, task.item!);
      take(state, task.item!, stockOfCarry(carry)!.amount);
      e.hands = carry;
      countStock(state, task.item!); // you see what's left as you take it
      return;
    }
    case "put_back": {
      const s = stockOfCarry(e.hands!)!;
      state.stockroom[s.item] += s.amount;
      e.hands = null;
      countStock(state, s.item);
      return;
    }
    case "glance_stock":
      glanceStock(state);
      state.stats.checks++;
      return;
    case "count_stock":
      countStock(state, task.item!);
      state.stats.checks++;
      return;
    case "check_trays": {
      const p = printerById(state, task.printerId!)!;
      for (const t of p.trays) observeTray(state, p, t);
      state.stats.checks++;
      return;
    }
    case "check_panel":
      observePanel(state, printerById(state, task.printerId!)!);
      state.stats.checks++;
      return;
    case "check_copier":
      observeCopier(state, task.copierId!);
      state.stats.checks++;
      return;
    case "check_shelf":
      observeShelf(state);
      state.stats.checks++;
      return;
    case "scan_package_room":
      observePackageRoom(state);
      state.stats.checks++;
      return;
    case "check_finishing":
      observeFinishing(state);
      state.stats.checks++;
      return;
    case "collect_output": {
      const p = printerById(state, task.printerId!)!;
      const entry = p.output.shift();
      if (!entry || e.hands) return;
      e.hands = { kind: "output", jobId: entry.jobId, sheets: entry.sheets };
      const job = jobById(state, entry.jobId)!;
      if (job.status === "printed") job.location = "hands";
      if (p.status === "output_full") p.status = p.currentJobId !== null ? "printing" : "idle";
      log(state, `Collected ${Math.floor(entry.sheets)} printed sheets of order #${entry.jobId} from the ${p.short} printer.`);
      observePanel(state, p);
      return;
    }
    case "drop_output": {
      const h = e.hands as Extract<Carry, { kind: "output" }>;
      putOnTable(state, jobById(state, h.jobId)!, h.sheets);
      e.hands = null;
      observeFinishing(state);
      return;
    }
    case "shelve": {
      const h = e.hands as Extract<Carry, { kind: "bag" }>;
      const job = jobById(state, h.jobId)!;
      job.status = "ready";
      job.location = "shelf";
      job.readyAt = state.time;
      job.filedUnder = task.filedUnder ?? job.customerId;
      e.hands = null;
      const name = customerById(state, job.filedUnder)?.name ?? "?";
      log(state, sentence(`Put order #${job.id} on the pickup shelf under ${name}`));
      observeShelf(state);
      return;
    }
    case "stage_packages": {
      const h = e.hands as Extract<Carry, { kind: "packages" }>;
      for (const id of h.packageIds) {
        const pkg = state.packages.find((p) => p.id === id)!;
        if (pkg.status === "unstaged") pkg.status = "staged";
      }
      e.hands = null;
      log(state, `Put ${h.packageIds.length === 1 ? "a package" : `${h.packageIds.length} packages`} in the outbound bin.`);
      observePackageRoom(state);
      return;
    }
    case "set_down":
      state.counterItems.push(e.hands!);
      e.hands = null;
      return;
    case "pick_up":
      e.hands = state.counterItems.splice(task.index!, 1)[0];
      return;
  }
}

export function putOnTable(state: GameState, job: Job, sheets: number): void {
  job.tableSheets += sheets;
  if (job.status === "printed" || job.status === "printing" || job.status === "queued") job.location = "finishing";
}
