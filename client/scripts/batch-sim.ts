// Runs many shifts headless in Node with a bot playing. No browser needed.
//
//   npm run batch -- --shifts 200 --seed 1 --reaction 10
//   npm run batch -- --shifts 200 --post http://localhost:8080   (stores results in Postgres)

import { createSim, isShiftOver, tick } from "../src/sim/sim";
import { botAct, createBot } from "../src/sim/bot";
import { report, summarize, type ShiftReport, type ShiftSummary } from "../src/sim/summary";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const shifts = Number(arg("shifts", "100"));
const seed = Number(arg("seed", "1"));
const reaction = Number(arg("reaction", "10"));
const postUrl = arg("post", "");
const DT = 1; // same fixed step as the game

async function main() {
  const reports: ShiftReport[] = [];

  for (let i = 0; i < shifts; i++) {
    const sim = createSim(seed + i);
    const bot = createBot(reaction);
    while (!isShiftOver(sim.state)) {
      botAct(bot, sim.state, DT);
      tick(sim, DT);
    }
    reports.push(report(sim.state));
    const summary: ShiftSummary = summarize(sim.state, `bot-r${reaction}`, "bot");

    if (postUrl) {
      const res = await fetch(`${postUrl}/api/shifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(summary),
      });
      if (!res.ok) throw new Error(`POST failed: ${res.status} ${await res.text()}`);
    }
  }

  const avg = (f: (r: ShiftReport) => number | null) => {
    const vals = reports.map(f).filter((v): v is number => v !== null);
    return vals.length ? (vals.reduce((a, v) => a + v, 0) / vals.length).toFixed(1) : "n/a";
  };
  console.log(`${shifts} shifts, seeds ${seed}..${seed + shifts - 1}, bot reaction ${reaction}s`);
  console.log(`revenue / profit     $${avg((r) => r.revenueCents / 100)} / $${avg((r) => r.profitCents / 100)}`);
  console.log(`orders (online)      ${avg((r) => r.ordersTaken)} (${avg((r) => r.webOrders)})`);
  console.log(`pickups              ${avg((r) => r.pickups)}`);
  console.log(`self-serve           ${avg((r) => r.selfServed)} ($${avg((r) => r.selfServeRevenueCents / 100)})`);
  console.log(`service / rush fees  $${avg((r) => r.serviceFeesCents / 100)} / $${avg((r) => r.rushFeesCents / 100)}`);
  console.log(`shipments            ${avg((r) => r.shipments)} ($${avg((r) => r.shippingRevenueCents / 100)})`);
  console.log(`drop-off pkgs / held ${avg((r) => r.dropoffPackages)} / ${avg((r) => r.packagePickups)} picked up`);
  console.log(`missed truck / refund ${avg((r) => r.missedTruckPackages)} / $${avg((r) => r.refundsCents / 100)}`);
  console.log(`calls ans / missed   ${avg((r) => r.callsAnswered)} / ${avg((r) => r.missedCalls)} (${avg((r) => r.quoteLeads)} online orders from quotes)`);
  console.log(`copier jams / gave up ${avg((r) => r.copierJams)} / ${avg((r) => r.copierGaveUp)}`);
  console.log(`breakdowns / recalls ${avg((r) => r.breakdowns)} / ${avg((r) => r.recalls)} (${avg((r) => r.wastedSheets)} sheets ruined in jams)`);
  console.log(`on time              ${avg((r) => r.onTimePct)}%`);
  console.log(`avg line wait        ${avg((r) => r.avgLineWaitMin)} min`);
  console.log(`avg rating           ${avg((r) => r.avgRating)}`);
  console.log(`walkouts / balks     ${avg((r) => r.walkouts)} / ${avg((r) => r.balks)}`);
  console.log(`turned away / cancel ${avg((r) => r.turnedAway)} / ${avg((r) => r.canceled)}`);
  console.log(`open at close        ${avg((r) => r.leftForTomorrow)}`);
  console.log(`sheets / jams        ${avg((r) => r.sheets)} / ${avg((r) => r.jams)}`);
  console.log(`you were busy        ${avg((r) => r.busyPct)}%`);
  console.log(`score                ${avg((r) => r.score)}`);
  if (postUrl) console.log(`posted ${shifts} shifts to ${postUrl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
