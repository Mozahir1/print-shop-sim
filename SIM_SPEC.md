# Print Shop Sim: Full Simulation Spec

This spec turns the prototype into a realistic print and ship shop simulator. It covers the core mechanics and the
way the player experiences them. Satire, jokes, coworker characters, and story are separate layers and are out of scope.

**Status:** All phases are done. Phases 1 to 4 (shipping, stockroom, phone, machine upkeep) and 5 to 10 (knowledge
layer, store as the main screen, the computer, physical checks and hands, cues and mistakes, balance and cleanup) are
implemented and tested. The old career mode was cancelled and its leftovers removed. The phase sections below are kept
as a record of what each one specified.

---

## Ground rules (read first)

1. **Read the existing code before changing anything.** `client/src/sim/` already has walk-ins, web orders, pickups,
   self-serve, line patience, due times, printers (trays, toner, jams, warmup, queues), finishing, pricing, material
   costs, ratings, closing and overtime, shipping, stockroom, phone, machine upkeep, a bot, and dev tools.
   Extend it; don't rebuild it.
2. **Everything the player does is a task.** One employee. Actions go through `canStart()` / `startTask()` /
   `stopTask()` / `previewTask()`: walk to a station, then spend time working. `canStart()` returns a plain-English
   reason when an action isn't possible.
3. **`src/sim/` stays DOM-free** so `scripts/batch-sim.ts` keeps running headless in Node.
4. **Determinism.** Same seed + same play = same shift. New random systems get their own RNG stream. Looking at things
   (checking, opening apps) must never consume randomness.
5. **Money is integer cents.** Time is sim seconds since opening (sim time 0 = 9:00 AM).
6. **All existing tests keep passing** unless a phase explicitly changes the behavior they test; update those tests
   on purpose and say why. Add new tests per phase.
