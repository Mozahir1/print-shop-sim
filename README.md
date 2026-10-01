# Print Shop Sim

A print and ship shop simulation. You work the counter alone for an 8-hour shift (9 AM to 5 PM). Customers order
prints, pick them up, use the self-serve copiers, ship packages, and call. You take the orders, run the machines, carry
the work from printer to finishing table to pickup shelf, and keep the place stocked. Every action takes time, you can
only do one thing at once, and you only know what you've gone and looked at. It's a faithful, fairly uneventful job sim;
the satire comes later, on top of sound mechanics.

**Stack:** TypeScript (game + simulation engine), Spring Boot (REST API), PostgreSQL (storage + analytics views),
Docker, GitHub Actions.

## Playing

The store floor is the screen. **Click anything** (a printer, a copier, the register, the phone, the counter, the
finishing table, the pickup shelf, the package room, the stockroom, or a customer at the counter) to walk there and see
what you can do. Greyed-out actions tell you why on hover. The top bar has the wall clock, what you're doing (with a Stop
button), what's in your hands, your notepad, and the speed controls.

### Controls

| | |
|---|---|
| Click an object | walk there and open its menu |
| Click the register | the computer |
| Click the stockroom | the stockroom shelves |
| Notepad | what you've seen (and how long ago), your order tickets, your own notes. Free to look at. |
| Space | pause |
| 1 to 4 | 1×, 10×, 30×, 60× speed |
| Escape | close a menu or station |

### A shift

- **The counter.** Customers line up to order, pick up, ship, drop off returns, or collect held packages. Click the one
  at the counter to hear what they want, in their words. Print orders go into the **POS** on the computer: you enter the
  specs yourself (it defaults to plain letter, B&W, single-sided), so enter what they asked for. Simple jobs on regular
  paper can go to the self-serve copiers, which are cheaper for them; most customers take themselves there.
- **The computer** only knows what's been entered. The **POS** knows what was ordered, sent, and paid, not whether it's
  printed or shelved. The **inbox** gets online orders (you can't print one until you've opened it) and customer
  emails. The **print server** is where you set each job's settings and send it to a printer, reorder or cancel queued
  jobs, and recall stuck ones; it shows printer error codes, never paper or toner levels. **Shipping** lists the labels
  printed today; **voicemail** has the calls you missed, to call back. App screens are snapshots: refresh to update.
- **The job path.** A printer fills its output tray (500 sheets narrow format, 20 wide); a full tray stops it. Collect
  the output, carry it to the finishing table, finish and bag it, carry the bag to the pickup shelf and file it under the
  customer's name. Ring-up fetches it from the shelf.
- **Your hands.** One thing at a time: a case of paper, a toner or ink, a roll, a box, a stack of output, a bagged order,
  or packages. Paper, toner, rolls, and boxes come from the stockroom; you carry them to where they go and put back what's
  left. Counter work needs empty hands (set things down on the counter).
- **Looking.** You don't see tray levels, toner, the stockroom, the shelf, or the package room unless you go and check;
  what you saw goes stale. Doing work somewhere also shows you what's there. From across the room a printer or copier
  only shows a light: green while it runs, blinking red when it has stopped.
- **Shipping.** Weigh and ship at the scale (bring the right box if it needs one), take drop-offs, check in the morning
  delivery, and hand out held packages. Every outgoing package has to go in the outbound bin in the package room. The
  carrier truck comes once, at 4:15 PM, and waits 10 minutes: anything not handed off misses it, and missed express
  packages are refunded.
- **The phone** rings for 30 seconds, then goes to voicemail. You can't pick up mid-transaction. Quote calls you answer
  (or call back) often turn into online orders.
- **Machines.** Printers jam (a jam ruins a few sheets), run out of paper and toner, and occasionally break until a
  technician comes; recall their jobs and send them elsewhere. Self-serve copiers jam and run out of paper too, and the
  customer using one will come tell you.
- **Pricing.** Full service is the price list plus a $2 service fee, unless the printing is over $50; orders over $50
  needed the same day add a 10% rush fee. Self-serve is cheaper and has no fees.

### Mistakes

They happen, they're deterministic (no random "mistake rolls"), and they cost you. The shift report lists the ones you
made.

| Mistake | What happens |
|---|---|
| Wrong settings in the POS or print server | The customer refuses it at pickup; you reprint at your cost while they wait; stars lost |
| Wrong paper in a tray | Jobs from that tray print on it; same as above |
| Output left in a tray | It fills up behind the next job and stops the printer |
| Order shelved under the wrong name | A long search at ring-up; a star lost |
| Package never put in the outbound bin | It misses the truck |
| Missed the truck | Express packages refunded |
| Online order never opened | It starts late, maybe misses its time |
| Took an order you couldn't fill | It gets stuck mid-job |

**Score** is gross profit times customer satisfaction squared, so unhappy customers cost a lot.

## How it's built

