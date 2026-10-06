// Boots the game: Phaser draws the stations and handles input; the sim (src/sim/) is the source of truth; the
// controller (view/run.ts) runs the day.
import Phaser from "phaser";
import { BASE_H, BASE_W, INTEGER_ZOOM, PIXEL_ART } from "./view/config";
import { Boot, UIScene } from "./view/ui";
import { ComputerScene, CounterScene, FinishingScene, PrinterScene, ShelfScene, ShippingScene } from "./view/scenes";
import { listen, showStart } from "./view/run";

// As big as fits: whole-number zoom when the screen allows (crisp pixels), otherwise whatever fits.
function zoom(): number {
  const box = document.getElementById("game")!;
  const z = Math.max(0.25, Math.min((box.clientWidth || innerWidth - 16) / BASE_W, (innerHeight - 16) / BASE_H));
  return INTEGER_ZOOM && z >= 1 ? Math.floor(z) : z;
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: BASE_W,
  height: BASE_H,
  pixelArt: PIXEL_ART,
  backgroundColor: "#17191c",
  scale: { mode: Phaser.Scale.NONE, zoom: zoom() },
  input: { activePointers: 2 },
  fps: { target: 60, forceSetTimeOut: true }, // a timer, not animation frames: those stop when the page isn't on screen, and so would the clock
  scene: [Boot, CounterScene, ComputerScene, PrinterScene, FinishingScene, ShippingScene, ShelfScene, UIScene],
});
// The in-world overlays (dialogue, forms) sit in a layer laid exactly over the canvas, in game pixels, scaled with it.
function applyZoom(): void {
  const z = zoom();
  if (game.scale.zoom !== z) game.scale.setZoom(z);
  const canvas = game.canvas;
  const layer = document.getElementById("layer")!;
  if (!canvas) return;
  Object.assign(layer.style, { left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`, transform: `scale(${z})` });
}
game.events.once("ready", applyZoom);
game.scale.on("resize", () => requestAnimationFrame(applyZoom));
addEventListener("resize", applyZoom);
Object.assign(window, { phaserGame: game }); // (for the console)

listen();
showStart();
