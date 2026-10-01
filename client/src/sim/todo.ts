// The to-do list: the obvious next things to do, and how many things need you right now.
// The UI shows it, the bot works from it, and the flow director keeps its size in a band.
import type { CounterChoice, Customer, GameState, Station, TaskRequest, TaskType } from "./types";
import { canStart, currentCustomer, STATION } from "./sim";
import { jobById, packageById } from "./util";
import { eventIsActive } from "./events";

export interface TodoItem {
  text: string;
  station: Station;
  req: TaskRequest; // doing it properly
  alts: TaskRequest[]; // the other ways to handle it (the lazy option, or for a customer: minimum, rude, ignore)
  customerId?: number;
}

// Things that need you. Each customer's request counts once, whether they're in the store or have left an order
// that isn't done (waiting on the printer still counts: it's in progress). So does each package still to go in the
// outbound bin, and the truck while it waits.
export function activeCount(state: GameState): number {
  let n = 0;
  for (const c of state.customers) if (isActive(state, c)) n++;
  for (const p of state.packages) if (p.status === "labeled" || p.status === "scanned") n++;
  if (state.truck.status === "waiting") n++;
  if (eventIsActive(state)) n++;
  return n;
}

export function isActive(state: GameState, c: Customer): boolean {
  if (c.state === "line" || c.state === "talking" || c.state === "waiting") return true;
  if (c.state !== "away") return false;
  const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
  if (!job || job.status === "bagged" || job.status === "picked_up") return false;
  if (job.status === "unread") return !state.messages.some((m) => m.jobId === job.id && m.snoozed); // left unread on purpose
  return true;
}

