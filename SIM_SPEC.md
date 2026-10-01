# Print Shop Sim: Gameplay Spec (v3)

**This replaces the previous spec.** The game is changing direction: from a realistic, stressful shop simulator to a
low-stress job game where **choices and their consequences** are the core. The realism-heavy systems built in the last
round (knowledge, checks, hands, mistakes, multi-printer management) get removed or simplified. The job loop and the
main character get finished here. Coworkers, customer personalities, regulars, and story come in a later spec.

Work through the phases in order. Finish each phase (code, tests, bot, UI where listed), run the checks, then **stop and
summarize** before starting the next.

---

## Ground rules

1. **Checkpoint first.** Before deleting anything, commit the current state and tag it `realistic-sim` so it can be recovered.
2. **Read the existing code before changing it.** Reuse what fits; delete what doesn't. Don't leave dead code or unused config behind.
3. **The task system stays.** Player actions still go through `canStart()` / `startTask()` / `stopTask()` / `previewTask()`,
   with `canStart()` returning a plain-English reason when an action isn't possible.
4. **`src/sim/` stays DOM-free** so `scripts/batch-sim.ts` runs headless in Node.
5. **Determinism.** Same seed + same choices = same day. Separate RNG streams per system. Choices never consume randomness.
6. **Money is integer cents.** Time is sim seconds since opening.
7. **Content is data.** All dialogue, MC lines, event text, and reward text live in JSON under `src/data/`, not in code.
8. **Tests.** Old tests for removed systems get deleted with them. Every phase adds tests for what it builds.
9. **No real brand names, logos, or company procedures.** Generic print and ship shop.
10. **Server and SQL stay as they are.** The client must still post a summary the server accepts (see Phase 9).
11. **Write player-facing text without em dashes.** Use commas, periods, or colons.

---

## Design pillars

- **Low stress, never idle.** The clock always runs (while talking and while doing tasks). There's always one obvious
  thing to do and rarely more than two or three at once. No downtime, no overload.
- **Choices are the game.** How the player handles customers and tasks decides what happens.
- **You fail by not caring, not by being a bit slow.** An attentive player doesn't fail by accident. Ignoring things,
  being rude, or doing sloppy work eventually gets you fired.
- **Perfection gets you nothing.** Doing a perfect job just keeps the game going with hollow rewards. The MC never changes.
- **No maintenance busywork.** Supplies and machines only need attention when something actually happens, and then it's
  one clear task.

---

## Phase 1: Teardown (done)

Remove the realism systems. Delete their code, config, types, UI, and tests.

**Remove entirely**
- `knowledge.ts` (snapshots, staleness, observe/glance/count)
- `hands.ts` (carrying, set down, pick up, put back) and all hands-empty requirements
- `mistakes.test.ts` and the mistake mechanics: manual job settings mismatches, wrong paper in a tray, mislabeled or
  unshelved orders, output tray capacity stalls
- Physical check tasks (check trays, check panel, check copier, glance/count stockroom, check shelf, scan package room, check finishing)
- `ui/notes.ts` (notepad), `ui/stockroom.ts`, the walkable floor as the main interaction model (`ui/floor.ts` can be reused for
  a background picture or removed)
- Stockroom as a managed resource (`inventory.ts`): no back stock counts, no fetching, no supply orders
- Production printer breakdowns, tech visits, `needs_service`, and `recall_job`
- Jam waste sheets
- Phone calls, ringing, voicemail (`phone.ts`). Web orders and messages arrive through the inbox only.
- The hourly arrival schedule in `schedule.ts` (replaced by the flow director in Phase 3)
- Star ratings, penalties in stars, `satisfaction()` as currently computed, the score formula (replaced in Phase 5)
- Carrier refunds math and missed-truck refunds
- Any remaining career or multi-day economy code (`mode`, `supplyOrders`, etc.)
- Self-serve "goes alone / with help / full service" rolls and the copier queue math

