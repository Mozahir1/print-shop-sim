// Tuning numbers. Balance the game by editing this file.
import type { BoxSize, ColorMode, CounterAction, EventKind, Finishing, Media, RequestKind, ShipService, TaskType } from "./types";

export const TUNING = {
  openHour: 9, // the wall clock reads 9:00 AM at open...
  closeHour: 17, // ...and 5:00 PM at close
  dayLength: 300, // sim seconds from open to close: about 5 real minutes at 1x
  wrapUp: 60, // after close, customers still inside get this long before they leave
};

// The flow director keeps the number of things that need you in a band, instead of a fixed arrival schedule.
export type Arrival = RequestKind | "web_order";

export const DIRECTOR = {
  floor: 1, // below this many active things, bring in the next one quickly...
  ceiling: 3, // ...and at this many, hold everything back
  floorGap: [0, 1] as [number, number], // seconds, once below the floor
  pace: [14, 24] as [number, number], // seconds between arrivals otherwise
  firstArrival: [1, 2] as [number, number],
  maxPerDay: 15, // new customers (web orders count; people coming back for an order don't)
  mix: {
    quick_copies: 5,
    large_job: 3,
    poster: 2,
    ship: 3,
    dropoff: 2,
    order_pickup: 5, // only when someone has a finished order to come back for
    package_pickup: 2,
    self_serve_help: 2,
    complaint: 0,
    web_order: 2,
  } as Record<Arrival, number>,
  // Later days lean toward requests with more steps: their weight grows by this much per day, up to the cap.
  multiStep: ["large_job", "poster", "ship"] as Arrival[],
  multiStepPerDay: 0.05,
  multiStepMax: 1,
  truckHold: 20, // seconds before the truck is due: hold arrivals so there's room for it
};

// How long each task takes, in sim seconds. Short and fixed.
// Finishing goes by FINISH_SECONDS and answering a customer by RESPOND_SECONDS instead.
// Cutting the corner (Don't) is faster than doing it properly: that's the temptation.
export const DURATIONS: Record<Exclude<TaskType, "finish" | "respond">, number> = {
  talk: 3,
  hand_over: 3,
  ring_up: 4,
  enter_order: 4,
  send_job: 2,
  open_message: 3,
  leave_unread: 1,
  collect: 3,
  reprint: 2,
  use_anyway: 1,
  clear_jam: 6,
  load_paper: 5,
  bag: 3,
  help_self_serve: 8,
  fix_copier: 10,
  out_of_order_sign: 2,
  weigh: 3,
  pack: 8,
  tape_shut: 2,
  label: 4,
  bin: 2,
  scan_dropoff: 5,
  find_package: 6,
  hand_off: 4,
  let_truck_go: 1,
  fix_card_reader: 10,
  manual_ring_up: 8, // writing the card number down by hand
  restart_router: 6,
};

// Bad luck: about one thing a day, never two at once, from its own stream.
export const EVENTS = {
  chance: 0.85, // days with one
  window: [0.15, 0.7] as [number, number], // share of the day: earliest time it can happen
  weights: { printer_jam: 3, copier_dies: 2, card_reader_down: 2, box_rips: 2, wifi_drop: 2 } as Record<EventKind, number>,
  wifiOutage: 60, // seconds until the Wi-Fi comes back on its own
  unhandledHeat: 8, // still broken at close
};

export const RESPOND_SECONDS: Record<CounterAction, number> = { take: 4, rush: 4, self_serve: 3, turn_away: 2, ignore: 1 };

// Customer mood is a running score: everyone starts happy (1). Neutral at 0, angry at -1 or less.
// Your attitude isn't graded: only what happens to them.
export const MOOD = {
  start: 1,
  fedUp: -1, // waited past their patience
  late: -1, // their order wasn't ready when promised
  turnedAway: -1, // you said no
  ignored: -1, // each time you ignore them
  badWork: -2, // smudged copies handed over, a taped-up box, pointed at an out of order sign
};

// How long you have to answer someone at the counter before it counts as ignoring them.
export const ANSWER_WITHIN = 12;

