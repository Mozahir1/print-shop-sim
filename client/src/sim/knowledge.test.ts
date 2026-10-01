import { describe, expect, it } from "vitest";
import { createSim, isShiftOver, startTask, tick, type Sim } from "./sim";
import { botAct, createBot } from "./bot";
import { summarize } from "./summary";
import { spawnShippingCustomer } from "./dev";
import { fetch, loadPaper } from "./testkit";
import { counterCustomer } from "./util";
import {
  KEYS,
  age,
  countStock,
  fillBucket,
  glanceStock,
  knows,
  observeCopier,
  observePanel,
  observeTray,
  roughCount,
  snapshot,
  type PanelSnap,
  type StockGlanceSnap,
  type TraySnap,
} from "./knowledge";

function runUntil(sim: Sim, cond: () => boolean, limit = 3 * 3600) {
  for (let i = 0; i < limit && !cond(); i++) tick(sim, 1);
  expect(cond()).toBe(true);
}

function quiet(): Sim {
  const sim = createSim(1);
  sim.state.customers = [];
  sim.state.calls = [];
  sim.state.packages = [];
  return sim;
}

describe("snapshots", () => {
  it("start empty: the player hasn't seen anything yet", () => {
    const s = createSim(1).state;
    expect(knows(s, KEYS.tray("bw", "letter"))).toBe(false);
    expect(age(s, KEYS.tray("bw", "letter"))).toBeNull();
  });

  it("record the facts at that moment, rounded, with the time", () => {
    const sim = quiet();
    const s = sim.state;
    const tray = s.printers[0].trays[0];
    tray.level = 1234;
    runUntil(sim, () => s.time >= 600);
    observeTray(s, s.printers[0], tray);
    const snap = snapshot<TraySnap>(s, KEYS.tray("bw", "letter"))!;
    expect(snap.at).toBe(600);
    expect(snap.data.level).toBe(1250); // nearest 50
    expect(snap.data.unit).toBe("sheets");
  });

  it("don't change when the true state changes; only looking again updates them", () => {
    const sim = quiet();
    const s = sim.state;
    const tray = s.printers[0].trays[0];
    tray.level = 1800;
    observeTray(s, s.printers[0], tray);
    tray.level = 100; // a big job eats it
    runUntil(sim, () => s.time >= 900);
    expect(snapshot<TraySnap>(s, KEYS.tray("bw", "letter"))!.data.level).toBe(1800);
    expect(age(s, KEYS.tray("bw", "letter"))).toBe(900);

    observeTray(s, s.printers[0], tray);
    expect(snapshot<TraySnap>(s, KEYS.tray("bw", "letter"))!.data.level).toBe(100);
    expect(age(s, KEYS.tray("bw", "letter"))).toBe(0);
  });

  it("are copies, not live references", () => {
    const s = quiet().state;
    observePanel(s, s.printers[1]);
    const snap = snapshot<PanelSnap>(s, KEYS.panel("color"))!;
    s.printers[1].output.push({ jobId: 1, sheets: 10 });
    expect(snap.data.output).toHaveLength(0);
  });

  it("bucket toner and stock roughly", () => {
    expect(fillBucket(0.9)).toBe("full");
    expect(fillBucket(0.4)).toBe("half");
    expect(fillBucket(0.1)).toBe("low");
    expect(fillBucket(0)).toBe("empty");
    expect(roughCount("letter", 0)).toBe("none");
    expect(roughCount("letter", 5000)).toBe("one");
    expect(roughCount("letter", 12000)).toBe("a few");
    expect(roughCount("letter", 40000)).toBe("plenty");
    expect(roughCount("bw_toner", 1)).toBe("one");
    const s = quiet().state;
    s.stockroom.cardstock = 0;
    glanceStock(s);
    expect(snapshot<StockGlanceSnap>(s, KEYS.stockGlance)!.data.items.cardstock).toBe("none");
  });
});

describe("doing work updates what you'd naturally see", () => {
  it("loading paper tells you the tray is full and how much is left in back", () => {
    const sim = quiet();
    const s = sim.state;
    s.printers[0].trays[0].level = 200;
    s.stockroom.letter = 9000;
    loadPaper(sim, "bw", "letter"); // take a case, load 1,800, put 3,200 back
    expect(snapshot<TraySnap>(s, KEYS.tray("bw", "letter"))!.data.level).toBe(2000);
    expect(snapshot<{ count: number }>(s, KEYS.stockItem("letter"))!.data.count).toBe(7200);
  });

  it("clearing a jam shows you the printer's panel", () => {
    const sim = quiet();
    const s = sim.state;
    s.printers[1].status = "jammed";
    s.printers[1].jamClearSeconds = 60;
    startTask(s, { type: "clear_jam", printerId: "color" });
    runUntil(sim, () => !s.employee.task);
    expect(snapshot<PanelSnap>(s, KEYS.panel("color"))!.data.status).toBe("idle");
  });

  it("boxing a shipment shows you the box count you took from", () => {
    const sim = quiet();
    const s = sim.state;
    s.stockroom.box_small = 7;
    const c = spawnShippingCustomer(s, "ship", { packed: false, weightLb: 2 });
    runUntil(sim, () => counterCustomer(s)?.id === c.id);
    fetch(sim, "box_small"); // you see how many are left as you take one
    expect(snapshot<{ count: number }>(s, KEYS.stockItem("box_small"))!.data.count).toBe(6);
    startTask(s, { type: "ship_package" });
    runUntil(sim, () => c.outcome !== null);
  });

  it("fixing a copier shows you the copier", () => {
    const sim = quiet();
    const s = sim.state;
    s.copiers[0].status = "jammed";
    s.copiers[0].fixSeconds = 30;
    startTask(s, { type: "fix_copier", copierId: 1 });
    runUntil(sim, () => !s.employee.task);
    expect(snapshot<{ status: string }>(s, KEYS.copier(1))!.data.status).toBe("ok");
  });
});

describe("determinism", () => {
  it("looking at things never consumes randomness", () => {
    const play = (lookAround: boolean) => {
      const sim = createSim(13);
      const bot = createBot(10);
      while (!isShiftOver(sim.state)) {
        if (lookAround) {
          for (const p of sim.state.printers) {
            observePanel(sim.state, p);
            for (const t of p.trays) observeTray(sim.state, p, t);
          }
          glanceStock(sim.state);
          countStock(sim.state, "letter");
          observeCopier(sim.state, 1);
        }
        botAct(bot, sim.state, 1);
        tick(sim, 1);
      }
      return summarize(sim.state, "t", "bot");
    };
    expect(play(true)).toEqual(play(false));
  });
});
