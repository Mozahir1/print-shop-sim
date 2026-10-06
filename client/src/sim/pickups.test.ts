import { describe, expect, it } from "vitest";
import { endDay, newGame, startDay } from "./game";
import { botAct, createBot, type BotStyle } from "./bot";
import { isDayOver, tick } from "./sim";
import { CLOSING } from "./config";
import { returnCustomer, spawnCustomer } from "./customers";
import { readyToReturn } from "./director";
import { calm, makeReady, talkTo } from "./testkit";

// Every promise is inside open hours, and every order someone placed gets a visit to pick it up: today, or (if it's
// not done or not collected by close) the next morning. A customer who comes and gives up waiting has had their visit.
describe("due times and pickups", () => {
  const STYLES: BotStyle[] = ["smart", "do_everything", "careless", "random"];
  const DAYS = 4;

  it("someone in line for their order at closing goes home and comes back for it in the morning", () => {
    const restore = calm();
    const game = newGame(3);
    const sim = startDay(game);
    const s = sim.state;
    s.director.enabled = false;
    s.event = null;
    const c = spawnCustomer(s, sim.rng.dev, "large_job", { timing: "back", needIn: 200 });
    talkTo(sim, c);
    const job = s.jobs.find((j) => j.id === c.jobId)!;
    makeReady(sim, job);
    while (s.time < s.closeAt - 5) tick(sim, 1);
    returnCustomer(s, c); // back for it just before close, and still in line at 5
    while (s.time <= s.closeAt) tick(sim, 1);
    expect(c.state).toBe("away");
    expect(c.outcome).toBeNull();
    while (!isDayOver(s)) tick(sim, 1);
    endDay(game, sim);
    const next = startDay(game);
    const back = next.state.customers.find((x) => x.id === c.id)!;
    expect(back.state).toBe("away");
    const carried = next.state.jobs.find((j) => j.id === job.id)!;
    expect(carried.status).toBe("bagged");
    next.state.director.enabled = true;
    while (!readyToReturn(next.state).length && next.state.time < 120) tick(next, 1);
    expect(readyToReturn(next.state).map((x) => x.id)).toContain(c.id); // the morning
    restore();
  });

  it("across many seeds: every due time is in open hours, and no order ends without a pickup visit", () => {
    let orders = 0;
    for (const style of STYLES)
      for (let g = 0; g < 8; g++) {
        const game = newGame(7 + g * 1000);
        const ordered = new Map<number, number>(); // job: when it was placed (day * 10000 + minute)
        const seen = new Map<number, number>(); // customer: the last time they were in the store
        const jobs = new Map<number, { customerId: number; status: string; outcome: string | null }>();
        for (let day = 1; day <= DAYS && !game.fired; day++) {
          const sim = startDay(game);
          const s = sim.state;
          const bot = createBot(1, style, s.seed);
          const watch = () => {
            const now = day * 10000 + s.time;
            for (const c of s.customers) if (c.state === "line" || c.state === "talking" || c.state === "waiting") seen.set(c.id, now);
            for (const j of s.jobs) {
              if (!ordered.has(j.id)) ordered.set(j.id, day * 10000 + j.orderedAt);
              const c = s.customers.find((x) => x.id === j.customerId);
              jobs.set(j.id, { customerId: j.customerId, status: j.status, outcome: c?.state === "gone" ? c.outcome : null });
            }
          };
          while (!isDayOver(s)) {
            botAct(bot, s, 1);
            tick(sim, 1);
            watch();
          }
          for (const j of s.jobs) {
            expect(j.dueAt, `job ${j.id} due`).toBeGreaterThanOrEqual(0);
            expect(j.dueAt, `job ${j.id} due after the last due time`).toBeLessThanOrEqual(s.closeAt - CLOSING.dueBuffer);
          }
          endDay(game, sim);
          // Anything still open at the end of the last day must be on its way to a visit tomorrow.
          if (day === DAYS || game.fired) {
            for (const j of s.jobs) {
              if (j.status === "picked_up" || j.status === "canceled") continue;
              const c = s.customers.find((x) => x.id === j.customerId)!;
              const visited = (seen.get(c.id) ?? -1) >= ordered.get(j.id)!;
              if (!visited) {
                expect(c.state, `job ${j.id}: ${c.name} never came and isn't coming`).toBe("away");
                expect(j.dueDay, `job ${j.id} isn't due by tomorrow`).toBeLessThanOrEqual(day + 1);
              }
            }
          }
        }
        // Every order that's over had its visit. Closing never sends someone home for good with their order still open
        // (they come back in the morning); leaving without it is only ever something that happened at a visit: they
        // gave up waiting, or you turned them away.
        for (const [id, j] of jobs) {
          orders++;
          const open = j.status !== "picked_up" && j.status !== "canceled";
          if (open && j.outcome !== null) expect(j.outcome, `${style} game ${g} job ${id} (${j.status}): the store closed on them`).not.toBe("closed");
          if (open && j.outcome === null) continue;
          expect((seen.get(j.customerId) ?? -1) >= ordered.get(id)!, `${style} game ${g} job ${id} (${j.status}) ended with no visit`).toBe(true);
        }
      }
    expect(orders).toBeGreaterThan(300);
  });
});
