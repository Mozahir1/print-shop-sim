// Seeded random number generator (mulberry32).
// Same seed = same shift every time. Needed for daily challenges and batch balancing runs.
// Never use Math.random() inside src/sim/.

export type Rng = () => number; // returns float in [0, 1)

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function pick<T>(rng: Rng, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

// A roll keyed by what it's for (e.g. seed, "mood", customer id, choice number) instead of drawn from a stream.
// Used for "usually" outcomes of your choices: the same choices always get the same results, and making a choice
// never shifts any other system's rolls.
export function keyedRoll(...keys: (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const k of keys) {
    const str = String(k);
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 0xff, 0x01000193);
  }
  return createRng(h >>> 0)();
}
