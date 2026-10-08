import { describe, expect, it } from "vitest";
import manifest from "../assets/manifest.json";
import { ACTIONS, ART, H, inside, MIN, overlaps, REGION, spriteRect, STAGE_H, STAGE_W, W, type Rect } from "./layout";

// The layout has fixed regions and nothing overlaps: the screen's regions, and everything you can click in a scene.
const sprites = manifest.sprites as Record<string, { size: number[]; anchor: number[]; layer: string }>;
const scenes = manifest.scenes as Record<string, { key: string; x: number; y: number }[]>;
const spots = manifest.spots as Record<string, number[]>;
const STAGE: Rect = { x: 0, y: 0, w: STAGE_W, h: STAGE_H };
const FLOOR: Rect = { x: 0, y: 0, w: STAGE_W, h: ACTIONS.y }; // where clickable things go

const rectOf = (key: string, x: number, y: number) => spriteRect(x, y, sprites[key].size, sprites[key].anchor);

function noOverlaps(rects: [string, Rect][]): void {
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i][1], rects[j][1]), `${rects[i][0]} overlaps ${rects[j][0]}`).toBe(false);
}

describe("the screen regions", () => {
  const regions = Object.entries(REGION);

  it("sit on the screen and never overlap", () => {
    for (const [name, r] of regions) expect(inside(r, { x: 0, y: 0, w: W, h: H }), name).toBe(true);
    noOverlaps(regions);
  });

  it("cover the whole screen", () => {
    expect(regions.reduce((n, [, r]) => n + r.w * r.h, 0)).toBe(W * H);
  });

  it("the stage is exactly its art pixels, drawn at a whole-number scale", () => {
    expect(Number.isInteger(ART)).toBe(true);
    expect(STAGE_W * ART).toBe(REGION.stage.w);
    expect(STAGE_H * ART).toBe(REGION.stage.h);
  });

  it("the action strip fits a full-size button", () => {
    expect(inside(ACTIONS, STAGE)).toBe(true);
    expect(ACTIONS.h * ART).toBeGreaterThanOrEqual(MIN.target);
  });
});

describe("the station scenes", () => {
  for (const [scene, objs] of Object.entries(scenes)) {
    describe(scene, () => {
      const clickable = objs.filter((o) => sprites[o.key].layer === "interactive");

      it("everything is on the stage", () => {
        for (const o of objs) expect(inside(rectOf(o.key, o.x, o.y), STAGE), o.key).toBe(true);
      });

      it("everything you click is big enough, and clear of the action strip", () => {
        for (const o of clickable) {
          const r = rectOf(o.key, o.x, o.y);
          expect(Math.min(r.w, r.h) * ART, `${o.key} is too small to tap`).toBeGreaterThanOrEqual(MIN.target);
          expect(inside(r, FLOOR), `${o.key} is in the action strip`).toBe(true);
        }
      });

      it("nothing you click overlaps anything else you click", () => {
        noOverlaps(clickable.map((o) => [o.key, rectOf(o.key, o.x, o.y)]));
      });
    });
  }

  it("the customer at the counter doesn't cover anything you click there", () => {
    const [x, y] = spots.counterCustomer;
    const cust = rectOf("customer/body_a", x, y);
    expect(inside(cust, FLOOR)).toBe(true);
    const [hx, hy] = spots.counterHeld;
    const held = rectOf("item/bag", hx, hy);
    for (const o of scenes.counter.filter((o) => sprites[o.key].layer === "interactive")) {
      expect(overlaps(cust, rectOf(o.key, o.x, o.y)), o.key).toBe(false);
      expect(overlaps(held, rectOf(o.key, o.x, o.y)), o.key).toBe(false);
    }
  });

  it("every slot on the pickup shelf fits, without touching the next", () => {
    for (const [spot, key, n] of [["shelfBags", "shelf/bag", 15], ["shelfPackages", "shelf/package", 6]] as const) {
      const [x0, y0, dx, dy, cols] = spots[spot];
      const slots: [string, Rect][] = [];
      for (let i = 0; i < n; i++) slots.push([`${spot} ${i}`, rectOf(key, x0 + (i % cols) * dx, y0 + Math.floor(i / cols) * dy)]);
      for (const [name, r] of slots) expect(inside(r, FLOOR), name).toBe(true);
      noOverlaps(slots);
    }
  });
});

describe("the counter's two sides", () => {
  it("your coworker's register (them, and who they're helping) never sits under the conversation box", async () => {
    const { CREW_ZONE, DIALOG_DOCK } = await import("./layout");
    const [cx, cy] = spots.crewCounter;
    const [kx, ky] = spots.crewCustomer;
    const scaled = (r: Rect, s: number, ax: number, ay: number): Rect => ({ x: ax - (ax - r.x) * s, y: ay - (ay - r.y) * s, w: r.w * s, h: r.h * s });
    const crew: [string, Rect][] = [
      ["coworker", rectOf("crew/body", cx, cy)],
      ["their customer", scaled(rectOf("customer/body_b", kx, ky), 0.85, kx, ky)],
      ["their register", rectOf("counter/crew_register", scenes.counter.find((o) => o.key === "counter/crew_register")!.x, scenes.counter.find((o) => o.key === "counter/crew_register")!.y)],
    ];
    for (const [name, r] of crew) expect(inside(r, CREW_ZONE), name).toBe(true);
    expect(overlaps(CREW_ZONE, DIALOG_DOCK)).toBe(false);
    // The box's CSS width (index.html) is what DIALOG_DOCK says, 1rem (10 art pixels) in from the stage's edge.
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    const rem = Number(/\.modal-box\.dialog \{ width: ([\d.]+)rem/.exec(css)![1]);
    expect(rem * 20 + 20).toBe(DIALOG_DOCK.w * ART);
    expect(DIALOG_DOCK.x + DIALOG_DOCK.w).toBe(STAGE_W);
  });
});
