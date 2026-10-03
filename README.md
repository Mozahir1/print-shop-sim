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

**The decision.** Fewer customers, more to think about with each. When someone reaches the counter the clock stops
while they explain: what they want, when they need it, the price with fees itemized, and how much of **your** time
each way of handling it takes. A simple job someone's waiting for can go to self-serve (a couple of minutes of your
time, a smaller sale) or you can make the copies yourself (more money, but 10 to 25 minutes you can't walk away
from). Usually that's fine. But business clients come in on their own schedule with orders worth hundreds or
thousands of dollars, and they won't wait long; if you're tied up making someone's copies, that order walks out
the door. Turning away someone who could have used self-serve is a lost sale, and every so often (surveys are rare)
it comes back as a bad survey. The manager watches sales: a slow day adds a little heat, a strong one takes some off.

**Time.** The clock is honest: everything is measured in game minutes, and what you see on the wall clock is how long
things take. Taking a drop-off (answer, scan it, toss it in the bin) takes three minutes; boxing a package takes four; laminating
a poster takes eight; a print job takes as long as the printer needs (30 sheets a minute). Standard turnaround is an
hour. Customers give up after 20 to 35 minutes of waiting (business clients after 18). At 1× about a minute and a half
passes every real second; when nobody's in the store, time flies.

The screen is the store: counter in front, printer, finishing table and shipping behind it, the self-serve copier to
the side, customers lining up in front. You (the MC) walk to whatever you're working on, holding what it needs, with
a thought bubble saying what you're doing; empty hands mean you're free. Customers show how they're doing with a
mood dot (fine, annoyed, angry) and say things in speech bubbles. Stations that need you pulse.

