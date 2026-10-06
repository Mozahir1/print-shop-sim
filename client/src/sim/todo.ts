// The to-do list: the obvious next things to do, and how many things need you right now.
// The UI shows it, the bot works from it, and the flow director keeps its size in a band.
import type { CounterAction, Customer, GameState, Station, TaskRequest, TaskType } from "./types";
import { canStart, currentCustomer, STATION } from "./sim";
import { jobById, packageById } from "./util";
import { eventIsActive } from "./events";
import { WORKFLOWS, currentStep } from "./workflow";

export interface TodoItem {
  text: string;
  station: Station;
  req: TaskRequest; // doing it (properly)
  alts: TaskRequest[]; // the other ways to handle it: cutting the corner, or at the counter, the other answers
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
// What the game suggests doing next (the top bar's "Next:", and what a person does): whoever's waiting at the
// counter first, then sending anything that's ready to the printer (a minute, and it prints while you do the rest),
// then the list as it is (soonest due first).
export function suggested(items: TodoItem[]): TodoItem[] {
  const rank = (i: TodoItem) => (i.req.type === "talk" || i.req.type === "respond" ? 0 : i.req.type === "send_job" ? 1 : 2);
  return items.slice().sort((a, b) => rank(a) - rank(b));
}

export function todoList(state: GameState): TodoItem[] {
  const items: TodoItem[] = [];
  const free = { ...state, employee: { ...state.employee, task: null }, workflow: null };
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
    if (job?.status === "bagged" && c.fetched === null) add(`Get ${c.name}'s bag off the shelf`, "shelf", { type: "fetch_bag", customerId: c.id, jobId: job.id }, c.id);
    else if (job?.status === "bagged") {
      if (job.prepaid) add(`Hand ${c.name} their order`, "counter", { type: "hand_over", customerId: c.id }, c.id);
      else if (state.cardReader === "down") add(`Ring up ${c.name} (by hand)`, "counter", { type: "manual_ring_up", customerId: c.id }, c.id);
      else add(`Ring up ${c.name}`, "counter", { type: "ring_up", customerId: c.id }, c.id);
    }
    if (c.kind === "package_pickup") {
      add(`Find ${c.name}'s package`, "shelf", { type: "find_package", customerId: c.id }, c.id);
      add(`Hand ${c.name} their package`, "counter", { type: "hand_over", customerId: c.id }, c.id);
    }
    if (c.kind === "dropoff") add(`Scan ${c.name}'s drop-off`, "shipping", { type: "scan_dropoff", customerId: c.id }, c.id);
    if (c.kind === "self_serve_help") add(`Help ${c.name} at self-serve`, "self_serve", { type: "help_self_serve", customerId: c.id }, c.id);
    if (c.kind === "ship" && c.packageId !== null) {
      const pkg = packageById(state, c.packageId)!;
      if (pkg.status === "new") add(`Pack ${c.name}'s package`, "shipping", { type: "pack", packageId: pkg.id }, c.id, [{ type: "tape_shut", packageId: pkg.id }]);
      if (pkg.status === "boxed") add(`Tape ${c.name}'s package`, "shipping", { type: "tape", packageId: pkg.id }, c.id);
      if (pkg.status === "packed") add(`Weigh ${c.name}'s package`, "shipping", { type: "weigh", packageId: pkg.id }, c.id);
      if (pkg.status === "weighed") add(`Label ${c.name}'s package`, "shipping", { type: "label", packageId: pkg.id }, c.id);
      if (pkg.status === "labeled" && !pkg.paid) add(`Ring up ${c.name}`, "counter", { type: state.cardReader === "down" ? "manual_ring_up" : "ring_up", customerId: c.id }, c.id);
    }
  }