**Keep**
- RNG, determinism tests, the task system, `util.ts`, time formatting, pricing basics in `orders.ts`, the bot and batch sim
  (they'll be rewritten against the new loop), dev mode (it will show true state), the API client and summary posting.

**Acceptance:** the project typechecks and the remaining tests pass, even if the game is temporarily not playable. List
in the summary what was deleted.

---

## Phase 2: The simplified job (done)

One employee (the MC), a handful of stations, short readable tasks (a few seconds to about 30 game seconds each).

### Stations and tasks
| Station | Tasks |
|---|---|
| **Counter** | Talk to the customer (opens the choice menu, Phase 4), hand over an order, ring up |
| **Computer** | Enter the order (choose specs from what the customer said; defaults are prefilled from the request, the player just confirms), send it to the printer, open the inbox (web orders and messages) |
| **Printer** (one production printer) | Collect a finished job, clear a jam, load paper when the tray is empty |
| **Finishing table** | One step per finishing type (staple, cut, laminate), then bag it |
| **Self-serve copier** | Help a stuck customer, fix the copier |
| **Shipping** | Weigh, pick a box, tape it, print the label, put it in the outbound bin, hand off to the driver when the truck comes |

### Rules
- **One production printer** handles color and B&W, letter, legal, tabloid, cardstock. Wide format is gone for now.
- **Supplies are events, not resources.** The paper tray runs out at most occasionally (seeded) and shows "Tray empty."
  Loading paper is one task. There is no stock count.
- **Jobs flow:** ordered, sent, printing, printed (waiting at the printer), finished and bagged, picked up.
  Collecting from the printer and finishing are simple tasks, no carrying.
- **Self-serve:** customers use it on their own. It only needs you when a bad luck event hits it or a customer asks for help.
- **Shipping:** ship (weigh, box, label, bin), drop-off (scan, bin), pickup of a held package (find it, hand it over).
  The truck comes once a day; handing off is one task. Packages left in the bin go tomorrow; that's a consequence hook (Phase 5), not a refund calculation.
- **Pricing:** keep the existing price list logic for revenue shown in the end-of-day report. Revenue is flavor, not a win condition.

**Acceptance:** a scripted test can take each request type from arrival to done using only tasks. Tasks have short fixed
durations from `config.ts`.

---

## Phase 3: Day structure and flow director (done)

### The day
- About **5 real minutes** at default speed, about **10 to 15 customers**. The in-game clock is compressed (open to close).
- **Start of day:** MC monologue line, an inbox message (corporate note or a hollow reward, Phase 5), store opens.
- **During:** customers, tasks, at most one bad luck event (Phase 6).
- **Close:** customers already inside get finished or leave; no new arrivals.
- **End of day:** end-of-day report (Phase 8), then the manager outcome (Phase 5), then "Start next day."

### Multiple days
- Days run in sequence. **Only this carries over:** manager heat, write-ups, consequence flags, orders not yet picked up,
  packages left in the outbound bin, and the day number. No money, no supplies, no machine state.
- Save between days in `localStorage` (wrapped in try/catch). On load: "Continue (day N)" or "New game."
- Each day uses seed = base seed + day number.

### Flow director (replaces the arrival schedule)
- Keeps the player's load in a target band: spawn the next customer or task when **active things** (customers waiting or
  being served + jobs needing the player) drop below the band's floor; hold back when at or above the ceiling.
- Default band: at least 1 active thing, at most 3. A small random gap (seconds) between spawns, from the director's RNG stream.
- Request mix from `config.ts` weights: quick copies, larger print job (wait or come back later), poster/laminate,
  ship, drop-off, order pickup, held package pickup, self-serve help.
- **Difficulty ramps slowly with the day number:** slightly shorter patience, slightly more multi-step requests, never more than the band ceiling.

**Acceptance:** batch runs show near-zero idle time (track seconds with no active thing; target under 5% of the day) and
never more than the band ceiling. Same seed and same choices produce the same day.

---

## Phase 4: Choices and customer mood (done)

### Counter choices
Talking to a customer opens up to four options, always written in the MC's flat voice:
- **Proper:** do it right.
- **Minimum:** do it, barely (no small talk, no upsell, rushed).
- **Rude:** say the thing.
- **Ignore:** don't engage; the customer keeps waiting.

