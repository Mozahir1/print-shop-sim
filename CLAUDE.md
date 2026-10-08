# Print Shop Sim: notes for Claude Code

Read this first, then `SIM_SPEC.md` (the current task). This file is the project's memory between sessions.

## What this is
A low-stress, satirical job game about working the counter of a print and ship shop. The owner works at one in real
life. Portfolio project too, so code quality and a clean README matter.

Stack: TypeScript + Vite + Phaser 3 client (`client/`), Spring Boot API (`server/`), PostgreSQL via Flyway, Docker
Compose. The game runs fully offline; the server only stores day summaries and a leaderboard.

## Game direction (settled, don't relitigate)
- **Low stress, never idle.** Always one obvious thing to do, rarely more than two or three. Days are short (6 to 12 customers).
- **Choices are the game:** do / don't / ignore. At the counter: take the order (standard, rush, or send to self-serve),
  turn it away, or ignore. On tasks: do it properly, cut the corner, or leave it.
- **The MC is apathetic and never changes.** Choices change actions, not attitude. Manners are not graded.
- **Consequences:** hidden manager heat, write-ups (3 = fired), delayed consequences, and every failure shown as a
  visible moment (customer comes back, message, report line). Perfect play only earns hollow rewards (the joke).
- **Hands-on work:** the player physically does tasks (load paper, staple, tape, weigh, label, bag, ring up).
- **Satire comes later** through characters (coworkers, customer personalities, story). Not in scope yet.

Tried and rejected: realistic hidden-information management (too stressful), proper/minimum/rude attitude choices,
career mode with an economy, an overhead walking store view, top-down panels of buttons.

## Current priority
**Human playability.** The sim logic is in good shape. The player-facing UI is not: it's tiny, blurry, overlapping,
hard to operate, and confusing about what to do next. Bots finish days easily; humans don't. Judge every change by
whether a first-time human can understand and do it. See `SIM_SPEC.md`.

## Code map (client/src)
- `sim/`: the game rules. DOM-free, deterministic (seeded RNG streams per system). Source of truth.
  - `sim.ts` core loop and tasks (`canStart` / `startTask` / `stopTask` / `previewTask`)
  - `workflow.ts` + `data/workflows.json` multi-step jobs as data (station, held item, building block, hint)
  - `director.ts` customer flow (keeps load within a floor/ceiling)
  - `customers.ts`, `dialogue.ts`, `quote.ts`, `orders.ts` requests, how they're said, prices and fees
  - `consequences.ts`, `mood.ts`, `events.ts` heat, write-ups, delayed flags, bad luck events
  - `game.ts`, `summary.ts` days, saving, endings, reports
  - `bot.ts` playstyles for batch balancing
- `view/`: the view. `layout.ts` the 1280x720 screen regions (top bar, stage, right rail, bottom bar) and the stage's
  action strip, in one place; `hud.ts` the DOM HUD over the canvas (bars, sticky notes, one modal at a time, toasts,
  tooltips); `audit.ts` runtime layout checks (`window.audit()` in dev); `run.ts` controller; `station.ts` base station
  scene (camera on the stage region, art pixels at 2x) and interaction components; `scenes.ts` per-station scenes;
  `ui.ts` boot + clock scene; `juice.ts` feedback effects; `assets.ts` manifest loading and placeholders (category
  color + pixel icon from `icons.ts`); `config.ts` view settings (render resolution, fonts, clock).
- `ui/`: DOM HTML builders (`view.ts`: dialogue, forms, keypad, unfolded notes, screens; `dev.ts` dev drawer).
- `assets/manifest.json` every sprite (size, anchor, layer, layout); `assets/sounds.json`.
- `data/` all content as JSON (customers, dialogue, MC lines, messages, failures, workflows).
- `scripts/batch-sim.ts` headless balancing; `scripts/art-checklist.ts` generates the art to-do list.

## Commands (from client/)
`npm run dev` · `npm test` · `npm run typecheck` · `npm run build` ·
`npm run batch -- --days 20 --style all`

## Conventions
- Keep `src/sim/` DOM-free and deterministic. Choices never consume randomness.
- Content goes in JSON, not code. Money is integer cents.
- Player-facing text: plain, short, no em dashes.
- No real brand names or logos.
- The owner has limited usage: work in small phases, stop and summarize after each, and prefer restoring or reusing code
  (including the `realistic-sim` git tag) over rewriting.
