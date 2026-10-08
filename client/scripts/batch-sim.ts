// Plays whole games headless in Node with a bot, for balancing. No browser needed.
//   npm run batch -- --days 20 --style smart
//   npm run batch -- --days 20 --style all --games 20
//   npm run batch -- --days 20 --style all --post http://localhost:8080   (stores each day in Postgres)
//   npm run batch -- --days 5 --style smart --pace human   (plays at a person's speed: see sim/humanbot.ts)
import { isDayOver, tick } from "../src/sim/sim";
import { BOT_STYLES, botAct, createBot, type BotStyle } from "../src/sim/bot";
import { endDay, newGame, startDay } from "../src/sim/game";
import { summarize } from "../src/sim/summary";
import { createHuman, humanDay } from "../src/sim/humanbot";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const days = Number(arg("days", "20"));
const games = Number(arg("games", "10"));
const seed = Number(arg("seed", "1"));
const styleArg = arg("style", "all");
const postUrl = arg("post", "");
const human = arg("pace", "bot") === "human";
const styles: BotStyle[] = styleArg === "all" ? BOT_STYLES : [styleArg as BotStyle];

interface Row {
  survived: number[]; // days lasted per game (days + 1 = never fired)
  dayCount: number;
  idle: number;
  open: number;
  active: number;
  maxActive: number;
  complaints: number;
  late: number;
  lostSales: number;
  onTime: number;
  revenue: number;
  bizLost: number;
  badSurveys: number;
  overtime: number;
  walkouts: number;
  warnings: number;
  writeUps: number;
  served: number;
  byDay: { days: number; walkouts: number; late: number; served: number; lost: number }[]; // by day number
  byCrew: Record<string, CrewRow>; // by who you worked with
}

// Per coworker: your load and idle time, your time spent (task minutes), their requests, and the days you got
// written up or fired on.
interface CrewRow {
  days: number;
  active: number;
  idle: number;
  open: number;
  busy: number;
  walkouts: number;
  late: number;
  theirServed: number;
  asked: number;
  helped: number;
  mistakes: number;
  writeUps: number;
}

