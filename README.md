# Print Shop Sim

A low-stress job game about a print and ship shop. You work the counter. Customers come in, you decide how to deal
with them, and the day ends. Then another one starts. The job isn't hard: the game is about **choices and what they
lead to**. Do it properly and nothing happens (you get a pizza party coupon, expired). Stop caring and it adds up, and
eventually you get fired. The main character never changes, whatever you do.

**Stack:** TypeScript (game + simulation engine), Spring Boot (REST API), PostgreSQL (storage + analytics views),
Docker, GitHub Actions.

## Playing

The screen is the counter. In the middle is whoever is at the counter, what they said, and your answers. On the left
are the stations (Computer, Printer, Finishing, Self-serve, Shipping); click one to see everything you can do there.
On the right is the to-do list: the obvious next things, with the proper way to handle each one first. The top bar has
the clock, what you're doing (with a Stop button), and the speed.

### Controls

| | |
|---|---|
| Talk to someone, then pick an answer | Proper, Minimum, Rude, or Ignore. Not answering for 12 seconds counts as Ignore. |
| Click a station | its tasks, including the lazy shortcuts (dashed buttons) |
| Click a to-do item | start it (alternatives sit next to it) |
| Space | pause |
| 1 to 3 | 1×, 2×, 4× speed (a day is about 5 minutes at 1×) |
| Escape | close the station panel |

### A day

- **Customers** want quick copies, a bigger print job (some wait, some come back later), a poster laminated, a box
  shipped, a drop-off scanned, an order or a held package picked up, or help at the self-serve copier. Online orders
  land in the inbox. A flow director brings people in so there's always one obvious thing to do and rarely more than
  three, about 12 customers a day. Later days lean toward requests with more steps.
- **Every action is a short task** (2 to 10 seconds): enter the order, send it to the printer, collect it, staple or
  cut or laminate it, bag it, ring them up. Weigh, pack, label, bin. The clock keeps running while you work and talk.
- **Choices.** At the counter: Proper, Minimum, Rude, Ignore. In the work: reprint smudged copies or hand them over
  anyway, fix the copier or tape a sign on it, pack a box or just tape it shut, open a web order or leave it unread,
  hand packages to the driver or let them leave. The lazy option is always faster.
- **Mood.** Proper makes people happy, Minimum usually leaves them neutral, Rude usually makes them angry, Ignore makes
  them wait. Waiting too long, or getting smudged copies or a taped-up box, makes it worse. Patience is generous.
- **Bad luck,** about once a day: the printer jams, the self-serve copier dies, the card reader goes down, a box rips,
  the Wi-Fi drops. Each one is obvious and takes a task or two to fix (or work around, or ignore).
- **Consequences.** Angry customers usually complain, and complaints reach your manager. Rudeness turns into online
  reviews. Taped boxes come back damaged a day or two later; smudged copies come back too; packages left in the bin
  are a complaint the next day. At close the manager reacts: nothing, a warning, or a write-up. Three write-ups and
  you're fired, with an ending that depends on why. A day with no complaints gets a hollow reward the next morning.
- **Between days** only a few things carry over: the day number, the manager's mood, write-ups, things still coming
  back, orders not picked up, and packages that didn't go out. The game saves between days (Continue on the start
  screen).

## How it's built

```
client/
  src/sim/          Pure simulation. No DOM, so it runs in the browser AND headless in Node.
    sim.ts          tick() loop, the task system (canStart/startTask/stopTask/previewTask), the printer, the truck
    director.ts     the flow director: who comes in when, keeping the load in a band
    customers.ts    spawning customers, their requests, orders and web orders
    mood.ts         choices, customer mood, patience
    consequences.ts manager heat, complaints, delayed flags, hollow rewards
    events.ts       the day's bad luck
    game.ts         a run of days: what carries over, the manager's verdict, endings, saves
    todo.ts         the to-do list and what counts as "active"; tasks available at each station
    mc.ts, lines.ts the MC's monologue and customer lines, picked from tagged JSON
    bot.ts          an automated employee with a playstyle (proper, minimum, rude, ignore, lazy, random)
    summary.ts      the end-of-day report and the summary posted to the server
    orders.ts       sheets and prices; config.ts all tuning numbers; rng.ts seeded randomness
    dev.ts          dev mode actions
  src/data/         all text: mc.json, customers.json, messages.json, events.json, endings.json, names.json
  src/ui/           view.ts (the counter view, stations, to-do list, screens), dev.ts (dev drawer)
  scripts/batch-sim.ts   plays whole games with bots, for balancing
server/             Spring Boot API (JdbcTemplate, plain SQL), Flyway migrations
docker-compose.yml  Postgres + API
```

