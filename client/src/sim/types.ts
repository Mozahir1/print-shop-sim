import type { DirectorState } from "./director";

// Core data types for the simulation.
// RULE: nothing in src/sim/ may touch the DOM. That's what lets batch-sim.ts run it in Node.
// Time is always in sim seconds since the store opened. Money is integer cents.

// ---------- orders ----------

export type ColorMode = "bw" | "color";
export type Media = "letter" | "legal" | "tabloid" | "cardstock" | "business_card" | "large_format";
// Where a job is made: the production printer, the business card machine, or the wide-format printer.
export type Machine = "printer" | "cards" | "wide";
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

// What you type into the order form on the computer. Mistakes only ever come from here.
export type OrderEntry = Pick<JobSpec, "copies" | "color" | "media" | "duplex" | "finishing">;

// new: taken at the counter, not in the computer yet. unread: a web order nobody has opened.
// entered: in the computer, not sent. queued/printing: at the printer. printed: waiting in the printer's output.
// collected: picked up from the printer, waiting for finishing. finished: finishing done, not bagged yet.
// bagged: ready for the customer. picked_up: gone with the customer.
export type JobStatus = "new" | "unread" | "entered" | "queued" | "printing" | "printed" | "collected" | "finished" | "bagged" | "picked_up" | "canceled";

export interface Job {
  id: number;
  customerId: number;
  kind: RequestKind; // the request it came from
  channel: "counter" | "web";
  spec: JobSpec; // what gets made: what you entered in the computer (until then, what they asked for)
  asked: JobSpec; // what the customer actually asked for
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
  late: boolean; // the customer had to wait for it past when it was promised (counted once; see checkLate)
  pickupAt: number; // when an away customer comes back for it, ready or not
  attempt: number; // prints so far (a reprint starts a new attempt)
  smudge: "none" | "found" | "accepted"; // smudged copies: found when collected; accepted = handed over anyway
  skipped: boolean; // the finishing was skipped (handed over unstapled, uncut, ...)
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
  | "complaint" // back because of something you did (a damaged box, smudged copies)
  | "business" // a business client with a big order: worth a lot, and they won't wait around
  | "business_cards" // made on the card machine (it prints and cuts them)
  | "large_format"; // a 24x36 print on the wide-format printer: a long print, then trimmed and rolled by hand

export type ShipService = "ground" | "two_day" | "overnight";
export type BoxSize = "small" | "medium" | "large";

// line: waiting to be talked to at the counter. talking: at the counter, waiting for your answer.
// waiting: you took their request, they're waiting in the store. self_serve: making their own copies.
// away: not in the store (coming back for an order later). gone: done for the day.
export type CustomerState = "line" | "talking" | "waiting" | "self_serve" | "away" | "gone";

export type Mood = "happy" | "neutral" | "angry";

// How a waiting customer is doing. Each change is a cue they say out loud; "gone" means they left.
export type PatienceStage = "fine" | "annoyed" | "angry" | "gone";

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
  what: "counter" | "smudge" | "copier" | "pack" | "finish" | "inbox" | "truck" | "event" | "work" | "coworker"; // work: walked away from a workflow; coworker: what they asked you
  customerId?: number;
  auto?: boolean; // you didn't answer in time: counts as ignoring them
}

export type CustomerOutcome =
  | "served" // got what they came for (self-serve included)
  | "turned_away" // you said no
  | "balked" // didn't like the fee or the timing, and left
  | "closed" // the store closed (they went at close, or you showed them out)
  | "left"; // gave up waiting and left

