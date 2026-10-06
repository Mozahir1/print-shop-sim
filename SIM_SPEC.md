# Print Shop Sim: Spec v8 (human playability)

Read `CLAUDE.md` first. The sim rules stay; this round is about a first-time human being able to see, understand, and
do everything. Commit the current uncommitted work as a checkpoint before starting.

## Audit (what's wrong now)
1. **Tiny and blurry.** Everything renders at 640x360 with 10px text and 7px placeholder labels. When the screen isn't
   an exact multiple, zoom falls back to a fractional scale, which blurs pixel art and text. DOM overlays are scaled
   with a CSS transform, which blurs them too.
2. **Overlapping UI.** Overlays, the hand slot, tab bar, notes, and station objects share space with no layout rules.
3. **Hands are a drop target.** You drag items into a small hand slot outside the scene. Picking something up should
   simply mean you're holding it.
4. **No clear next action.** Nothing points at where the paper goes or what to click next. Players lose time searching.
5. **New customers step up while you're busy.** The director's ceiling is 3 and returning customers come in regardless,
   so a new person appears at the counter while you're mid-job with no sign you should be elsewhere.
6. **Computer is text on text.** Too much information, small fields, no hierarchy.
7. **Tested only by bots** acting on the sim, never through the UI at human speed.

## 1. Resolution and text
- Render at a **1280x720 logical size** with `Phaser.Scale.FIT` and `autoCenter`; set text resolution to
  `devicePixelRatio`. Pixel art can stay pixel art, drawn at 2x or 3x inside that space with nearest-neighbour.
- **Minimum sizes:** body text 20px, labels 16px, headings 28px (at 1280x720). Interactive targets at least 56px.
- **No CSS transforms on text.** DOM overlays are positioned and sized in real CSS pixels from the canvas bounds.
- One font family for UI, one for notes. High contrast (WCAG AA) everywhere.

## 2. Layout with fixed regions
- Screen regions, each owning its space, nothing overlaps:
  - **Top bar:** clock, manager mood, what you're doing now ("Helping Dana: print job, step 2 of 5").
  - **Stage:** the current station.
  - **Right rail:** sticky notes (max 4 visible, then "+N more").
  - **Bottom bar:** station tabs, large, with icons and labels; pulsing when they need you.
- **One modal at a time** (dialogue, form, keypad, report), centered over the stage, never over the bars.
- Define regions in one layout config. Add a test that computes element rectangles and fails on any overlap.

## 3. Holding things
- Remove the hand slot as a drop target. **Tap an item to pick it up** (or start dragging it): you're now holding it.
- The held item follows the pointer, and also shows as a large icon in the top bar ("Holding: ream of paper").
- **Tap the destination to place it.** Dragging still works; tap-then-tap is the main path (easier on touch).
- You can switch stations while holding something. Tap the held icon in the top bar to put it back where it came from.

## 4. Always show the next action
- The current step's target gets a **glow and a bouncing arrow** with a short label ("Put the ream in the tray").
- While holding something, every valid destination glows; invalid ones dim.
- A **big next-step line** in the top bar mirrors the hint ("Next: tape the box").
- If the next step is on another station, that tab glows and the line says so ("Next: Finishing").
- Wrong action: short message at the point you clicked, plus what to do instead.

## 5. One customer at a time
- **Nobody steps up to the counter while you're helping someone or working on their order's hands-on steps.** Waiting
  customers stand in a visible line behind the counter (small figures with a count: "2 waiting").
- Line patience counts down slower while you're visibly busy with someone else (config), and is long enough that a
  first-time human finishes a typical print job before anyone leaves.
- If someone in line does leave, show it clearly: they walk out, a message appears ("Someone in line left after waiting
  6 min"), and it goes on the report. Never show a new customer at the counter while a workflow is unfinished.
- Wait steps (printing) free you: the next customer may step up then, and the note keeps track of the print job.
- Returning customers (pickups) join the same line; they don't skip it.

## 6. Computer, simplified
- One app at a time, filling the monitor. Big text. App icons on the left with unread badges.
- **Order form:** large toggle buttons with icons: B&W / Color, 1-sided / 2-sided, paper chips (Plain, Cardstock, Legal,
  Tabloid), copies stepper (+/- and typing), finishing chips, due time chips. A short quote of what the customer said
  sits at the top for reference. Show price and ready time once, at the bottom, with one Submit button.
- **Inbox:** list of at most 6 items, one line each (sender, subject). Open shows one message. Web orders open straight into the order form, prefilled.
- **Shipping label form:** weight, service as three big buttons with price on each, Print label.
- Remove anything a player doesn't need to make the current decision.

## 7. Readable placeholders
- Placeholders must look like their object at a glance: simple shapes plus a clear icon (box, ream, stapler, scale,
  printer). No tiny text labels on sprites; names appear on hover/focus in a tooltip at readable size.
- Distinct, consistent colors per object category. Update `ART_CHECKLIST.md` with the new sizes.

## 8. Day 1 tutorial
- Day 1 is a guided shift: 3 customers (print job, pickup, shipment), no bad luck event, slower clock, and a short
  prompt for each new kind of step the first time it appears. Skippable. Later days are normal.

## 9. Human-play checks (required each phase)
- **Playwright UI playtest:** a script that plays a guided day through the real UI (clicks, not sim calls) at 1280x720,
  1920x1080, and 390x844 (phone landscape and portrait), and saves screenshots of every station and modal to `playtest/`.
- Automated checks during that run: no overlapping UI regions, no text under 16px, no target under 56px, no text clipped.
- **Human-pace bot:** a bot that acts through the sim with realistic delays (2 to 4 seconds per action, a short search
  delay when switching stations, occasional wrong tap) used to tune patience, due times, and day length. Targets: on
  days 1 to 3 it completes every job on time with nobody leaving; by day 5 it occasionally loses one customer.
- After each phase, summarize and point to the screenshots so the owner can review before the next phase.

## Phases
1. Resolution, text sizes, layout regions, overlap test, readable placeholders.
2. Holding (tap to pick up, tap to place), next-action highlighting, top bar status.
3. One customer at a time and line behavior, retuned with the human-pace bot.
4. Computer redesign.
5. Day 1 tutorial, Playwright playtest across sizes, final screenshot set.

## Done when
`npm run typecheck`, `npm test`, `npm run build` pass, batch targets hold, the Playwright playtest passes all checks at
every size, and the screenshot set shows a clean, readable, non-overlapping UI on every station.
