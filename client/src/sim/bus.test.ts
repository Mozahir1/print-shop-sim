import { afterEach, describe, expect, it } from "vitest";
import { createSim, isDayOver, tick } from "./sim";
import { botAct, createBot } from "./bot";
import { on, type SimEvents } from "./bus";

const off: (() => void)[] = [];
afterEach(() => off.splice(0).forEach((f) => f()));

describe("the event bus", () => {
  it("tells the view what happened over a day, and listening changes nothing", () => {
    const play = (listen: boolean) => {
      const seen = new Set<keyof SimEvents>();
      if (listen) for (const k of ["customer_arrived", "customer_left", "job_printing", "sheet_printed", "job_printed", "bag_shelved", "payment_done", "package_binned", "truck_arrived", "truck_left", "mood_changed"] as const) off.push(on(k, () => seen.add(k)));
      const sim = createSim(5);
      const bot = createBot(1, "smart", 5);
      while (!isDayOver(sim.state)) {
        botAct(bot, sim.state, 1);
        tick(sim, 1);
      }
      off.splice(0).forEach((f) => f());
      return { seen, state: JSON.stringify(sim.state) };
    };
    const a = play(true);
    expect(a.seen).toEqual(new Set(["customer_arrived", "customer_left", "job_printing", "sheet_printed", "job_printed", "bag_shelved", "payment_done", "package_binned", "truck_arrived", "truck_left"])); // (nobody gets impatient with the smart bot)
    expect(play(false).state).toBe(a.state);
  });
});