```
client/
  src/sim/          Pure simulation. No DOM, so it runs in the browser AND headless in Node.
    sim.ts          tick() loop, the task system (canStart/startTask/stopTask/previewTask), printers, customers, self-serve
    knowledge.ts    what the player knows: snapshots of what they've seen, with when they saw it
    computer.ts     the register computer: POS, inbox, print server, shipping, voicemail (and app snapshots)
    hands.ts        carrying things, checking things, output trays to shelf, staging packages, the counter
    shipping.ts     shippers, drop-offs, held packages, the morning delivery and the carrier truck
    inventory.ts    the stockroom: back stock and paper shortfall checks
    phone.ts        calls, voicemail, and quote calls that turn into online orders
    upkeep.ts       copier paper and jams, printer breakdowns and the technician, recalling jobs
    orders.ts       order math: sheets, prices and fees, materials cost, finishing time, descriptions
    schedule.ts     generates the day's customers from the seed (arrival curve, orders, patience)
    bot.ts          an automated employee (careful or careless) that plays on true state
    config.ts       all tuning numbers
    layout.ts       the store floor plan, in meters
    util.ts         shared helpers (log, walking, lookups, the counter line, mistakes)
    testkit.ts      test helpers that do things the long way (fetch, collect, finish, shelve)
    dev.ts          dev mode actions
  src/data/         customer order profiles as JSON
  src/ui/           floor canvas + menus (floor.ts), the computer, stockroom and notepad views, dev tools,
                    and the true-state dashboard for dev mode (panel.ts)
  scripts/batch-sim.ts   runs bot shifts for balancing: careful vs. careless
server/             Spring Boot API (JdbcTemplate, plain SQL), Flyway migrations
docker-compose.yml  Postgres + API
```

Key design decisions:
- **Deterministic simulation.** The day's customers, calls, shipments, and stockroom are generated from the seed up
  front, each system on its own RNG stream, so adding a system never changes what the others roll. Looking at things
  never consumes randomness. The sim steps in fixed 1-second increments. Same seed + same inputs = same shift.
- **The sim knows everything; the player doesn't.** Every check, app screen, and piece of work writes a snapshot of
  what you saw; the UI shows snapshots, never live state (except in dev mode).
- **You are the bottleneck.** Every action is a task: walk to the station, then work for a while. Walking is real
  (including to the stockroom and back). Finishing work and walks can be interrupted; progress is kept.
- **Data-driven content.** New customer/order types are JSON entries, not code.
- **Balance with data.** Bots play hundreds of shifts; results can go into Postgres where SQL views show what's broken.

## Run it

```bash
# 1. The game (works offline on its own)
cd client
npm install
npm run dev                  # http://localhost:5173

# 2. Backend: Postgres + API (no Java or Maven needed, Docker builds it)
docker compose up --build    # http://localhost:8080/api/health

# 3. Balancing: careful vs. careless bots on the same seeds (optionally stored in Postgres)
cd client
npm run batch -- --shifts 50
npm run batch -- --shifts 500 --post http://localhost:8080
curl localhost:8080/api/stats/bots
```

Running the server from your IDE instead: `docker compose up -d db`, then run `ServerApplication`.

Checks: `cd client && npm run typecheck && npm test && npm run build`

### Dev mode

Press <kbd>`</kbd> (backtick) to open the dev drawer. It's always available under `npm run dev`; in a production build
add `?dev` to the URL. `?seed=N` plays a specific day (e.g. `http://localhost:5173/?dev&seed=42`). While the drawer is
open, the page also shows the **true state**: every order, machine, tray, stockroom count, and the full event log.

- **Time:** 120× / 300× / 1200× speeds, step +1 or +15 minutes, skip to any hour
- **Autoplay:** let the bot work the shift (a red "Bot is playing" chip shows while it does)
- **Spawn:** print customers (with self-serve preference), shippers, drop-offs, package pickups, phone calls, the truck
- **Break things:** jam a printer or copier, break a printer, empty a tray, drop toner; or restock everything
- **State:** copy the full state as JSON, or use `window.sim` in the console

Anything that changes the shift (and a hand-picked seed) marks it as dev-assisted: it can't be submitted.

## API

| Method | Path | What |
|---|---|---|
| GET  | /api/health | health check |
| GET  | /api/daily-seed | same shift for everyone today |
| POST | /api/shifts | save a finished shift + its jobs (one transaction) |
| GET  | /api/leaderboard?limit=10 | top human shifts |
| GET  | /api/stats/customer-types | abandon rate, wait time, revenue per customer type |
| GET  | /api/stats/bots | score by bot setting |

## Balancing

`npm run batch -- --shifts 100` (seeds 1 to 100, both bots reacting every 10 s of sim time):

| | careful | careless |
|---|---|---|
| Score | 3,759 | 2,889 (23% lower) |
| Profit | $4,440 | $3,957 |
| Avg rating | 4.69 | 4.42 |
| Ready on time | 92% | 75% |
| Mistakes per shift | 0 | 11.7 |
| Busy | 78% of the shift | 77% |

The careful bot enters every order correctly, keeps on top of the inbox and the output trays, and stages every package.
The careless one ignores the inbox until something's late, collects output only when a printer stops, forgets
"double-sided" on some orders, and sets packages down instead of staging them.

## Ideas / roadmap

- [ ] Anti-cheat: server replays the seed with the player's recorded inputs instead of trusting the client score
- [ ] Coworkers with their own state machines (on break, "on break", hiding in the back)
- [ ] Multi-day play
- [ ] Sprites and a Tiled map once the gameplay is fun
- [ ] Deploy: client on Vercel/Netlify, API + DB on Render/Fly.io
