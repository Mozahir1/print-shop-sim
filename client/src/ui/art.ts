// All art goes through this one asset map. Every key draws a flat placeholder until it's given an image URL in ART:
// put a file in public/art/ and set ART["bg.printer"] = "/art/printer.png", and it's drawn instead. No other code
// changes. Portraits are one bust template with color swaps and three expressions ("portrait.fine", ...).
import type { PatienceStage } from "../sim/types";

export const ART: Record<string, string> = {
  // "bg.counter": "/art/counter.png",
};

export interface Palette {
  ink: string;
  muted: string;
  card: string;
  line: string;
  accent: string;
  warn: string;
  bad: string;
  ok: string;
  floor: string;
  counter: string;
  wall: string;
}

export interface Look {
  skin: string;
  hair: string;
  shirt: string;
}

type Draw = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, p: Palette, o: DrawOpts) => void;
export interface DrawOpts {
  look?: Look;
  face?: PatienceStage;
  count?: number; // how many to show (packages in the bin, sheets in the tray, ...)
  status?: string;
  labels?: string[]; // names on the shelf
}

const images = new Map<string, HTMLImageElement>();
function image(key: string): HTMLImageElement | null {
  const url = ART[key];
  if (!url) return null;
  let img = images.get(key);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(key, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

// Draws one asset: the real image if there is one, the placeholder otherwise.
export function draw(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, w: number, h: number, p: Palette, o: DrawOpts = {}): void {
  const img = image(key);
  if (img) return void ctx.drawImage(img, x, y, w, h);
  (PLACEHOLDER[key] ?? box("#ccc"))(ctx, x, y, w, h, p, o);
}

const SKIN = ["#f1d0b5", "#d9a77f", "#a8734f", "#6e4a33"];
const HAIR = ["#2b2118", "#6b4528", "#c9a15a", "#8a8a8a", "#a3462d"];
const SHIRT = ["#5d8bb8", "#8d6aa8", "#5f9e72", "#c2723a", "#b0505a", "#4f6b7a"];

// One customer's colors, from who they are.
export function lookFor(id: number, business: boolean): Look {
  return { skin: SKIN[id % SKIN.length], hair: HAIR[(id >> 1) % HAIR.length], shirt: business ? "#2f3a48" : SHIRT[(id >> 2) % SHIRT.length] };
}

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number, stroke?: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, size = 12): void {
  ctx.fillStyle = color;
  ctx.font = `${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(s, x, y);
}

function box(color: string): Draw {
  return (ctx, x, y, w, h, p) => rect(ctx, color, x, y, w, h, p.ink);
}

const PLACEHOLDER: Record<string, Draw> = {
  // ---------- station backgrounds ----------
  "bg.counter"(ctx, x, y, w, h, p, o) {
    rect(ctx, p.wall, x, y, w, h);
    rect(ctx, p.floor, x + w * 0.72, y + h * 0.1, w * 0.18, h * 0.62, p.line); // the door
    for (let i = 0; i < (o.count ?? 0); i++) {
      // the rest of the line, behind them
      ctx.fillStyle = p.muted;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(x + w * 0.78 - i * 34, y + h * 0.42, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x + w * 0.78 - i * 34 - 14, y + h * 0.48, 28, 40);
      ctx.globalAlpha = 1;
    }
    rect(ctx, p.counter, x, y + h * 0.74, w, h * 0.26, p.ink); // the counter top
    rect(ctx, "#444b55", x + w * 0.08, y + h * 0.62, 70, 40, p.ink); // register
  },
  "bg.printer"(ctx, x, y, w, h, p, o) {
    rect(ctx, p.wall, x, y, w, h);
    rect(ctx, p.card, x + w * 0.25, y + h * 0.15, w * 0.5, h * 0.7, p.ink);
    rect(ctx, "#e9e3d3", x + w * 0.3, y + h * 0.72, w * 0.16, h * 0.08, p.ink); // tray
    rect(ctx, "#f4f4f0", x + w * 0.55, y + h * 0.3 - Math.min(30, o.count ?? 0), w * 0.15, 6 + Math.min(30, o.count ?? 0), p.ink); // output stack
    const lamp = o.status === "jammed" ? p.bad : o.status === "tray_empty" ? p.warn : o.status === "printing" ? p.ok : p.muted;
    ctx.fillStyle = lamp;
    ctx.beginPath();
    ctx.arc(x + w * 0.7, y + h * 0.22, 7, 0, Math.PI * 2);
    ctx.fill();
  },
  "bg.finishing"(ctx, x, y, w, h, p) {
    rect(ctx, p.wall, x, y, w, h);
    rect(ctx, p.counter, x, y + h * 0.6, w, h * 0.4, p.ink);
    draw(ctx, "item.stapler", x + w * 0.15, y + h * 0.45, 60, 40, p);
    rect(ctx, "#9aa3ad", x + w * 0.42, y + h * 0.45, 110, 40, p.ink); // cutter
    rect(ctx, "#6d7680", x + w * 0.7, y + h * 0.4, 90, 50, p.ink); // laminator
  },
  "bg.shipping"(ctx, x, y, w, h, p, o) {
    rect(ctx, p.wall, x, y, w, h);
    rect(ctx, p.counter, x, y + h * 0.6, w * 0.7, h * 0.4, p.ink);
    draw(ctx, "item.scale", x + w * 0.08, y + h * 0.45, 90, 45, p);
    draw(ctx, "item.box_large", x + w * 0.35, y + h * 0.3, 80, 70, p);
    draw(ctx, "item.box_medium", x + w * 0.48, y + h * 0.4, 60, 52, p);
    rect(ctx, "#59626c", x + w * 0.74, y + h * 0.45, w * 0.22, h * 0.5, p.ink); // outbound bin
    text(ctx, `Outbound: ${o.count ?? 0}`, x + w * 0.85, y + h * 0.42, p.ink);
  },
  "bg.shelf"(ctx, x, y, w, h, p, o) {
    rect(ctx, p.wall, x, y, w, h);
    const labels = o.labels ?? [];
    for (let row = 0; row < 3; row++) rect(ctx, p.counter, x + 20, y + 70 + row * 80, w - 40, 8, p.ink);
    labels.slice(0, 18).forEach((name, i) => {
      const bx = x + 40 + (i % 6) * ((w - 80) / 6);
      const by = y + 22 + Math.floor(i / 6) * 80;
      draw(ctx, "item.bag", bx, by, 52, 48, p);
      text(ctx, name, bx + 26, by + 34, p.ink, 10);
    });
  },
  // ---------- the customer: one bust, colors swapped, three faces ----------
  portrait(ctx, x, y, w, h, p, o) {
    const look = o.look ?? { skin: SKIN[0], hair: HAIR[0], shirt: SHIRT[0] };
    const cx = x + w / 2;
    ctx.fillStyle = look.shirt; // shoulders
    ctx.beginPath();
    ctx.ellipse(cx, y + h, w * 0.45, h * 0.32, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = look.skin; // head
    ctx.beginPath();
    ctx.ellipse(cx, y + h * 0.42, w * 0.22, h * 0.27, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = look.hair;
    ctx.beginPath();
    ctx.ellipse(cx, y + h * 0.27, w * 0.23, h * 0.14, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = p.ink;
    ctx.fillStyle = p.ink;
    ctx.lineWidth = 2;
    const face = o.face ?? "fine";
    const eyeY = y + h * 0.4;
    for (const dx of [-0.08, 0.08]) {
      ctx.beginPath();
      ctx.arc(cx + w * dx, eyeY, 3, 0, Math.PI * 2);
      ctx.fill();
      if (face !== "fine") {
        // brows, dipping toward the middle: a little when annoyed, a lot when angry
        const inner = cx + w * dx - 7 * Math.sign(dx);
        const outer = cx + w * dx + 7 * Math.sign(dx);
        ctx.beginPath();
        ctx.moveTo(outer, eyeY - 12);
        ctx.lineTo(inner, eyeY - 12 + (face === "angry" ? 7 : 3));
        ctx.stroke();
      }
    }
    const mouthY = y + h * 0.55;
    ctx.beginPath();
    if (face === "fine") ctx.arc(cx, mouthY - 6, 10, 0.2 * Math.PI, 0.8 * Math.PI);
    else if (face === "annoyed") {
      ctx.moveTo(cx - 9, mouthY);
      ctx.lineTo(cx + 9, mouthY);
    } else ctx.arc(cx, mouthY + 8, 10, 1.2 * Math.PI, 1.8 * Math.PI);
    ctx.stroke();
  },
  // ---------- items ----------
  "item.ream": box("#e9e3d3"),
  "item.paper"(ctx, x, y, w, h, p) {
    for (let i = 0; i < 3; i++) rect(ctx, "#f4f4f0", x + i * 2, y + h * 0.3 - i * 3, w * 0.8, h * 0.5, p.ink);
  },
  "item.box": box("#b98b55"),
  "item.box_small"(ctx, x, y, w, h, p) {
    rect(ctx, "#b98b55", x + w * 0.2, y + h * 0.35, w * 0.6, h * 0.5, p.ink);
  },
  "item.box_medium"(ctx, x, y, w, h, p) {
    rect(ctx, "#b98b55", x + w * 0.1, y + h * 0.2, w * 0.8, h * 0.7, p.ink);
  },
  "item.box_large": box("#a87a46"),
  "item.tape"(ctx, x, y, w, h) {
    ctx.strokeStyle = "#d9c06a";
    ctx.lineWidth = Math.min(w, h) * 0.18;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  },
  "item.label"(ctx, x, y, w, h, p) {
    rect(ctx, "#ffffff", x + w * 0.1, y + h * 0.25, w * 0.8, h * 0.5, p.ink);
    for (let i = 0; i < 3; i++) rect(ctx, p.muted, x + w * 0.2, y + h * (0.35 + i * 0.1), w * 0.5, 2);
  },
  "item.bag"(ctx, x, y, w, h, p) {
    rect(ctx, "#9bb7d4", x + w * 0.15, y + h * 0.25, w * 0.7, h * 0.7, p.ink);
    ctx.strokeStyle = p.ink;
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h * 0.25, w * 0.18, Math.PI, 0);
    ctx.stroke();
  },
  "item.stapler"(ctx, x, y, w, h, p) {
    rect(ctx, "#3b4250", x, y + h * 0.5, w, h * 0.3, p.ink);
    rect(ctx, "#b0505a", x, y + h * 0.25, w * 0.9, h * 0.25, p.ink);
  },
  "item.scale"(ctx, x, y, w, h, p, o) {
    rect(ctx, "#9aa3ad", x, y + h * 0.5, w, h * 0.5, p.ink);
    rect(ctx, "#1f2a1f", x + w * 0.25, y, w * 0.5, h * 0.4, p.ink);
    text(ctx, o.status ?? "0.0", x + w / 2, y + h * 0.3, "#7cff9a", 11);
  },
  "item.card": box("#3b5b8a"),
  "item.cash": box("#7fae7a"),
  "item.wrench"(ctx, x, y, w, h, p) {
    rect(ctx, "#8a8f98", x + w * 0.45, y + h * 0.1, w * 0.1, h * 0.8, p.ink);
  },
  "item.pen"(ctx, x, y, w, h, p) {
    rect(ctx, "#3b5b8a", x + w * 0.46, y + h * 0.1, w * 0.08, h * 0.8, p.ink);
  },
  "item.sign": box("#e8b94a"),
};

// The theme's colors, for drawing.
export function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { ink: v("--ink"), muted: v("--muted"), card: v("--card"), line: v("--line"), accent: v("--accent"), warn: v("--warn"), bad: v("--bad"), ok: v("--ok"), floor: v("--floor"), counter: v("--counter"), wall: v("--wall") };
}
