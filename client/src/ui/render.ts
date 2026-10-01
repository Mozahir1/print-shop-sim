// Draws the store floor on a canvas. It's an overview; everything you do happens in the panels.
import type { GameState, Printer } from "../sim/types";
import { DOOR, MAP_H, MAP_W, REGISTER, TRUCK_BAY, zones } from "../sim/layout";
import { printerStopped } from "../sim/upkeep";
import { servingCustomerId } from "../sim/sim";
import { ringingCalls } from "../sim/phone";
import { PHONE_RECT, type Rect } from "./floor";

const TILE = 40; // pixels per meter (the canvas is scaled to fit its container)

export function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = MAP_W * TILE * dpr;
  canvas.height = MAP_H * TILE * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}

export function render(ctx: CanvasRenderingContext2D, state: GameState, selected?: Rect): void {
  ctx.fillStyle = "#f8f6f1";
  ctx.fillRect(0, 0, MAP_W * TILE, MAP_H * TILE);
  ctx.textBaseline = "top";

  for (const z of zones) {
    ctx.fillStyle = z.color;
    ctx.fillRect(z.x * TILE, z.y * TILE, z.w * TILE, z.h * TILE);
    ctx.fillStyle = "#5b5f66";
    ctx.font = "11px system-ui";
    ctx.fillText(z.label, z.x * TILE + 4, z.y * TILE + 3);
  }

  // register
  ctx.fillStyle = "#3b3f45";
  ctx.fillRect((REGISTER.x - 0.4) * TILE, 4.7 * TILE, 0.8 * TILE, 0.5 * TILE);
  ctx.fillStyle = "#fff";
  ctx.font = "9px system-ui";
  ctx.fillText("register", (REGISTER.x - 0.37) * TILE, 4.78 * TILE);

  // phone on the counter; it shakes a little ring around it while it rings
  const ph = PHONE_RECT;
  ctx.fillStyle = "#3b3f45";
  ctx.fillRect(ph.x * TILE, ph.y * TILE, ph.w * TILE, ph.h * TILE);
  ctx.fillStyle = "#fff";
  ctx.font = "9px system-ui";
  ctx.fillText("phone", ph.x * TILE + 2, ph.y * TILE + 5);
  if (ringingCalls(state).length && Math.floor(state.time) % 2 === 0) {
    ring(ctx, ph.x + ph.w / 2, ph.y + ph.h / 2, 0.55, "#b3261e");
  }

  for (const p of state.printers) drawPrinter(ctx, p, state.time);
  for (const cp of state.copiers) {
    const cx = (cp.spot.x - 1.7) * TILE;
    const cy = (cp.spot.y - 0.55) * TILE;
    ctx.fillStyle = cp.userId !== null ? "#6b5a8e" : "#8c96a3";
    ctx.fillRect(cx, cy, 1.2 * TILE, 1.1 * TILE);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px system-ui";
    ctx.fillText(`Copier ${cp.id}`, cx + 2, cy + 4);
    statusLight(ctx, cx + 1.2 * TILE - 8, cy + 1.1 * TILE - 8, cp.status !== "ok" ? "stopped" : cp.work ? "running" : "off", state.time);
  }

  // The door chime: someone just walked in.
  if (state.customers.some((c) => c.state === "line" && Math.hypot(c.pos.x - DOOR.x, c.pos.y - DOOR.y) < 1.5)) {
    ctx.fillStyle = "#c9a227";
    ctx.font = "bold 14px system-ui";
    ctx.fillText("🔔", (DOOR.x + 1.1) * TILE, (DOOR.y - 0.9) * TILE);
  }

  if (state.truck.status === "waiting") {
    const b = TRUCK_BAY;
    ctx.fillStyle = "#5b4636";
    ctx.fillRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px system-ui";
    ctx.fillText("Carrier truck", b.x * TILE + 6, b.y * TILE + 8);
    ctx.font = "10px system-ui";
    ctx.fillText("waiting", b.x * TILE + 6, b.y * TILE + 24);
  }

  const serving = servingCustomerId(state);
  for (const c of state.customers) {
    if (c.state === "outside") continue;
    const shipping = c.purpose === "ship" || c.purpose === "dropoff" || c.purpose === "package";
    const color =
      c.state === "seated" ? "#9c8a6c" : c.state === "self_serve" ? "#6b5a8e" : shipping ? "#b0672a" : c.purpose === "order" ? "#2f5d8a" : "#2e7d4f";
    dot(ctx, c.pos.x, c.pos.y, 0.32, color, c.state === "leaving" ? 0.45 : 1);
    if (c.id === serving) ring(ctx, c.pos.x, c.pos.y, 0.45, "#1f2328");
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(c.name[0], c.pos.x * TILE, c.pos.y * TILE - 5);
    ctx.textAlign = "left";
  }

  if (selected) {
    ctx.strokeStyle = "#2f5d8a";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(selected.x * TILE - 2, selected.y * TILE - 2, selected.w * TILE + 4, selected.h * TILE + 4);
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }

  const e = state.employee;
  dot(ctx, e.pos.x, e.pos.y, 0.36, "#1f2328", 1);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 9px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("You", e.pos.x * TILE, e.pos.y * TILE - 5);
  ctx.textAlign = "left";
}

// A printer looks like a printer. All it tells you from across the room is its light: green while it's running,
// blinking red when it has stopped for any reason. What's wrong, you find out at the machine.
function drawPrinter(ctx: CanvasRenderingContext2D, p: Printer, time: number): void {
  const x = p.tile.x * TILE;
  const y = p.tile.y * TILE;
  const size = TILE * 2;
  ctx.fillStyle = "#8c96a3";
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 12px system-ui";
  ctx.fillText(p.short, x + 5, y + 6);
  statusLight(ctx, x + size - 10, y + 10, printerStopped(p) ? "stopped" : p.status === "printing" || p.status === "warming_up" ? "running" : "off", time);
}

function statusLight(ctx: CanvasRenderingContext2D, px: number, py: number, kind: "running" | "stopped" | "off", time: number): void {
  if (kind === "stopped" && Math.floor(time) % 2 === 1) kind = "off"; // blink
  ctx.fillStyle = kind === "running" ? "#3fb950" : kind === "stopped" ? "#ff4d4f" : "#59606a";
  ctx.beginPath();
  ctx.arc(px, py, 5, 0, Math.PI * 2);
  ctx.fill();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x * TILE, y * TILE, r * TILE, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x * TILE, y * TILE, r * TILE, 0, Math.PI * 2);
  ctx.stroke();
}