// The next step for everything that needs you, most urgent first. Only steps you could start right now (ignoring
// that you're busy) are listed.
export function todoList(state: GameState): TodoItem[] {
  const items: TodoItem[] = [];
  const free = { ...state, employee: { ...state.employee, task: null } };
  const add = (text: string, station: Station, req: TaskRequest, customerId?: number, alts: TaskRequest[] = []) => {
    if (canStart(free, req) === null) items.push({ text, station, req, alts, customerId });
  };
  const p = state.printer;
  if (p.status === "tray_empty") add("Printer: tray empty", "printer", { type: "load_paper" });
  if (p.status === "jammed") add("Printer: jammed", "printer", { type: "clear_jam" });
  if (state.copier.status === "broken" && !state.copier.sign) add("Self-serve copier: broken", "self_serve", { type: "fix_copier" }, undefined, [{ type: "out_of_order_sign" }]);
  if (state.cardReader === "down") add("Card reader: down", "computer", { type: "fix_card_reader" });
  if (state.wifi.down) add("Wi-Fi: down", "computer", { type: "restart_router" });
  if (state.truck.status === "waiting") add("The truck is here", "shipping", { type: "hand_off" }, undefined, [{ type: "let_truck_go" }]);

  const waiting = state.customers.filter((c) => c.state === "waiting").sort((a, b) => a.arrivedAt - b.arrivedAt);
  for (const c of waiting) {
    const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
    if (job?.status === "unread") {
      // They're here for a web order nobody opened. It's on the list now, unread or not.
      const m = state.messages.find((x) => x.jobId === job.id);
      if (m) add(`Open ${c.name}'s web order (they're here)`, "computer", { type: "open_message", messageId: m.id }, c.id);
    }
    if (job?.status === "bagged") {
      if (job.prepaid) add(`Hand ${c.name} their order`, "counter", { type: "hand_over", customerId: c.id }, c.id);
      else if (state.cardReader === "down") add(`Ring up ${c.name} (by hand)`, "counter", { type: "manual_ring_up", customerId: c.id }, c.id);
      else add(`Ring up ${c.name}`, "counter", { type: "ring_up", customerId: c.id }, c.id);
    }
    if (c.kind === "package_pickup") {
      add(`Find ${c.name}'s package`, "shipping", { type: "find_package", customerId: c.id }, c.id);
      add(`Hand ${c.name} their package`, "counter", { type: "hand_over", customerId: c.id }, c.id);
    }
    if (c.kind === "dropoff") add(`Scan ${c.name}'s drop-off`, "shipping", { type: "scan_dropoff", customerId: c.id }, c.id);
    if (c.kind === "self_serve_help") add(`Help ${c.name} at self-serve`, "self_serve", { type: "help_self_serve", customerId: c.id }, c.id);
    if (c.kind === "ship" && c.packageId !== null) {
      const pkg = packageById(state, c.packageId)!;
      if (pkg.status === "new") add(`Weigh ${c.name}'s package`, "shipping", { type: "weigh", packageId: pkg.id }, c.id);
      if (pkg.status === "weighed") add(`Pack ${c.name}'s package`, "shipping", { type: "pack", packageId: pkg.id }, c.id, [{ type: "tape_shut", packageId: pkg.id }]);
      if (pkg.status === "packed") add(`Label ${c.name}'s package`, "shipping", { type: "label", packageId: pkg.id }, c.id);
    }
  }

  const front = currentCustomer(state);
  if (front?.state === "line") add(`${front.name} is at the counter`, "counter", { type: "talk", customerId: front.id }, front.id);
  if (front?.state === "talking") {
    const reply = (choice: CounterChoice): TaskRequest => ({ type: "respond", customerId: front.id, choice });
    add(`${front.name} is waiting for an answer`, "counter", reply("proper"), front.id, [reply("minimum"), reply("rude"), reply("ignore")]);
  }

  for (const job of state.jobs) {
    const owner = state.customers.find((c) => c.id === job.customerId);
    if (owner?.state === "gone") continue; // they left without it
    const who = owner ? `${owner.name}'s` : "the";
    if (job.status === "collected" && job.smudge === "found") {
      add(`Order #${job.id} came out smudged`, "printer", { type: "reprint", jobId: job.id }, owner?.id, [{ type: "use_anyway", jobId: job.id }]);
      continue;
    }
    if (job.status === "printed") add(`Collect ${who} order #${job.id} from the printer`, "printer", { type: "collect", jobId: job.id }, owner?.id);
    if (job.status === "collected" && job.spec.finishing !== "none") add(`Finish order #${job.id}`, "finishing", { type: "finish", jobId: job.id }, owner?.id);
    if (job.status === "collected" || job.status === "finished") add(`Bag order #${job.id}`, "finishing", { type: "bag", jobId: job.id }, owner?.id);
    if (job.status === "entered") add(`Send order #${job.id} to the printer`, "computer", { type: "send_job", jobId: job.id }, owner?.id);
    if (job.status === "new") add(`Enter ${who} order #${job.id}`, "computer", { type: "enter_order", jobId: job.id }, owner?.id);
  }

  for (const m of state.messages) {
    if (!m.read && m.kind === "web_order" && !m.snoozed) add(`Web order in the inbox`, "computer", { type: "open_message", messageId: m.id }, undefined, [{ type: "leave_unread", messageId: m.id }]);
  }
  for (const pkg of state.packages) {
    if (pkg.status === "labeled" || pkg.status === "scanned") add(`Put package #${pkg.id} in the outbound bin`, "shipping", { type: "bin", packageId: pkg.id });
  }
  // Someone waiting for your answer first (walking away from them is ignoring them); then machines, the truck,
  // and quick chores; then whoever has been in the store longest; then orders for people who'll be back later.
  const rank = (item: TodoItem): number => {
    if (item.req.type === "respond") return -2;
    const c = item.customerId !== undefined ? state.customers.find((x) => x.id === item.customerId) : undefined;
    if (!c) return -1;
    return c.state === "away" ? state.closeAt * 2 + c.arrivedAt : c.arrivedAt;
  };
  return items.map((item, i) => ({ item, i, r: rank(item) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.item);
}

// The faster, sloppier way to do something.
export const LAZY: ReadonlySet<TaskType> = new Set(["use_anyway", "out_of_order_sign", "tape_shut", "leave_unread", "let_truck_go"]);

// Everything you could start at a station right now (ignoring that you might be busy). Answering the customer at
// the counter isn't here: that's the counter's choice menu.
export function availableTasks(state: GameState, station: Station): TaskRequest[] {
  const free = { ...state, employee: { ...state.employee, task: null } };
  const reqs: TaskRequest[] = [];
  const types = (list: TaskType[]) => list.filter((t) => STATION[t] === station);
  for (const type of types(["clear_jam", "load_paper", "fix_copier", "out_of_order_sign", "fix_card_reader", "restart_router", "hand_off", "let_truck_go"])) reqs.push({ type });
  for (const c of state.customers) for (const type of types(["talk", "hand_over", "ring_up", "manual_ring_up", "help_self_serve", "scan_dropoff", "find_package"])) reqs.push({ type, customerId: c.id });
  for (const j of state.jobs) for (const type of types(["enter_order", "send_job", "collect", "reprint", "use_anyway", "finish", "bag"])) reqs.push({ type, jobId: j.id });
  for (const p of state.packages) for (const type of types(["weigh", "pack", "tape_shut", "label", "bin"])) reqs.push({ type, packageId: p.id });
  for (const m of state.messages) for (const type of types(["open_message", "leave_unread"])) reqs.push({ type, messageId: m.id });
  return reqs.filter((r) => canStart(free, r) === null);
}
