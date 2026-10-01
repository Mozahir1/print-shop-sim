# Print Shop Sim

A print shop simulation. You work the counter alone for an 8-hour shift (9 AM to 5 PM): take orders, send
them to the right printer, finish and bag them, ring customers up, and keep the machines fed with paper and
toner. Every action takes time and you can only do one thing at once. Right now the goal is a faithful,
fairly uneventful job sim; the satire comes later, on top of sound mechanics.

**Stack:** TypeScript (game + simulation engine), Spring Boot (REST API), PostgreSQL (storage + analytics
views), Docker, GitHub Actions.

## How it's built

```
client/
  src/sim/        Pure simulation. No DOM, so it runs in the browser AND headless in Node.
    sim.ts        tick() loop + your tasks: counter, printers (speed, paper, toner, jams), customers, self-serve
    shipping.ts   shippers, drop-offs, held packages, the morning delivery and the carrier truck
    inventory.ts  the stockroom: back stock, fetch walks, paper shortfall checks
    phone.ts      calls, voicemail, and quote calls that turn into web orders
    upkeep.ts     copier paper and jams, printer breakdowns and the technician, recalling jobs
    util.ts       shared helpers (log, walking, lookups, the counter line)
    schedule.ts   generates the day's customers from the seed (arrival curve, orders, patience)
    orders.ts     order math: sheets, price, materials cost, finishing time, descriptions
    bot.ts        an automated employee with a configurable reaction time
    config.ts     all tuning numbers (hours, arrival rates, printers, price list, task durations)
    layout.ts     the store floor plan, in meters
  src/data/       customer order profiles as JSON
  src/ui/         floor canvas + panels (you, counter, orders, machines, activity log)
  scripts/batch-sim.ts   runs thousands of bot shifts for balancing
server/           Spring Boot API (JdbcTemplate, plain SQL), Flyway migrations
  src/main/resources/db/migration/
    V1__init.sql             shifts + jobs tables
    V2__analytics_views.sql  leaderboards (window functions), customer stats, bot balance
    V3__ready_outcome.sql    jobs can end the shift finished but not picked up
docker-compose.yml          Postgres + API
```

Key design decisions:
- **Deterministic simulation.** The whole day's customers are generated from the seed up front, and each system
  has its own RNG stream (print customers, machines, shipping, stockroom, phone, upkeep), so adding a system never
  changes what the others roll. The sim steps in fixed 1-second increments.
  Same seed + same inputs = same shift. That powers the daily challenge and makes tests reliable.
- **You are the bottleneck.** Every action is a task with a duration (walk to the station, then work).
  Finishing work can be interrupted to help the counter; progress is kept.
- **Data-driven content.** New customer/order types are JSON entries, not code.
- **Balance with data.** The bot plays thousands of shifts, results go into Postgres, and SQL views show
  what's broken.

## Run it

```bash
# 1. The game (works offline on its own)
cd client
npm install
npm run dev                  # http://localhost:5173

# 2. Backend: Postgres + API (no Java or Maven needed, Docker builds it)
docker compose up --build    # http://localhost:8080/api/health

# 3. Balancing: simulate 500 shifts at three bot skill levels and store them
cd client
npm run batch -- --shifts 500 --reaction 10 --post http://localhost:8080
npm run batch -- --shifts 500 --reaction 30 --post http://localhost:8080
npm run batch -- --shifts 500 --reaction 90 --post http://localhost:8080
curl localhost:8080/api/stats/bots
curl localhost:8080/api/stats/customer-types
```

Running the server from your IDE instead: `docker compose up -d db`, then run `ServerApplication`.

Tests: `cd client && npm test`

### Shipping

The shipping counter (`src/sim/shipping.ts`) brings three more kinds of customer, generated on their own RNG stream:
shippers (1 to 40 lb, ground / two-day / overnight, packed or needing a box), drop-offs (1 to 3 prepaid returns, no
charge) and people collecting a package we're holding. They all use the same line as print customers.

- **Ship package** at the scale: 150 s, plus 2 to 5 min to box it. The customer pays the retail rate (plus a packing fee
  if we box it); 70% of the rate goes to the carrier as cost. Shipping pays less than printing but takes your time.
- **Accept drop-off**: quick, no revenue, adds to the outbound bins.
- **Check in the delivery**: the morning delivery (about 6 packages) arrives unsorted. Owners who come in before you've
  checked it in have to wait in line until you do.
- **Release package**: hand a held package to its owner.
- **Hand off to the driver**: the carrier truck comes at 4:15 PM and waits 10 minutes. Anything still staged when it
  leaves misses it: two-day and overnight packages are refunded, ground just goes tomorrow. An express package shipped
  after the truck left costs that customer a star.

### Stockroom

