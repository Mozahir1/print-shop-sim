// The view's settings in one place. Switching from pixel art to hand-drawn art later is a change here: a bigger base
// resolution and smoothing on.
import manifest from "../assets/manifest.json";

export const BASE_W = manifest.base.width; // 640
export const BASE_H = manifest.base.height; // 360
export const PIXEL_ART = manifest.base.pixelArt; // nearest-neighbour scaling, no smoothing
export const INTEGER_ZOOM = true; // scale by whole numbers when the screen is big enough
export const TOP = manifest.base.stationTop; // the station view sits between the top bar...
export const BOTTOM = manifest.base.stationBottom; // ...and the tab bar

export const FONT = { fontFamily: "ui-monospace, Menlo, monospace", fontSize: "10px", color: "#1f2328" };

// The clock: game minutes per real second (1x, 2x, 4x), and how it slows down or speeds up.
export const SPEEDS = [1.5, 3, 6];
export const DECIDING = 0.35; // a step's waiting on you
export const AT_THE_COUNTER = 0; // a customer's explaining
export const QUIET = 4; // nothing going on
export const LINE_MS = 1300; // the next line of dialogue
export const HOLD_MS = 1200; // holding a tool, start to done (pauses when you let go)
export const SNAP = 36; // drops this close to a target count (forgiving)
export const MAX_TAPS = 10;
