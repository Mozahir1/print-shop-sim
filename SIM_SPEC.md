# Print Shop Sim: Full Simulation Spec

This spec turns the current prototype into a complete print and ship shop simulator. It covers the
"boring" core mechanics only. Satire, jokes, and coworker characters are a separate layer and are out of scope.

Work through the phases in order. Finish each phase (code, tests, bot support, UI) before starting the next.

---

## Ground rules (read first)

1. **Read the existing code before changing anything.** The prototype in `client/src/sim/` already has walk-ins,
   web orders, pickups, self-serve, line patience, due times, printers (trays, toner, jams, warmup, queues),
   finishing, pricing, material costs, ratings, closing/overtime, a bot, and dev tools. Extend it; don't rebuild it.
2. **Everything you do is a task.** The player is one employee. New actions must go through the existing
   `canStart()` / `startTask()` / `stopTask()` / `previewTask()` flow: walk to a station, then spend time working.
   `canStart()` returns a plain-English reason when an action isn't possible.
3. **`src/sim/` stays DOM-free** so `scripts/batch-sim.ts` keeps running headless in Node.
4. **Determinism.** Same seed + same play = same shift. Every new random system gets its **own RNG stream**
   (like the existing `day` and `machine` streams) so adding a system never changes what the existing streams produce.
   The existing test "the day's customers don't depend on how you play" must keep passing.
5. **Money is integer cents.** Time is sim seconds since opening (sim time 0 = 9:00 AM).
6. **All existing tests must keep passing.** Add new tests per phase (see acceptance criteria).
7. **Teach the bot every new task** so `npm run batch` still produces a competent day. The existing balance test
   (`a competent employee gets through the day`) must still pass after every phase. Retune numbers if it doesn't.
8. **Tuning lives in `config.ts`** (and JSON in `src/data/`). Use the defaults below as a starting point.
9. **No real brand names, logos, or company-specific procedures.** Generic retail print and ship shop only.
10. **Don't change the server or SQL** unless a phase says so. Extra fields in the posted summary are fine.

---

## Phase 1: Shipping (`src/sim/shipping.ts`)

The biggest gameplay addition. Shipping pays less than printing but takes your time, and ignoring it still
costs ratings. That tradeoff is the point.

### New customer purposes
Extend `Purpose` with:
- **`ship`**: sending a package. Rolled per customer: weight (1 to 40 lb), service (`ground` / `two_day` / `overnight`),
  and whether they brought it packed or need us to box it (box size from weight: up to 5 lb small, up to 20 lb medium, else large).
- **`dropoff`**: 1 to 3 packages with prepaid labels (returns). No revenue.
- **`package`**: picking up a package being held for them.

They arrive on their own hourly schedules, generated from a new RNG stream. They stand in the same line as everyone else,
balk at long lines like order customers, and use the same line-wait rating penalty.

### Packages
A `Package` record: id, customer, direction (out/in), service, weight, price paid, status, timestamps, missed-truck count.
- Outbound: `staged` (in the outbound bins) then `shipped` (on the truck).
- Inbound: `unsorted` (arrived on the morning delivery) then `on_hold` (on the hold shelf) then `released`.

### Tasks
| Task | Where | Time (default) | Effect |
|---|---|---|---|
| `ship_package` | shipping scale behind the counter | 150 s + packing (small 120 s, medium 180 s, large 300 s) | Uses a box from the stockroom if packing. Charges the customer. Package becomes `staged`. |
| `accept_dropoff` | register | 25 s + 10 s per package | Packages become `staged`. No charge. |
| `check_in_packages` | package room | 30 s + 15 s per package | All `unsorted` inbound packages become `on_hold`. |
| `release_package` | register | 60 s | Customer's package becomes `released`. |
| `hand_off_truck` | package room | 30 s + 5 s per staged package | All `staged` packages become `shipped`. |

