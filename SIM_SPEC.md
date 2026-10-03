# Print Shop Sim: Spec v4 (choice model + counter decisions)

Builds on the current version. Keep the existing UI, days/saving, flow director, bad luck events, heat and write-ups,
delayed consequences, hollow rewards, to-do list, and dev mode. Only change core logic below.
Many removed features still exist in the `realistic-sim` git tag (turn away, self-serve ushering and refusals, timing,
price quotes, ready-time estimate). Restore simplified versions from there instead of rewriting.

Rules: `src/sim/` stays DOM-free and deterministic (customer reactions use a seeded stream; choices never consume
randomness). Content stays in JSON. Update tests and the bot with each change. Player-facing text has no em dashes.

## Direction
Low stress, never idle, choices matter. The MC's attitude never changes and isn't graded. The manager cares about
the job getting done and sales, not manners.

## 1. Choices: Do / Don't / Ignore
- Replace proper / minimum / rude / lazy everywhere with **do / dont / ignore**.
- Counter: **Do** = handle it (sub-options in section 2). **Don't** = engage and decline (turn away). **Ignore** = don't
  engage; they wait until you return or give up. Not choosing for long enough counts as ignore.
- Tasks and events use the same three: Do = fix properly (fix copier, pack properly, reprint smudged copy).
  Don't = cut the corner (out of order sign, tape box shut, hand over smudged copy). Ignore = leave it.
- MC lines are reactions and monologue only, the same regardless of choice. Remove rude/nice line variants.

## 2. Counter decisions
When a customer reaches the counter, the sim exposes a quote: full-service price with fees itemized, self-serve price
if eligible, their timing (wait / come back / tomorrow), and a simple ready-time estimate from the printer queue.

- **Do:** take order (standard turnaround), take as rush (only if needed sooner than standard; adds rush fee), or send to self-serve (only if eligible: plain paper, no back-counter finishing, staying in store).
- **Don't:** turn away.

## 3. Customer reactions (seeded per customer)
- **Self-serve:** some eligible customers go straight to self-serve without coming to the counter; some accept being
  sent over; some refuse and want full service (player then chooses do or don't).
- **Fees:** some balk at a rush fee or small-order service fee. They take standard time instead, ask for self-serve, or leave.
- **Timing:** if the estimate misses their time, some accept a later time, some leave.

## 4. Pricing
- Restore full-service and self-serve price lists (self-serve cheaper).
- **Rush fee:** percent of order (config). **Service fee:** flat fee on full-service orders under a threshold.
- **Shipping:** service level (ground / 2-day / overnight) plus packing fee by box size.
- Revenue matters again: it's what the manager watches (section 6).

## 5. Prioritization (light)
- Orders have due times again. The player chooses what to work on next and which job to send first.
- Big jobs pay more but tie up the printer; shipping pays little; small quick jobs are best sent to self-serve.
- Flow director still caps load at 2 to 3 active things, so prioritizing is a decision, not a scramble.

## 6. Consequences
- Remove the "rude" heat cause. Heat comes from:
  - ignoring (walkouts after being ignored, ignored events)
  - late or unfinished orders
  - complaints from bad outcomes (smudged copies handed over, taped box arrives damaged, copier left broken)
  - **lost sales:** turning away a job that was doable and worth it adds a little heat; turning away a job that
    couldn't be done in time or wasn't worth it adds none
- Firing ending variants: too much ignoring, too many lost sales, too many complaints.

## 7. Bot and balance
- Bot styles: do-everything (never turns away), smart (turns away impossible/unprofitable jobs, uses self-serve),
  turn-away-heavy, ignore-heavy, random.
- Targets: smart survives 20 days; do-everything survives with more late orders; turn-away-heavy gets fired slowly;
  ignore-heavy gets fired fast; idle time stays near zero.
- Tests: the three choices at the counter and on tasks, self-serve accept/refuse/go-alone, fee balking, rush pricing,
  justified vs unjustified turn-away heat.

## Done when
`npm run typecheck`, `npm test`, `npm run build` pass, and `npm run batch -- --days 20 --style all` meets the targets.
