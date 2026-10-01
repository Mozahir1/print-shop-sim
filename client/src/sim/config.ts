// Tuning numbers. Balance the game by editing this file.
import type { ColorMode, CounterChoice, EventKind, Finishing, Media, RequestKind, TaskType } from "./types";

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
// Lazy options are faster than doing it properly: that's the temptation.
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

export const RESPOND_SECONDS: Record<CounterChoice, number> = { proper: 5, minimum: 2, rude: 2, ignore: 1 };

// Customer mood is a running score: happy at 1 or more, neutral at 0, angry at -1 or less.
export const MOOD = {
  proper: 1,
  minimum: 0, // usually...
  minimumSour: -1, // ...but sometimes they wanted a person
  minimumSourChance: 0.1,
  rude: -2, // usually...
  rudeShrug: 0, // ...but some people don't care
  rudeShrugChance: 0.2,
  ignore: -1,
  lazyNoticed: -1, // smudged copies, a taped-shut box, being pointed at a sign
  fedUp: -1, // waited past their patience
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

// Customers who leave an order (and web customers) come back about this long after ordering, ready or not.
export const PICKUP_AFTER: [number, number] = [100, 160];

export const SMUDGE_CHANCE = 0.12; // a print run comes out smudged

// Manager heat (0..100, hidden) and what moves it. Checked at close: warning, write-up, and 3 write-ups is fired.
export const HEAT = {
  complaint: 5, // when a complaint (or bad review) arrives
  angryLeft: 4, // an angry customer left
  rude: 4, // each rude answer
  ignore: 3, // each time you ignore someone
  walkout: 6, // someone waited until they gave up
  flag: 10, // something you did came back (damaged box, smudged copies, packages left behind)
  overnightCool: 0.6, // share of heat that's gone by the next morning
  cleanDayCool: 10, // extra, after a day with no complaints
  warnAt: 30,
  writeUpAt: 70,
  writeUpRelief: 25, // a write-up clears the air a bit
  writeUpsToFire: 3,
};

// Who complains, by mood when they leave ("usually" and "sometimes" are keyed rolls).
export const COMPLAINT_CHANCE = { happy: 0, neutral: 0.08, angry: 0.85 };
export const COMPLAINT_SAME_DAY = 0.5; // share that arrive later the same day; the rest come in the next morning
export const COMPLAINT_DELAY: [number, number] = [20, 60]; // seconds, same day

// Delayed consequences: when each kind comes back.
export const FLAGS = {
  rudeReviewChance: 0.6, // a rude answer usually turns into a bad online review next morning
  damagedBoxDays: [1, 2] as [number, number], // a taped-shut box comes back damaged
  smudgeSameDay: 0.5, // smudged copies come back the same day (or else the next)
  smudgeDelay: [40, 90] as [number, number], // seconds, same day
  morningAt: [10, 60] as [number, number], // seconds after open, for visits due on a later day
};

export const FINISH_SECONDS: Record<Exclude<Finishing, "none">, number> = { staple: 4, cut: 6, laminate: 8 };

export const PRINTER = {
  warmup: 2, // seconds before the first sheet of each job
  sheetsPerSecond: 8,
  paperOutChance: 0.35, // days the tray runs out once
  paperOutSheets: [40, 400] as [number, number], // ...after this many sheets that day
};

export const SHIPPING = {
  truckArrives: 0.8, // share of the day
  truckWaits: 30, // seconds
  weightLb: [1, 30] as [number, number],
};

// Retail rate = base + per lb (rounded up to the next pound). Everything goes ground for now.
export const SHIP_RATE = { base: 1100, perLb: 90 };
export const PACKING_FEE_CENTS = 600;

// What each kind of print request asks for. Ranges are inclusive.
export interface PrintRequestDef {
  item: string;
  originals: [number, number];
  copies: [number, number];
  colorChance: number;
  media: Partial<Record<Media, number>>; // weights
  duplexChance: number;
  finishing: Partial<Record<Finishing, number>>; // weights
  waitChance: number; // waits in the store; otherwise comes back later
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
    waitChance: 1,
  },
  large_job: {
    item: "handout",
    originals: [2, 6],
    copies: [15, 40],
    colorChance: 0.3,
    media: { letter: 6, cardstock: 2, tabloid: 2 },
    duplexChance: 0.5,
    finishing: { none: 3, staple: 4, cut: 3 },
    waitChance: 0.4,
  },
  poster: {
    item: "poster",
    originals: [1, 1],
    copies: [1, 4],
    colorChance: 0.9,
    media: { tabloid: 1 },
    duplexChance: 0,
    finishing: { laminate: 1 },
    waitChance: 1,
  },
};

// ---------- prices (cents) ----------

// Full service charges on top of the printing price list.
export const FULL_SERVICE = {
  serviceFeeCents: 200, // every full-service order...
  feeWaivedAboveCents: 5000, // ...unless the printing comes to more than $50
  rushRate: 0.1, // orders over $50 that are due the same day
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
