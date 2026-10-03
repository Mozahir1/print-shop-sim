// Tuning numbers. Balance the game by editing this file.
// Time is in game minutes: one sim step is one minute on the wall clock (9:00 AM to 5:00 PM is 480 of them), so every
// duration here means what it says. The UI decides how many game minutes pass per real second.
import workflowData from "../data/workflows.json";
import type { BoxSize, ColorMode, CounterAction, EventKind, Finishing, Media, RequestKind, ShipService, TaskType } from "./types";

export const TUNING = {
  openHour: 9, // the wall clock reads 9:00 AM at open
  dayLength: 480, // game minutes from open (9 AM) to close (5 PM)
};

// Closing time. Most people in line head out at close (now and then one stays anyway); people waiting on an order
// stay until it's done or you show them out. The day ends when you go home: on time with everything done is
// rewarded, overtime annoys the manager (and the clock drags), and leaving work undone is penalized.
export const CLOSING = {
  lingerChance: 0.2, // someone in line at close who stays anyway (at most one)
  onTimeGrace: 15, // minutes after close you can still leave "on time"
  onTimeReward: 6, // heat off for leaving on time with nothing left undone
  overtimeHeatPer10Min: 1, // past the grace period, per 10 minutes you stay
  leftUndoneHeat: 4, // per thing left undone when you go home
  sentHomeAfter: 240, // minutes after close (9 PM) the manager locks up and sends you home
  overtimeLineEvery: 30, // minutes between the MC's "I want to go home" lines
  overtimeSpeed: 0.5, // the UI runs the clock this much slower after close (you're bored)
};

// The flow director keeps the number of things that need you in a band, instead of a fixed arrival schedule.
export type Arrival = RequestKind | "web_order";

export const DIRECTOR = {
  floor: 1, // below this many active things, bring in the next one quickly...
  ceiling: 3, // ...and at this many, hold everything back
  floorGap: [2, 6] as [number, number], // minutes, once below the floor
  pace: [12, 25] as [number, number], // minutes between arrivals otherwise
  firstArrival: [2, 5] as [number, number],
  maxPerDay: 26, // new customers (web orders count; people coming back for an order don't)
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
    business: 0, // they come on their own schedule (BUSINESS)
    web_order: 2,
  } as Record<Arrival, number>,
  // Later days lean toward requests with more steps: their weight grows by this much per day, up to the cap.
  multiStep: ["large_job", "poster", "ship"] as Arrival[],
  multiStepPerDay: 0.05,
  multiStepMax: 1,
  truckHold: 30, // minutes before the truck is due: hold arrivals so there's room for it
};

// How long each step takes, in game minutes: from the workflow data (src/data/workflows.json). Short and fixed.
// Finishing goes by FINISH, making copies by WALK_UP, and answering a customer by RESPOND_MINUTES instead.
// Cutting the corner (Don't) is faster than doing it properly: that's the temptation.
export const DURATIONS = Object.fromEntries(
  Object.entries(workflowData.steps)
    .filter(([k]) => k !== "finish" && k !== "respond" && k !== "make_copies")
    .map(([k, v]) => [k, v.duration]),
) as Record<Exclude<TaskType, "finish" | "respond" | "make_copies">, number>;

// Bad luck: about one thing a day, never two at once, from its own stream.
export const EVENTS = {
  chance: 0.85, // days with one
  window: [0.15, 0.7] as [number, number], // share of the day: earliest time it can happen
  weights: { printer_jam: 3, copier_dies: 2, card_reader_down: 2, box_rips: 2, wifi_drop: 2 } as Record<EventKind, number>,
  wifiOutage: 45, // minutes until the Wi-Fi comes back on its own
  unhandledHeat: 8, // still broken at close
};

// Answering a print customer (anything else is a minute).
export const RESPOND_MINUTES: Record<CounterAction, number> = { take: 2, rush: 2, self_serve: 1, turn_away: 1, ignore: 1 };

// Customer mood is a running score: everyone starts happy (1). Neutral at 0, angry at -1 or less.
// Your attitude isn't graded: only what happens to them.
export const MOOD = {
  start: 1,
  fedUp: -1, // got angry waiting
  late: -1, // their order wasn't ready when promised
  turnedAway: -1, // you said no
  ignored: -1, // each time you ignore them
  badWork: -2, // smudged copies handed over, a taped-up box, pointed at an out of order sign
};

// How long you have to answer someone at the counter before it counts as ignoring them.
export const ANSWER_WITHIN = 8; // minutes (the UI slows the clock while you decide)

// How long a customer will wait before giving up and leaving, in sim seconds, by what they came for. Waiting in
// line or at the counter counts; waiting for an order only counts once it's overdue; being helped doesn't count.
// They get annoyed, then angry, then go (each one said out loud). Shorter on later days, down to the floor.
export const GIVE_UP: Record<RequestKind, number> = {
  quick_copies: 25,
  large_job: 35,
  poster: 30,
  ship: 25,
  dropoff: 20,
  order_pickup: 30,
  package_pickup: 25,
  self_serve_help: 25,
  complaint: 25,
  business: 18, // they have somewhere to be: long enough for a normal job, not for a long one you could have skipped
};
// While you're busy with someone else they can see it, and it doesn't wear on them as fast.
export const BUSY_PATIENCE = 0.5;
export const PATIENCE_STAGES = { annoyed: 0.4, angry: 0.75 }; // share of the give-up time
export const PATIENCE_RAMP = { perDay: 0.01, min: 0.8 };

