// ART_CHECKLIST.md, generated from the manifest: every sprite an artist needs to make (npm run art).
import manifest from "../assets/manifest.json";
import sounds from "../assets/sounds.json";
import type { SpriteDef } from "./assets";

export function checklist(): string {
  const sprites = manifest.sprites as Record<string, SpriteDef>;
  const groups = new Map<string, string[]>();
  for (const key of Object.keys(sprites)) {
    const g = key.split("/")[0];
    groups.set(g, [...(groups.get(g) ?? []), key]);
  }
  const out = [
    "# Art checklist",
    "",
    "Generated from `src/assets/manifest.json` by `npm run art`. Don't edit by hand.",
    "",
    `Pixel art on a grid of ${manifest.base.stageWidth}x${manifest.base.stageHeight} art pixels per station, drawn at ${manifest.base.art}x (nearest-neighbour) on a`,
    "1280x720 screen. Every sprite below is drawn as a placeholder (a shape in its category's color, and an icon) until",
    "its file exists. To add one, save it at the path shown: a single PNG, a PNG strip of frames (left to right, in the",
    "order the animations are listed), or an Aseprite export (PNG + JSON with the same name). Sizes are in art pixels;",
    "the anchor is the point placed at the sprite's position (0.5, 0.5 is the center). Anything you can click is at",
    "least 28 art pixels on its short side (56 on screen).",
    "",
    `Categories (placeholder colors, so the same kind of thing looks the same everywhere): ${Object.entries(manifest.categories).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    "",
    `Layers, back to front: ${manifest.layers.join(", ")}.`,
    "",
  ];
  for (const [g, keys] of groups) {
    out.push(`## ${g}`, "", "| Done | Key | Name | File | Size | Anchor | Frames | Layer | Category | What it is |", "|---|---|---|---|---|---|---|---|---|---|");
    for (const k of keys) {
      const d = sprites[k];
      const frames = d.animations ? Object.entries(d.animations).map(([n, a]) => `${n}: ${a.frames} @ ${a.fps} fps`).join("; ") : "1";
      out.push(`| [ ] | \`${k}\` | ${d.label} | \`src/assets/art/${k}.png\` | ${d.size.join("x")} | ${d.anchor.join(", ")} | ${frames} | ${d.layer} | ${d.category} | ${d.purpose} |`);
    }
    out.push("");
  }
  out.push("## Sounds", "", "Optional: each plays `src/assets/sounds/<key>.ogg` (or .mp3, .wav) if it exists, and a short tone otherwise.", "", "| Done | Key | Stand-in tone |", "|---|---|---|");
  for (const [k, v] of Object.entries(sounds.sounds)) out.push(`| [ ] | \`${k}\` | ${v.tone[0]} Hz, ${v.tone[1]} ms |`);
  return out.join("\n") + "\n";
}
