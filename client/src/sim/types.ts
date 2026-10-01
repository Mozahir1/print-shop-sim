// Core data types for the simulation.
// RULE: nothing in src/sim/ may touch the DOM. That's what lets batch-sim.ts run it in Node.
// Time is always in sim seconds since the store opened. 1 tile = 1 meter.

export interface Vec {
  x: number;
  y: number;
}

// ---------- orders ----------

export type ColorMode = "bw" | "color";
export type Media = "letter" | "legal" | "tabloid" | "cardstock" | "wide_18x24" | "wide_24x36";
export type PaperStock = "letter" | "legal" | "tabloid" | "cardstock" | "roll"; // what goes in a tray
export type Finishing = "none" | "staple" | "fold" | "cut" | "laminate" | "coil_bind";

export interface JobSpec {
  item: string; // what the customer calls it: "flyer", "resume", "poster"
  originals: number; // pages (sides) in one set; for wide format, number of different sheets
  copies: number; // sets
  color: ColorMode;
  media: Media;
  duplex: boolean;
  finishing: Finishing;
}

// When the customer wants it.
export type Timing =
  | { kind: "wait"; minutes: number } // waits in the store
  | { kind: "back"; minutes: number } // leaves and comes back about this much later
  | { kind: "tomorrow" };

export type JobStatus = "unsent" | "queued" | "printing" | "printed" | "ready" | "picked_up" | "canceled";

export interface Job {
  id: number;
  customerId: number;
  profileId: string;
  channel: "counter" | "web";
  spec: JobSpec;
  sheets: number; // physical sheets to print
  priceCents: number; // what the customer pays: printing + service fee + rush fee
  serviceFeeCents: number;
  rushCents: number;
  prepaid: boolean; // web and next-day orders are paid when ordered
  status: JobStatus;
  printerId: string | null;
  sheetsPrinted: number; // float while printing
  finishWorkDone: number; // seconds of finishing/bagging already done
  orderedAt: number;
  dueAt: number;
  dueTomorrow: boolean; // due at open tomorrow; finishing by close counts as on time
  printedAt: number | null;
  readyAt: number | null;
  closedAt: number | null; // picked up or canceled
}

// ---------- customers ----------

// outside: not in the store (not arrived yet, away until visitAt, or gone for the day if visitAt is null)
// self_serve: at the self-serve copiers, either using one or queued for the next free one
export type CustomerState = "outside" | "line" | "seated" | "self_serve" | "leaving";
// order: new print order · pickup: collecting a print order · ship: sending a package
// dropoff: leaving prepaid return packages · package: collecting a package we're holding for them
export type Purpose = "order" | "pickup" | "ship" | "dropoff" | "package";
export type CustomerOutcome =
  | "picked_up"
  | "self_served" // made their own copies at self-serve and paid there
  | "shipped" // sent a package
  | "dropped_off" // left prepaid packages
  | "package_picked_up" // collected a held package
  | "pickup_later" // their order is still on the shelf (or in production) at close
  | "walked_out" // gave up waiting in line before ordering
  | "balked" // saw the line and didn't come in
  | "turned_away"
  | "canceled" // gave up on an order that wasn't ready
  | "copier_gave_up"; // a self-serve copier stopped on them and nobody came to fix it

export interface Customer {
  id: number;
  name: string;
  profileId: string;
  state: CustomerState;
  pos: Vec;
  visitAt: number | null;
  purpose: Purpose;
  request: { spec: JobSpec; timing: Timing } | null; // print customers only
  ship: ShipRequest | null; // "ship" customers
  dropoffCount: number; // "dropoff" customers: how many packages they bring
  packageId: number | null; // "package" customers: the package we're holding for them
  webOrderAt: number | null; // web customers place the order online at this time
  jobId: number | null;
  // personality, rolled when the day is generated so a seed always plays the same
  linePatience: number; // seconds they'll stand in line
  lateTolerance: number; // seconds they'll wait for a late order before leaving
  balkLineLength: number; // won't come in if this many people are already in line
  returnDelay: number; // seconds until they try again after leaving unhappy
  arrivalJitter: number; // seconds early (-) or late (+) they show up for a pickup
  selfServeRoll: number; // 0..1, decides whether they'd use self-serve on their own, with help, or not at all
  // bookkeeping
  lineTicket: number | null; // position in line: lower is further ahead
  waitStart: number | null; // patience clock for the current stretch in line
  lineWaitTotal: number;
  seatedUntil: number | null;
  selfServeTicket: number | null; // place in the copier queue
  selfServeDeclined: boolean; // asked to use self-serve and said they want full service
  returns: number;
  penalty: number; // stars knocked off a 5-star visit
  rating: number | null;
  outcome: CustomerOutcome | null;
}

