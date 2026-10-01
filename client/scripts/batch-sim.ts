// Runs many shifts headless in Node with a bot playing. No browser needed.
// By default it plays every seed twice, once with a careful bot and once with a careless one, and compares them.
//
//   npm run batch -- --shifts 50
//   npm run batch -- --shifts 200 --reaction 30 --style careful
//   npm run batch -- --shifts 200 --post http://localhost:8080   (stores results in Postgres)

import { createSim, isShiftOver, tick } from "../src/sim/sim";
import { botAct, createBot, type BotStyle } from "../src/sim/bot";
import { report, summarize, type ShiftReport } from "../src/sim/summary";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const shifts = Number(arg("shifts", "100"));
const seed = Number(arg("seed", "1"));
const reaction = Number(arg("reaction", "10"));
const styleArg = arg("style", "both");
const postUrl = arg("post", "");
const DT = 1; // same fixed step as the game

const styles: BotStyle[] = styleArg === "both" ? ["careful", "careless"] : [styleArg as BotStyle];

async function play(style: BotStyle): Promise<ShiftReport[]> {
  const reports: ShiftReport[] = [];
  for (let i = 0; i < shifts; i++) {
    const sim = createSim(seed + i);
    const bot = createBot(reaction, style);
    while (!isShiftOver(sim.state)) {
      botAct(bot, sim.state, DT);
      tick(sim, DT);
    }
    reports.push(report(sim.state));
    if (postUrl) {
      const name = `bot-r${reaction}${style === "careless" ? "-careless" : ""}`;
      const res = await fetch(`${postUrl}/api/shifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(summarize(sim.state, name, "bot")),
      });
      if (!res.ok) throw new Error(`POST failed: ${res.status} ${await res.text()}`);
    }
  }
  return reports;
}

type Row = [label: string, value: (r: ShiftReport) => number | null, format?: (n: number) => string];

const whole = (n: number) => n.toFixed(0);
const ROWS: Row[] = [
  ["score", (r) => r.score, whole],
  ["revenue $", (r) => r.revenueCents / 100, whole],
  ["profit $", (r) => r.profitCents / 100, whole],
  ["avg rating", (r) => r.avgRating, (n) => n.toFixed(2)],
  ["on time %", (r) => r.onTimePct],
  ["mistakes", (r) => r.mistakes.length],
  ["orders taken", (r) => r.ordersTaken],
  ["online orders", (r) => r.webOrders],
  ["picked up", (r) => r.pickups],
  ["self-serve", (r) => r.selfServed],
  ["shipments", (r) => r.shipments],
  ["held pkgs out", (r) => r.packagePickups],
  ["missed truck", (r) => r.missedTruckPackages],
  ["refunds $", (r) => r.refundsCents / 100],
  ["calls answered", (r) => r.callsAnswered],
  ["calls missed", (r) => r.missedCalls],
  ["service+rush fees $", (r) => (r.serviceFeesCents + r.rushFeesCents) / 100, whole],
  ["copier jams", (r) => r.copierJams],
  ["breakdowns", (r) => r.breakdowns],
  ["walkouts + balks", (r) => r.walkouts + r.balks],
  ["turned away", (r) => r.turnedAway],
  ["canceled", (r) => r.canceled],
  ["open at close", (r) => r.leftForTomorrow],
  ["avg line wait min", (r) => r.avgLineWaitMin],
  ["sheets", (r) => r.sheets, whole],
  ["busy %", (r) => r.busyPct],
];

function avg(reports: ShiftReport[], f: Row[1]): number | null {
  const vals = reports.map(f).filter((v): v is number => v !== null);
  return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
}

async function main() {
  const results = new Map<BotStyle, ShiftReport[]>();
  for (const style of styles) results.set(style, await play(style));

  console.log(`${shifts} shifts, seeds ${seed}..${seed + shifts - 1}, bot reaction ${reaction}s`);
  console.log(`${"".padEnd(20)}${styles.map((s) => s.padStart(12)).join("")}`);
  for (const [label, f, fmt] of ROWS) {
    const cells = styles.map((s) => {
      const v = avg(results.get(s)!, f);
      return (v === null ? "n/a" : (fmt ?? ((n: number) => n.toFixed(1)))(v)).padStart(12);
    });
    console.log(`${label.padEnd(20)}${cells.join("")}`);
  }
  if (styles.length === 2) {
    const [a, b] = styles.map((s) => avg(results.get(s)!, (r) => r.score)!);
    console.log(`\ncareless scores ${(100 - (b / a) * 100).toFixed(0)}% lower than careful`);
    const kinds = new Map<string, number>();
    for (const r of results.get("careless")!) for (const m of r.mistakes) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
    console.log(`careless mistakes per shift: ${[...kinds].map(([k, n]) => `${k} ${(n / shifts).toFixed(1)}`).join(", ") || "none"}`);
  }
  if (postUrl) console.log(`posted ${shifts * styles.length} shifts to ${postUrl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
