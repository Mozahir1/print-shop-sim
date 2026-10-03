// Everything the scene draws goes through this registry: people, held items, stations, mood icons, bubbles.
// These are placeholder shapes. Real sprites drop in by replacing these functions (same names, same arguments);
// nothing else changes.
import type { PatienceStage, Station } from "../sim/types";

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

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Sprites {
  person(ctx: CanvasRenderingContext2D, x: number, y: number, o: { body: string; label?: string; pose?: string; p: Palette }): void;
  item(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, p: Palette): void;
  station(ctx: CanvasRenderingContext2D, id: Station | "truck" | "counter", r: Rect, o: { pulse: number; label: string; status?: string; p: Palette }): void;
  mood(ctx: CanvasRenderingContext2D, stage: PatienceStage, x: number, y: number, p: Palette): void;
  bubble(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: { thought: boolean; p: Palette; maxWidth?: number }): void;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Word-wraps text to a width; returns the lines.
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const ITEM_COLOR: Record<string, string> = {
  box: "#b98b55",
  paper: "#f4f4f0",
  ream: "#e9e3d3",
  bag: "#9bb7d4",
  wrench: "#8a8f98",
  tape: "#d9c06a",
  label: "#ffffff",
  pen: "#3b5b8a",
  sign: "#e8b94a",
};

export const sprites: Sprites = {
  person(ctx, x, y, { body, label, pose, p }) {
    const lean = pose === "bend" ? 4 : pose === "reach" ? 2 : 0;
    ctx.fillStyle = body;
    roundRect(ctx, x - 11 + lean, y - 8, 22, 30, 7); // body
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + lean, y - 17, 9, 0, Math.PI * 2); // head
    ctx.fillStyle = "#e6c2a0";
    ctx.fill();
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (label) {
      ctx.fillStyle = p.ink;
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x, y + 36);
    }
  },
  item(ctx, name, x, y, p) {
    ctx.fillStyle = ITEM_COLOR[name] ?? p.muted;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1;
    if (name === "wrench" || name === "pen") {
      ctx.fillRect(x - 2, y - 9, 4, 18);
      ctx.strokeRect(x - 2, y - 9, 4, 18);
      return;
    }
    const w = name === "paper" || name === "label" ? 16 : 18;
    const h = name === "paper" || name === "label" ? 12 : 14;
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  },
  station(ctx, id, r, { pulse, label, status, p }) {
    ctx.fillStyle = id === "counter" ? p.counter : p.card;
    roundRect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fill();
    ctx.lineWidth = pulse > 0 ? 2 + 2 * pulse : 1;
    ctx.strokeStyle = pulse > 0 ? p.warn : p.line;
    ctx.stroke();
    ctx.fillStyle = p.ink;
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, r.x + r.w / 2, r.y + 15);
    if (status) {
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillStyle = pulse > 0 ? p.warn : p.muted;
      ctx.fillText(status, r.x + r.w / 2, r.y + 28);
    }
  },
  mood(ctx, stage, x, y, p) {
    if (stage === "gone") return;
    const color = stage === "fine" ? p.ok : stage === "annoyed" ? p.warn : p.bad;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (stage !== "fine") {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(stage === "annoyed" ? "!" : "!!", x, y + 3);
    }
  },
  bubble(ctx, text, x, y, { thought, p, maxWidth = 160 }) {
    ctx.font = "12px system-ui, sans-serif";
    const lines = wrap(ctx, text, maxWidth);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14;
    const h = lines.length * 15 + 8;
    const bx = Math.max(4, Math.min(800 - w - 4, x - w / 2));
    const by = y - h - 10;
    ctx.fillStyle = p.card;
    ctx.strokeStyle = thought ? p.muted : p.ink;
    ctx.lineWidth = 1;
    if (thought) ctx.setLineDash([3, 3]);
    roundRect(ctx, bx, by, w, h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (thought) {
      ctx.beginPath();
      ctx.arc(x, y - 5, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x - 5, by + h);
      ctx.lineTo(x, y - 2);
      ctx.lineTo(x + 5, by + h);
      ctx.fill();
    }
    ctx.fillStyle = thought ? p.muted : p.ink;
    ctx.textAlign = "left";
    lines.forEach((l, i) => ctx.fillText(l, bx + 7, by + 16 + i * 15));
  },
};