export interface Customer {
  id: number;
  name: string;
  kind: RequestKind;
  state: CustomerState;
  crew?: boolean; // the coworker on shift is helping them (start to finish), not you
  trait?: Trait | null; // a light personality tag (frantic, confused, cheapskate, chatty), or none
  spec: JobSpec | null; // print requests: what they want
  timing: Timing; // print requests: when they want it
  needBy: number | null; // the latest it's any use to them today (null: tomorrow is fine)
  refusedSelfServe: boolean; // asked to use self-serve, and wants full service instead
  goingToSelfServe: boolean; // agreed to self-serve: you're about to show them the copier
  lingering: boolean; // stayed past closing (and won't leave on their own)
  couldSelfServe: boolean; // you turned them away when they could have used self-serve
  selfServeUntil: number | null; // self_serve: when they're done copying
  helpAt: number | null; // self_serve: when they come back to the counter for help (if they do)
  weightLb: number; // ship: how heavy the box is
  service: ShipService; // ship: how fast
  jobId: number | null;
  packageId: number | null;
  fetched: number | null; // order pickup: the bag you took off the shelf for them (the job it's for)
  pays: "card" | "cash";
  arrivedAt: number;
  lineTicket: number; // order in line: lower is further ahead
  mood: number; // starts happy (1); waiting, lateness, being turned away, and bad work bring it down (see moodOf)
  choices: number; // counter choices made with them this visit (keys their reaction rolls)
  ignored: number; // times you ignored them
  giveUp: number; // seconds of waiting before they give up and leave (see PATIENCE_STAGES for annoyed and angry)
  waited: number; // seconds waited this visit (waiting for an order only counts once it's overdue)
  stage: PatienceStage;
  answerBy: number | null; // talking: past this, not answering counts as ignoring them
  about: FlagKind | null; // complaint: what they're back about
  said: string | null; // the last thing they said...
  saidAt: number | null; // ...and when (for speech bubbles)
  outcome: CustomerOutcome | null;
  leftAt: number | null;
}

// ---------- packages ----------

// Outgoing: new (at the counter) -> boxed -> packed (taped) -> weighed -> labeled -> (rung up) -> binned -> shipped.
// Drop-offs: scanned -> binned. Held packages: held -> found -> picked_up.
export type PackageStatus = "new" | "boxed" | "packed" | "weighed" | "labeled" | "scanned" | "binned" | "shipped" | "held" | "found" | "picked_up";

export interface Package {
  id: number;
  customerId: number;
  kind: "ship" | "dropoff" | "held";
  to?: string; // held packages: the name on the label (who's coming for it)
  weightLb: number;
  service: ShipService | null;
  box: BoxSize | null; // the box it needs, if we pack it
  priceCents: number;
  status: PackageStatus;
  taped: boolean; // just taped shut instead of packed properly
  paid: boolean;
  label: ShippingLabel | null; // what you printed on the label
}

export interface ShippingLabel {
  weightLb: number;
  service: ShipService;
}

// The carrier's one pickup a day. It comes at arrivesAt, or once there's room for it (see director.ts).
// The card machine and the wide-format printer: simpler than the production printer (no paper, no jams). Each makes
// one job at a time, from its own queue.
export interface MachineState {
  queue: number[];
  currentJobId: number | null;
  left: number; // minutes left on the job it's making
  total: number; // ...out of
}

// ---------- coworkers ----------

export type Trait = "frantic" | "confused" | "cheapskate" | "chatty";

// What happens when you answer a coworker's request (Do, Don't, or Ignore). All data (coworkers.json).
export interface RequestOutcome {
  minutes?: number; // your time (Do: helping takes a few minutes)
  relationship?: number;
  revenueCents?: number; // an upsell
  mood?: number; // on the customer it was about
  flub?: boolean; // they do it themselves, wrong: a fix shows up for you later
  louder?: boolean; // they keep going, louder
  reply?: string; // what they say back (a line moment)
}

export interface RequestDef {
  id: string;
  do: string; // the Do button's label
  dont: string;
  outcomes: Record<"do" | "dont" | "ignore", RequestOutcome>;
}

export interface CrewLine {
  moment: string;
  text: string;
  about?: string;
}

// A coworker asks you something. You can answer from anywhere (or not: it goes away on its own as an Ignore).
export interface CrewRequest {
  id: number;
  from: string; // coworker id
  kind: string; // a RequestDef id
  text: string;
  do: string;
  dont: string;
  at: number;
  until: number;
  customerId?: number;
}

// Something your coworker got wrong that's now yours to fix (or leave).
export interface CrewMistake {
  id: number;
  by: string; // their name
  text: string;
  jobId?: number;
  fixed: boolean;
}

