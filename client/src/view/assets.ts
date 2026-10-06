// The art pipeline. Every sprite is listed in assets/manifest.json (size, anchor, layer, animations). If its file is
// in assets/art/ it's loaded (a single PNG, a PNG strip of frames, or an Aseprite PNG + JSON export); if not, a
// placeholder is drawn from the manifest (a flat shape and the key's name), so the game always runs with no art.
// Sounds work the same way from assets/sounds.json: a file if there is one, a short tone if not.
import Phaser from "phaser";
import manifest from "../assets/manifest.json";
import soundMap from "../assets/sounds.json";

export interface SpriteDef {
  size: number[];
  anchor: number[];
  layer: string;
  color: string;
  purpose: string;
  animations?: Record<string, { frames: number; fps: number }>;
}
export const SPRITES = manifest.sprites as Record<string, SpriteDef>;
export const LAYOUT = manifest.scenes as Record<string, { key: string; x: number; y: number; starts?: string[] }[]>;
export const SPOT = manifest.spots as Record<string, number[]>;
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

function placeholder(scene: Phaser.Scene, key: string, def: SpriteDef): void {
  const [w, h] = def.size;
  const g = scene.make.graphics({}, false);
  const fill = Phaser.Display.Color.HexStringToColor(def.color);
  g.fillStyle(fill.color, 1).fillRect(0, 0, w, h);
  if (def.layer !== "background") g.lineStyle(1, fill.clone().darken(35).color, 1).strokeRect(0.5, 0.5, w - 1, h - 1);
  const rt = scene.make.renderTexture({ width: w, height: h }, false);
  rt.draw(g);
  const name = key.split("/")[1];
  if (w >= 24 && h >= 10 && def.layer !== "background") {
    const t = scene.make.text({ text: name, style: { fontFamily: "monospace", fontSize: "7px", color: fill.v > 0.55 ? "#3a3a3a" : "#f0f0f0", align: "center", wordWrap: { width: w - 2 } } }, false);
    rt.draw(t, Math.max(1, (w - t.width) / 2), Math.max(1, (h - t.height) / 2));
    t.destroy();
  }
  rt.saveTexture(key);
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
