// Tuning numbers. Balance the game by editing this file and src/data/customers.json.
// Rates and prices are meant to be roughly what a real copy shop sees, not game-y.
import customerData from "../data/customers.json";
import type { BoxSize, ColorMode, Finishing, Media, Printer, ShipService, StockItem } from "./types";

const MIN = 60;
const HOUR = 3600;

export const TUNING = {
  openHour: 9, // 9:00 AM
  shiftLength: 8 * HOUR, // closes at 5:00 PM
  overtimeLimit: 1 * HOUR, // shift ends at the latest this long after close
  walkSpeed: 1.3, // meters per second, for you and customers
  // Walk-in customers per hour, starting at open. Lunch is the rush.
  walkInsPerHour: [3, 4, 5, 7, 6, 4, 4, 4],
  webOrdersPerHour: 1,
  backOrderCutoff: 30 * MIN, // a "come back later" time this close to closing becomes "tomorrow"
  lineWaitGrace: 3 * MIN, // standing in line longer than this starts to cost stars
  lateGrace: 5 * MIN, // picking up later than promised by more than this costs stars
};

// Shipping counter. Pays less than printing, takes your time, and the truck doesn't wait.
export const SHIPPING = {
  shippersPerHour: [1, 1.5, 1.5, 2, 2, 1.5, 1.5, 1.5], // customers sending a package, starting at open
  dropoffsPerHour: [1, 1, 1, 1.5, 1.5, 1, 1, 1], // customers with prepaid returns
  dropoffPackages: [1, 3] as [number, number],
  inboundMean: 6, // held packages in the morning delivery
  ownersComeToday: 0.75, // share of held-package owners who come in today
  truckArrives: 7.25 * HOUR, // 4:15 PM
  truckWaits: 10 * MIN,
  serviceWeights: { ground: 6, two_day: 3, overnight: 1 } as Record<ShipService, number>,
  packedChance: 0.6, // brought it already packed
  maxWeightLb: 40,
  boxMaxLb: { small: 5, medium: 20 }, // anything heavier goes in a large box
  linePatience: [8, 15] as [number, number], // minutes
};

// Retail rate = base + per lb (rounded up to the next pound).
export const SHIP_RATE: Record<ShipService, { base: number; perLb: number }> = {
  ground: { base: 1100, perLb: 90 },
  two_day: { base: 2400, perLb: 220 },
  overnight: { base: 4200, perLb: 380 },
};
export const CARRIER_SHARE = 0.7; // what the carrier charges us, as a share of the retail rate
export const PACKING_FEE: Record<BoxSize, number> = { small: 600, medium: 1000, large: 1600 };
export const PACKING_MATERIAL_CENTS = 40; // tape, fill, label pouch (the box itself is costed in the stockroom phase)

// The phone. Each call rings for a while, then goes to voicemail.
export const PHONE = {
  callsPerHour: [1.5, 1.8, 2.2, 2.5, 2.3, 1.8, 1.6, 1.5], // busiest at lunch
  kindWeights: { quote: 4, status: 3, hours: 2, rates: 2 },
  ringSeconds: 30,
  talkSeconds: { quote: [120, 300], status: [45, 120], hours: [20, 45], rates: [60, 180] } as Record<string, [number, number]>,
  quoteConversion: 0.55, // answered quote calls that turn into a web order
  leadDelayMinutes: [10, 90] as [number, number],
};

// Machine upkeep: self-serve copier paper and jams, production printer breakdowns, jam waste.
export const UPKEEP = {
  copierCapacity: 1500, // letter sheets
  copierMeanSheetsBetweenJams: 1800,
  fixCopierSeconds: [45, 150] as [number, number],
  refillCopierSeconds: 60,
  recallSeconds: 20,
  breakdownChance: 0.06, // per production printer, per day
  techDelayHours: [2, 4] as [number, number],
  techWorkMinutes: [30, 90] as [number, number],
  jamWasteSheets: [1, 5] as [number, number],
};

// Stockroom: back stock for every machine and the shipping counter. Start is a random range for a single shift.
export interface StockDef {
  label: string;
  unit: string;
  start: [number, number];
  pack: number; // units per order
  packLabel: string;
  packCents: number;
  low: number; // warn at or below this
}