7. **The bot keeps working** and plays on true state (it's for balancing and testing, not fair play). Teach it every new
   task. `npm run batch` must still produce a competent day.
8. **Tuning lives in `config.ts`** (and JSON in `src/data/`).
9. **No real brand names, logos, or company-specific procedures.** Generic retail print and ship shop only.
10. **Don't change the server or SQL** unless a phase says so.
11. **Single shift only.** There is no multi-day mode.

---

## Already implemented (reference only)

- **Phase 1, Shipping** (`shipping.ts`): ship / drop-off / held-package customers, package lifecycle, daily carrier
  truck with refunds for missed express packages, morning delivery and check-in, shipping money.
- **Phase 2, Stockroom** (`inventory.ts`): back stock of paper, toner, rolls, boxes; tasks draw from it; fetch walking time.
- **Phase 3, Phone** (`phone.ts`): scheduled calls, ringing, answering, quote calls converting to web orders.
- **Phase 4, Machine upkeep** (`upkeep.ts`): copier paper and jams, printer breakdowns and tech visits, recall, jam waste.

---

## Design goal for Phases 5 to 10

Right now the UI shows the player everything: every tray level, every queue, every package, plus estimates and
suggestions. Real shop work isn't like that. You find things out by going to them, the computer only knows what's
been entered into it, and small things slip through the cracks.

Three rules drive everything below:
1. **The sim knows everything; the player doesn't.** The player sees only what they've checked, and what they saw can go stale.
2. **The store is the main screen.** You interact by walking to objects. The computer is one of those objects.
3. **Mistakes are possible and have consequences.** A careful player has a good day; a careless one has a noticeably bad one.

---

## Phase 5: Player knowledge layer (`src/sim/knowledge.ts`) (done)

Sim-side only. No UI changes yet (the old panels keep working until Phase 6).

### Snapshots
- Add `state.knowledge`: what the player has seen, each entry with the sim time it was observed.
- A snapshot is a copy of the relevant facts at that moment, never a live reference. Examples:
  - a tray's level (rounded to the nearest 50 sheets, or "about a quarter full" style buckets), checked at 10:42
  - a printer's toner bucket (full / half / low / empty) and its output tray contents
  - stockroom counts (rough, see Phase 8), copier paper and status, pickup shelf contents, package room contents
- Helpers: `knows(state, key)`, `snapshot(state, key)`, `age(state, key)`. Snapshots are plain data so tests and the UI can read them.

### What updates knowledge
- **Checking** something (a new task type per thing, Phase 8) writes a snapshot.
- **Doing work** at a place updates what you'd naturally see there: loading paper into a tray tells you that tray is full;
  clearing a jam shows you the printer's panel; packing a box at the scale shows you the box count you took from.
- **Computer apps** (Phase 7) write snapshots of what the system knows, which is not the same as physical truth.

### Acceptance criteria
- Snapshots don't change when the true state changes; only re-checking updates them.
- Checking consumes no randomness (determinism tests still pass).
- Unit tests for snapshot creation, staleness, and updates from work tasks.

---

## Phase 6: The store is the main screen (done)

### Layout
- The floor canvas becomes the main view, large and centered. Remove the dashboard panels (counter, orders, machines,
  stockroom, shipping, "You" suggestions, KPIs) from normal play. **Move them into dev mode** as a "true state" view for debugging.
- Make the floor readable as a store: counter and register, production area with printers, finishing table, pickup shelf,
  shipping scale, package room, stockroom, self-serve area, waiting area, door. Keep it simple shapes and labels
  (logic over looks), but every interactive object needs a clear click target.

### Interaction
- Click an object: your character walks there and a small **action menu** opens next to it, listing only what you can
  do there (Check trays, Load paper, Clear jam, Collect output...). Disabled actions show the `canStart()` reason on hover.
- Click a customer at the counter: talk to them (see what they want, in their words).
- Some objects open a **station view** (a modal) instead of a menu: the computer (Phase 7) and the stockroom shelves (Phase 8).

### HUD (all that's always on screen)
- **Wall clock:** current time only. No day progress bar, no "closes in", no truck countdown.
- **Current task** with a progress bar and a Stop button.
- **Hands:** what you're carrying (Phase 8).
- **Notepad** button (Phase 8).
- Speed controls and pause stay.

### Remove these crutches
- The "Suggestion" next-action button.
- "Your estimate" (ready-time estimate) when taking an order.
- Per-order "Next step" buttons and the global orders table.
- Header chips for truck and phone, and the KPI bar (sales, ratings, lost customers). Those numbers show on the end-of-shift report only.
- Autopause options for counter, truck, and phone. Plain pause stays.

### Acceptance criteria
- A full shift is playable using only the floor, menus, and HUD.
- Dev mode still shows the full true-state panels.
- Existing sim tests unaffected (this phase is UI only, plus any small sim helpers it needs).

---

## Phase 7: The computer (`src/sim/computer.ts`, UI in `src/ui/computer.ts`) (done)

The register has a computer. You must be standing at the register to use it. It opens as a desktop with app icons.
Opening an app takes a few seconds; refreshing a view takes a couple of seconds. Using the computer is a task (you're busy while on it).

### Apps
- **POS / Orders:** take an order (enter it from what the customer said), ring up pickups, list open orders with the
  status the system knows: ordered, sent to printer, paid. **It doesn't know whether a job is printed, finished, bagged,
  or on the shelf.** That's physical.
- **Inbox:** web orders and customer emails arrive here. Nothing pops up; the icon shows an unread count. Opening a
  web order is how you learn its specs and due time. Web orders you haven't opened can't be sent to a printer.
- **Print server:** pick an order, choose the printer, **set the job settings manually** (paper, color, duplex, copies,
  finishing note), and send. See each printer's queue, move jobs up or down, cancel, recall. Shows printer **error codes**
  (jam, paper out on tray X, toner out, needs service) but **not** tray levels or toner percentages.
- **Shipping:** rate a package, print the label, list of labels printed today. It doesn't know what's physically in the
  outbound bins or on the hold shelf. Shows the carrier pickup time as plain text.
- **Voicemail:** missed calls leave a message (who, what they wanted, a callback number). Calling back is a task
  that works like answering a call.

### Taking an order
- The customer's request is shown as speech at the counter ("50 copies, double-sided, on cardstock, by 2").
  The player enters it into the POS. Defaults are the plain options (letter, B&W, single-sided, no finishing),
  so the player has to set anything else themselves.
- What gets entered is what the system knows. If it differs from what the customer asked for, the job is wrong (Phase 9).
- Taking an order prints an **order ticket** that goes into your notepad (Phase 8) with the specs as entered.

### Acceptance criteria
- Every computer action is a task at the register with a duration; you can't use the computer from across the store.
- The print server never exposes tray levels or toner percentages.
- Unopened web orders can't be printed. Tests cover entering settings that match and don't match the customer's request.
- The bot uses the computer through the same task API, entering correct settings.

---

## Phase 8: Physical checks, hands, and output trays (done)

### Checks (new task types)
| Check | Where | Reveals | Time |
|---|---|---|---|
| Check trays | at a printer | each tray's paper level, bucketed | 5 s per tray |
| Check printer panel | at a printer | toner/ink bucket, current job progress, what's in the output tray | 5 s |
| Check copier | at a self-serve copier | paper bucket, jammed or not | 5 s |
| Glance at stockroom | stockroom | rough counts ("a few cases", "one box", "none") | 10 s |
| Count stockroom item | stockroom | exact count of one item | 20 to 60 s by item |
| Check pickup shelf | pickup shelf | which bagged orders are on it, by name | 10 s |
| Scan package room | package room | staged outbound, on-hold, unsorted packages | 5 s + 2 s per package |
| Check finishing table | finishing table | printed jobs waiting there | 5 s |

### Hands
- You carry **one thing** at a time: a case of a paper type, a toner cartridge or ink set, a roll, an empty box,
  a stack of printed output (one job), a bagged order, or a package.
- Restocking: take an item at the stockroom (a task), walk to the printer, load it. Loading needs the matching item in hand.
  Fetch time is no longer baked into task durations; it comes from actually walking.
- Grabbing the wrong item means another trip. Put-back is a task at the stockroom.
- Hands must be empty for counter work. If they're not, you set the item down on the counter (a short task) and it
  stays there until you pick it up.

### Output trays and moving work
- Printers no longer mark jobs "printed" into thin air. Finished sheets sit in the printer's **output tray**
  (capacity by printer, about 500 sheets for narrow format). A full output tray stops the printer with an error code.
- **Collect output** (task at the printer) puts the job in your hands. Carry it to the finishing table and do the
  finishing work there; the result is a bagged order in your hands. **Shelve** it at the pickup shelf.
- **Ring up** at the register requires the bagged order to be on the shelf. You fetch it during the ring-up (walk included).

### Notepad
- **Auto-notes:** your latest snapshots with how long ago you checked.
- **Order tickets:** one per order taken or web order opened, with specs as entered. Mark as done by hand.
- **Manual notes:** free text the player types.
- Opening the notepad is free (no task, no time); it only shows what you already know.

### Acceptance criteria
- A job only reaches the shelf by going printer, output tray, hands, finishing, hands, shelf.
- Out-of-date snapshots are visible as out of date; nothing refreshes without a check or work at that spot.
- The bot collects, finishes, and shelves correctly and the balance test still passes (retune if needed).

---

## Phase 9: Cues and mistakes (done)

### Cues instead of alerts
- **On the floor:** a stopped printer shows a blinking light on its sprite (not the reason). A ringing phone and the
  door chime show as small icons at their location. The carrier truck appears outside the door while the driver waits.
- **Customers tell you things:** a self-serve customer whose copier stopped comes to the counter and says so after a
  short wait. A pickup customer asks for their order by name.
- **Missed things leave traces, not popups:** missed calls go to voicemail; unread emails pile up; when the driver
  leaves, there's no message. You find out by seeing packages still in the bin.
- Remove log lines that hand the player information they wouldn't have (for example "the color printer is out of toner"
  as a global message). The activity log becomes a record of **your own actions** only. Dev mode keeps the full log.

### Mistakes and their costs
| Mistake | How it happens | Consequence |
|---|---|---|
| Wrong job settings | entered something different from the request | job prints wrong; customer refuses it at pickup; you reprint at your cost and they wait; rating hit |
| Wrong paper in a tray | loaded a different stock than the tray holds | jobs from that tray print on the wrong stock (same as wrong settings) |
| Output left in the tray | never collected | tray fills, printer stops |
| Order not shelved / bagged with the wrong ticket | shelved under a different name, or left on the finishing table | ring-up takes much longer while you search; rating hit |
| Package not staged | never put in the outbound bin | misses the truck |
| Missed the truck | not at the package room when the driver came | existing refund and rating rules |
| Unread web order | never opened the inbox | starts late, possibly misses its due time |
| Took an order you can't fill | out of the needed stock | stuck mid-job until you find a fix; late |

- Each mistake is deterministic given the player's actions (no random "mistake rolls").
- The end-of-shift report lists mistakes made, so the player can learn from them.

### Acceptance criteria
- Tests for each row of the mistakes table: the mistake is possible, and its consequence happens.
- The bot never makes these mistakes (it enters correct settings and follows the full job path).

---

## Phase 10: Balance pass and cleanup (done)

- **Remove career mode leftovers:** `mode: "career"`, `supplyOrders`, `SupplyOrder`, `placeSupplyOrder`,
  `receiveSupplyOrders`, and any related UI and tests. `mode` can go entirely if nothing else uses it.
- **Retune** so a careful human has a decent day and a careless one has a clearly worse one. Use the bot for the
  "careful" baseline. Add a second bot setting in `batch-sim.ts` that skips checks and forgets things on purpose
  (for example, never checks email until something is late, collects output late) to measure how punishing carelessness is.
  Report both in the batch output.
- **README:** update "How it's built", the gameplay section, and controls for the new UI. Remove anything about career mode.
- Delete this spec's completed phases or mark them done.

### Acceptance criteria
- No references to career mode remain.
- Batch output shows a clear score gap between the careful and careless bots.

---

## Out of scope
- Multi-day play, career mode, story (planned separately).
- Coworkers, breaks, character personalities, satirical events and dialogue (separate layers).
- Cash drawer counting and a separate POS cash flow.
- Sprites and art. Simple shapes and labels are fine.

## Definition of done
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- `npm run batch -- --shifts 50` runs clean for both bot settings.
- A full shift is playable in the browser using only the store, the computer, menus, the HUD, and the notepad.
