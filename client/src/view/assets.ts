// The art pipeline. Every sprite is listed in assets/manifest.json (size, anchor, layer, animations). If its file is
// in assets/art/ it's loaded (a single PNG, a PNG strip of frames, or an Aseprite PNG + JSON export); if not, a
// placeholder is drawn from the manifest (a shape in its category's color and a pixel icon), so the game always runs
// with no art.
// Sounds work the same way from assets/sounds.json: a file if there is one, a short tone if not.
import Phaser from "phaser";
import manifest from "../assets/manifest.json";
import soundMap from "../assets/sounds.json";
import { ICONS } from "./icons";

export interface SpriteDef {
  label: string; // its name, shown on hover
  size: number[];
  anchor: number[];
  layer: string;
  category: string; // placeholders in a category share a color
  icon?: string; // see icons.ts
  color?: string; // a placeholder color of its own (states: broken, jammed, ...)
  purpose: string;
  animations?: Record<string, { frames: number; fps: number }>;
}
export const SPRITES = manifest.sprites as Record<string, SpriteDef>;
export const LAYOUT = manifest.scenes as Record<string, { key: string; x: number; y: number; starts?: string[] }[]>;
export const SPOT = manifest.spots as Record<string, number[]>;
const CATEGORY = manifest.categories as Record<string, string>;
const SOUNDS = soundMap.sounds as Record<string, { tone: number[] }>;