- Bots are for balance only. They are not evidence that a human can play it. Every UI phase needs screenshots and the
  human-play checks in `SIM_SPEC.md`.

## Status
- Spec v8 Phase 1 done (2026-10-05): 1280x720 FIT at device resolution, DOM HUD in rem (1rem = 20 layout px), fixed
  regions with `layout.test.ts` + `audit.ts`, readable placeholders, tooltips. Screenshots in `playtest/phase1/`.
  Also added (owner request): tap a sticky note to unfold it (full details + step checklist; the clock waits).
- Phase 2 done (2026-10-05): no hand slot; tap to pick up / tap to place (or drag), `ctl.carry` + a pointer ghost +
  "Holding:" in the top bar (tap it or Escape to put it back); glow + bouncing arrow with each part's `say`/`put`
  (workflows.json) on what's next, the free next thing glows too; wrong taps say what it is and what to do; tabs glow
  only for the next step while you're mid-workflow. Screenshots in `playtest/phase2/`.
- Phase 3 done (2026-10-05): nobody steps up mid-workflow (`atCounter`/`inLine` in ui/view.ts), visible line +
  "N waiting" + Counter tab badge, line walkouts animate and say how long they waited. Clock pacing moved to
  `sim/clock.ts` (also slows while someone waits to be called). `sim/humanbot.ts` + `npm run batch -- --pace human`
  tune against a first-time player. Tuning: business give-up 25 and 0.75 busy rate, RUSH_BUFFER 35, next-day and web
  promises leave time to print, bad luck eases in (EASE_IN), `suggested()` ordering for "Next:" and the human bot.
  Result (smart, 30 games): walkout days 0% / 3% / 7% on days 1 to 3, 10% on day 5; residual = late order + bad luck.
  Next: Phase 4 (computer redesign).
- Spec v8.1 done (2026-10-06): promises inside open hours (`CLOSING.dueBuffer`, `lastDueAt`/`morningDueAt` in
  quote.ts), closing sends people with open orders home to come back (`pickups.test.ts`); walk-up removed (taking is
  always full service; quick copies wait 50 to 90 min); computer = four apps (`ui/computer.ts`; `ctl.app/mail/webForm`),
  every message through `postMessage()` in `sim/messages.ts` (sender + real body, `messages.test.ts`); arrows place
  themselves clear of glows, the hold meter (depth 80) and popups, `audit()` reports covered labels. Screenshots in
  `playtest/v8.1/`. Human pace now: smart 0/3/0% walkout days on days 1 to 3; do_everything worse (small jobs are
  real work now).
- Owner request (2026-10-06), multitasking and packages: one thing at a time, but waits never hold you (printing; the
  card reader / router restart by themselves after you reset them, `cardReader: "restarting"`, `wifi.restarting`,
  `EVENTS.restart`), and a job (take_order, collect_finish, inbox) can be put down for a quick chore (`CHORES`,
  `canPutDown` in workflow.ts; `state.setAside`, `carryOn` in sim.ts), never for another job or with a customer
  there. The driver waits while you can't hand off (`SHIPPING.truckWaitsMax`), nobody new walks in while it's here,
  and the truck ranks first in `suggested()`. Pickup packages exist only from the day-1 shelf stock or the truck's
  delivery (`shelve`/`deliverPackages`/`onTheShelf` in customers.ts, `Package.to`, own rng stream), and carry over
  day to day (`shelf.test.ts`). Human pace, smart: truck handed off 150/150 days (was 117/150). Screenshots in
  `playtest/v8.2/`.
- Owner request (2026-10-07), more print jobs: business cards (`business_cards`, media `business_card`, the card
  machine in the Printer room makes them by itself) and large format (`large_format`, media `large_format`, the
  wide-format printer at Finishing: a long print, then `trim` and `roll` by hand, in the collect_finish workflow).
  `machineFor(spec)` in orders.ts routes a job; `state.machines.cards/wide` + `runMachines` in sim.ts; quote timing
  per machine (`machineMinutes`). Paper on the order form is now a dropdown (six choices). Bigger lost sales add
  `HEAT.lostBigSale`. Tests in `products.test.ts`; screenshots in `playtest/products/`. Dev drawer: skip-to buttons
  and N (next thing that needs you).