// ---------- shipping ----------

export type ShipService = "ground" | "two_day" | "overnight";
export type BoxSize = "small" | "medium" | "large";

// What a shipping customer walks in with. Rolled when the day is generated.
export interface ShipRequest {
  weightLb: number;
  service: ShipService;
  packed: boolean; // brought it ready to go, or needs us to box it
  box: BoxSize; // the box it needs if we pack it
}

// out: staged in the outbound bins, then shipped on the truck. in: unsorted (morning delivery), on hold, released.
export type PackageStatus = "staged" | "shipped" | "unsorted" | "on_hold" | "released";

export interface Package {
  id: number;
  customerId: number;
  direction: "out" | "in";
  kind: "shipment" | "dropoff" | "held";
  service: ShipService | null; // null for prepaid drop-offs and held packages: not ours to guarantee
  weightLb: number;
  pricePaidCents: number;
  status: PackageStatus;
  createdAt: number;
  shippedAt: number | null;
  releasedAt: number | null;
  missedTrucks: number;
}

// The carrier's daily pickup at the package room door.
export interface Truck {
  arrivesAt: number;
  leavesAt: number;
  status: "coming" | "waiting" | "gone";
  handedOff: boolean;
  departedAt: number | null;
  warned: boolean; // "leaving in 5 minutes" has been logged
}

// ---------- phone ----------

export type CallKind = "quote" | "status" | "hours" | "rates";

export interface Call {
  id: number;
  kind: CallKind;
  ringsAt: number;
  talkSeconds: number; // rolled in advance: how long the conversation takes if you pick up
  status: "scheduled" | "ringing" | "answered" | "missed";
  leadCustomerId: number | null; // quote calls that would turn into a web order if answered
  leadDelay: number; // seconds after the call ends that the web order comes in
  answeredAt: number | null;
}

// ---------- stockroom ----------

export type StockItem =
  | "letter"
  | "legal"
  | "tabloid"
  | "cardstock"
  | "wide_roll"
  | "bw_toner"
  | "color_toner"
  | "wide_ink"
  | "box_small"
  | "box_medium"
  | "box_large";

// Placed and paid for today, delivered at open tomorrow (career mode).
export interface SupplyOrder {
  item: StockItem;
  packs: number;
  costCents: number;
  orderedAt: number;
}

// ---------- machines ----------

export type PrinterStatus = "idle" | "warming_up" | "printing" | "jammed" | "out_of_paper" | "out_of_toner" | "needs_service";

export interface Tray {
  stock: PaperStock;
  capacity: number; // sheets, or feet for a roll
  level: number;
}

export interface Printer {
  id: string;
  name: string;
  short: string;
  tile: Vec; // top-left, drawn 2x2
  station: Vec; // where you stand to work on it
  colors: ColorMode[];
  media: Media[];
  ppm: number; // letter-size impressions per minute
  wideSecondsPerSqFt: Record<ColorMode, number> | null; // wide format only
  warmup: number; // seconds before the first sheet of each job
  trays: Tray[];
  toner: number; // 0..100
  supply: StockItem; // the cartridge or ink set it takes
  tonerUse: Record<ColorMode, number>; // % per letter impression (wide: per sq ft)
  meanSheetsBetweenJams: number;
  status: PrinterStatus;
  currentJobId: number | null;
  queue: number[];
  warmupLeft: number;
  sheetsUntilJam: number;
  jamClearSeconds: number;
  sheetsToday: number;
  jamsToday: number;
  breakdown: Breakdown | null;
}