  const front = currentCustomer(state);
  const closed = state.time >= state.closeAt;
  const showOut = (c: Customer): TaskRequest[] => (closed ? [{ type: "usher_out", customerId: c.id }] : []);
  if (front?.state === "line") add(`${front.name} is at the counter${front.lingering ? " (after closing)" : ""}`, "counter", { type: "talk", customerId: front.id }, front.id, showOut(front));
  if (front?.state === "talking") {
    const reply = (choice: CounterAction): TaskRequest => ({ type: "respond", customerId: front.id, choice });
    const alts = (["rush", "self_serve", "turn_away", "ignore"] as const).map(reply).filter((r) => canStart(free, r) === null);
    add(`${front.name} is waiting for an answer`, "counter", reply("take"), front.id, alts);
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
    if (job.status === "collected" && job.spec.finishing !== "none") add(`Finish order #${job.id}`, "finishing", { type: "finish", jobId: job.id }, owner?.id, [{ type: "skip_finish", jobId: job.id }]);
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
  // Someone waiting for your answer first (walking away from them is ignoring them); then machines, the truck, and
  // quick chores; then whatever's due soonest: an order by its due time, someone in the store by when they came in
  // (plus a minute). Orders for tomorrow go last.
  const rank = (item: TodoItem): number => {
    if (item.req.type === "respond") return -2;
    const job = item.req.jobId !== undefined ? jobById(state, item.req.jobId) : undefined;
    if (job) return job.dueDay > state.day ? state.closeAt * 3 : job.dueAt;
    const c = item.customerId !== undefined ? state.customers.find((x) => x.id === item.customerId) : undefined;
    if (!c) return -1;
    const theirs = c.jobId !== null ? jobById(state, c.jobId) : undefined;
    if (c.state === "away" && theirs) return theirs.dueDay > state.day ? state.closeAt * 3 : theirs.dueAt;
    return c.arrivedAt + 60;
  };
  const sorted = items.map((item, i) => ({ item, i, r: rank(item) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.item);
  // In the middle of a workflow, its next step comes first (answering someone is already at the top).
  const step = currentStep(state);
  if (!step || step.type === "respond") return sorted;
  const same = (r: TaskRequest) => r.type === step.req.type && r.jobId === step.req.jobId && r.packageId === step.req.packageId && r.customerId === step.req.customerId;
  const wf = state.workflow!;
  const now: TodoItem = { text: `Now: ${WORKFLOWS[wf.kind].label}`, station: step.data.station, req: step.req, alts: step.alts, customerId: wf.customerId };
  return [now, ...sorted.filter((i) => !same(i.req))];
}

// Cutting the corner (Don't): the faster, sloppier way to do something.
export const DONT: ReadonlySet<TaskType> = new Set(["skip_finish", "use_anyway", "out_of_order_sign", "tape_shut", "let_truck_go", "manual_ring_up"]);
// Leaving it (Ignore).
export const IGNORE: ReadonlySet<TaskType> = new Set(["leave_unread"]);

// Everything you could start at a station right now (ignoring that you might be busy). Answering the customer at
// the counter isn't here: that's the counter's choice menu.
export function availableTasks(state: GameState, station: Station): TaskRequest[] {
  const free = { ...state, employee: { ...state.employee, task: null } };
  const reqs: TaskRequest[] = [];
  const types = (list: TaskType[]) => list.filter((t) => STATION[t] === station);
  for (const type of types(["clear_jam", "load_paper", "fix_copier", "out_of_order_sign", "fix_card_reader", "restart_router", "hand_off", "let_truck_go"])) reqs.push({ type });
  for (const c of state.customers) for (const type of types(["talk", "hand_over", "ring_up", "manual_ring_up", "help_self_serve", "scan_dropoff", "find_package"])) reqs.push({ type, customerId: c.id });
  for (const c of state.customers) if (c.jobId !== null && station === "shelf") reqs.push({ type: "fetch_bag", customerId: c.id, jobId: c.jobId });
  for (const j of state.jobs) for (const type of types(["enter_order", "send_job", "collect", "reprint", "use_anyway", "finish", "skip_finish", "bag"])) reqs.push({ type, jobId: j.id });
  for (const p of state.packages) for (const type of types(["pack", "tape_shut", "tape", "weigh", "label", "bin"])) reqs.push({ type, packageId: p.id });
  for (const m of state.messages) for (const type of types(["open_message", "leave_unread"])) reqs.push({ type, messageId: m.id });
  return reqs.filter((r) => canStart(free, r) === null);
}
