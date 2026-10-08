// Layout checks on the real page (window.audit() in dev mode; the UI playtest calls it at every stop): regions don't
// overlap, nothing spills out of its region, at most one modal is up, no text under 16px, no target under 56px, and
// no text cut off. Sizes are in layout pixels (the 1280x720 screen), whatever the window's size.
import type Phaser from "phaser";
import { ART, MIN, REGION, type Region } from "./layout";
import { scale } from "./hud";
import { ctl } from "./run";

export interface Problem {
  kind: "overlap" | "outside" | "modals" | "small text" | "small target" | "clipped" | "covered";
  what: string;
  detail: string;
}

const SLACK = 0.75; // layout pixels of rounding

function name(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classList.length ? `.${[...el.classList].join(".")}` : "";
  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
  return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
}

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
  }
  return true;
}

const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const over = (a: DOMRect, b: DOMRect, s: number) => a.left < b.right - s && b.left < a.right - s && a.top < b.bottom - s && b.top < a.bottom - s;
const within = (a: DOMRect, b: DOMRect, s: number) => a.left >= b.left - s && a.top >= b.top - s && a.right <= b.right + s && a.bottom <= b.bottom + s;

// The counter's open box (the conversation, or the register's keypad), in art pixels on the stage.
function counterBox(): { x: number; y: number; width: number; height: number } | null {
  const el = [...document.querySelectorAll<HTMLElement>("#modal .modal-box.dialog, #modal .modal-box.keypad")].find((e) => visible(e));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const st = document.getElementById("stage")!.getBoundingClientRect();
  const u = scale();
  return { x: (r.left - st.left) / u / ART, y: (r.top - st.top) / u / ART, width: r.width / u / ART, height: r.height / u / ART };
}

export function audit(game?: Phaser.Game): Problem[] {
  const u = scale();
  const out: Problem[] = [];
  const add = (kind: Problem["kind"], el: Element | string, detail: string) => out.push({ kind, what: typeof el === "string" ? el : name(el), detail });
  const regions = (Object.keys(REGION) as Region[]).map((r) => [r, document.getElementById(r)!] as const);

  // The regions.
  for (let i = 0; i < regions.length; i++)
    for (let j = i + 1; j < regions.length; j++)
      if (over(regions[i][1].getBoundingClientRect(), regions[j][1].getBoundingClientRect(), SLACK * u)) add("overlap", `#${regions[i][0]}`, `overlaps #${regions[j][0]}`);

  // One modal at a time.
  const modals = [...document.querySelectorAll(".modal-box")].filter(visible);
  if (modals.length > 1) add("modals", modals.map(name).join(", "), `${modals.length} modals up at once`);

  for (const [region, root] of regions) {
    const box = root.getBoundingClientRect();
    for (const el of [root, ...root.querySelectorAll("*")]) {
      if (!visible(el) || el.closest("svg") && el.tagName !== "svg") continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (el !== root && cs.position !== "absolute" && !within(r, box, SLACK * u)) add("outside", el, `spills out of #${region}`);
      // Text: its size, and whether it's cut off.
      const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      if (ownText && parseFloat(cs.fontSize) / u < MIN.label - SLACK) add("small text", el, `${(parseFloat(cs.fontSize) / u).toFixed(1)}px`);
      const clipsX = cs.overflowX === "hidden" || cs.overflowX === "clip";
      const clipsY = cs.overflowY === "hidden" || cs.overflowY === "clip";
      if ((clipsX && el.scrollWidth > el.clientWidth + 1) || (clipsY && el.scrollHeight > el.clientHeight + 1)) add("clipped", el, `content ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
      if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) add("clipped", el, "cut off with an ellipsis");
      // Targets.
      const target = el.matches("button, input:not([type=radio]):not([type=checkbox]), [data-act], .chip-opt > span, .tab");
      if (target && Math.min(r.width, r.height) / u < MIN.target - SLACK) add("small target", el, `${(r.width / u).toFixed(0)}x${(r.height / u).toFixed(0)}`);
    }
  }

  // The station you're looking at: what you can click, and its text.
  const scene = game?.scene.getScene(ctl.tab) as Phaser.Scene | undefined;
  if (scene?.sys.isActive()) {
    for (const o of scene.children.list as (Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.GetBounds & Phaser.GameObjects.Components.Visible)[]) {
      if (!o.visible || !("getBounds" in o)) continue;
      const b = o.getBounds();
      if (o.input?.enabled && Math.min(b.width, b.height) * ART < MIN.target - SLACK) add("small target", `${scene.sys.settings.key}: ${o.name || o.type}`, `${(b.width * ART).toFixed(0)}x${(b.height * ART).toFixed(0)}`);
      // An arrow's words (during hold, drag, tap, pick steps) never cover the hold meter, or anything else that glows.
      if (o.getData("guide")) {
        const c = o as unknown as Phaser.GameObjects.Container;
        const tip = { x: c.x, y: c.y };
        const words = (c.list[1] as Phaser.GameObjects.Text).getBounds();
        const meter = (scene as unknown as { meter: Phaser.Geom.Rectangle | null }).meter;
        const label = `${scene.sys.settings.key}: "${(c.list[1] as Phaser.GameObjects.Text).text}"`;
        if (meter && intersects(words, meter)) add("covered", label, "covers the hold meter");
        for (const g of scene.children.list) {
          if (!g.getData("glow")) continue;
          const r = (g as Phaser.GameObjects.Rectangle).getBounds();
          const pointsAtIt = tip.x >= r.left - 8 && tip.x <= r.right + 8 && tip.y >= r.top - 8 && tip.y <= r.bottom + 8;
          if (!pointsAtIt && intersects(words, r)) add("covered", label, `covers something to click (${Math.round(r.x)},${Math.round(r.y)})`);
        }
      }
      // Your coworker, and who they're helping, are never under the counter's conversation (or keypad). (Screens and
      // an unfolded note cover everything on purpose.)
      const box = counterBox();
      if (o.getData("crew") && o.visible && box && intersects(box, o.getBounds())) add("covered", `${scene.sys.settings.key}: coworker`, "under the conversation box");
      if (o.type === "Text") {
        const t = o as unknown as Phaser.GameObjects.Text;
        const px = parseFloat(String(t.style.fontSize)) * t.scaleY * ART;
        if (t.text && px < MIN.label - SLACK) add("small text", `${scene.sys.settings.key}: "${t.text.slice(0, 30)}"`, `${px.toFixed(1)}px`);
      }
    }
  }
  return out;
}