Next to the store: the **job card** (what you're in the middle of, as a checklist, with the Do / Don't / Ignore
buttons for the step you're on) and the **to-do list** (most urgent first; waiting times turn amber, then red). The
top bar has the clock, the manager's mood (calm, annoyed, unhappy), the speed, and after 5 PM, Go home. When
something goes wrong you see it right then, at the top of the store.

### Controls

| | |
|---|---|
| Click the customer at the counter | talk to them, then Do (take the order, rush it, or send them to self-serve), Don't (turn them away), or Ignore. Not answering within 8 minutes (on the clock) counts as Ignore; the clock slows while you decide. |
| Click a station or a customer | what you can do there, right where you clicked |
| Enter / X / I | Do (the next step) / Don't / Ignore |
| G | go home (after 5 PM) |
| Space | pause |
| 1 to 3 | 1×, 2×, 4× speed (a day is about 5 real minutes at 1×; after close the clock drags) |
| Escape | close a menu |

The first time you turn someone away, walk away from a job, or go home with work left, it asks you to confirm.

### A day

- **Customers** want quick copies, a bigger print job (some wait, some come back later, some are fine with tomorrow),
  a poster laminated, a box shipped (ground, 2-day, or overnight), a drop-off scanned, an order or a held package
  picked up, or help at the self-serve copier. Some people with simple jobs go straight to the self-serve copier.
  Online orders land in the inbox and can't be turned away. A flow director brings people in so there's always one
  obvious thing to do and rarely more than three. Later days lean toward requests with more steps.
- **The counter quote.** When someone reaches the counter you see what they want, when they need it, the full-service
  price with fees itemized (a $2 service fee on small orders, a rush fee if it's a rush), the self-serve price if it's
  an option (plain paper, no back-counter finishing, and they're staying), and when it could be ready from what's in
  the printer queue. A rush is offered when they need it sooner than standard turnaround.
- **Workflows.** Jobs with several steps run as workflows: taking an order (talk, answer, enter it, send it),
  shipping (talk, answer, weigh, box, tape, label, bin), collecting and finishing a print job (collect, finish, bag),
  and so on. Steps run one after another and stop where there's a choice (box it or just tape it shut, reprint
  smudged copies or use them anyway). While you're in one, nothing unrelated can start ("You can't do that, you're
  boxing a package."); jobs printing on their own keep printing. Walking away from a workflow counts as ignoring it.
- **Do / Don't / Ignore.** At the counter: Do (take, rush, or self-serve), Don't (turn away), Ignore (they wait until
  you come back, or give up). In the work and with bad luck: Do it properly (reprint smudged copies, fix the copier,
  pack the box, hand the packages to the driver), Don't (hand over the smudged copies, tape an out of order sign on
  the copier, tape the box shut, let the driver leave), or Ignore it. Cutting the corner is always faster.
- **Customers react.** Some agree to self-serve and some want full service; some balk at a service or rush fee (and
  take standard time, do it themselves, or leave); if it can't be ready in time, some take the later time and some
  leave. Mood comes from what happens to them, not from your tone: waiting too long, a late order, being turned
  away, or bad work (smudged copies, a taped box, an out of order sign) brings it down.
- **Patience.** Anyone nobody's helping gets annoyed ("Hello?"), then angry ("Is anyone working here?"), then
  leaves ("I'll go somewhere else."), 20 to 35 minutes after they started waiting, depending on what they came for (more slowly while
  they can see you're busy). Waiting for an
  order only counts once it's overdue.
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
  in the inbox, and the end-of-day report lists them by name ("Order #112 was never finished. Dana left without
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
    sim.ts          tick() loop, the task system (canStart/startTask/stopTask/previewTask), the printer, the truck
    director.ts     the flow director: who comes in when, keeping the load in a band
    customers.ts    spawning customers, their requests, orders and web orders
    quote.ts        the counter quote: prices and fees, self-serve, timing, the ready-time estimate
    mood.ts         choices (do / dont / ignore), customer mood, patience
    consequences.ts manager heat, complaints, delayed flags, hollow rewards
    events.ts       the day's bad luck
    game.ts         a run of days: what carries over, the manager's verdict, endings, saves
    workflow.ts     workflows: steps, the strict lock, currentStep(); step data in src/data/workflows.json
    failures.ts     failures (logged by name, manager notes) and the manager's mood
    todo.ts         the to-do list and what counts as "active"; tasks available at each station
    mc.ts, lines.ts the MC's monologue and customer lines, picked from tagged JSON
    bot.ts          an automated employee with a playstyle (smart, do_everything, turn_away, ignore, random)
    summary.ts      the end-of-day report and the summary posted to the server
    orders.ts       sheets and prices; config.ts all tuning numbers; rng.ts seeded randomness
    dev.ts          dev mode actions
  src/data/         all text: mc.json, customers.json, messages.json, events.json, endings.json, names.json
  src/ui/           scene.ts (the store on a canvas), sprites.ts (everything it draws: swap in real sprites here),
                    view.ts (job card, to-do list, menus, screens), dev.ts (dev drawer)
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
npm run batch -- --days 20 --style smart --games 20
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

`npm run batch -- --days 20 --style all --games 20` (bots react every game minute):

| style | survived 20 days | fired on day (median, range) | idle | late/day | lost sales/day | walkouts/day | on time |
|---|---|---|---|---|---|---|---|
| smart | 20/20 | never | 29% | 0.1 | 0.0 | 0.0 | 99% |
| do_everything | 20/20 | never | 27% | 0.1 | 0.0 | 0.1 | 96% |
| turn_away | 2/20 | 11 (6 to 20) | 60% | 0.0 | 31.2 | 0.0 | 100% |
| ignore | 0/20 | 3 (3 to 3) | 1% | 0.6 | 0.0 | 21.1 | 22% |
| random | 0/20 | 3 (3 to 4) | 29% | 1.5 | 8.5 | 0.3 | 63% |

Smart averages $1,876 a day and loses a business client about once every 100 days. Do-everything makes every
walk-up job itself: a few dollars more each time, but it loses business clients seven times as often and averages
$1,703. Idle here means nobody's in the store: the shop has quiet stretches now, and the clock speeds through them.

The load never goes above 3 things at once for any style.
- **smart** sends simple jobs to self-serve, rushes only when that won't make another order late, turns away what
  can't be done in time or isn't worth doing, works on whatever's due soonest, and does all the work properly.
- **do_everything** says yes to everything: makes every walk-up job itself instead of sending it to self-serve,
  rushes whenever someone needs it sooner (bumping other orders), and works first come, first served. It survives,
  but loses more business clients while it's tied up.
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