`turn_away` should also work for ship customers (for example, when you're out of the right box).

### The carrier truck
- One pickup a day at **4:15 PM**. The driver waits **10 minutes**.
- If `hand_off_truck` isn't done by then, the driver leaves. Every package still staged **missed the truck**:
  `two_day` and `overnight` packages are refunded (revenue goes down by what they paid); `ground` just goes out tomorrow.
- Packages accepted after the truck left aren't "missed." But an express customer who ships after the truck left loses
  **1 star** (it goes out a day late).
- Log the truck arriving, waiting, and leaving, and make it obvious in the UI.

### Morning delivery
- A mean of **6** inbound held packages arrive at open as `unsorted`.
- About **75%** of their owners come in today, spread across the day.
- A `package` customer whose package is still unsorted can't be helped yet. They wait in line until you check the delivery in
  (or run out of patience, leave, and come back later like a pickup customer).

### Money (cents)
- Retail rate = base + per lb: ground 1100 + 90/lb, two-day 2400 + 220/lb, overnight 4200 + 380/lb.
- Carrier cost = 70% of the retail rate (booked as cost at sale).
- Packing fee: small 600, medium 1000, large 1600. Packing material cost: 40 per box, plus the box itself (see Phase 2).

### Acceptance criteria
- A ship customer can be served start to finish. Revenue and cost are correct for a packed and an unpacked package.
- Missing the truck refunds express packages and not ground. Handing off in time ships everything.
- A package pickup can't be released before check-in, and can be after.
- The bot handles all of the above, and the balance test still passes.
- Stats and end-of-shift report include: shipments, shipping revenue, drop-off packages, package pickups, missed-truck packages, refunds.

---

## Phase 2: Stockroom (`src/sim/inventory.ts`)

Supplies stop being infinite.

### Stockroom contents
Back stock, as a record of item to count: letter, legal, tabloid, and cardstock paper (in sheets); wide format rolls;
B&W toner, color toner set, wide format ink set; and small, medium, and large boxes.

Starting levels for a single shift are random from a new RNG stream:
| Item | Start range | Order pack | Pack cost |
|---|---|---|---|
| Letter | 4,000 to 15,000 sheets | case, 5,000 sheets | $45 |
| Legal | 1,000 to 3,000 | case, 5,000 | $55 |
| Tabloid | 1,000 to 2,500 | case, 2,500 | $60 |
| Cardstock | 250 to 1,250 | case, 1,250 | $65 |
| Wide rolls | 0 to 2 rolls | 1 roll | $75 |
| B&W toner | 0 to 2 | 1 cartridge | $90 |
| Color toner | 0 to 2 sets | 1 set | $220 |
| Wide ink | 0 to 2 sets | 1 set | $180 |
| Small boxes | 5 to 20 | bundle of 25 | $15 |
| Medium boxes | 4 to 15 | bundle of 25 | $25 |
| Large boxes | 2 to 8 | bundle of 10 | $20 |

### Rules
- `load_paper` takes what the tray needs from the stockroom. If the stockroom has some but not enough, fill partially.
  If it has none, `canStart` says so.
- `replace_toner` uses one cartridge or set. None in stock means you can't.
- Packing a shipment uses one box of the right size. None in stock means you can't pack (you can turn them away or take it
  in their own box if they brought one packed).
- Self-serve copier refills (Phase 4) use letter paper from here.
- **Fetching costs time:** add the round-trip walk from the machine to the stockroom to every task that takes supplies.
- **Supply orders:** you can place an order (not a task, just a button), paid immediately, delivered next morning.
  It only matters in career mode (Phase 5). Hide ordering in single-shift mode.

### Acceptance criteria
- Paper, toner, and boxes deplete the stockroom. Running out blocks the task with a clear reason.
- Fetch walking time is included in task duration.
- The bot restocks sensibly and the balance test still passes.

---

## Phase 3: Phone (`src/sim/phone.ts`)

### Calls
- Scheduled per hour from a new RNG stream (default 1.5 to 2.5 per hour, busiest at lunch).
- Kinds and weights: quote 4, order status 3, hours 2, shipping rates 2.
- Each call **rings for 30 seconds**, then goes to voicemail (missed).

### Task
- `answer_phone`, at the register. Talk time by kind: quote 2 to 5 min, order status 45 s to 2 min, hours 20 to 45 s, shipping rates 1 to 3 min.
- You can't answer while you're in a non-interruptible task (for example, mid-transaction at the counter). Finishing work can be put down to answer.
- If you start walking to the phone while it's ringing, it doesn't hang up on you mid-walk.

### Consequences
- About **55%** of answered quote calls turn into a web order 10 to 90 minutes later.
  Pre-generate these "lead" customers when the day is generated, so answering only activates them (determinism).
- Missed calls are counted in stats. In career mode they count against reputation (Phase 5).

### Acceptance criteria
- Calls ring and go to voicemail on time if ignored.
- Answering a quote call can produce a web order later. The same seed and same play produce the same calls and conversions.
- The bot answers when it reasonably can, and the balance test still passes.

---

## Phase 4: Machine upkeep (`src/sim/upkeep.ts`)

### Self-serve copiers
- Each copier gets a paper level (1,500 sheets of letter capacity), a status (`ok` / `jammed` / `out_of_paper`), and jams
  (mean 1,800 sheets between jams).
- Copying becomes progress-based (work left) instead of a fixed finish time, so it can stop mid-job.
- When a copier stops, the customer stands there waiting. If nobody fixes it within their patience, they give up:
  low rating, no sale, new outcome `copier_gave_up`.
- Tasks: `fix_copier` (45 to 150 s at the copier) and `refill_copier` (60 s + stockroom fetch).
- Copiers start each single shift full.

### Production printer breakdowns
- Each production printer has about a **6%** chance per day of an error you can't clear (new status `needs_service`).
- A tech arrives **2 to 4 hours** later and takes **30 to 90 minutes**. The printer is unavailable until then.

