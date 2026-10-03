import type { DirectorState } from "./director";

// Core data types for the simulation.
// RULE: nothing in src/sim/ may touch the DOM. That's what lets batch-sim.ts run it in Node.
// Time is always in sim seconds since the store opened. Money is integer cents.

// ---------- orders ----------

export type ColorMode = "bw" | "color";
export type Media = "letter" | "legal" | "tabloid" | "cardstock";
export type Finishing = "none" | "staple" | "cut" | "laminate";

export interface JobSpec {
  item: string; // what the customer calls it: "flyer", "resume", "poster"
  originals: number; // pages (sides) in one set
  copies: number; // sets
  color: ColorMode;
  media: Media;
  duplex: boolean;
  finishing: Finishing;
}

// new: taken at the counter, not in the computer yet. unread: a web order nobody has opened.
// entered: in the computer, not sent. queued/printing: at the printer. printed: waiting in the printer's output.
// collected: picked up from the printer, waiting for finishing. finished: finishing done, not bagged yet.
// bagged: ready for the customer. picked_up: gone with the customer.
export type JobStatus = "new" | "unread" | "entered" | "queued" | "printing" | "printed" | "collected" | "finished" | "bagged" | "picked_up";

export interface Job {
  id: number;
  customerId: number;
  kind: RequestKind; // the request it came from
  channel: "counter" | "web";
  spec: JobSpec;
  sheets: number;
  priceCents: number;
  prepaid: boolean; // web orders are paid online
  status: JobStatus;
  printCents: number; // the price list part of priceCents
  serviceFeeCents: number;
  rushCents: number;
  rush: boolean; // jumps the printer queue
  sheetsPrinted: number; // float while printing
  orderedAt: number;
  dueDay: number; // the day it's promised for...
  dueAt: number; // ...and the time (sim seconds into that day)
  late: boolean; // it wasn't ready by then (counted once)
  pickupAt: number; // when an away customer comes back for it, ready or not
  attempt: number; // prints so far (a reprint starts a new attempt)
  smudge: "none" | "found" | "accepted"; // smudged copies: found when collected; accepted = handed over anyway
  closedAt: number | null;
}

// ---------- customers ----------

export type RequestKind =
  | "quick_copies"
  | "large_job"
  | "poster"
  | "ship"
  | "dropoff"
  | "order_pickup"
  | "package_pickup"
  | "self_serve_help"
  | "complaint"; // back because of something you did (a damaged box, smudged copies)

export type ShipService = "ground" | "two_day" | "overnight";
export type BoxSize = "small" | "medium" | "large";

// line: waiting to be talked to at the counter. talking: at the counter, waiting for your answer.
// waiting: you took their request, they're waiting in the store. self_serve: making their own copies.
// away: not in the store (coming back for an order later). gone: done for the day.
export type CustomerState = "line" | "talking" | "waiting" | "self_serve" | "away" | "gone";

export type Mood = "happy" | "neutral" | "angry";

// Every choice is one of three: do it (properly), don't (decline it, or cut the corner), or ignore it.
export type ChoiceType = "do" | "dont" | "ignore";

// At the counter, Do comes in flavors: take the order (standard turnaround), take it as a rush, or send them to
// self-serve. Don't is turning them away.
export type CounterAction = "take" | "rush" | "self_serve" | "turn_away" | "ignore";

// When a print customer wants it: they wait in the store, come back later, or pick it up tomorrow.
export type Timing = "wait" | "back" | "tomorrow";

export interface Choice {
  time: number;
  type: ChoiceType;
  action?: CounterAction; // at the counter: which kind of Do (or Don't)
  what: "counter" | "smudge" | "copier" | "pack" | "inbox" | "truck" | "event";
  customerId?: number;
  auto?: boolean; // you didn't answer in time: counts as ignoring them
}

export type CustomerOutcome =
  | "served" // got what they came for (self-serve included)
  | "turned_away" // you said no
  | "balked" // didn't like the fee or the timing, and left
  | "left"; // gave up waiting and left