// Web customers come back about this long after ordering, ready or not.
export const PICKUP_AFTER: [number, number] = [60, 180];

// Full service turnaround: an order taken normally is promised this long from now (or later, if the printer queue
// says so). A rush jumps the queue and is promised as soon as it can be done.
export const STANDARD_LEAD = 60; // an hour
export const RUSH_BUFFER = 10; // a rush is promised this long after the earliest it could possibly be done

// When print customers want it, by request: wait in the store, come back later, or tomorrow. The ranges are seconds
// from arrival: the latest it's any use to them.
export const TIMING: Record<"quick_copies" | "large_job" | "poster" | "business", { wait: number; back: number; tomorrow: number; waitIn: [number, number]; backIn: [number, number] }> = {
  quick_copies: { wait: 1, back: 0, tomorrow: 0, waitIn: [20, 45], backIn: [0, 0] },
  large_job: { wait: 0.35, back: 0.45, tomorrow: 0.2, waitIn: [45, 90], backIn: [90, 240] },
  poster: { wait: 0.6, back: 0.4, tomorrow: 0, waitIn: [30, 60], backIn: [60, 180] },
  business: { wait: 0, back: 0.4, tomorrow: 0.6, waitIn: [0, 0], backIn: [240, 420] },
};

// How customers react (keyed rolls per customer, so your choices never shift anyone else's).
export const REACTIONS = {
  goAlone: 0.2, // eligible for self-serve: go straight there, never come to the counter
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
  complaint: 4, // when a complaint arrives
  ignore: 2, // each time you ignore someone
  walkout: 6, // someone gave up waiting
  late: 4, // an order ready after it was promised
  unfinished: 6, // an order due today still not done at close
  lostSale: 0.3, // turned away a job you could have done, and that was worth doing
  flag: 8, // something you did came back (damaged box, smudged copies, packages left behind)
  overnightCool: 0.6, // share of heat that's gone by the next morning
  cleanDayCool: 10, // extra, after a day with no complaints
  warnAt: 30,
  writeUpAt: 70,
  writeUpRelief: 25, // a write-up clears the air a bit
  writeUpsToFire: 3,
};

// Who complains, by mood when they leave ("usually" and "sometimes" are keyed rolls).
export const COMPLAINT_CHANCE = { happy: 0, neutral: 0.02, angry: 0.85 };
export const COMPLAINT_SAME_DAY = 0.5; // share that arrive later the same day; the rest come in the next morning
export const COMPLAINT_DELAY: [number, number] = [30, 90]; // minutes, same day

// Delayed consequences: when each kind comes back.
export const FLAGS = {
  damagedBoxDays: [1, 2] as [number, number], // a taped-shut box comes back damaged
  smudgeSameDay: 0.5, // smudged copies come back the same day (or else the next)
  smudgeDelay: [60, 150] as [number, number], // minutes, same day
  morningAt: [15, 90] as [number, number], // minutes after open, for visits due on a later day
};

// Finishing time grows with the size of the job: base minutes, plus per copy (staple) or per sheet (cut, laminate).
export const FINISH: Record<Exclude<Finishing, "none">, { base: number; perCopy: number; perSheet: number }> = {
  staple: { base: 1, perCopy: 0.05, perSheet: 0 },
  cut: { base: 3, perCopy: 0, perSheet: 1 / 150 },
  laminate: { base: 2, perCopy: 0, perSheet: 1.5 },
};

// Full service on a simple job someone's waiting for: you make the copies yourself, start to finish. You can't
// leave it once you start, so it's your time that it costs.
export const WALK_UP = { setupMinutes: 3, sidesPerMinute: 6 };

// Business clients: big orders, and they won't wait around if you're tied up. On their own schedule (not the
// director's mix): how many a day, and when.
export const BUSINESS = {
  perDay: { 0: 2, 1: 6, 2: 2 } as Record<number, number>, // weights
  window: [0.08, 0.8] as [number, number], // share of the day
  lostHeat: 10, // the manager hears about a big order walking out
};

// Surveys are rare, like real life. Turning someone away when they could have done it themselves at self-serve is
// the kind of thing that ends up in one.
export const SURVEY = { chance: 0.03, badHeat: 6, goodHeat: -2 };

// The manager watches sales. A day under target adds a little heat; a strong day takes some off. That's what makes
// the few extra dollars of doing a job yourself worth something (against the chance of being tied up).
export const SALES = {
  targetCents: 25000,
  shortfallHeatPer25: 1, // per $25 under target
  strongDayCents: 50000,
  strongDayCool: 3,
};

export const PRINTER = {
  warmup: 1, // minutes before the first sheet of each job
  sheetsPerMinute: 30,
  paperOutChance: 0.35, // days the tray runs out once
  paperOutSheets: [40, 400] as [number, number], // ...after this many sheets that day
};

export const SHIPPING = {
  truckArrives: 0.78, // share of the day (about 4:15 PM)
  truckWaits: 15, // minutes
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

export const PRINT_REQUESTS: Record<"quick_copies" | "large_job" | "poster" | "business", PrintRequestDef> = {
  business: {
    item: "brochure",
    originals: [4, 12],
    copies: [100, 400],
    colorChance: 0.85,
    media: { letter: 3, cardstock: 3, tabloid: 2 },
    duplexChance: 0.6,
    finishing: { cut: 3, staple: 3 },
  },
  quick_copies: {
    item: "document",
    originals: [1, 6],
    copies: [2, 15],
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
  setupMinutes: 5,
  sidesPerMinute: 20,
  maxMinutes: 30,
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