Paper, toner, ink, wide format rolls and shipping boxes come out of the stockroom (`src/sim/inventory.ts`), with
starting levels rolled per shift. Loading paper takes what the tray needs (or whatever's left), swapping toner uses a
cartridge, boxing a shipment uses a box, and refilling a self-serve copier uses letter paper. Each of those tasks
includes the walk to the stockroom and back. Rolls are changed when they run out, not before. There are no deliveries
during a single shift, so the counter estimate warns when a new order needs more paper than you have, and when every
printer that could do it is out of toner with no spare. (Supply ordering exists for a future career mode and is
disabled in a single shift.)

### Phone

Calls (`src/sim/phone.ts`) come 1.5 to 2.5 an hour, busiest at lunch: price quotes, order status, store hours, and
shipping rates. Each rings for 30 seconds and then goes to voicemail. You can't pick up mid-transaction at the counter,
but you can put finishing work down for it, and if you're on your way to it, it keeps ringing. About half of answered
quote calls turn into a web order 10 to 90 minutes later. The game pauses when the phone rings by default (a call is
over in a second at 30×); turn that off in the header.

### Machine upkeep

- **Self-serve copiers** hold 1,500 sheets and jam now and then. They copy progressively, so one can stop mid-job
  with the customer standing there. Clear the jam or refill it before they run out of patience, or they leave without
  paying (`copier_gave_up`).
- **Printer breakdowns:** each production printer has about a 6% chance a day of an error you can't clear. A
  technician comes 2 to 4 hours later and takes 30 to 90 minutes.
- **Recall:** pull a queued or stuck job off a printer (keeping what's already printed) and send it to another one.
- **Jam waste:** every production jam ruins 1 to 5 sheets that have to be printed again.

### Self-serve

Two self-serve copiers sit on the shop floor. Any narrow format job (letter, legal, tabloid; B&W or color; any length)
on regular 20 lb bond can be done there; stapling is fine. Cardstock, wide format, and folding/cutting/laminating/binding
need the counter, and so do drop-offs (customers coming back later). Most eligible walk-ins go straight to a copier
(`SELF_SERVE.goesAlone`), some come to the counter and need to be shown over (`needsHelp`, the "Send to self-serve"
button), and the rest want full service. Self-serve has its own, lower price list (`SELF_SERVE_PER_SIDE`); full service is
the regular price list. There's no page limit, so a long job ties up a copier and the people queued behind it lose
patience and stars, eventually giving up and getting in line at the counter.

### Dev mode

Press <kbd>`</kbd> (backtick) to open the dev drawer. It's always available under `npm run dev`; in a production
build add `?dev` to the URL. `?seed=N` plays a specific day (e.g. `http://localhost:5173/?dev&seed=42`).

- **Time:** 120× / 300× / 1200× speeds, step +1 or +15 minutes, skip to any hour
- **Autoplay:** let the bot work the shift (adjustable reaction time), including while skipping
- **Customers:** send in a customer of any profile now, forcing wait / come back / tomorrow, or as a web order
- **Shortcuts:** finish your current task, finish a print job, jam a printer, empty a tray, drop toner to 5%, restock everything
- **Inspector:** upcoming arrivals, line patience left, when seated customers give up, printer internals (queue, sheets until the next jam)
- **State:** copy the full state as JSON, log it to the console; the live sim is on `window.sim`

Any of these (and a hand-picked seed) mark the shift as dev-assisted: a DEV badge shows and the score can't be submitted.
The dev actions live in `src/sim/dev.ts` (pure, tested in `dev.test.ts`); the drawer is `src/ui/dev.ts`.

## API

| Method | Path | What |
|---|---|---|
| GET  | /api/health | health check |
| GET  | /api/daily-seed | same shift for everyone today |
| POST | /api/shifts | save a finished shift + its jobs (one transaction) |
| GET  | /api/leaderboard?limit=10 | top human shifts |
| GET  | /api/stats/customer-types | abandon rate, wait time, revenue per customer type |
| GET  | /api/stats/bots | score by bot reaction time |

## Balancing

Bot employee, 100 seeded shifts (`npm run batch -- --shifts 100`), reaction time 10s: about 32 orders a day
(8 of them web), 92% ready on time, 4.7 average rating, 3 turned away, busy about 69% of the shift. At 90s
reaction it degrades gradually (85% on time) rather than collapsing, which is what a real job feels like.

## Ideas / roadmap

- [ ] Anti-cheat: server replays the seed with the player's recorded inputs instead of trusting the client score
- [ ] Coworkers with their own state machines (on break, "on break", hiding in the back)
- [ ] More machines: binding, lamination, shipping scale
- [ ] Sprites and a Tiled map (Phaser) once the gameplay is fun
- [ ] Deploy: client on Vercel/Netlify, API + DB on Render/Fly.io