export interface Customer {
  id: number;
  name: string;
  kind: RequestKind;
  state: CustomerState;
  spec: JobSpec | null; // print requests: what they want
  timing: Timing; // print requests: when they want it
  needBy: number | null; // the latest it's any use to them today (null: tomorrow is fine)
  refusedSelfServe: boolean; // asked to use self-serve, and wants full service instead
  selfServeUntil: number | null; // self_serve: when they're done copying
  weightLb: number; // ship: how heavy the box is
  service: ShipService; // ship: how fast
  jobId: number | null;
  packageId: number | null;
  arrivedAt: number;
  lineTicket: number; // order in line: lower is further ahead
  mood: number; // starts happy (1); waiting, lateness, being turned away, and bad work bring it down (see moodOf)
  choices: number; // counter choices made with them this visit (keys their reaction rolls)
  ignored: number; // times you ignored them
  patience: number; // seconds they'll wait (in line and for their order) before they're fed up
  waited: number; // seconds waited this visit
  fedUp: boolean; // waited past their patience and said so
  answerBy: number | null; // talking: past this, not answering counts as ignoring them
  about: FlagKind | null; // complaint: what they're back about
  said: string | null; // the last thing they said
  outcome: CustomerOutcome | null;
  leftAt: number | null;
}

// ---------- packages ----------

// Outgoing: new (at the counter) -> weighed -> packed -> labeled -> binned -> shipped. Drop-offs: scanned -> binned.
// Held packages: held -> found -> picked_up.
export type PackageStatus = "new" | "weighed" | "packed" | "labeled" | "scanned" | "binned" | "shipped" | "held" | "found" | "picked_up";

export interface Package {
  id: number;
  customerId: number;
  kind: "ship" | "dropoff" | "held";
  weightLb: number;
  service: ShipService | null;
  box: BoxSize | null; // the box it needs, if we pack it
  priceCents: number;
  status: PackageStatus;
  taped: boolean; // just taped shut instead of packed properly
}

// The carrier's one pickup a day. It comes at arrivesAt, or once there's room for it (see director.ts).
export interface Truck {
  arrivesAt: number;
  leavesAt: number; // set when it arrives
  status: "coming" | "waiting" | "gone";
  handedOff: boolean;
}

// ---------- machines ----------

export type PrinterStatus = "idle" | "printing" | "jammed" | "tray_empty";

// The one production printer. It does color and B&W on every paper size we stock.
export interface Printer {
  status: PrinterStatus;
  queue: number[]; // job ids, first is next
  currentJobId: number | null;
  warmupLeft: number;
  sheetsToday: number;
  paperOutAt: number; // the tray runs out when sheetsToday reaches this (Infinity on most days)
}

export interface Copier {
  status: "ok" | "broken";
  sign: boolean; // an "out of order" sign is taped on it
}

// ---------- bad luck ----------

export type EventKind = "printer_jam" | "copier_dies" | "card_reader_down" | "box_rips" | "wifi_drop";

// The day's one piece of bad luck (if any). pending: rolled, not happened yet. active: happening, needs you.
// fixed / worked_around: handled. ignored: left alone until it ran its course (or the day ended).
export interface BadLuck {
  kind: EventKind;
  at: number; // earliest time it can happen
  status: "pending" | "active" | "fixed" | "worked_around" | "ignored";
  firedAt: number | null;
}

// ---------- the computer ----------

export type MessageKind = "web_order" | "note" | "complaint" | "warning" | "write_up" | "reward" | "fired";

export interface Message {
  id: number;
  kind: MessageKind;
  at: number;
  subject: string;
  body: string;
  jobId: number | null;
  read: boolean;
  snoozed: boolean; // left unread on purpose
}

// ---------- consequences ----------

// Why the manager is unhappy. Heat is tallied by cause so getting fired can say why. Late and unfinished orders
// count as complaints (that's how the manager hears about them).
export type HeatCause = "complaints" | "ignoring" | "lost_sales";

// Something you did that comes back later (see consequences.ts).
export type FlagKind = "damaged_box" | "smudged_return" | "packages_left";