// Files that exist, found at build time (so a missing file costs no network request).
const art = import.meta.glob("../assets/art/**/*.{png,json}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const audio = import.meta.glob("../assets/sounds/*.{ogg,mp3,wav}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export function depthOf(layer: string): number {
  return manifest.layers.indexOf(layer) * 10;
}

export function preload(scene: Phaser.Scene): void {
  for (const [key, def] of Object.entries(SPRITES)) {
    const png = art[`../assets/art/${key}.png`];
    const json = art[`../assets/art/${key}.json`];
    if (png && json) scene.load.aseprite(key, png, json);
    else if (png && def.animations) scene.load.spritesheet(key, png, { frameWidth: def.size[0], frameHeight: def.size[1] });
    else if (png) scene.load.image(key, png);
  }
  for (const key of Object.keys(SOUNDS)) {
    const url = Object.entries(audio).find(([f]) => f.includes(`/sounds/${key}.`))?.[1];
    if (url) scene.load.audio(key, url);
  }
}

// After loading: placeholders for whatever's missing, and the animations for whatever's there.
export function create(scene: Phaser.Scene): void {
  for (const [key, def] of Object.entries(SPRITES)) {
    if (!scene.textures.exists(key)) placeholder(scene, key, def);
    else if (art[`../assets/art/${key}.json`]) scene.anims.createFromAseprite(key);
    else if (def.animations) {
      let first = 0;
      for (const [name, a] of Object.entries(def.animations)) {
        scene.anims.create({ key: `${key}:${name}`, frames: scene.anims.generateFrameNumbers(key, { start: first, end: first + a.frames - 1 }), frameRate: a.fps, repeat: -1 });
        first += a.frames;
      }
    }
  }
}

export function colorOf(def: SpriteDef): string {
  return def.color ?? CATEGORY[def.category];
}

// A placeholder: a simple shape for what kind of thing it is, and its icon. Drawn in art pixels on whole pixels, so it
// stays crisp at any whole-number scale.
function placeholder(scene: Phaser.Scene, key: string, def: SpriteDef): void {
  const [w, h] = def.size;
  const fill = Phaser.Display.Color.HexStringToColor(colorOf(def));
  const ink = fill.v > 0.6 ? fill.clone().darken(60).color : fill.clone().darken(45).color;
  const light = fill.clone().lighten(25).color;
  const g = scene.make.graphics({}, false);
  if (def.category === "room") {
    // Wall, a baseboard, and the floor.
    const floor = Math.round(h * 0.72);
    g.fillStyle(fill.color).fillRect(0, 0, w, floor);
    g.fillStyle(fill.clone().darken(30).color).fillRect(0, floor, w, h - floor);
    g.fillStyle(fill.clone().darken(45).color).fillRect(0, floor, w, 3);
  } else if (key.startsWith("customer/body")) {
    // Shoulders and a torso.
    g.fillStyle(fill.color).fillRoundedRect(0, 0, w, h, { tl: Math.min(20, w / 3), tr: Math.min(20, w / 3), bl: 0, br: 0 });
    g.fillStyle(fill.clone().darken(20).color).fillRect(Math.round(w / 2) - 1, 8, 2, h - 8);
  } else if (key.startsWith("customer/face") || def.category === "status") {
    g.fillStyle(fill.color).fillCircle(w / 2, h / 2, Math.min(w, h) / 2);
  } else if (key === "computer/monitor") {
    g.fillStyle(fill.color).fillRect(0, 0, w, h);
    g.fillStyle(0x10141a).fillRect(8, 8, w - 16, h - 16);
  } else {
    const r = def.category === "furniture" || def.category === "ui" ? 0 : Math.min(4, Math.floor(Math.min(w, h) / 6));
    g.fillStyle(fill.color).fillRoundedRect(0, 0, w, h, r);
    g.lineStyle(1, ink).strokeRoundedRect(0.5, 0.5, w - 1, h - 1, r);
    if (def.category === "furniture") g.fillStyle(light).fillRect(1, 1, w - 2, 2); // the top edge catches the light
    if (key === "shelf/rack") {
      // Three shelves, each a third of the way down (the pickup slots sit on them: see spots in the manifest).
      for (let i = 1; i <= 3; i++) g.fillStyle(ink).fillRect(0, Math.round((h * i) / 3) - 4, w, 4);
      g.fillStyle(ink).fillRect(0, 0, 4, h).fillRect(w - 4, 0, 4, h);
    }
  }
  if (key.endsWith("_broken") || key.endsWith("_down")) {
    // Something's wrong with it: a red cross.
    g.lineStyle(3, 0xb3261e).lineBetween(4, 4, w - 4, h - 4).lineBetween(w - 4, 4, 4, h - 4);
  }
  const icon = def.icon ? ICONS[def.icon] : undefined;
  if (icon) {
    const iw = Math.max(...icon.map((r) => r.length));
    const ih = icon.length;
    const big = key.startsWith("customer/face") ? 0.8 : 0.7;
    // Big props have other things on them, so their icon goes small in a corner.
    const corner = def.layer === "props" && Math.min(w, h) >= 100;
    const s = corner ? 2 : Math.max(1, Math.floor(Math.min((w * big) / iw, (h * big) / ih)));
    const ox = corner ? 6 : Math.floor((w - iw * s) / 2);
    const oy = corner ? 6 : Math.floor((h - ih * s) / 2);
    icon.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c !== "#" && c !== "+") return;
        g.fillStyle(c === "#" ? ink : 0xffffff).fillRect(ox + x * s, oy + y * s, s, s);
      }),
    );
  }
  g.generateTexture(key, w, h);
  g.destroy();
}

// A sprite from the manifest, anchored and layered as listed.
export function sprite(scene: Phaser.Scene, key: string, x: number, y: number): Phaser.GameObjects.Sprite {
  const def = SPRITES[key];
  const s = scene.add.sprite(x, y, key).setOrigin(def.anchor[0], def.anchor[1]).setDepth(depthOf(def.layer));
  s.setName(key);
  return s;
}

export function playAnim(s: Phaser.GameObjects.Sprite, name: string): void {
  const k = `${s.texture.key}:${name}`;
  if (s.scene.anims.exists(k)) s.play(k, true);
}

let ac: AudioContext | null = null;
// A sound by key: the file if there is one, otherwise its stand-in tone.
export function sound(scene: Phaser.Scene, key: keyof typeof SOUNDS | string): void {
  if (scene.cache.audio.exists(key)) return void scene.sound.play(key);
  const tone = SOUNDS[key]?.tone;
  if (!tone) return;
  try {
    ac ??= new AudioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = tone[0];
    g.gain.setValueAtTime(0.06, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + tone[1] / 1000);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + tone[1] / 1000);
  } catch {
    /* no sound is fine */
  }
}