// A production printer error you can't clear yourself. Rolled at the start of the day.
export interface Breakdown {
  at: number;
  techArrivesAt: number;
  fixedAt: number;
  phase: "pending" | "down" | "tech" | "fixed";
}

// A self-serve copier on the shop floor. Customers run it themselves and pay at the machine.
export interface Copier {
  id: number;
  spot: Vec; // where the customer stands
  station: Vec; // where you stand to fix or refill it
  userId: number | null;
  work: CopierWork | null; // set once the customer reaches it and starts
  status: "ok" | "jammed" | "out_of_paper";
  paper: number; // letter sheets
  capacity: number;
  sheetsUntilJam: number;
  fixSeconds: number; // rolled when it jams
  stoppedSince: number | null; // when it stopped on the current customer
  sheetsToday: number;
  jamsToday: number;
}

export interface CopierWork {
  setupLeft: number; // seconds of paying and picking settings before the first copy
  sidesLeft: number;
  sheetsPerSide: number;
}

// ---------- you ----------

export type TaskType =
  | "take_order"
  | "turn_away"
  | "ring_up"
  | "explain_delay"
  | "usher_self_serve"
  | "ship_package"
  | "accept_dropoff"
  | "check_in_packages"
  | "release_package"
  | "hand_off_truck"
  | "answer_phone"
  | "fix_copier"
  | "refill_copier"
  | "recall_job"
  | "send_job"
  | "finish_job"
  | "load_paper"
  | "replace_toner"
  | "clear_jam";

export interface TaskRequest {
  type: TaskType;
  jobId?: number;
  printerId?: string;
  stock?: PaperStock;
  callId?: number;
  copierId?: number;
}

export interface Task extends TaskRequest {
  label: string;
  station: Vec;
  duration: number; // seconds of work once you're there
  elapsed: number;
  customerId?: number;
}

export interface Employee {
  pos: Vec;
  task: Task | null;
  busySeconds: number;
}

// ---------- the day ----------

export interface LogEntry {
  time: number;
  text: string;
}

export interface ShiftStats {
  ordersTaken: number;
  webOrders: number;
  pickups: number;
  selfServed: number;
  selfServeRevenueCents: number;
  walkouts: number;
  balks: number;
  turnedAway: number;
  canceled: number;
  sheets: number;
  jams: number;
  paperLoads: number;
  tonerChanges: number;
  shipments: number;
  shippingRevenueCents: number; // shipping + packing fees charged (before refunds)
  dropoffs: number; // customers
  dropoffPackages: number;
  packagePickups: number;
  missedTruckPackages: number;
  refundsCents: number; // express packages refunded for missing the truck
  carrierCostCents: number;
  serviceFeesCents: number; // charged on full-service orders (included in revenue)
  rushFeesCents: number;
  suppliesOrderedCents: number;
  callsAnswered: number;
  missedCalls: number;
  quoteLeads: number; // web orders that came from answered quote calls
  copierJams: number;
  copierRefills: number;
  copierGaveUp: number;
  breakdowns: number;
  recalls: number;
  wastedSheets: number;
}

export interface GameState {
  seed: number;
  time: number;
  closeAt: number;
  revenueCents: number;
  costCents: number; // materials actually used (float, round for display)
  customers: Customer[];
  jobs: Job[];
  printers: Printer[];
  copiers: Copier[];
  packages: Package[];
  nextPackageId: number;
  truck: Truck;
  calls: Call[];
  stockroom: Record<StockItem, number>;
  supplyOrders: SupplyOrder[];
  mode: "single" | "career";
  employee: Employee;
  log: LogEntry[];
  nextJobId: number;
  nextLineNo: number;
  stats: ShiftStats;
  over: boolean;
  devUsed: boolean; // dev tools changed this shift, so it doesn't count for the leaderboard
}