export interface Flag {
  kind: FlagKind;
  dueDay: number;
  dueAt: number; // sim seconds into that day
  name: string; // the customer it's about
}

// A message that hasn't arrived yet.
export interface MessageDraft {
  kind: MessageKind;
  subject: string;
  body: string;
  at: number; // when it arrives (same day), or 0 for the next morning
  heat: number; // what it adds when it arrives
  cause: HeatCause;
}

export interface ManagerState {
  heat: number; // 0..100, never shown as a number
  heatBy: Record<HeatCause, number>; // added today, by cause
  complaints: number; // complaints today's customers made (whenever they arrive)
  flags: Flag[]; // everything still to come back, today or later
  scheduled: MessageDraft[]; // arriving later today
  morning: MessageDraft[]; // arriving tomorrow morning
  visitsDue: { name: string; about: FlagKind }[]; // people coming back to complain, when there's room
}

// ---------- you ----------

export type TaskType =
  // counter
  | "talk"
  | "respond"
  | "hand_over"
  | "ring_up"
  // computer
  | "enter_order"
  | "send_job"
  | "open_message"
  | "leave_unread"
  // printer
  | "collect"
  | "reprint"
  | "use_anyway"
  | "clear_jam"
  | "load_paper"
  | "fix_card_reader"
  | "manual_ring_up"
  | "restart_router"
  // finishing table
  | "finish"
  | "bag"
  // self-serve
  | "help_self_serve"
  | "fix_copier"
  | "out_of_order_sign"
  // shipping
  | "weigh"
  | "pack"
  | "tape_shut"
  | "label"
  | "bin"
  | "scan_dropoff"
  | "find_package"
  | "hand_off"
  | "let_truck_go";

export type Station = "counter" | "computer" | "printer" | "finishing" | "self_serve" | "shipping";

export interface TaskRequest {
  type: TaskType;
  customerId?: number;
  jobId?: number;
  packageId?: number;
  messageId?: number;
  choice?: CounterAction; // respond
}

export interface Task extends TaskRequest {
  label: string;
  station: Station;
  duration: number; // seconds of work
  elapsed: number;
}

export interface Employee {
  task: Task | null;
  busySeconds: number;
}

// ---------- the day ----------

export interface LogEntry {
  time: number;
  text: string;
}

export interface DayStats {
  served: number;
  left: number; // gave up and walked out
  happy: number; // how customers felt when they left
  neutral: number;
  angry: number;
  selfServed: number; // made their own copies (sent over, or went straight there)
  selfServeCents: number;
  turnedAway: number;
  lostSales: number; // turned away when it was doable and worth it
  lostSalesCents: number;
  balked: number; // left over a fee or the timing
  rushOrders: number;
  lateOrders: number;
  ordersTaken: number;
  webOrders: number;
  sheets: number;
  shipments: number;
  dropoffs: number;
  packagePickups: number;
  jams: number;
  idleSeconds: number; // open seconds with nothing that needs you
  activeSeconds: number; // sum over open seconds of how many things needed you (for the average)
  maxActive: number;
}

export interface GameState {
  seed: number;
  day: number; // 1 for the first day of a game
  time: number;
  closeAt: number;
  revenueCents: number;
  customers: Customer[];
  jobs: Job[];
  packages: Package[];
  printer: Printer;
  copier: Copier;
  truck: Truck;
  messages: Message[];
  heldMessages: Message[]; // web orders stuck behind a Wi-Fi outage
  event: BadLuck | null;
  cardReader: "ok" | "down";
  wifi: { down: boolean; backAt: number };
  choices: Choice[];
  captions: { time: number; moment: string; text: string }[]; // the MC's monologue
  manager: ManagerState;
  director: DirectorState;
  employee: Employee;
  log: LogEntry[];
  nextId: number; // shared by customers, jobs, packages, and messages
  nextLineNo: number;
  stats: DayStats;
  over: boolean;
  devUsed: boolean; // dev tools changed this day, so it doesn't count for the leaderboard
}