export const STOCK: Record<StockItem, StockDef> = {
  letter: { label: "Letter paper", unit: "sheets", start: [4000, 15000], pack: 5000, packLabel: "case of 5,000", packCents: 4500, low: 2000 },
  legal: { label: "Legal paper", unit: "sheets", start: [1000, 3000], pack: 5000, packLabel: "case of 5,000", packCents: 5500, low: 500 },
  tabloid: { label: "Tabloid paper", unit: "sheets", start: [1000, 2500], pack: 2500, packLabel: "case of 2,500", packCents: 6000, low: 500 },
  cardstock: { label: "Cardstock", unit: "sheets", start: [250, 1250], pack: 1250, packLabel: "case of 1,250", packCents: 6500, low: 250 },
  wide_roll: { label: "Wide format rolls", unit: "rolls", start: [0, 2], pack: 1, packLabel: "1 roll", packCents: 7500, low: 0 },
  bw_toner: { label: "B&W toner", unit: "cartridges", start: [0, 2], pack: 1, packLabel: "1 cartridge", packCents: 9000, low: 0 },
  color_toner: { label: "Color toner", unit: "sets", start: [0, 2], pack: 1, packLabel: "1 set", packCents: 22000, low: 0 },
  wide_ink: { label: "Wide format ink", unit: "sets", start: [0, 2], pack: 1, packLabel: "1 set", packCents: 18000, low: 0 },
  box_small: { label: "Small boxes", unit: "boxes", start: [5, 20], pack: 25, packLabel: "bundle of 25", packCents: 1500, low: 5 },
  box_medium: { label: "Medium boxes", unit: "boxes", start: [4, 15], pack: 25, packLabel: "bundle of 25", packCents: 2500, low: 4 },
  box_large: { label: "Large boxes", unit: "boxes", start: [2, 8], pack: 10, packLabel: "bundle of 10", packCents: 2000, low: 2 },
};

// Self-serve copiers out on the floor. Customers whose job qualifies mostly use them on their own.
// Full service charges on top of the printing price list.
export const FULL_SERVICE = {
  serviceFeeCents: 200, // every full-service order...
  feeWaivedAboveCents: 5000, // ...unless the printing comes to more than $50
  rushRate: 0.1, // orders over $50 that are due the same day
};

export const SELF_SERVE = {
  // Of customers whose job qualifies: some need to be shown over, some insist on full service, the rest go alone.
  needsHelp: 0.2,
  // Who insists on full service depends on what it costs them over doing it themselves (fees included),
  // less what their time at the copier is worth. Share = maxRefuse * e^(-extra cost / refuseScale), at least minRefuse.
  maxRefuse: 0.35,
  minRefuse: 0.02,
  refuseScaleCents: 200,
  timeValueCentsPerMinute: 25,
  ppm: { bw: 30, color: 20 } as Record<ColorMode, number>, // slower than the production machines
  setupSeconds: 120, // pay at the machine, pull the file off a USB or email, pick settings
  queueGrace: 3 * MIN, // waiting for a copier longer than this starts to cost stars
};

// How long things take you, in seconds, once you're standing at the right spot.
export const DURATIONS = {
  takeOrderBase: 90, // greet, get the file off their email/USB, confirm specs
  takeOrderPerOption: 20, // each extra (special paper, duplex, finishing)
  takeOrderBigRun: 30, // proof copy for runs over 100 sheets
  turnAway: 30,
  ringUp: 75, // find it on the shelf, show them, take payment
  handOver: 40, // already paid
  explainDelay: 30,
  usherSelfServe: 45, // walk them over, show them the machine and the card reader
  shipBase: 150, // weigh, enter the address, pick the service, print and stick the label, take payment
  pack: { small: 120, medium: 180, large: 300 } as Record<BoxSize, number>,
  dropoffBase: 25,
  dropoffPerPackage: 10, // scan each prepaid label
  checkInBase: 30,
  checkInPerPackage: 15, // scan, write the notice, shelve
  releasePackage: 60, // check ID, find it on the hold shelf, scan it out
  handOffBase: 30,
  handOffPerPackage: 5,
  sendJob: 45, // open the file, set paper/duplex/copies, send
  bag: 45, // count, box or bag, write the ticket
  bagPer500Sheets: 15,
  loadPaper: 60,
  loadRoll: 180,
  replaceToner: 120,
  jamClear: [60, 240] as [number, number],
};

// Finishing work, in seconds. Sheets = physical sheets in the whole job.
export function finishingWork(f: Finishing, copies: number, sheets: number, sheetsPerCopy: number, wide: boolean): number {
  switch (f) {
    case "none":
      return 0;
    case "staple":
      return 20 + 6 * copies;
    case "fold":
      return 120 + 0.3 * sheets; // set up the folder, then it runs
    case "cut":
      return 60 + 40 * Math.ceil(sheets / 250); // guillotine, one stack at a time
    case "laminate":
      return 120 + (wide ? 90 : 25) * sheets; // warm up, then one sheet at a time
    case "coil_bind":
      return 60 + copies * (90 + 1.5 * sheetsPerCopy); // punch, coil, crimp
  }
}

// ---------- prices and material costs (cents) ----------

// Full service price list: per impression (one printed side), by size. Staff runs the job for you.
export const PRICE_PER_SIDE: Record<ColorMode, Record<"letter" | "legal" | "tabloid", number>> = {
  bw: { letter: 15, legal: 18, tabloid: 30 },
  color: { letter: 59, legal: 69, tabloid: 118 },
};
// Self-serve price list: same paper, you run it yourself, so it's cheaper per side.
export const SELF_SERVE_PER_SIDE: Record<ColorMode, Record<"letter" | "legal" | "tabloid", number>> = {
  bw: { letter: 10, legal: 12, tabloid: 20 },
  color: { letter: 45, legal: 52, tabloid: 90 },
};
export const CARDSTOCK_UPCHARGE = 20; // per sheet
export const WIDE_PRICE: Record<ColorMode, Record<"wide_18x24" | "wide_24x36", number>> = {
  bw: { wide_18x24: 400, wide_24x36: 600 },
  color: { wide_18x24: 2500, wide_24x36: 4000 },
};
export const FINISHING_PRICE = {
  staple: 0,
  foldPerSheet: 5,
  cutPer250Sheets: 150,
  laminateLetter: 200,
  laminateWide: 1200,
  coilBindPerBook: 450,
};

