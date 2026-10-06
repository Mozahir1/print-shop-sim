// Feel: small tweens for picking up, dropping, getting it wrong, and getting it done.
import Phaser from "phaser";
import { sprite } from "./assets";
import { FONT } from "./config";

type Obj = Phaser.GameObjects.Sprite | Phaser.GameObjects.Container;

export function squash(o: Obj): void {
  o.scene.tweens.add({ targets: o, scaleX: 1.12, scaleY: 0.88, duration: 70, yoyo: true });
}

export function bounce(o: Obj): void {
  o.scene.tweens.add({ targets: o, y: o.y - 6, duration: 90, yoyo: true, ease: "Quad.easeOut" });
}

export function shake(o: Obj): void {
  const x = o.x;
  o.scene.tweens.add({ targets: o, x: x + 4, duration: 40, yoyo: true, repeat: 2, onComplete: () => (o.x = x) });
}

// Back to where it came from (a drop on the wrong spot).
export function snapBack(o: Obj, x: number, y: number): void {
  o.scene.tweens.add({ targets: o, x, y, duration: 180, ease: "Back.easeOut" });
  shake(o);
}

export function sparkle(scene: Phaser.Scene, x: number, y: number): void {
  const s = sprite(scene, "fx/check", x, y).setScale(0.4);
  scene.tweens.add({ targets: s, scale: 1, y: y - 14, alpha: 0, duration: 520, ease: "Quad.easeOut", onComplete: () => s.destroy() });
  for (let i = 0; i < 4; i++) {
    const p = sprite(scene, "fx/sparkle", x, y).setScale(0.5);
    const a = (Math.PI / 2) * i + Math.PI / 4;
    scene.tweens.add({ targets: p, x: x + Math.cos(a) * 18, y: y + Math.sin(a) * 18, alpha: 0, duration: 420, onComplete: () => p.destroy() });
  }
}

// A few words floating up from a spot ("That goes in the tray.").
export function say(scene: Phaser.Scene, x: number, y: number, text: string, color = "#b3261e"): void {
  const t = scene.add.text(x, y, text, { ...FONT, color, backgroundColor: "#ffffffdd", padding: { x: 3, y: 1 } }).setOrigin(0.5).setDepth(60);
  t.x = Phaser.Math.Clamp(t.x, t.width / 2 + 2, scene.scale.width - t.width / 2 - 2);
  scene.tweens.add({ targets: t, y: y - 16, alpha: 0, delay: 900, duration: 500, onComplete: () => t.destroy() });
}
