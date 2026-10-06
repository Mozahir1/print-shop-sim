import { describe, expect, it } from "vitest";
import { createSim, isDayOver, tick } from "./sim";
import { endDay, newGame, startDay } from "./game";
import { botAct, createBot, type BotStyle } from "./bot";
import { describeSpec, postMessage } from "./messages";
import { POOLS } from "./lines";

// Everything in the Email app is a real message: who it's from, a subject, and a body that says something.
describe("messages", () => {
  it("can't be created without a body (or with just the subject again, or from nobody)", () => {
    const s = createSim(1).state;
    expect(() => postMessage(s, { kind: "note", from: "Corporate", subject: "Reminder", body: "" })).toThrow();
    expect(() => postMessage(s, { kind: "note", from: "Corporate", subject: "Reminder", body: "   " })).toThrow();
    expect(() => postMessage(s, { kind: "reward", from: "Corporate", subject: "Great job team!", body: "Great job team!" })).toThrow();
    expect(() => postMessage(s, { kind: "note", from: "", subject: "Reminder", body: "Badge photos." })).toThrow();
    expect(postMessage(s, { kind: "note", from: "Corporate", subject: "Reminder", body: "Badge photos are Thursday." }).body).toBe("Badge photos are Thursday.");
  });

  it("every message line has a subject and a body of its own", () => {
    for (const l of POOLS.messages) {
      if (l.moment === "tone" || l.moment === "reason") continue; // (report lines and pieces of others, not messages)
      expect(l.subject, l.text).toBeTruthy();
      expect(l.text.trim().length, l.subject).toBeGreaterThan(l.subject!.length);
    }
  });

  it("over real days, every message says who it's from and something real; web orders list the job", () => {
    let count = 0;
    const kinds = new Set<string>();
    for (const style of ["smart", "careless", "ignore", "random"] as BotStyle[])
      for (let g = 0; g < 3; g++) {
        const game = newGame(11 + g * 1000);
        for (let d = 0; d < 5 && !game.fired; d++) {
          const sim = startDay(game);
          const s = sim.state;
          const bot = createBot(1, style, s.seed);
          while (!isDayOver(s)) {
            botAct(bot, s, 1);
            tick(sim, 1);
          }
          for (const m of [...s.messages, ...s.heldMessages]) {
            count++;
            kinds.add(m.kind);
            expect(m.from, m.subject).toBeTruthy();
            expect(m.body.trim(), m.subject).not.toBe("");
            expect(m.body, m.subject).not.toBe(m.subject);
            expect(m.body, m.body).not.toMatch(/\{\w+\}/); // every blank filled in
            if (m.kind === "web_order") {
              const job = s.jobs.find((j) => j.id === m.jobId)!;
              expect(m.body).toContain(describeSpec(job.spec));
            }
            if (m.kind === "complaint") expect(m.body).toContain(m.from);
          }
          endDay(game, sim);
        }
      }
    expect(count).toBeGreaterThan(50);
    for (const k of ["web_order", "note", "complaint", "warning", "write_up", "reward"]) expect(kinds, k).toContain(k);
  });
});
