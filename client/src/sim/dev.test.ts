import { describe, expect, it } from "vitest";
import { counterCustomer, createSim, startTask, tick } from "./sim";
import { createBot } from "./bot";
import { emptyTray, finishPrinting, finishTask, jamPrinter, restockAll, skipTo, spawnCustomer, upcoming } from "./dev";

describe("dev mode", () => {
  it("sending in a customer doesn't change the day's schedule, and marks the shift", () => {
    const a = createSim(3);
    const b = createSim(3);
    spawnCustomer(b.state, "posters", "wait");
    expect(b.state.devUsed).toBe(true);
    expect(a.state.devUsed).toBe(false);
    expect(b.state.customers.slice(0, -1).map((c) => c.request)).toEqual(a.state.customers.map((c) => c.request));
    const c = b.state.customers[b.state.customers.length - 1];
    expect(c.profileId).toBe("posters");
    expect(c.request!.timing.kind).toBe("wait");
  });

  it("a spawned customer walks in and reaches the counter", () => {
    const sim = createSim(1);
    sim.state.customers = [];
    const c = spawnCustomer(sim.state, "quick_copies", "wait", false, "full_service");
    for (let i = 0; i < 120 && counterCustomer(sim.state)?.id !== c.id; i++) tick(sim, 1);
    expect(counterCustomer(sim.state)?.id).toBe(c.id);
  });

  it("finish task and finish printing complete on the next tick", () => {
    const sim = createSim(1);
    sim.state.customers = [];
    const c = spawnCustomer(sim.state, "quick_copies", "wait", false, "full_service");
    for (let i = 0; i < 120 && !counterCustomer(sim.state); i++) tick(sim, 1);
    startTask(sim.state, { type: "take_order" });
    expect(finishTask(sim.state)).toBeNull();
    tick(sim, 1);
    const job = sim.state.jobs[0];
    expect(job.customerId).toBe(c.id);

    restockAll(sim.state);
    startTask(sim.state, { type: "send_job", jobId: job.id, printerId: "bw" });
    finishTask(sim.state);
    tick(sim, 1);
    tick(sim, 1); // printer picks it up
    expect(finishPrinting(sim.state, "bw")).toBeNull();
    tick(sim, 1);
    expect(job.status).toBe("printed");
  });

  it("jams and empty trays stop the printer; restock clears them", () => {
    const sim = createSim(1);
    jamPrinter(sim.state, "color");
    emptyTray(sim.state, "bw", "letter");
    expect(sim.state.printers[1].status).toBe("jammed");
    expect(sim.state.printers[0].trays[0].level).toBe(0);
    restockAll(sim.state);
    expect(sim.state.printers[1].status).toBe("idle");
    expect(sim.state.printers[0].trays[0].level).toBe(2000);
  });

  it("skipping ahead with the bot gets work done", () => {
    const sim = createSim(2);
    skipTo(sim, 4 * 3600, createBot(10));
    expect(sim.state.time).toBe(4 * 3600);
    expect(sim.state.stats.ordersTaken).toBeGreaterThan(0);
  });

  it("lists upcoming arrivals in order", () => {
    const sim = createSim(4);
    const next = upcoming(sim.state, 5);
    expect(next.length).toBe(5);
    for (let i = 1; i < next.length; i++) expect(next[i].at).toBeGreaterThanOrEqual(next[i - 1].at);
  });
});
