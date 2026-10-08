// The screen layout in one place. Everything is placed in a 1280x720 logical screen, scaled to fit the window. Each
// region owns its space and nothing overlaps (layout.test.ts checks it, and audit.ts checks the real page).
//
//   +---------------------------------------------------+
//   | top bar: clock, manager, what you're doing, next  |
//   +--------------------------------------+------------+
//   | stage: the station you're at         | right rail |
//   | (modals open centered over it)       | notes      |
//   +--------------------------------------+------------+
//   | bottom bar: station tabs, speed                   |
//   +---------------------------------------------------+
import manifest from "../assets/manifest.json";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const W = 1280;
export const H = 720;

export const REGION = {
  top: { x: 0, y: 0, w: 1280, h: 100 },
  stage: { x: 0, y: 100, w: 1000, h: 532 },
  rail: { x: 1000, y: 100, w: 280, h: 532 },
  bottom: { x: 0, y: 632, w: 1280, h: 88 },
} satisfies Record<string, Rect>;
export type Region = keyof typeof REGION;

// The stage is drawn in art pixels, each ART screen pixels across (pixel art, nearest-neighbour).
export const ART = manifest.base.art; // 2
export const STAGE_W = manifest.base.stageWidth; // 500 art pixels = REGION.stage.w
export const STAGE_H = manifest.base.stageHeight; // 266 art pixels = REGION.stage.h

// Inside the stage, in art pixels: a strip along the bottom for the in-world buttons. Nothing you click on in a scene
// sits in it.
export const ACTIONS: Rect = { x: 0, y: 232, w: 500, h: 34 };
export const BUTTON_H = 28; // art pixels (56 on screen)

// The counter, in art pixels: the left side is your coworker's register (them, and the customer they're helping);
// your side's on the right, and that's where the conversation box docks (.modal-box.dialog in index.html: 30rem wide,
// 1rem in from the edge), so it never covers them.
export const CREW_ZONE: Rect = { x: 88, y: 60, w: 100, h: 206 };
export const DIALOG_DOCK: Rect = { x: 190, y: 0, w: 310, h: 266 };

// Minimum sizes on the 1280x720 screen.
export const MIN = { body: 20, label: 16, heading: 28, target: 56 };

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function inside(a: Rect, b: Rect): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

// A sprite's rectangle in art pixels, from where it's placed, its size, and its anchor.
export function spriteRect(x: number, y: number, size: number[], anchor: number[]): Rect {
  return { x: x - size[0] * anchor[0], y: y - size[1] * anchor[1], w: size[0], h: size[1] };
}