- Spec v9 Phase 1 done (2026-10-08): coworkers. `data/coworkers.json` (A, B = "Brody", C; B's lore: the owner's son,
  which is why he can't be fired; owner request), `sim/schedule.ts` (posted ahead, weight = (1 + days since)^2, never
  3 days running; `game.crew` persisted, save version 3), `sim/coworker.ts` (agent with its own customers, flagged
  `Customer.crew`: serves them start to finish with the usual step times x their station speed; shares the printer
  queue (yours go first when due sooner, `queueJob`) and the printer/finishing table (`inUse`, your steps there wait,
  they never take a station you're mid-step at); breaks; goes home after close). Director scales perDay/budget by
  capacity and gives that share to them (`crewShare`; theirs wait for them, never become yours). Crew stuff is off
  your to-do list, notes, load, line, patience, and go-home penalties (`theirs`, `isCrew`). UI: day-start card,
  "Working with:" in the top bar, "In use: X, about N min" banner on stations, Schedule app. Tests in
  `coworker.test.ts`. Human pace (smart, 30 games x 5 days) late orders/day: solo 0.21, A 0.27, B 0.21, C 0.13;
  walkouts/day A 0.05, B 0.09, C 0.04. Screenshots in `playtest/v9-phase1/`. Next: Phase 2 (personalities, hooks).
  Owner request (2026-10-08): the coworker is on screen. The counter has two sides: the coworker's register on the left
  (`CREW_ZONE` in layout.ts: them, the customer they're helping walking in from the door, "N more waiting for X", or
  where they went), and the conversation box docked bottom right over your side (`DIALOG_DOCK`, 30rem; the customer's
  mood shows in its header since the box covers them). `crewFigure()` in station.ts puts them at the printer,
  finishing, shipping, or shelf when they're working there (manifest spots `crew*`). layout.test.ts checks the zone
  stays clear of the box; `audit()` reports a coworker under the counter's box.
- Spec v9 Phases 2 to 4 done (2026-10-08): personalities in `data/coworkers.json` (rates, hooks, requests with
  data outcomes, lines, C's story, report rating). `sim/coworker.ts`: speech (`crewSays`, lines cycle without
  repeats via `spoke`), requests (`state.request`, `answerRequest`/`resolveRequest`; Do = `help_coworker`, a quick
  chore; auto-Ignore after `CREW.requestWait`), relationship (persisted in `game.crew`, nudges request/hook rates),
  hooks: A upsell (`onYourOrder`), double-check, re-sort shelf (`state.shelfOrder`), clear jams; Brody mishap = the
  day's event (`BadLuck.by`, immediate kinds), help requests (Don't/Ignore -> `state.mistakes`, `fix_mistake` on the
  computer; unfixed at close = failure + `CREW.blameChance`), goes missing (customers move to your line), praise memo;
  C chat-up (wears your line), wants a response (Ignore -> louder), story across days. Pace: walking, dawdle, chatter.
  MC thoughts: `sim/thoughts.ts` + `data/mc_thoughts.json` (cooldown `THOUGHTS`). Traits: `Customer.trait`
  (`TRAITS`, keyed roll): patience, extra answer time, fee balk, a dialogue line, a tag in the dialogue header.
  UI: request card + thought slot in the rail, speech bubble over the coworker (kept in `CREW_ZONE` at the counter),
  "Working with" on row 2, Fix it rows in Orders, two-column report with "Team collaboration". Batch prints a
  by-coworker table. Bots answer requests by style (smart helps between jobs). Human pace (60 games, days 1 to 3):
  walkout days A 3%, Brody 6%, C 9%; your work min/day (smart bot) A 138, Brody 161 (+17%), C 154. Human-pace test
  thresholds now 10% walkout days, 0.2 late/day (v9 adds work by design). Tests: `personality.test.ts`,
  `coworker.test.ts`. Screenshots in `playtest/v9/`. No Playwright playtest exists yet (spec v8 Phase 5).
- Known for later phases: phone sizes are the same layout scaled down (about 11px text on an 844x390 phone, worse in
  portrait).
- Art: placeholders only. The owner will draw custom pixel art later from `ART_CHECKLIST.md` (2x art grid, 500x266 per
  station).