Not choosing anything for long enough counts as Ignore.

### Task choice points
Some tasks offer a lazy alternative:
- Smudged or misprinted copy: reprint it, or hand it over anyway.
- Broken self-serve copier: fix it, or tape an "out of order" sign on it.
- Packing: pack it properly, or just tape it shut.
- Inbox: process a web order now, or leave it unread.
- Truck: hand off the packages, or let the driver leave.

Lazy options are faster. Each choice is recorded with its type (proper, minimum, rude, ignore, lazy).

### Customer mood
Each customer has a mood: happy, neutral, or angry. It's set by the choices made during their visit and by waiting:
- Proper: happy. Minimum: usually neutral. Rude: usually angry. Ignored or waited far past patience: angry and they leave.
- Lazy task results that the customer would notice (smudged copies, taped box) lower their mood when they get it.
- Use seeded rolls only where the outline says "usually," from a dedicated stream, so the same choices give the same result.

### Patience
- Every customer has patience (seconds, from config, adjusted by the day ramp). Waiting in line and waiting for an order both use it.
- Patience is generous: a reasonably attentive player never hits it.

**Acceptance:** tests cover each choice type's effect on mood, ignore-by-timeout, and each lazy task option.

---

## Phase 5: Consequences (done)

### Hidden meters (never shown as numbers)
- **Manager heat (0 to 100):** rises from complaints, angry customers, rude choices, ignored customers, unhandled bad luck,
  packages left behind. Falls a little after a clean day (no complaints).
- **Write-ups:** 3 write-ups = fired.

### Complaints
- Angry customers usually complain. Neutral customers sometimes complain. Happy customers don't.
- Complaints show up as inbox messages (same day or next morning) and add heat.

### End-of-day manager outcome
Based on heat at close: nothing, a verbal warning (message), or a write-up (message). Thresholds in config.
On the third write-up: **fired** (Phase 7).

### Delayed consequences (flags)
- Choices can set a flag with a due day. When it comes due, it fires an event (a message, an angry returning customer, extra heat).
- Starter set: taped-shut box comes back damaged in 1 to 2 days; a rude reply becomes a bad online review next morning;
  smudged copies come back the same day or next; packages left in the bin cause a complaint next day.
- Flags persist across days with the save.

### Perfect play: hollow rewards
- A clean day queues a **hollow reward** message for the next morning, from a JSON pool (placeholders below).
- There's no score bonus, no unlock, and no change to the MC. The MC reacts with the same deadpan line every time.

**Acceptance:** tests show a rude/ignore playstyle reaching 3 write-ups, a proper playstyle never getting a write-up,
delayed flags firing on the right day, and hollow rewards appearing after clean days.

---

## Phase 6: Bad luck events (done)

- **About one per day, never two at once.** Rolled from a dedicated RNG stream; each day may also have none.
- Starter set: printer jams mid-job, self-serve copier dies, card reader goes down (ring-ups take a manual workaround task),
  a box rips while packing (repack), Wi-Fi drops (a web order arrives late in the inbox).
- Each is **obvious** (clear on-screen prompt) and **simple** (one or two tasks to fix).
- Ignoring it causes trouble: the job stalls, a customer waits and gets angry, heat rises.
- Each offers the fix, a lazy workaround where it makes sense (out of order sign), or ignoring it. These are choices (Phase 4).

**Acceptance:** each event can be triggered in dev mode, fixed, worked around, or ignored, with the right consequence.

---

## Phase 7: The MC and endings (done)

### The MC
- Fixed personality: apathetic and dry. **Demeanor and voice never change based on player choices.**
- The player chooses actions, not attitude. Even Proper options read as bored.
- **Monologue lines** fire on: start of day, bad luck event, hollow reward, warning, write-up, end of day, getting fired.
  Lines come from `src/data/mc.json` keyed by moment, with a few variants each, picked deterministically.

### Endings
- **Getting fired is the only ending for now.** A short end scene (text) picks a variant by the main cause:
  too many complaints, too much ignoring, rude to customers. Placeholder text for now.
- After the ending: "New game." No win state.

