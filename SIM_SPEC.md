# Print Shop Sim: Spec v8.1 (small fixes)

Read `CLAUDE.md` first. Small follow-up to v8. Keep everything else as is. Do all four items, run the checks, then stop
and summarize with screenshots.

## 1. Due times and pickups
- Every due time falls inside open hours. A customer's requested time is capped at close minus a buffer (config);
  if the job can't be done today, the order is for **tomorrow morning** (said in dialogue, shown on the note).
- Every accepted order gets a pickup visit, today or the next day. Unfinished or uncollected orders carry over and the
  customer returns the next morning.
- Test: across many seeds, no accepted order ends without a pickup visit.

## 2. Taking a job means doing it
- Remove automatic routing of taken orders to the self-serve copier.
- **Take order** always means full service: enter it, print on the production printer, collect, finish, bag, shelve,
  ring up at pickup. Same steps whether it's 2 pages or 200.
- **Send to self-serve** is the only way a job goes to the self-serve copier (customer does it; no work for you, less revenue).
- Balance so small self-serve-eligible jobs tempt the player to send them over or turn them away: self-serve saves
  time; taking it earns full-service price plus the small-order fee.

## 3. Computer: four apps
- **Orders:** new order form; open orders with clear status (entered, printing, ready to collect, bagged, picked up); tap for details.
- **Email:** every message-like thing lives here, and every message has a real body. Web orders (specs in the body, plus
  "Enter this order" opening a prefilled form), complaints (who, what, which order), manager notes (warning or write-up
  with reason), corporate memos and hollow rewards (actual text). Newest first; action items flagged.
- **Devices:** status of production printer, self-serve copier, card reader, Wi-Fi: OK or the problem plus a one-line hint ("Jam in tray 2. Go to the Printer.").
- **Shipping:** label form, today's outbound packages, truck time.
- Remove separate memo and reminder lists (fold into Email or delete empty ones). Unread badges on app icons.
- Test: no message can be created without a body.

## 4. Hold labels covering the progress bar
- Progress meters are always on top and never covered. Action labels sit above or beside the object.
- Extend the overlap check to transient labels during hold, drag, and tap steps.

## Done when
typecheck, tests, build pass; batch targets and the Playwright playtest checks still pass.
