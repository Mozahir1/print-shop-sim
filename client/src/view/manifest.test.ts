import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import manifest from "../assets/manifest.json";
import { STEP } from "../sim/workflow";
import { checklist } from "./checklist";

// The step data, the scene layouts, and the art manifest have to agree: every object a step is done on is a sprite
// in the manifest (or one of the few live objects), so placeholder or real art, every task can be done by hand.
const sprites = manifest.sprites as Record<string, { size: number[]; anchor: number[]; layer: string; purpose: string }>;
const LIVE = new Set(["box", "held", "hands", "customer"]);

describe("the art manifest", () => {
  it("lists every sprite with a size, an anchor, a layer, and what it's for", () => {
    for (const [key, d] of Object.entries(sprites)) {
      expect(key).toMatch(/^[a-z]+\/[a-z_]+$/); // station/object_state
      expect(d.size).toHaveLength(2);
      expect(d.anchor).toHaveLength(2);
      expect(manifest.layers).toContain(d.layer);
      expect(d.purpose.length).toBeGreaterThan(5);
      expect(d.purpose).not.toContain("—");
    }
  });

  it("every scene object is in it", () => {
    for (const objs of Object.values(manifest.scenes)) for (const o of objs) expect(sprites[o.key], o.key).toBeDefined();
  });

  it("every step's hands-on part is done on something that exists", () => {
    for (const [type, step] of Object.entries(STEP)) {
      for (const p of step.hands ?? []) {
        for (const ref of [p.drag, p.to, p.tap, p.hold, p.on]) if (ref) expect(LIVE.has(ref) || sprites[ref] !== undefined, `${type}: ${ref}`).toBe(true);
      }
      if (step.held) expect(sprites[`item/${step.held}`], `${type}: item/${step.held}`).toBeDefined();
    }
  });

  it("ART_CHECKLIST.md is up to date (npm run art)", () => {
    expect(readFileSync(new URL("../../ART_CHECKLIST.md", import.meta.url), "utf8")).toBe(checklist());
  });
});