### Recall
- `recall_job` (20 s at the register): pull a queued or stuck job off a printer and set it back to unsent,
  keeping sheets already printed, so you can resend it to another printer.

### Jam waste
- Every production jam ruins 1 to 5 sheets that have to be reprinted (subtract from sheets printed, count the material cost).

### Acceptance criteria
- A jammed copier blocks its customer until fixed. An ignored one leads to `copier_gave_up`.
- A broken printer stays down until the tech is done. Recalled jobs can be resent and finish correctly.
- Existing self-serve tests still pass (copiers start full; a short job should rarely jam).
- The bot fixes copiers, recalls jobs off broken printers, and the balance test still passes.

---

## Phase 5: Career mode (`src/sim/career.ts`)

Multi-day play. The daily-seed single shift stays exactly as it is for the leaderboard.

### Carries over to the next day
- Open print orders (unsent, queued, printing, printed, ready). Printers keep their queues.
- Customers with open orders come back the next morning. "Tomorrow" orders are due at open.
- Held packages not picked up, and outbound packages that missed the truck (they go on today's truck).
- Stockroom levels, plus yesterday's supply orders delivered at open.
- Printer trays, toner, and status (a printer waiting on a tech is fixed overnight). Copier paper levels.
- Shift timestamps carried over move back by 24 hours so lateness math keeps working.
- Job ids keep counting up. Customer ids must stay unique.

### Money and reputation
- Bank starts at **$2,500**. Each day: + revenue, - carrier costs, - supply purchases, - **$300** fixed daily cost (rent, utilities, your wage).
  Daily profit in the report still uses materials used; the bank is cash-based.
- Reputation = average rating over the last **3** days. Tomorrow's walk-in and web traffic scale by
  **15% per star** above or below 4, clamped to 70% to 125%. Missed calls lower reputation slightly.
- Bankruptcy (bank below zero at the end of a day) ends the career.

### Flow and saving
- The end-of-day screen shows the day report, bank balance, reputation, and a "Start day N+1" button.
- Save between days in `localStorage` (wrapped in try/catch). On load, offer "Continue career (day N)".
- Career days can't be submitted to the daily leaderboard.

### Acceptance criteria
- An order taken late on day 1 can be picked up on day 2 with correct lateness.
- Supply orders arrive the next morning. Missed outbound packages ship the next day.
- Good ratings raise traffic and bad ratings lower it.
- The bot can play 5 career days in a row without crashing or going bankrupt with default tuning.

---

## Cross-cutting updates

- **`types.ts`**: new purposes, outcomes, Package/Truck/Call/Stockroom/SupplyOrder types, copier status, `needs_service`,
  new task types, and new stats. `TaskRequest` gains `copierId` and `callId`.
- **`layout.ts`**: shipping scale (right end of the counter, staff side), package room and stockroom (staff-only, right side of the floor).
- **`schedule.ts`**: generate shippers, drop-offs, held-package owners, and calls on their own RNG streams, plus a traffic multiplier for career mode.
- **`sim.ts`**: route new tasks through `canStart` / `buildTask` / `completeTask`; call new systems from `tick`; make
  arrivals, balking, leaving the line, and end-of-day finalize handle the new purposes. Pull shared helpers
  (log, walk, lookups, line helpers) into a `util.ts` if needed to avoid circular imports.
- **`bot.ts`** priority: hand off the truck, stopped machines (printers, copiers, broken printer recalls), ringing phone,
  counter (including shipping), send and finish jobs, check in packages, restock.
- **`summary.ts`**: report rows for every new stat. Keep the server summary shape compatible.
- **`dev.ts`**: restock covers the stockroom and copiers and clears `needs_service`. Spawn options for shippers, drop-offs,
  package pickups, and calls. Upcoming list includes them.
- **UI** (`panel.ts`, `render.ts`, `main.ts`, `index.html`), matching the existing style:
  - Counter panel handles ship, drop-off, and package customers with the right buttons.
  - Shipping panel: truck countdown and status, staged count, unsorted and on-hold counts, hand-off and check-in buttons.
  - Stockroom panel: levels with low-stock warnings; order buttons in career mode.
  - Phone indicator in the header or "You" panel with an Answer button while ringing.
  - Copier cards: paper level, status, fix and refill buttons. Printer cards: `needs_service` with tech ETA.
    Orders table: recall button for jobs stuck on a stopped printer.
  - Floor map: draw the new zones and the truck at the door while it's waiting.
  - End screen: new report rows; career flow from Phase 5.

---

## Out of scope
- Cash drawer counting and a separate POS (revenue tracking already covers it).
- Coworkers, breaks, and character personalities (separate layer).
- Satirical events and dialogue (separate layer).

## Definition of done
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- `npm run batch -- --shifts 50` runs clean and the averages look like a real shop day (the bot is busy a good chunk of
  the shift but not at 100%, ratings mostly 4+, profit positive).
- README updated with the new systems and how to play career mode.