---

## Phase 8: UI (functional, not final) (done)

Replace the store-walking UI with a **counter view**:
- **Center:** the current customer (name, request text in their words, mood indicator only through their dialogue), and the choice buttons.
- **Side:** station buttons (Computer, Printer, Finishing, Self-serve, Shipping). Clicking one opens a small panel with that station's tasks.
- **To-do list:** the current obvious tasks (customers waiting, a job ready at the printer, tray empty, truck here). This is what makes "always something to do" readable.
- **HUD:** clock, current task with progress bar, speed and pause.
- **Inbox:** unread count on the Computer button; messages open in the computer panel.
- **Monologue:** MC lines show as a small caption.
- **End-of-day report:** satirical corporate metrics (customers served, "upsell opportunities missed", complaints,
  a meaningless "Team Spirit Index"), revenue, and a tone line from the manager outcome. Never show heat as a number.
- **Dev mode:** shows true state (heat, write-ups, flags, director band, upcoming events) and can trigger events and skip days.
- Keep it plain and readable. Art comes later.

---

## Phase 9: Bot, batch, server, README (done)

- **Bot playstyles:** proper, minimum, rude, ignore, lazy, random. Each picks its choice type consistently.
- **Batch sim:** `npm run batch -- --days 20 --style proper` (and `--style all`) reports days survived per style,
  average idle time, average active-thing count, complaints per day.
- **Targets (tune config until true):** proper and minimum survive 20 days; rude and ignore get fired within 2 to 6 days;
  lazy lands somewhere in between; idle time under 5%.
- **Server compatibility:** keep posting the existing `ShiftSummary` shape at end of day. Map: score = customers served,
  cashCents = day revenue, satisfaction = share of happy customers (0 to 100), customersLost = angry customers,
  jams = bad luck events. No server or SQL changes.
- **README:** rewrite "How it's built", gameplay, controls, and the batch commands for the new loop. Remove everything about the realistic sim.

---

## Placeholder content (put in JSON, testing only)

**MC (`src/data/mc.json`)**
- greeting: "Hi. What do you need."
- proper: "Yeah, I can do that."
- minimum: "Sure."
- rude: "That's not how printers work."
- ignore: *(keeps staring at the screen)*
- lazy: "Good enough."
- bad luck: "Of course."
- hollow reward: "Cool."
- warning: "Noted."
- write-up: "Okay."
- start of day: "Another day."
- end of day: "That's a day."
- fired: "Okay."

**Customers (`src/data/customers.json`, by request type and mood)**
- quick copies: "I just need a few copies, real quick."
- larger job: "Can this be ready by two?"
- poster or laminate: "Can you make this bigger?"
- ship: "How much to ship this? It's just a box."
- drop-off: "Just dropping this off."
- order pickup: "I'm here to pick something up."
- held package: "I got a text saying my package is here."
- self-serve help: "This machine isn't doing anything."
- waiting too long: "Is anyone working here?"
- happy: "Thanks!"
- neutral: "Okay."
- angry, leaving: "I'll go somewhere else."

**Messages (`src/data/messages.json`)**
- complaint: "Your employee was very unhelpful."
- bad review: "One star. Would not print again."
- warning: "Hey, can we talk about yesterday? Let's do better."
- write-up: "Please sign the attached write-up."
- hollow rewards: "Great job team!", "Pizza party coupon (expired)", "Congrats on your 3 cent raise.",
  "Employee of the Month certificate attached. Please print it yourself."
- fired: "We're going to have to let you go."

Structure the data so lines can later be tagged by **customer trait** and **speaker** (coworkers) without changing code.

---

## Out of scope (next spec)
- Coworkers and the manager as an on-screen character (the manager exists only as heat and messages for now)
- Customer personalities and trait-based dialogue, regulars
- Story, art, sound

## Definition of done
- `npm run typecheck`, `npm test`, `npm run build` pass.
- `npm run batch -- --days 20 --style all` meets the Phase 9 targets.
- In the browser: a full day is playable from the counter view, the next day continues from the save, and a rude
  playthrough ends in getting fired.
