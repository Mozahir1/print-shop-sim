// How fast the clock runs, in game minutes per real second. The UI runs the clock with this, and so does the
// human-pace bot (humanbot.ts), so balancing sees the same day a person does: the clock slows while a step waits on
// you, stops while a customer explains, flies when nothing's going on, and drags after close.
import type { GameState } from "./types";
import { CLOCK, CLOSING } from "./config";
import { currentStep } from "./workflow";
import { activeCount } from "./todo";
import { currentCustomer } from "./sim";

// Nothing going on: no job, nobody here, the store's open.
export function isQuiet(s: GameState): boolean {
  return !s.workflow && !s.employee.task && s.time < s.closeAt && activeCount(s) === 0;
}

// Game minutes per real second at a speed (CLOCK.speeds). Something waits on you when it's the next step in what
// you're doing and nothing's running, or when you're free and someone's in line to be called up.
export function clockRate(s: GameState, speed: number): number {
  const step = s.employee.task ? null : currentStep(s);
  const called = !s.employee.task && !s.workflow && currentCustomer(s)?.state === "line";
  const pace = step ? (step.type === "respond" ? CLOCK.atTheCounter : CLOCK.deciding) : called ? CLOCK.deciding : isQuiet(s) ? CLOCK.quiet : 1;
  return speed * pace * (s.time >= s.closeAt ? CLOSING.overtimeSpeed : 1);
}