async function run(style: BotStyle): Promise<Row> {
  const row: Row = { survived: [], dayCount: 0, idle: 0, open: 0, active: 0, maxActive: 0, complaints: 0, late: 0, lostSales: 0, onTime: 0, revenue: 0, bizLost: 0, badSurveys: 0, overtime: 0, walkouts: 0, warnings: 0, writeUps: 0, served: 0, byDay: [], byCrew: {} };
  for (let g = 0; g < games; g++) {
    const game = newGame(seed + g * 1000);
    while (!game.fired && game.day <= days) {
      const sim = startDay(game);
      if (human) humanDay(sim, createHuman(style, sim.state.seed));
      else {
        const bot = createBot(1, style, sim.state.seed);
        while (!isDayOver(sim.state)) {
          botAct(bot, sim.state, 1);
          tick(sim, 1);
        }
      }
      const s = sim.state;
      const d = (row.byDay[game.day - 1] ??= { days: 0, walkouts: 0, late: 0, served: 0, lost: 0 });
      d.days++;
      d.walkouts += s.stats.left;
      d.late += s.stats.lateOrders;
      d.served += s.stats.served;
      d.lost += s.stats.left > 0 ? 1 : 0;
      row.dayCount++;
      row.idle += s.stats.idleSeconds;
      row.open += s.closeAt;
      row.active += s.stats.activeSeconds;
      row.maxActive = Math.max(row.maxActive, s.stats.maxActive);
      row.complaints += s.manager.complaints;
      row.late += s.stats.lateOrders;
      row.lostSales += s.stats.lostSales;
      row.walkouts += s.stats.left;
      if (s.wentHome?.onTime) row.onTime++;
      row.revenue += s.revenueCents / 100;
      row.bizLost += s.stats.businessLost;
      row.badSurveys += s.stats.badSurveys;
      row.overtime += s.wentHome?.overtime ?? 0;
      row.served += s.stats.served;
      const k = s.coworker?.name ?? "alone";
      const c = (row.byCrew[k] ??= { days: 0, active: 0, idle: 0, open: 0, busy: 0, walkouts: 0, late: 0, theirServed: 0, asked: 0, helped: 0, mistakes: 0, writeUps: 0 });
      c.days++;
      c.active += s.stats.activeSeconds;
      c.idle += s.stats.idleSeconds;
      c.open += s.closeAt;
      c.busy += s.employee.busySeconds;
      c.walkouts += s.stats.left;
      c.late += s.stats.lateOrders;
      c.theirServed += s.coworker?.stats.served ?? 0;
      c.asked += s.choices.filter((x) => x.what === "coworker").length;
      c.helped += s.choices.filter((x) => x.what === "coworker" && x.type === "do").length;
      c.mistakes += s.mistakes.length;
      const r = endDay(game, sim);
      if (r.outcome === "write_up" || r.outcome === "fired") c.writeUps++;
      if (r.outcome === "warning") row.warnings++;
      if (r.outcome === "write_up" || r.outcome === "fired") row.writeUps++;
      if (postUrl) {
        const res = await fetch(`${postUrl}/api/shifts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(summarize(s, `bot-${style}`, "bot")),
        });
        if (!res.ok) throw new Error(`POST failed: ${res.status} ${await res.text()}`);
      }
    }
    row.survived.push(game.fired ? game.day : days + 1);
  }
  return row;
}

const rows = new Map<BotStyle, Row>();

async function main() {
  console.log(`${games} games per style, up to ${days} days, seeds ${seed}, ${seed + 1000}, ...${human ? ", at a person's pace" : ""}`);
  console.log(["style".padEnd(13), "survived 20", "fired on day (median, range)", "idle %", "avg active", "max", "complaints/day", "late/day", "lost sales/day", "walkouts/day", "revenue $/day", "biz lost/day", "bad surveys/day", "on time %", "overtime s", "warnings", "write-ups", "served/day"].join("  "));
  for (const style of styles) {
    const r = await run(style);
    rows.set(style, r);
    const fired = r.survived.filter((d) => d <= days).sort((a, b) => a - b);
    const firedText = fired.length ? `${fired[Math.floor(fired.length / 2)]} (${fired[0]} to ${fired.at(-1)})` : "never";
    console.log(
      [
        style.padEnd(13),
        `${r.survived.length - fired.length}/${games}`.padStart(11),
        firedText.padStart(28),
        ((r.idle / r.open) * 100).toFixed(1).padStart(6),
        (r.active / r.open).toFixed(2).padStart(10),
        String(r.maxActive).padStart(3),
        (r.complaints / r.dayCount).toFixed(1).padStart(14),
        (r.late / r.dayCount).toFixed(1).padStart(8),
        (r.lostSales / r.dayCount).toFixed(1).padStart(14),
        (r.walkouts / r.dayCount).toFixed(1).padStart(12),
        (r.revenue / r.dayCount).toFixed(0).padStart(13),
        (r.bizLost / r.dayCount).toFixed(2).padStart(12),
        (r.badSurveys / r.dayCount).toFixed(2).padStart(15),
        ((r.onTime / r.dayCount) * 100).toFixed(0).padStart(9),
        (r.overtime / r.dayCount).toFixed(0).padStart(10),
        String(r.warnings).padStart(8),
        String(r.writeUps).padStart(9),
        (r.served / r.dayCount).toFixed(1).padStart(10),
      ].join("  "),
    );
  }
  // v9: by coworker. Your load and idle time, the minutes you spent working, and how each one's days go.
  console.log("\nby coworker: days, your avg load, idle %, your work min/day, walkouts/day, late/day, they served/day, requests/day (you helped), their mistakes/day, write-up days");
  for (const style of styles) {
    const r = rows.get(style)!;
    for (const [name, c] of Object.entries(r.byCrew).sort()) {
      console.log(
        `${style.padEnd(13)} ${name.padEnd(6)} ${String(c.days).padStart(4)}  load ${(c.active / c.open).toFixed(2)}  idle ${((c.idle / c.open) * 100).toFixed(0).padStart(2)}%  work ${(c.busy / c.days).toFixed(0).padStart(3)} min  walkouts ${(c.walkouts / c.days).toFixed(2)}  late ${(c.late / c.days).toFixed(2)}  they served ${(c.theirServed / c.days).toFixed(1)}  requests ${(c.asked / c.days).toFixed(1)} (${(c.helped / c.days).toFixed(1)})  mistakes ${(c.mistakes / c.days).toFixed(1)}  write-ups ${c.writeUps}`,
      );
    }
  }
  if (human) {
    // The spec's targets: days 1 to 3 everything on time and nobody leaving; by day 5, now and then one walks out.
    console.log("\nby day (a person's pace): walkouts per day, share of days with any, late orders per day, served per day");
    for (const style of styles) {
      const r = rows.get(style)!;
      console.log(`${style.padEnd(13)} ${r.byDay.map((d, i) => `day ${i + 1}: ${(d.walkouts / d.days).toFixed(2)} (${Math.round((d.lost / d.days) * 100)}%) late ${(d.late / d.days).toFixed(2)} served ${(d.served / d.days).toFixed(1)}`).join(" | ")}`);
    }
  }
  if (postUrl) console.log(`posted every day to ${postUrl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
