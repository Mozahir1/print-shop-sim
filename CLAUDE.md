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
- `view/`: Phaser layer. `run.ts` controller, `station.ts` base station scene and interaction components,
  `scenes.ts` per-station scenes, `ui.ts` top bar/tabs/notes, `juice.ts` feedback effects, `assets.ts` manifest loading
  and generated placeholders, `config.ts` view settings.
- `ui/`: older DOM helpers (`view.ts`, `dev.ts`). Dev mode lives here.
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
- Git: the v7 Phaser work (manifest, scenes, juice) is uncommitted. Commit it first as a checkpoint before changing anything.
- Art: placeholders only. The owner will draw custom pixel art later from `ART_CHECKLIST.md`.