// Seconds a customer will wait, in line and for their order, before they're fed up. Generous on purpose: an
// attentive player never hits it. Past patience x leaveAfter they walk out angry.
export const PATIENCE: Record<RequestKind, number> = {
  quick_copies: 150,
  large_job: 210,
  poster: 180,
  ship: 120,
  dropoff: 90,
  order_pickup: 120,
  package_pickup: 100,
  self_serve_help: 100,
  complaint: 90,
};
export const PATIENCE_RAMP = { perDay: 0.01, min: 0.8 }; // shorter by this share per day, down to the floor
export const LEAVE_AFTER = 1.5;

// Web customers come back about this long after ordering, ready or not.
export const PICKUP_AFTER: [number, number] = [100, 160];

// Full service turnaround: an order taken normally is promised this long from now (or later, if the printer queue
// says so). A rush jumps the queue and is promised as soon as it can be done.
export const STANDARD_LEAD = 90;
export const RUSH_BUFFER = 20; // a rush is promised this long after the earliest it could possibly be done

// When print customers want it, by request: wait in the store, come back later, or tomorrow. The ranges are seconds
// from arrival: the latest it's any use to them.
export const TIMING: Record<"quick_copies" | "large_job" | "poster", { wait: number; back: number; tomorrow: number; waitIn: [number, number]; backIn: [number, number] }> = {
  quick_copies: { wait: 1, back: 0, tomorrow: 0, waitIn: [50, 120], backIn: [0, 0] },
  large_job: { wait: 0.35, back: 0.45, tomorrow: 0.2, waitIn: [100, 200], backIn: [150, 260] },
  poster: { wait: 0.6, back: 0.4, tomorrow: 0, waitIn: [80, 160], backIn: [140, 240] },
};

// How customers react (keyed rolls per customer, so your choices never shift anyone else's).
export const REACTIONS = {
  goAlone: 0.35, // eligible for self-serve: go straight there, never come to the counter
  acceptSelfServe: 0.65, // of those who come to the counter: agree to be sent over (the rest want full service)
  serviceFeeBalk: 0.25, // small orders: don't want to pay the service fee
  rushBalk: 0.3, // don't want to pay the rush fee
  // What someone who balks at a fee does instead (weights). "standard" only applies to a rush.
  balkInstead: { standard: 4, self_serve: 3, leave: 2 },
  acceptLater: 0.55, // the promised time misses theirs: take the later time (or leave)
};

// Turning away a doable job worth at least this much is a lost sale.
export const WORTH_MIN_CENTS = 400;

export const SMUDGE_CHANCE = 0.12; // a print run comes out smudged

// Manager heat (0..100, hidden) and what moves it. Checked at close: warning, write-up, and 3 write-ups is fired.
// The manager cares about the work getting done and sales, not manners.
export const HEAT = {
  complaint: 6, // when a complaint arrives
  ignore: 2, // each time you ignore someone
  walkout: 6, // someone gave up waiting
  late: 4, // an order ready after it was promised
  unfinished: 6, // an order due today still not done at close
  lostSale: 2, // turned away a job you could have done, and that was worth doing
  flag: 8, // something you did came back (damaged box, smudged copies, packages left behind)
  overnightCool: 0.6, // share of heat that's gone by the next morning
  cleanDayCool: 10, // extra, after a day with no complaints
  warnAt: 30,
  writeUpAt: 70,
  writeUpRelief: 25, // a write-up clears the air a bit
  writeUpsToFire: 3,
};

// Who complains, by mood when they leave ("usually" and "sometimes" are keyed rolls).
export const COMPLAINT_CHANCE = { happy: 0, neutral: 0.05, angry: 0.85 };
export const COMPLAINT_SAME_DAY = 0.5; // share that arrive later the same day; the rest come in the next morning
export const COMPLAINT_DELAY: [number, number] = [20, 60]; // seconds, same day

// Delayed consequences: when each kind comes back.
export const FLAGS = {
  damagedBoxDays: [1, 2] as [number, number], // a taped-shut box comes back damaged
  smudgeSameDay: 0.5, // smudged copies come back the same day (or else the next)
  smudgeDelay: [40, 90] as [number, number], // seconds, same day
  morningAt: [10, 60] as [number, number], // seconds after open, for visits due on a later day
};

