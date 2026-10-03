# Print Shop Sim: Spec v5 (visible work + feedback)

Builds on the current version (v4 choice model and counter decisions stay). This round fixes three problems:
1. You can't tell you're busy, and multi-step jobs hide their remaining steps.
2. Ignored customers never leave.
3. Failures happen silently; the player can't tell they're doing a bad job.

Rules: `src/sim/` stays DOM-free and deterministic. Content (lines, cues, step data) stays in JSON. Update tests and the
bot with each change. Player-facing text has no em dashes.

## 1. Workflows (sim)
- Multi-step jobs become **workflows**: take order, ring up, ship, drop-off, release package, collect and finish a job,
  fix copier, clear jam, load paper, send to self-serve.
- Each workflow is data: ordered steps, and per step: station, held item, pose, duration, thought line.
  Example, ship: weigh, box, tape, label, bin.
- **Strict lock:** while a workflow is active, nothing unrelated can start. `canStart()` returns
  "You can't do that, you're <current step>." Exception: jobs printing on their own run in the background.
- Abandoning a workflow is explicit and counts as don't or ignore with normal consequences.
- The next step is always known to the sim (`currentStep()`), so the UI never needs scrolling to find it.

## 2. Customers leave
- Fix: ignored or waiting customers must give up. Default 2 to 5 game minutes depending on request (config).
- Patience stages: fine, annoyed, angry, gone. Each stage change emits a cue line ("Hello?", "Is anyone working here?",
  exit line) and the exit is a logged failure.
- Test: an ignored customer leaves within the configured window.

## 3. Every failure has a visible moment
Hidden meters (heat) are fine; hidden events are not.
- **Missing or unfinished order at pickup:** the customer comes to the counter and it becomes a counter scene
  ("Where's my order?") with do (rush it now, they wait) / don't (apologize, refund) / ignore. Outcome is logged.
- Same pattern for: damaged package returned, smudged copies returned, broken copier with a customer at it, packages
  left in the bin after the truck leaves, customers walking out.
- Notable failures send a short manager message to the inbox during the day.
- End-of-day report lists failures by name ("Order #112 was never printed. Dana left without it."), not only counts.
- Add a **manager mood** value derived from heat (calm, annoyed, unhappy) for the UI. Never expose the number.

## 4. Visual UI
Replace the panel-heavy layout with a simple scene drawn on the existing canvas. Placeholder shapes are fine; real
sprites later must be drop-in (no logic changes).
- **Scene:** counter in front, stations behind (printer, finishing table, shipping scale), self-serve to the side,
  customers lining up in front.
- **MC:** simple character that walks to the station of the current step and shows the **held item** for that step
  (box, paper stack, bag, wrench, ream). Empty hands mean free.
- **Thought bubble** over the MC with the current step's line ("Weigh it.", "Tape it.").
- **Customers:** simple characters with a mood icon (fine, annoyed, angry) and speech bubbles for cue lines.
- **Blocked actions:** short message at the click point ("You can't do that, you're packing a box.").
- **Station highlight:** pulse the station that needs attention (job done at printer, truck here, tray empty).
- **Kept panels, small:** active job card (step checklist with checkmarks, next-step button), to-do list ordered by
  urgency with waiting time turning amber then red, manager mood icon, computer screen when used.
- Every click gets immediate feedback: pressed state, short caption, counters or checklist updating.
- No scrolling needed for core actions. Keyboard shortcuts for next step and do / don't / ignore.
- First turn-away or abandon asks for a quick confirm.
- Keep it touch-friendly.

## 5. Tests
- Workflow lock blocks unrelated tasks with the right message; background printing continues.
- Ignored customers progress through patience stages and leave.
- Pickup with a missing or unprinted order produces a counter scene and a logged failure.
- Each failure type appears in the end-of-day report.
- Bot still meets the v4 balance targets.

## Done when
`npm run typecheck`, `npm test`, `npm run build` pass, batch targets still met, and in the browser you can see what the
MC is doing at all times, customers leave when ignored, and every failure is visible when it happens.