Key design decisions:
- **Deterministic.** Each day's seed is the game's base seed plus the day number. Every system rolls from its own
  stream (arrivals, paper, bad luck, dev spawns). Outcomes of your choices ("usually angry") are keyed rolls, so making
  a choice never shifts anything else, and the same choices always give the same day.
- **The task system** is the only way to act, for the player and the bot alike. `canStart()` says in plain English
  why something can't be done.
- **The flow director replaces a schedule.** It counts active things (each customer request once, packages still to
  bin, the truck, bad luck that needs you) and brings in the next customer when there's room. Bad luck and the truck
  wait for room too.
- **Hidden meters.** Manager heat is never shown as a number, only through messages, the report's tone line, and the
  manager's verdict. Dev mode shows the true state.
- **Content is data.** Lines are tagged (`moment`, `request`, `mood`, `cause`, ...); a line fits when its tags match,
  and the most specific wins. Customer traits and coworkers can be added as tags without code changes.

## Run it

```bash
# 1. The game (works offline on its own)
cd client
npm install
npm run dev                  # http://localhost:5173

# 2. Backend: Postgres + API (no Java or Maven needed, Docker builds it)
docker compose up --build    # http://localhost:8080/api/health

# 3. Balancing: bot playstyles over whole games (optionally stored in Postgres)
cd client
npm run batch -- --days 20 --style all
npm run batch -- --days 20 --style lazy --games 20
npm run batch -- --days 20 --style all --post http://localhost:8080
curl localhost:8080/api/stats/bots
```

Running the server from your IDE instead: `docker compose up -d db`, then run `ServerApplication`.

Checks: `cd client && npm run typecheck && npm test && npm run build`

### Dev mode

Press <kbd>`</kbd> (backtick) to open the dev drawer. It's always available under `npm run dev`; in a production build
add `?dev` to the URL. `?seed=N` sets the game's base seed. The drawer shows the true state: heat, write-ups, flags
coming due, the director's band and next arrival, and today's bad luck. It can trigger any bad luck event, send in any
kind of customer, hold arrivals, skip to the end of the day, run at 10× or 30×, and let a bot play in any style.
Anything that changes the day marks it as dev-assisted, and it isn't posted to the leaderboard.

## API

| Method | Path | What |
|---|---|---|
| GET  | /api/health | health check |
| GET  | /api/daily-seed | same seed for everyone today (not used by the game right now) |
| POST | /api/shifts | save a finished shift + its jobs (one transaction) |
| GET  | /api/leaderboard?limit=10 | top human shifts |
| GET  | /api/stats/customer-types | abandon rate, wait time, revenue per customer type |
| GET  | /api/stats/bots | score by bot setting |

## Balancing

`npm run batch -- --days 20 --style all --games 20` (bots react every second):

| style | survived 20 days | fired on day (median, range) | idle | complaints/day | warnings | write-ups |
|---|---|---|---|---|---|---|
| proper | 20/20 | never | 0.6% | 0.0 | 0 | 0 |
| minimum | 20/20 | never | 1.5% | 2.2 | 262 | 2 |
| lazy | 0/20 | 10 (6 to 16) | 1.7% | 0.8 | 120 | 60 |
| rude | 0/20 | 3 (3 to 3) | 2.3% | 9.5 | 0 | 60 |
| ignore | 0/20 | 4 (3 to 4) | 0.0% | 3.8 | 16 | 60 |
| random | 0/20 | 4 (3 to 5) | 1.3% | 3.9 | 13 | 60 |

The load never goes above 3 things at once for any style. Lazy answers people properly but takes every shortcut on
the work, so what gets it fired is the stuff that comes back: damaged boxes, smudged copies, packages left behind.

The server stores each day as a shift: score = customers served, cash = the day's revenue, satisfaction = share of
customers who left happy, customers lost = angry customers, jams = bad luck events.

## Ideas / roadmap

- [ ] Coworkers and the manager as an on-screen character
- [ ] Customer personalities and trait-based dialogue, regulars
- [ ] Story, art, sound
- [ ] Anti-cheat: server replays the seed with the player's recorded inputs instead of trusting the client