// A coworker, from src/data/coworkers.json.
export interface CoworkerDef {
  id: string;
  name: string;
  about: string;
  lore: string; // who they are (Brody: the owner's son, which is why he never gets in trouble)
  capacity: number; // extra customers the day brings in for them, as a share of yours (0.5: half as many again)
  speed: Record<Station, number>; // time multipliers on each step's usual time, by station (1.5: half again as long)
  breaks: { count: number; minutes: number };
  // How often things happen: per hour (chat, requests, chatUp), per day (missing, reorganize), per chance (upsell,
  // doubleCheck, fixJam), and minutes they stand around between tasks (dawdle).
  rates: { chat: number; requests: number; dawdle: number; missing: number; upsell: number; doubleCheck: number; reorganize: number; fixJam: number; chatUp: number };
  hooks: string[];
  opening: string; // what they say when the day starts
  rating: string; // the report's word on them (corporate tone)
  requests: RequestDef[];
  lines: CrewLine[];
  story?: string[]; // a story told a part at a time, across days
}

// What the coworker's doing: a run of the usual steps for one customer or job, at one station.
export interface CoworkerTask {
  kind: "serve" | "pickup" | "ship" | "dropoff" | "package" | "enter" | "collect" | "finish" | "fix_jam";
  what: string; // "Collecting order #12"
  station: Station;
  customerId?: number;
  jobId?: number;
  until: number;
  total: number; // minutes, all told
}

export interface CoworkerState {
  id: string;
  name: string;
  at: Station | "break" | "missing" | "gone"; // gone: their shift's over
  task: CoworkerTask | null;
  breaks: number[]; // when their breaks start (still to come)
  breakUntil: number;
  said: { text: string; at: number } | null; // the last thing they said (a speech bubble)
  nextChatAt: number;
  nextRequestAt: number;
  idleUntil: number; // standing around between tasks
  missingAt: number | null; // when they wander off (and until)
  missingUntil: number;
  reorganizeAt: number | null;
  louderUntil: number; // ignored mid-story: they keep going, louder
  nextChatUpAt: number; // chatting up the customers in your line
  storyToday: number; // story parts told today
  relationship: number; // hidden; from the game, written back at the end of the day
  story: number; // how far into their story (from the game)
  checked: number[]; // orders they've double-checked
  spoke: Record<string, number>; // lines said today, by moment (they go through them in turn: no repeats till they run out)
  stats: { served: number; ordersTaken: number; jobsDone: number; revenueCents: number; minutesWorked: number };
}

export interface Truck {
  arrivesAt: number; // when it comes (once it's here: when it came)
  leavesAt: number; // set when it arrives; the driver waits longer while you're busy with a customer
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
  by?: string; // a coworker did it (their mishap is the day's bad luck)
  at: number; // earliest time it can happen
  status: "pending" | "active" | "fixed" | "worked_around" | "ignored";
  firedAt: number | null;
}

// ---------- the computer ----------

export type MessageKind = "web_order" | "note" | "complaint" | "survey" | "warning" | "write_up" | "reward" | "fired";

