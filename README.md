# Print Shop Sim

A low-stress job game about a print and ship shop. You work the counter. Customers come in, you decide how to deal
with them, and the day ends. Then another one starts. The job isn't hard: the game is about **choices and what they
lead to**. Every choice is Do, Don't, or Ignore. The manager cares about the work getting done and sales, not
manners. Do it well and nothing happens (you get a pizza party coupon, expired). Ignore people, let orders run late,
cut corners, or turn away business you could have done, and it adds up until you get fired. The main character never
changes, whatever you do.

**Stack:** TypeScript (game + simulation engine), Spring Boot (REST API), PostgreSQL (storage + analytics views),
Docker, GitHub Actions.

## Playing

**First person.** You stand behind the counter. The customer across from you says what they want in a textbox, one
line at a time: the item and how many, the pages, color, sides, paper, finishing, and when they need it (or the
shipping service, or the name an order's under). The clock stops while they talk. "What was that?" has them say it
again, at the cost of a moment and a bit of their patience. Then Do (take it, rush it, or send them to self-serve),
Don't (turn them away), or Ignore. Under the textbox: the price with fees, when it could be ready, and how much of
**your** time it takes.

**You do the work by hand, on the actual things.** The game is a 2D scene (Phaser, pixel art drawn at 2x on a
1280x720 screen that scales to fit). The tabs along the bottom are the stations: Counter, Computer, Printer, Finishing,
Shipping, Pickup Shelf; the view slides to each step's station by itself. You pick up the real objects and put them
where they go: tap the ream, then tap the tray (or drag it there). What you're holding follows the pointer and shows
in the top bar; tap it there to put it back. You also hold a tool over something (the tape gun across the flaps, the
cutter, the laminator; letting go pauses, it never fails), tap things (jammed sheets, each set to staple, packing
paper), pick by looking (the box that fits, the bag with their name on the shelf), and type on the register's keypad.
Forms (the order form on the monitor, the shipping label) are real typing. Tap a station's object to start what it's
for, or use the in-world buttons. Nothing tests speed or precision; big jobs cost time, not difficulty.

**You're never lost.** What to do next glows, with a bouncing arrow that says it ("Put it in the tray"); while you're
holding something, where it goes glows and everything else fades. The top bar says what you're doing ("Helping Dana:
Take an order, step 3 of 4") and what's next, and if that's at another station, its tab glows. Tap the wrong thing
and a few words appear right there saying what it is and what to do instead.
- **Print job:** taking an order is always full service, 2 pages or 200. Fill in the order form on the computer
  from what they said (it's quoted above the form), send it, and it prints while you do other things. Then pick up the stack, staple (a tap per set on
  small runs, a hold on big ones), cut, or laminate (hold), then put it in a bag, put the name label on, and put it on
  the cart to the shelf.
- **Pickup:** find their bag on the shelf, then ring them up at the counter: type the total for a card, or the change
  for cash.
- **Shipping:** pick a box (it has to fit) and put their item in, tap in packing paper, hold to tape, put it on the
  scale, fill in the label (the weight you read and the service they asked for), stick the label on, ring them up,
  put it in the outbound bin.
- **Drop-off:** tap to scan the label, put it in the bin. **Self-serve:** send them over; now and then they come back
  for help (one tap fixes the copier).

**Mistakes only come from what you put in**, and they come back later where you can see them: an order entered wrong
is made wrong ("This isn't what I asked for", and they don't pay); the wrong bag gets handed back ("This isn't
mine"); a wrong total or wrong change leaves the register off at close; a wrong shipping label sends the package back,
and the customer a day or two later. The lazy options are the Don'ts, and they're faster: skip the finishing (they
notice), skip the packing paper and just tape it shut (it comes back damaged), hand over smudged copies.

**Sticky notes** replace the to-do list. Taking an order makes the MC write one, from what you entered on the computer
(not what they asked for): "Resume x25, B&W, cardstock, staple, due 2:00 PM. Dana." Each one says the next step
("Send to printer", "Printing. You can leave it.", "Collect", "Staple", "Bag and shelve", "Ring up"). Done orders are
crossed off and fade. Tap a note and it unfolds: every detail of the order and a checklist of every step, with
where each one's done (the clock waits while you read). A bell rings and the Counter tab pulses when someone comes in
while you're elsewhere.

**The decision is still the game.** Six to twelve customers a day, budgeted by how much work they are (a heavy day
has fewer people), spread over the day, with quick drop-offs and pickups more likely while something's printing.
Sending a simple job to self-serve costs you a minute and earns less; taking it is a whole production job (enter,
print, collect, finish, bag, ring up) for the full-service price plus the small-order fee. Business clients
come in on their own schedule with big orders and won't wait long. Turning away work you could have done is a lost
sale. The manager watches sales.

**Time.** Everything is measured in game minutes, and the wall clock is honest. The clock slows while a step waits for
you (or someone's in line waiting to be called up), stops while a customer explains, and flies when nobody's in the
store. At 1× about a minute and a half passes every real second.

**One customer at a time.** Nobody steps up to the counter while you're in the middle of something; they wait in a
line behind the counter ("2 waiting"), and the Counter tab shows how many from any station. Once a job's printing on
its own you're free, and the next person steps up. People coming back for an order join the same line. If someone in
line gives up, you see them walk out and the message says how long they waited; it's on the report too. The first
days ease you in: no bad luck on day 1 and less on days 2 and 3.

The top bar has the clock, the manager's mood (calm, annoyed, unhappy), the speed, and after 5 PM, Go home. When
something goes wrong you see it right then, over the station view.

### Controls

| | |
|---|---|
| Next, please | talk to the customer at the counter; tap the textbox to hurry them along |
| Tabs | move between stations (it follows the step you're on by itself) |
| Enter / X / I | hear the rest / Do (the next step) / Don't / Ignore. Enter in a form fills it in. |
| G | go home (after 5 PM) |
| Space | pause |
| 1 to 3 | 1×, 2×, 4× speed (a day is about 5 real minutes at 1×; after close the clock drags) |

The first time you turn someone away, walk away from a job, or go home with work left, it asks you to confirm.

### A day

- **Customers** want quick copies, a bigger print job (some wait, some come back later, some are fine with tomorrow),
  a poster laminated, a box shipped (ground, 2-day, or overnight), a drop-off scanned, an order or a held package
  picked up, or help at the self-serve copier. Some people with simple jobs go straight to the self-serve copier.
  Online orders land in Email and can't be turned away. Later days lean toward requests with more steps.
- **Promises keep to open hours.** Nothing's due later than 30 minutes before close. What a customer asks for is
  capped there; a job that can't make it today is promised for tomorrow morning ("ready tomorrow morning, by
  10:26 AM", and on the note), with time to print it first. Every order gets its pickup: anyone in line for an order
  at 5 PM goes home and comes back for it in the morning.
- **The computer** has four apps (icons on the left, with badges for what needs you). **Orders:** the order form,
  and every open order with where it is (entered, printing, ready to collect, bagged, picked up); tap one for
  everything about it. **Email:** every message, newest first, each with a sender and a real body: web orders (the
  job, the price, the pickup time, and "Enter this order", which opens the form filled in), customer feedback (who,
  what happened, which order), the manager's notes (a warning or write-up says why), corporate memos, and the hollow
  rewards. **Devices:** the printer, the self-serve copier, the card reader, and the Wi-Fi: OK, or what's wrong and
  where to fix it. **Shipping:** today's outbound packages and where each one is, and when the truck comes.
- **The counter quote.** Under what they said: the full-service price with fees itemized (a $2 service fee on small
  orders, a rush fee if it's a rush), the self-serve price if it's an option (plain paper, no back-counter finishing,
  and they're staying), and when it could be ready from what's in the printer queue. A rush is offered when they
  need it sooner than standard turnaround.
- **Workflows.** Jobs with several steps run as workflows: taking an order (talk, answer, the form, send it),
  shipping (talk, answer, box, tape, weigh, label, ring up, bin), collecting and finishing a print job (collect,
  finish, bag), a pickup (the shelf, ring up), and so on. Each step waits for you to do it by hand. While you're in
  one, nothing unrelated can start ("You can't do that, you're boxing a package."), except while something prints:
  that's a wait, and you're free. Walking away from a workflow counts as ignoring it.
- **Do / Don't / Ignore.** At the counter: Do (take, rush, or self-serve), Don't (turn away), Ignore (they wait until
  you come back, or give up). In the work and with bad luck: Do it properly (reprint smudged copies, fix the copier,
  pack the box, hand the packages to the driver), Don't (hand over the smudged copies, tape an out of order sign on
  the copier, tape the box shut, let the driver leave), or Ignore it. Cutting the corner is always faster.
- **Customers react.** Some agree to self-serve and some want full service; some balk at a service or rush fee (and
  take standard time, do it themselves, or leave); if it can't be ready in time, some take the later time and some
  leave. Mood comes from what happens to them, not from your tone: waiting too long, a late order, being turned
  away, or bad work (smudged copies, a taped box, an out of order sign) brings it down.
- **Patience.** Anyone nobody's helping gets annoyed ("Hello?"), then angry ("Is anyone working here?"), then
  leaves ("I'll go somewhere else."), 20 to 35 minutes after they started waiting, depending on what they came for (half
  as fast while they can see you're busy; a business client minds more). Waiting for an order only counts once it's
  overdue.
- **Problems come to the counter.** Someone whose order isn't ready asks "Where's my order?" (rush it now while they
  wait, or apologize and refund). Someone at a dead copier comes and says so (fix it now, or say sorry). People back
  with a damaged box or smudged copies want it made right (file a claim, reprint them free, or apologize).
- **Prioritizing.** Orders have due times. You choose what to work on next and what to send to the printer first;
  rushes print first. Big jobs pay more but tie up the printer, shipping pays little (the store keeps the packing fee
  and a small cut of postage), and small quick jobs are best sent to self-serve.
- **Bad luck,** about once a day: the printer jams, the self-serve copier dies, the card reader goes down, a box rips,
  the Wi-Fi drops. Each one is obvious and takes a task or two to fix (or work around, or ignore).
- **Closing time.** At 5 PM the door's locked and most people in line head out; now and then someone stays anyway,
  and you can show anyone out. The day ends when you go home. Leaving on time with everything done is rewarded;
  staying late annoys the manager (and the clock drags, because the MC wants to go home); going home with work left
  undone is penalized. Stay long enough and the manager locks up and sends you home.
- **Consequences.** Every failure has a moment: it's shown when it happens, notable ones get a note from the manager
  in Email, and the end-of-day report lists them by name ("Order #112 was never finished. Dana left without
  it."). Heat with the manager comes from ignoring (people who walk out after being ignored, problems left
  alone), late or unfinished orders, complaints about bad work (taped boxes come back damaged a day or two later,
  smudged copies come back, a broken copier upsets whoever needed it, packages left in the bin are a complaint the
  next day), and lost sales: turning away a job you could have done in time and that was worth doing. Turning away
  something impossible or not worth it costs nothing. At close the manager reacts: nothing, a warning, or a
  write-up. Three write-ups and you're fired, with an ending for too much ignoring, too many lost sales, or too many
  complaints. A day with no complaints gets a hollow reward the next morning.
- **Between days** only a few things carry over: the day number, the manager's mood, write-ups, things still coming
  back, orders not picked up, and packages that didn't go out. The game saves between days (Continue on the start
  screen).

## How it's built

```
client/
  src/sim/          Pure simulation. No DOM, so it runs in the browser AND headless in Node.
    sim.ts          tick() loop, the task system (canStart/startTask/begin/previewTask), the printer, the truck,
                    ringing up and the register
    director.ts     the flow director: 6 to 12 customers a day, budgeted by work, spread over the day
    dialogue.ts     what customers say, line by line, from their request and the templates in data/dialogue.json
    notes.ts        the sticky notes: what you entered, and the next step
    customers.ts    spawning customers, their requests, orders and web orders
    quote.ts        the counter quote: prices and fees, self-serve, timing, the ready-time estimate
    mood.ts         choices (do / dont / ignore), customer mood, patience
    consequences.ts manager heat, complaints, delayed flags, hollow rewards
    events.ts       the day's bad luck
    game.ts         a run of days: what carries over, the manager's verdict, endings, saves
    workflow.ts     workflows: steps, the strict lock, currentStep(); step data in src/data/workflows.json
    failures.ts     failures (logged by name, manager notes) and the manager's mood
    todo.ts         the bot's to-do list and what counts as "active"; tasks available at each station
    mc.ts, lines.ts the MC's monologue and customer lines, picked from tagged JSON
    bot.ts          an automated employee with a playstyle (smart, careless, do_everything, turn_away, ignore,
                    random); it skips the hands-on part and uses each step's time from the data
    summary.ts      the end-of-day report and the summary posted to the server
    orders.ts       sheets and prices; config.ts all tuning numbers; rng.ts seeded randomness
    dev.ts          dev mode actions
  src/data/         all text and steps: workflows.json (each step's station, building block, hands-on parts, hint),
                    dialogue.json, mc.json, customers.json, messages.json, events.json, endings.json, names.json
    bus.ts          sim to view events (customer_arrived, sheet_printed, jam, payment_done, failure, ...); nothing
                    in the sim listens, so the bot and batch runs never notice
  src/view/         the view: layout.ts (the screen regions, in one place), hud.ts (the DOM HUD over the canvas:
                    top bar, notes, tabs, one modal at a time), audit.ts (layout checks on the real page),
                    run.ts (the controller: the day, the clock, doing things, what you're holding, keys),
                    station.ts (a station scene: objects from the manifest layout, the pick up / put down / hold /
                    tap / pick parts of each step from the step data, and the glow and arrow on what's next),
                    scenes.ts (the six stations), ui.ts (the clock, slides between stations), assets.ts and
                    icons.ts (the art pipeline and placeholders), juice.ts (squash, bounce, shake, sparkle),
                    config.ts (render resolution, fonts, speeds)
  src/assets/       manifest.json (every sprite: size, anchor, layer, animations, purpose; scene layouts),
                    sounds.json, art/ and sounds/ (drop files here)
  src/ui/           view.ts (the HTML for the modals: dialogue box, keypad, monitor and forms, unfolded notes, screens),
                    dev.ts (dev drawer)
  ART_CHECKLIST.md  every sprite and sound to make, generated from the manifest (npm run art)
  scripts/batch-sim.ts   plays whole games with bots, for balancing
server/             Spring Boot API (JdbcTemplate, plain SQL), Flyway migrations
docker-compose.yml  Postgres + API
```

Key design decisions:
- **Deterministic.** Each day's seed is the game's base seed plus the day number. Every system rolls from its own
  stream (arrivals, paper, bad luck, dev spawns). Outcomes of your choices ("usually angry") are keyed rolls, so making
  a choice never shifts anything else, and the same choices always give the same day.
- **The task system** is the only way to act, for the player and the bot alike. `canStart()` says in plain English
  why something can't be done. The UI owns the hands-on part of a step; when it's done it starts the step's task with
  what you did (form values, the bag you picked, the total you typed), and the sim decides what that leads to. With
  `handsOn` off (the bot, tests) steps run on by themselves at their time cost.
- **The flow director budgets work, not headcount.** Each request costs about so many minutes of your time; each day
  has a work budget, so a heavy day brings fewer people (6 to 12 in all). It spaces them over the day and holds them
  while three things already need you. Bad luck and the truck wait for room too.
- **Art drops in.** Every sprite is listed in `src/assets/manifest.json`. A missing file draws a placeholder (a flat
  shape and the key's name), so the game is fully playable with no art. Put `src/assets/art/<key>.png` (a single PNG,
  a strip of frames, or an Aseprite PNG + JSON) and it's used instead; same for sounds. `ART_CHECKLIST.md` is the
  list to work through (`npm run art` regenerates it; a test fails if it's stale). Switching to hand-drawn art later
  is a change in `src/view/config.ts` and the manifest's base size.
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
npm run batch -- --days 20 --style smart --games 20
npm run batch -- --days 20 --style all --post http://localhost:8080
npm run batch -- --days 5 --style all --pace human --games 30   # at a first-time player's speed
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

`npm run batch -- --days 20 --style all --games 20` (bots react every game minute):

| style | survived 20 days | fired on day (median, range) | late/day | lost sales/day | walkouts/day | complaints/day | revenue/day |
|---|---|---|---|---|---|---|---|
| smart | 20/20 | never | 0.0 | 0.0 | 0.0 | 0.0 | $1,602 |
| careless | 20/20 | never | 0.1 | 0.0 | 0.0 | 0.8 | $1,270 |
| do_everything | 20/20 | never | 0.1 | 0.0 | 0.0 | 0.0 | $1,576 |
| turn_away | 1/20 | 12 (6 to 19) | 0.0 | 7.7 | 0.0 | 0.8 | $29 |
| ignore | 0/20 | 3 (3 to 3) | 0.3 | 0.0 | 10.5 | 9.0 | $4 |
| random | 0/20 | 6 (4 to 11) | 0.6 | 3.5 | 0.1 | 4.4 | $1,008 |

About 11 customers are served a day. The shop is quiet about 60% of the open day (the clock speeds through it); the
work is in doing each request by hand.

**At a person's pace** (`--pace human`, sim/humanbot.ts): the same decisions, but every step takes the real seconds a
first-time player needs (2 to 4 a click, forms typed out, a pause to find the station, now and then a wrong tap) while
the clock runs the way the UI runs it, and it does what the game suggests next (whoever's in line, then sending
things to the printer, then whatever's due soonest). That's what patience, promises, and day length are tuned
against. Share of days with anyone walking out, 30 games:

| style | day 1 | day 2 | day 3 | day 4 | day 5 |
|---|---|---|---|---|---|
| smart | 0% | 3% | 7% | 0% | 10% |
| do_everything | 7% | 10% | 0% | 10% | 17% |

The early walkouts left are a late order and some bad luck on the same day.

- **smart** sends simple jobs to self-serve, rushes only when that won't make another order late, turns away what
  can't be done in time or isn't worth doing, works on whatever's due soonest, and does all the work properly.
- **do_everything** says yes to everything: takes every small job as full service instead of sending it to self-serve,
  rushes whenever someone needs it sooner (bumping other orders), and works first come, first served. It survives,
  but loses more business clients while it's tied up.
- **careless** plays like smart but gets something wrong by hand a quarter of the time (the order form, the total,
  the bag, the label). It survives, but with warnings and write-ups, and a fifth less money.
- **turn_away** says no to new business and cuts corners on the work. Lost sales add up slowly. It idles more
  because it sends people away as fast as they come in.
- **ignore** ignores people and problems (and goes home at 5 whatever's left), and is fired fast.

After close, every bot except ignore finishes today's work (tomorrow's can wait), shows out anyone who stayed past
closing (do_everything serves them instead), and goes home.

The server stores each day as a shift: score = customers served, cash = the day's revenue, satisfaction = share of
customers who left happy, customers lost = angry customers, jams = bad luck events.

## Ideas / roadmap

- [ ] Coworkers and the manager as an on-screen character
- [ ] Customer personalities and trait-based dialogue, regulars
- [ ] Story, art, sound
- [ ] Anti-cheat: server replays the seed with the player's recorded inputs instead of trusting the client