export const FINISH_SECONDS: Record<Exclude<Finishing, "none">, number> = { staple: 4, cut: 6, laminate: 8 };

export const PRINTER = {
  warmup: 2, // seconds before the first sheet of each job
  sheetsPerSecond: 4,
  paperOutChance: 0.35, // days the tray runs out once
  paperOutSheets: [40, 400] as [number, number], // ...after this many sheets that day
};

export const SHIPPING = {
  truckArrives: 0.8, // share of the day
  truckWaits: 30, // seconds
  weightLb: [1, 30] as [number, number],
  serviceWeights: { ground: 6, two_day: 3, overnight: 1 } as Record<ShipService, number>,
  boxMaxLb: { small: 5, medium: 20 }, // anything heavier goes in a large box
};

// Postage = base + per lb (rounded up). The store only keeps a small cut of postage; packing is where it earns.
export const SHIP_RATE: Record<ShipService, { base: number; perLb: number }> = {
  ground: { base: 1100, perLb: 90 },
  two_day: { base: 2400, perLb: 220 },
  overnight: { base: 4200, perLb: 380 },
};
export const POSTAGE_CUT = 0.1; // the store's share of postage
export const PACKING_FEE: Record<BoxSize, number> = { small: 600, medium: 1000, large: 1600 };

// What each kind of print request asks for. Ranges are inclusive.
export interface PrintRequestDef {
  item: string;
  originals: [number, number];
  copies: [number, number];
  colorChance: number;
  media: Partial<Record<Media, number>>; // weights
  duplexChance: number;
  finishing: Partial<Record<Finishing, number>>; // weights
}

export const PRINT_REQUESTS: Record<"quick_copies" | "large_job" | "poster", PrintRequestDef> = {
  quick_copies: {
    item: "document",
    originals: [1, 5],
    copies: [1, 10],
    colorChance: 0.2,
    media: { letter: 9, legal: 1 },
    duplexChance: 0.3,
    finishing: { none: 7, staple: 3 },
  },
  large_job: {
    item: "handout",
    originals: [2, 6],
    copies: [15, 40],
    colorChance: 0.3,
    media: { letter: 6, cardstock: 2, tabloid: 2 },
    duplexChance: 0.5,
    finishing: { none: 3, staple: 4, cut: 3 },
  },
  poster: {
    item: "poster",
    originals: [1, 1],
    copies: [1, 4],
    colorChance: 0.9,
    media: { tabloid: 1 },
    duplexChance: 0,
    finishing: { laminate: 1 },
  },
};

// ---------- prices (cents) ----------

// Full service charges on top of the printing price list.
export const FULL_SERVICE = {
  serviceFeeCents: 200, // a flat fee on small orders...
  serviceFeeUnderCents: 1000, // ...when the printing comes to less than this
  rushRate: 0.25, // a rush adds this share of the printing price...
  rushMinCents: 200, // ...but at least this
};

// Self-serve copiers: plain paper and simple jobs only, cheaper per side, and the customer does the work.
export const SELF_SERVE = {
  setupSeconds: 15,
  sidesPerSecond: 2,
  maxSeconds: 90,
};
export const SELF_SERVE_PER_SIDE: Record<ColorMode, Record<"letter" | "legal" | "tabloid", number>> = {
  bw: { letter: 10, legal: 12, tabloid: 20 },
  color: { letter: 45, legal: 52, tabloid: 90 },
};

// Per impression (one printed side), by size.
export const PRICE_PER_SIDE: Record<ColorMode, Record<"letter" | "legal" | "tabloid", number>> = {
  bw: { letter: 15, legal: 18, tabloid: 30 },
  color: { letter: 59, legal: 69, tabloid: 118 },
};
export const CARDSTOCK_UPCHARGE = 20; // per sheet
export const FINISHING_PRICE = {
  staple: 0,
  cutPer250Sheets: 150,
  laminateSheet: 200,
};