export interface Message {
  id: number;
  kind: MessageKind;
  from: string; // who it's from: a customer, the manager, corporate, the website
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
export type HeatCause = "complaints" | "ignoring" | "lost_sales" | "overtime";

// Something you did that comes back later (see consequences.ts).
export type FlagKind = "damaged_box" | "smudged_return" | "packages_left" | "wrong_label";

export interface Flag {
  kind: FlagKind;
  dueDay: number;
  dueAt: number; // sim seconds into that day
  name: string; // the customer it's about
}

// A message that hasn't arrived yet.
export interface MessageDraft {
  kind: MessageKind;
  from: string;
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

// ---------- failures ----------

// Things that went wrong, each with a moment you can see (and a line in the end-of-day report, by name).
export type FailureKind =
  | "walked_out"
  | "missing_order"
  | "never_ready"
  | "late_order"
  | "damaged_package"
  | "smudged_return"
  | "copier_broken"
  | "packages_left"
  | "lost_sale"
  | "left_broken"
  | "left_work"
  | "lost_business"
  | "wrong_order"
  | "wrong_bag"
  | "drawer_off"
  | "wrong_label"
  | "crew_mistake";

export interface Failure {
  time: number;
  kind: FailureKind;
  text: string;
  customerId?: number;
  jobId?: number;
}

export type ManagerMood = "calm" | "annoyed" | "unhappy";

export interface WentHome {
  at: number;
  onTime: boolean; // within the grace period after close, with nothing left undone
  overtime: number; // seconds past close
  leftUndone: string[]; // what you left behind
  sentHome: boolean; // the manager locked up
}

// ---------- workflows ----------

export type WorkflowKind =
  | "take_order"
  | "self_serve"
  | "ship"
  | "dropoff"
  | "release_package"
  | "pickup"
  | "missing_order"
  | "self_serve_help"
  | "complaint"
  | "counter"
  | "ring_up"
  | "collect_finish"
  | "fix_copier"
  | "clear_jam"
  | "load_paper"
  | "fix_card_reader"
  | "restart_router"
  | "hand_off"
  | "inbox"
  | "bin"
  | "usher_out"
  | "help_coworker"
  | "fix_mistake";

// A multi-step job you're in the middle of. While it's on, nothing unrelated can start (see workflow.ts).
export interface Workflow {
  kind: WorkflowKind;
  customerId?: number;
  jobId?: number;
  packageId?: number;
  messageId?: number;
  mistakeId?: number;
  done: TaskType[]; // steps finished in this workflow (most steps also show as done from the state of things)
  fixFirst?: boolean; // self-serve help: you chose to fix the copier first
  startedAt: number;
}

// ---------- you ----------

export type TaskType =
  // counter
  | "talk"
  | "ask_again" // "What was that?"
  | "respond"
  | "hand_over"
  | "ring_up"
  | "make_good"
  | "usher_out"
  // computer
  | "enter_order"
  | "send_job"
  | "open_message"
  | "leave_unread"
  // printer
  | "collect"
  // wide-format prints, at finishing: cut it off the roll and trim it, then roll it into a tube
  | "trim"
  | "roll"
  | "reprint"
  | "use_anyway"
  | "clear_jam"
  | "load_paper"
  | "fix_card_reader"
  | "manual_ring_up"
  | "restart_router"
  // finishing table
  | "finish"
  | "skip_finish"
  | "bag"
  // pickup shelf
  | "fetch_bag"
  // self-serve
  | "help_self_serve"
  | "escort"
  | "fix_copier"
  | "out_of_order_sign"
  // shipping
  | "weigh"
  | "pack"
  | "tape"
  | "tape_shut"
  | "label"
  | "bin"
  | "scan_dropoff"
  | "find_package"
  | "hand_off"
  | "let_truck_go"
  // coworkers
  | "help_coworker" // Do, on what they asked you
  | "fix_mistake"; // something they got wrong

export type Station = "counter" | "computer" | "printer" | "finishing" | "self_serve" | "shipping" | "shelf";

export interface TaskRequest {
  type: TaskType;
  customerId?: number;
  jobId?: number;
  packageId?: number;
  messageId?: number;
  mistakeId?: number; // fix_mistake: which one
  choice?: CounterAction; // respond
  entry?: OrderEntry; // enter_order: the form as you filled it in (left out: exactly what they asked for)
  shipLabel?: ShippingLabel; // label: the label form as you filled it in (left out: right)
  box?: BoxSize; // pack, tape_shut: the box you picked (left out: the right one)
  amount?: number; // ring_up: the total you typed, card (cents; left out: right)
  change?: number; // ring_up: the change you typed, cash (cents; left out: right)
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
  refundsCents: number;
  surveys: number; // rare: customers who filled out a survey
  badSurveys: number;
  businessWon: number;
  businessLost: number;
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
  cardReader: "ok" | "down" | "restarting"; // restarting: you reset it, and it's coming back by itself
  readerBackAt: number;
  wifi: { down: boolean; backAt: number; restarting: boolean }; // restarting: the router's coming back by itself
  choices: Choice[];
  failures: Failure[];
  workflow: Workflow | null;
  coworker: CoworkerState | null; // who's on shift with you today (see coworker.ts)
  request: CrewRequest | null; // what they're asking you, if anything
  mistakes: CrewMistake[]; // theirs, for you to fix
  shelfOrder: number; // nonzero: someone re-sorted the pickup shelf (the bags aren't where you'd expect)
  thoughts: { time: number; trigger: string; text: string }[]; // the MC's thought bubbles
  schedule: string[]; // who's on today and the next two days (ids)
  machines: Record<"cards" | "wide", MachineState>; // the card machine and the wide-format printer (the production printer is printer)
  setAside: Workflow | null; // the job you put down for a quick chore (the truck, a jam, ...): you go back to it after
  wentHome: WentHome | null; // set when you go home: the day is over
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
  handsOn: boolean; // a player doing each step by hand: every step waits for them (the bot and tests let steps run on)
  drawerOffCents: number; // how far the register is off from wrong totals and wrong change
}
