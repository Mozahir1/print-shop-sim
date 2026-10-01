// Generates the whole day's customers up front from the seed.
// Everything random about a customer (when they come, what they want, how patient they are) is rolled here,
// so the same seed always brings the same people through the door no matter how you play.
import type { Customer, Finishing, JobSpec, Media, Timing } from "./types";
import { PROFILES, TUNING, type CustomerProfile } from "./config";
import { DOOR } from "./layout";
import { isWide } from "./orders";
import { randInt, type Rng } from "./rng";

const MIN = 60;

const FIRST_NAMES = [
  "Alex", "Brenda", "Carlos", "Dana", "Elena", "Frank", "Grace", "Hector", "Irene", "James", "Kim", "Luis",
  "Maria", "Nate", "Olivia", "Priya", "Quinn", "Rosa", "Sam", "Tara", "Umar", "Vera", "Will", "Yusuf",
  "Zoe", "Ben", "Chloe", "Derek", "Fatima", "Gabe", "Hannah", "Ivan", "Jade", "Ken", "Lena", "Mark",
];
const LAST_INITIALS = "ABCDEFGHJKLMNOPRSTVW";

export function generateDay(rng: Rng): Customer[] {
  const arrivals: { at: number; web: boolean }[] = [];
  TUNING.walkInsPerHour.forEach((rate, hour) => {
    const n = poisson(rng, rate);
    for (let i = 0; i < n; i++) arrivals.push({ at: (hour + rng()) * 3600, web: false });
    const w = poisson(rng, TUNING.webOrdersPerHour);
    for (let i = 0; i < w; i++) arrivals.push({ at: (hour + rng()) * 3600, web: true });
  });
  arrivals.sort((a, b) => a.at - b.at);

  return arrivals.map((a, i) => makeCustomer(rng, i + 1, Math.round(a.at), a.web));
}

// Also used by dev mode to send in a specific kind of customer on demand.
export function makeCustomer(rng: Rng, id: number, at: number, web: boolean, force?: { profile?: CustomerProfile; timing?: Timing["kind"] }): Customer {
  const profile = force?.profile ?? weighted(rng, PROFILES, (p) => (web ? p.webWeight : p.walkInWeight));
  const spec = makeSpec(rng, profile);
  const timing = makeTiming(rng, profile, web, force?.timing);
  const name = randomName(rng);
  const personality = {
    linePatience: randInt(rng, profile.linePatience[0], profile.linePatience[1]) * MIN,
    lateTolerance: randInt(rng, profile.lateTolerance[0], profile.lateTolerance[1]) * MIN,
    balkLineLength: randInt(rng, 5, 9),
    returnDelay: randInt(rng, 30, 90) * MIN,
    arrivalJitter: randInt(rng, -5, 20) * MIN,
    selfServeRoll: rng(),
  };

  return {
    id,
    name,
    profileId: profile.id,
    state: "outside",
    pos: { ...DOOR },
    visitAt: web ? null : at,
    purpose: web ? "pickup" : "order",
    request: { spec, timing },
    ship: null,
    dropoffCount: 0,
    packageId: null,
    webOrderAt: web ? at : null,
    jobId: null,
    ...personality,
    lineTicket: null,
    waitStart: null,
    lineWaitTotal: 0,
    seatedUntil: null,
    selfServeTicket: null,
    selfServeDeclined: false,
    returns: 0,
    penalty: 0,
    rating: null,
    outcome: null,
  };
}

export function randomName(rng: Rng): string {
  return `${FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]} ${LAST_INITIALS[Math.floor(rng() * LAST_INITIALS.length)]}.`;
}

function makeSpec(rng: Rng, p: CustomerProfile): JobSpec {
  const originals = randInt(rng, p.originals[0], p.originals[1]);
  let copies = randInt(rng, p.copies[0], p.copies[1]);
  if (p.copiesRound) copies = Math.max(p.copiesRound, Math.round(copies / p.copiesRound) * p.copiesRound);
  const color = rng() < p.colorChance ? "color" : "bw";
  let media = weightedKey(rng, p.media) as Media;
  const duplexRoll = rng();
  let finishing = weightedKey(rng, p.finishing) as Finishing;

  if (color === "color" && media === "legal") media = "letter"; // the color printer has no legal tray
  const wide = isWide(media);
  const duplex = !wide && originals > 1 && duplexRoll < p.duplexChance;
  const perCopy = wide || !duplex ? originals : Math.ceil(originals / 2);

  // Keep finishing physically sensible.
  if (finishing === "coil_bind" && perCopy < 5) finishing = "staple";
  if (finishing === "staple" && perCopy < 2) finishing = "none";
  if ((finishing === "fold" || finishing === "cut") && (wide || originals > 2)) finishing = "none";

  return { item: p.item, originals, copies, color, media, duplex, finishing };
}

function makeTiming(rng: Rng, p: CustomerProfile, web: boolean, force?: Timing["kind"]): Timing {
  const options: { t: "wait" | "back" | "tomorrow"; w: number }[] = [];
  if (p.timing.wait && !web) options.push({ t: "wait", w: p.timing.wait.weight });
  if (p.timing.back) options.push({ t: "back", w: p.timing.back.weight });
  if (p.timing.tomorrow) options.push({ t: "tomorrow", w: p.timing.tomorrow.weight });
  let choice = weighted(rng, options, (o) => o.w).t;
  const minutesRoll = rng();
  if (force) choice = force;

  if (choice === "tomorrow") return { kind: "tomorrow" };
  // A forced timing the profile doesn't define borrows a sensible default range.
  const fallback: [number, number] = choice === "wait" ? [15, 30] : [60, 120];
  const range = (choice === "wait" ? p.timing.wait?.minutes : p.timing.back?.minutes) ?? fallback;
  const minutes = Math.round(range[0] + minutesRoll * (range[1] - range[0]));
  return { kind: choice, minutes };
}

// ---------- random helpers ----------

export function poisson(rng: Rng, mean: number): number {
  const limit = Math.exp(-mean);
  let k = 0;
  let p = rng();
  while (p > limit) {
    k++;
    p *= rng();
  }
  return k;
}

export function weighted<T>(rng: Rng, items: T[], weight: (t: T) => number): T {
  const total = items.reduce((s, t) => s + weight(t), 0);
  let r = rng() * total;
  for (const t of items) {
    r -= weight(t);
    if (r < 0) return t;
  }
  return items[items.length - 1];
}

function weightedKey(rng: Rng, weights: Partial<Record<string, number>>): string {
  const entries = Object.entries(weights) as [string, number][];
  return weighted(rng, entries, (e) => e[1])[0];
}
