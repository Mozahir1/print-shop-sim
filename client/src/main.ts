// Boots the game: Phaser draws the stations and handles input on them; the HUD (view/hud.ts) is DOM over the canvas;
// the sim (src/sim/) is the source of truth; the controller (view/run.ts) runs the day.
import Phaser from "phaser";
import { H, W } from "./view/layout";
import { PIXEL_ART, RES } from "./view/config";
import { Boot, UIScene } from "./view/ui";
import { ComputerScene, CounterScene, FinishingScene, PrinterScene, ShelfScene, ShippingScene } from "./view/scenes";
import { devEnabled, listen, showStart } from "./view/run";
import * as hud from "./view/hud";
import { audit } from "./view/audit";

// The canvas is the 1280x720 layout at the device's pixel density (RES), scaled to fit the window and centered.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: W * RES,
  height: H * RES,
  pixelArt: PIXEL_ART,
  backgroundColor: "#101215",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { activePointers: 2 },
  fps: { target: 60, forceSetTimeOut: true }, // a timer, not animation frames: those stop when the page isn't on screen, and so would the clock
  scene: [Boot, CounterScene, ComputerScene, PrinterScene, FinishingScene, ShippingScene, ShelfScene, UIScene],
});

// The HUD follows the canvas wherever FIT puts it.
const place = () => game.canvas && hud.place(game.canvas);
game.events.once("ready", place);
game.scale.on("resize", () => requestAnimationFrame(place));
addEventListener("resize", () => requestAnimationFrame(place));
Object.assign(window, { phaserGame: game }); // (for the console)
if (devEnabled) Object.assign(window, { audit: () => audit(game) }); // layout checks (see audit.ts)

hud.build(game);
listen();
showStart();