export const COST = {
  sidePerColor: { bw: 1.2, color: 6 } as Record<ColorMode, number>, // toner/click charge
  sheet: { letter: 1, legal: 1.3, tabloid: 2.5, cardstock: 6 } as Record<string, number>,
  wideSqFt: { bw: 35, color: 120 } as Record<ColorMode, number>,
  laminatePouchLetter: 40,
  laminateWide: 300,
  coilPerBook: 90,
};

// ---------- machines ----------

export function createPrinters(): Printer[] {
  const base = () => ({
    status: "idle" as const,
    currentJobId: null,
    queue: [] as number[],
    warmupLeft: 0,
    sheetsUntilJam: 0,
    jamClearSeconds: 0,
    sheetsToday: 0,
    jamsToday: 0,
    toner: 100,
    breakdown: null,
  });
  return [
    {
      ...base(),
      id: "bw",
      supply: "bw_toner",
      name: "B&W production printer",
      short: "B&W",
      tile: { x: 7, y: 1 },
      station: { x: 8, y: 3.3 },
      colors: ["bw"],
      media: ["letter", "legal", "tabloid"],
      ppm: 65,
      wideSecondsPerSqFt: null,
      warmup: 20,
      trays: [
        { stock: "letter", capacity: 2000, level: 2000 },
        { stock: "legal", capacity: 500, level: 500 },
        { stock: "tabloid", capacity: 500, level: 500 },
      ],
      tonerUse: { bw: 100 / 40000, color: 0 },
      meanSheetsBetweenJams: 3000,
    },
    {
      ...base(),
      id: "color",
      supply: "color_toner",
      name: "Color production printer",
      short: "Color",
      tile: { x: 10.5, y: 1 },
      station: { x: 11.5, y: 3.3 },
      colors: ["bw", "color"],
      media: ["letter", "tabloid", "cardstock"],
      ppm: 45,
      wideSecondsPerSqFt: null,
      warmup: 30,
      trays: [
        { stock: "letter", capacity: 1000, level: 1000 },
        { stock: "tabloid", capacity: 500, level: 500 },
        { stock: "cardstock", capacity: 250, level: 250 },
      ],
      tonerUse: { bw: 100 / 30000, color: 100 / 12000 },
      meanSheetsBetweenJams: 1500,
    },
    {
      ...base(),
      id: "wide",
      supply: "wide_ink",
      name: "Wide format printer",
      short: "Wide",
      tile: { x: 14, y: 1 },
      station: { x: 15, y: 3.3 },
      colors: ["bw", "color"],
      media: ["wide_18x24", "wide_24x36"],
      ppm: 0,
      wideSecondsPerSqFt: { bw: 6, color: 25 },
      warmup: 45,
      trays: [{ stock: "roll", capacity: 300, level: 300 }], // feet
      tonerUse: { bw: 0.04, color: 0.25 }, // ink, % per sq ft
      meanSheetsBetweenJams: 250,
    },
  ];
}

// Printing speed relative to plain letter paper.
export const MEDIA_SPEED: Record<Media, number> = {
  letter: 1,
  legal: 0.9,
  tabloid: 0.5,
  cardstock: 0.6,
  wide_18x24: 1,
  wide_24x36: 1,
};

// How much more likely a sheet is to jam.
export const MEDIA_JAM_FACTOR: Record<Media, number> = {
  letter: 1,
  legal: 1.2,
  tabloid: 1.3,
  cardstock: 3,
  wide_18x24: 1,
  wide_24x36: 1,
};
export const DUPLEX_JAM_FACTOR = 1.5;

// ---------- customers ----------

type Range = [number, number];

export interface CustomerProfile {
  id: string;
  name: string; // shown in stats
  item: string; // singular noun the customer uses
  walkInWeight: number;
  webWeight: number;
  originals: Range;
  copies: Range;
  copiesRound?: number; // big runs come in round numbers
  colorChance: number;
  media: Partial<Record<Media, number>>; // weights
  duplexChance: number;
  finishing: Partial<Record<Finishing, number>>; // weights
  timing: {
    wait?: { weight: number; minutes: Range };
    back?: { weight: number; minutes: Range };
    tomorrow?: { weight: number };
  };
  linePatience: Range; // minutes
  lateTolerance: Range; // minutes
}

export const PROFILES = customerData as CustomerProfile[];

export function profileById(id: string): CustomerProfile {
  return PROFILES.find((p) => p.id === id)!;
}
