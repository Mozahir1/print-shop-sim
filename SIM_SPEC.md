# Print Shop Sim: Spec v6 (hands-on orders, first person)

Builds on the current version. Keep: do / don't / ignore choices, counter decisions (turn away, rush, self-serve,
fees), days and saving, heat and write-ups, delayed consequences, visible failures, customers leaving when ignored,
bad luck events, hollow rewards, dev mode. This round makes the player physically do the work in a first-person view.

Rules: `src/sim/` stays DOM-free and deterministic. Steps, dialogue, and hints are JSON data. Update tests and the bot
with each change. Player-facing text has no em dashes. Keep the UI touch-friendly.

Build order: counter dialogue and notes, print job, pickup and ring-up, shipping, drop-off and self-serve.
Stop and summarize after each.

## 1. First-person view (replaces the overhead store scene from v5)
- **Counter** is the home screen: the customer stands across the counter as a portrait (one bust template, color
  swaps, 3 expressions: fine, annoyed, angry).
- Other **station screens** via a bottom tab bar: Counter, Computer, Printer, Finishing, Shipping, Pickup Shelf.
  Switching takes about 1 second of game time.
- **Hand slot** at the bottom shows what you're holding (box, paper stack, bag, ream). Empty means free.
- When a customer arrives while you're elsewhere: bell cue and the Counter tab pulses.

## 2. Customer conversation
- Customers state their request in a **textbox**, in their own words, one line at a time. Request details live in the
  dialogue, not a side panel.
- "What was that?" replays the request; costs a few seconds and a small patience hit.
- After they finish: **do** (take order, take as rush, send to self-serve), **don't** (turn away), **ignore**.
- Dialogue lines are generated from the request spec plus phrasing templates in JSON (paper, color, copies, finishing,
  timing), so every request is stated in words.

## 3. Notes (to-do)
- Accepting a job makes the MC write a **sticky note** on screen edge, built from what the player **entered** on the
  computer (not the true request): "Resume x25, cardstock, due 2:00. Dana."
- Each note shows a **next-step hint** that updates as you work ("Send to printer", "Collect", "Staple", "Bag and shelve").
- Done jobs get crossed off and fade. Notes replace the to-do list.

## 4. Interaction building blocks (UI)
Every step uses one of: **form** (pick or type values), **hold** (press until bar fills), **tap** (click N targets),
**drag** (item to slot), **number** (read and type a value), **wait** (background timer you can leave).
Each step in data: station, building block, params, hint text, held item before and after.

## 5. Workflows
**Print job**
1. Computer: fill the order form (paper, color, sides, copies, finishing) from what the customer said. Creates the note.
2. Printer: send (wait, can leave). Empty tray: drag a ream in. Jam: tap the jammed sheets out.
3. Collect: drag the stack into your hands.
4. Finishing: staple (tap per set), cut (hold), bind (hold per book).
5. Drag stack into a bag, drag name label on, drag bag to the shelf.

**Pickup:** at the shelf, find the bag by name and drag it to hands; at the counter hand it over, then ring up
(enter total; enter change if cash).

**Shipping:** pick box size and drag item in, tap to add packing paper, hold to tape, drag onto scale and read the
weight, enter weight and service on the label form, print and drag label onto box, ring up, drag box to outbound bin.

**Drop-off:** tap to scan the label, drag package to the bin.

**Self-serve:** short dialogue to send them over; occasionally they return for help (one tap to fix the copier).

## 6. Rules
- Interactions are easy: no precision or speed tests. Big jobs cost time, not difficulty.
- Effort scales sensibly: taps per set for small runs; holds and printer wait for big runs. Never more than about 10 taps in a step.
- Workflow lock stays, except during wait steps (printing), when you can work elsewhere.
- Mistakes only come from player input: wrong form values, wrong label, wrong bag handed over. The sim compares entered
  values to the true request and the result surfaces later as a visible scene ("This isn't what I asked for").
- Lazy options (skip packing paper, hand over unstapled, tape shut) are the "don't" choices and are faster.

## 7. Day pacing
- 6 to 12 customers per day. The director budgets by **work cost** (game minutes per request type in config), not headcount:
  heavy days have fewer customers, light days more.
- Interleave quick interactions (drop-off, pickup) between big jobs so there's something to do while printing.
- Bad luck events still roughly once per day, inside these workflows (jam mid-print, tray empty mid-run).

## 8. Sim and bot
- The sim records each step's result: values entered, correct or not, time spent. The UI owns the interaction itself.
- The bot skips interactions and uses per-step time costs from config, entering correct values (or deliberately wrong
  values for a "careless" style). Batch targets from v4 still apply, plus customers per day stays within 6 to 12.

## 9. Assets (placeholders, swappable later)
- 5 station backgrounds (flat shapes fine): counter, printer, finishing table, shipping table, shelf. Computer is pure UI.
- 1 customer portrait template with color swaps and 3 expressions.
- About 15 item icons: ream, paper stack, box (3 sizes), tape, label, bag, stapler, scale display, card, cash.
- Load all art through one asset map so real sprites drop in without code changes.

## 10. Tests
- Dialogue generation states every spec field for each request type.
- Notes reflect entered values, not the true request.
- Each workflow completes step by step; wrong entries produce the matching failure scene later.
- Wait steps release the lock; other steps keep it.
- Director keeps customers per day within 6 to 12 across seeds.

## Done when
`npm run typecheck`, `npm test`, `npm run build` pass, batch targets met, and in the browser a full day is playable in
first person: hear the request, enter it, do the work by hand, and see mistakes come back.
