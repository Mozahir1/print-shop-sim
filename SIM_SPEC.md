# Print Shop Sim: Spec v9 (coworkers and personality)

Read `CLAUDE.md` first. Desktop version only; don't touch the mobile repo. This update adds coworkers, MC thought
bubbles, and light customer trait tags. Its purpose is personality: it should shake the day up without making the
game much harder. Small phases; stop and summarize with screenshots after each.

Rules as before: `src/sim/` DOM-free and deterministic (new systems get their own RNG streams); content in JSON;
player-facing text has no em dashes; overlap and human-play checks must still pass.

## 1. Schedule
- One coworker on shift with the player each day, chosen by the schedule (player can't control it).
- Weighted random, never streaky: the same coworker at most 2 days in a row; weight rises with days since you last
  worked with them. Seeded per day. Test the streak rule across many seeds.
- **Schedule app** on the computer: today plus the next 2 days.
- Day-start card: "Today you're working with [name]" plus their opening line.

## 2. Coworker system (shared by all coworkers)
- A coworker is an autonomous agent: takes some counter customers, runs print jobs, packs shipments, takes breaks.
  Their work goes through the same sim tasks and timings as the player's.
- **Shared machines:** while a coworker uses the printer or finishing table, it shows "In use: [name], about N min" and
  the player's jobs wait. They never take a station mid-step from the player.
- **More customers:** the director adds customers based on the coworker's effective capacity so the player's own load
  stays at 1 to 3 active things.
- **Requests to the player:** small non-blocking prompt with do / don't / ignore (auto-ignores after a while). Outcomes
  are data (time cost, relationship change, later consequence).
- **Hidden relationship meter** per coworker, persisted. It nudges behavior (e.g. helping B often makes B ask more).
- Coworker mistakes surface as visible failures like the player's. A config chance that the manager blames the player anyway.
- Persist across days: relationship, story progress (C), schedule history.

## 3. Personalities (`src/data/coworkers.json`)
Each coworker: id, display name (placeholders "A", "B", "C" until the owner names them), capacity, machine speed
multipliers, rates (help requests, breaks, missing, chatting), dialogue pools, and up to 3 special hooks.

**A: neurotic corporate believer.** Competent and helpful; the comedy is how much they care.
- High capacity; takes a fair share of customers; occasionally clears a jam before you notice.
- **Corporate metrics talk:** constant lines about sales goals, upsell rates, customer scores, "shareholder value,"
  quoting company values. A part-timer who sounds like an executive.
- **Upsell nag (hook):** sometimes asks "Did you offer them lamination?" Do = offer it (small extra revenue, small
  customer annoyance), don't / ignore = A visibly frets. The MC never cares either way.
- **Reorganizes (hook):** sometimes re-sorts the pickup shelf (bags move; finding one may take a second look).
- **Double-checks (hook):** sometimes catches a wrong entry on your order form before it prints. Genuinely helpful, annoyingly announced.
- Hyper-precise about time ("Break in 47 minutes."), and anxious when numbers dip.

**B: the one you don't want.** Trolls the player without making the day much harder.
- Low capacity; slow on machines (ties up printer and finishing table longer).
- **Breaks things (hook):** on B days, B's mishap replaces the day's random bad luck event instead of adding one.
- **Needs help (hook):** frequent requests ("How do I do labels again?"). Ignored, they do it wrong and a small fix shows up later.
- **Goes missing (hook):** 10 to 20 minutes; their customers move to your line.
- Never gets in trouble; the manager's memo praises B.
- Target: a B day is about 20 to 30% more work than an A day, not double.

**C: the talker.** Fine at the job; exhausting to be near.
- Medium capacity.
- Constant speech bubbles; ongoing stories that continue across days (serialized in JSON, progress persisted).
- **Chats up customers (hook):** those customers lose a little patience.
- **Wants a response (hook):** occasionally; do = engage (a few seconds), don't, ignore = they keep going, louder.
- Gossips about A and B.

## 4. MC thought bubbles
- Small bubbles near the MC (in their reserved layout region), never blocking input.
- `src/data/mc_thoughts.json`: lines keyed by trigger (day start, coworker request, coworker missing, customer trait,
  event, failure, hollow reward) and conditions (which coworker, trait). Cooldown so they don't spam. The MC's tone
  never changes: apathetic and dry. Examples: "Man, this guy..." (B asks again), "Everyone always needs something
  urgent..." (frantic customer), "It's going to be a long seven hours." (C day start), "Shareholders. Sure." (A metrics talk).

## 5. Light customer trait tags
- Add tags to customers (frantic, confused, cheapskate, chatty), rolled per customer, used for thought triggers and a
  few dialogue variants. Small patience tweaks only. Full customer personalities come later.

## 6. UI
- Coworker figure shown in the station they're at, with their speech bubbles there.
- Top bar: "Working with: [name]" and where they are (at a station, on break, missing).
- "In use by [name]" overlay with time estimate on machines.
- Corner prompt for coworker requests (do / don't / ignore).
- Reserved layout regions for the coworker figure and all bubbles; extend the overlap test to cover them.
- End-of-day report: coworker section in corporate tone.

## 7. Balance and tests
- Batch runs per coworker; report player load, idle time, and days survived per coworker.
- Human-pace bot survives all three; B days only modestly harder; A days slightly busier but smooth.
- Tests: schedule streak rule, shared machine waiting, director scaling by capacity, each hook's outcome for do / don't /
  ignore, B's mishap replacing the random event, C's story progress persisting, thought cooldowns.

## Phases
1. Schedule, coworker agent, shared machines, director scaling, top bar status.
2. Personalities A, B, C with hooks and dialogue (placeholder lines are fine).
3. MC thought bubbles and customer trait tags.
4. UI regions, report section, balance pass, screenshots.

## Done when
Typecheck, tests, build pass; batch and human-pace targets met per coworker; the Playwright playtest passes with a
coworker on screen; each coworker clearly feels different within one day.
