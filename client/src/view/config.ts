// The view's settings in one place. Switching from pixel art to hand-drawn art later is a change here and in the
// manifest: a bigger art grid (ART 1) and smoothing on.
import manifest from "../assets/manifest.json";
import { ART, H, W } from "./layout";
import { CLOCK } from "../sim/config";

export const PIXEL_ART = manifest.base.pixelArt; // nearest-neighbour scaling, no smoothing

// The canvas is drawn at the screen's real pixel density (the 1280x720 layout times RES), so nothing is upscaled and
// blurred on the way to the screen. Picked once at start, from the window and the device.
const fit = typeof window === "undefined" ? 1 : Math.min(innerWidth / W, innerHeight / H) * (devicePixelRatio || 1);
export const RES = Math.max(1, Math.min(3, Math.round(fit)));

// Text in a station scene is sized in art pixels (10 = 20 on the 1280x720 screen), and rendered sharp at the scale
// it's drawn at.
export const FONT = { fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", fontSize: "10px", color: "#1f2328", resolution: ART * RES };
export const SMALL = { ...FONT, fontSize: "8px" }; // 16 on screen: the smallest text anywhere

// The clock's speeds (and how fast it runs when: sim/clock.ts).
export const SPEEDS = CLOCK.speeds;
export const LINE_MS = 1300; // the next line of dialogue
export const HOLD_MS = 1200; // holding a tool, start to done (pauses when you let go)
export const SNAP = 36; // drops this close to a target count (forgiving), in art pixels
export const MAX_TAPS = 10;
