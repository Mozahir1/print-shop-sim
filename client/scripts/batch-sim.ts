// Plays whole games headless in Node with a bot, for balancing. No browser needed.
//   npm run batch -- --days 20 --style smart
//   npm run batch -- --days 20 --style all --games 20
//   npm run batch -- --days 20 --style all --post http://localhost:8080   (stores each day in Postgres)
import { isDayOver, tick } from "../src/sim/sim";
import { BOT_STYLES, botAct, createBot, type BotStyle } from "../src/sim/bot";
import { endDay, newGame, startDay } from "../src/sim/game";
import { summarize } from "../src/sim/summary";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const days = Number(arg("days", "20"));
const games = Number(arg("games", "10"));
const seed = Number(arg("seed", "1"));
const styleArg = arg("style", "all");
const postUrl = arg("post", "");
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
  warnings: number;
  writeUps: number;
  served: number;
}

async function run(style: BotStyle): Promise<Row> {
  const row: Row = { survived: [], dayCount: 0, idle: 0, open: 0, active: 0, maxActive: 0, complaints: 0, late: 0, lostSales: 0, warnings: 0, writeUps: 0, served: 0 };
  for (let g = 0; g < games; g++) {
    const game = newGame(seed + g * 1000);
    while (!game.fired && game.day <= days) {
      const sim = startDay(game);
      const bot = createBot(1, style, sim.state.seed);
      while (!isDayOver(sim.state)) {
        botAct(bot, sim.state, 1);
        tick(sim, 1);
      }
      const s = sim.state;
      row.dayCount++;
      row.idle += s.stats.idleSeconds;
      row.open += s.closeAt;
      row.active += s.stats.activeSeconds;
      row.maxActive = Math.max(row.maxActive, s.stats.maxActive);
      row.complaints += s.manager.complaints;
      row.late += s.stats.lateOrders;
      row.lostSales += s.stats.lostSales;
      row.served += s.stats.served;
      const r = endDay(game, sim);
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

async function main() {
  console.log(`${games} games per style, up to ${days} days, seeds ${seed}, ${seed + 1000}, ...`);
  console.log(["style".padEnd(13), "survived 20", "fired on day (median, range)", "idle %", "avg active", "max", "complaints/day", "late/day", "lost sales/day", "warnings", "write-ups", "served/day"].join("  "));
  for (const style of styles) {
    const r = await run(style);
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
        String(r.warnings).padStart(8),
        String(r.writeUps).padStart(9),
        (r.served / r.dayCount).toFixed(1).padStart(10),
      ].join("  "),
    );
  }
  if (postUrl) console.log(`posted every day to ${postUrl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
