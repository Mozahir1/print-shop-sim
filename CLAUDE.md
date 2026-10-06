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
- Known for later phases: phone sizes are the same layout scaled down (about 11px text on an 844x390 phone, worse in
  portrait).
- Art: placeholders only. The owner will draw custom pixel art later from `ART_CHECKLIST.md` (2x art grid, 500x266 per
  station).
