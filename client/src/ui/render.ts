// Draws the store floor on a canvas. It's an overview; everything you do happens in the panels.
import type { GameState, Printer } from "../sim/types";
import { MAP_H, MAP_W, REGISTER, TRUCK_BAY, zones } from "../sim/layout";
import { servingCustomerId } from "../sim/sim";

const TILE = 32; // pixels per meter

const PRINTER_FILL: Record<Printer["status"], string> = {
  idle: "#8c96a3",
  warming_up: "#5d84ad",
  printing: "#2f5d8a",
  jammed: "#b3261e",
  out_of_paper: "#b3261e",
  out_of_toner: "#b3261e",
  needs_service: "#6d1b16",
};

const PRINTER_TEXT: Record<Printer["status"], string> = {
  idle: "idle",
  warming_up: "warming up",
  printing: "printing",
  jammed: "JAM",
  out_of_paper: "NO PAPER",
  out_of_toner: "NO TONER",
  needs_service: "SERVICE",
};

export function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = MAP_W * TILE * dpr;
  canvas.height = MAP_H * TILE * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  return ctx;
}

export function render(ctx: CanvasRenderingContext2D, state: GameState): void {
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

  for (const p of state.printers) drawPrinter(ctx, p);
  for (const cp of state.copiers) {
    ctx.fillStyle = cp.status !== "ok" ? "#b3261e" : cp.userId !== null ? "#6b5a8e" : "#8c96a3";
    ctx.fillRect((cp.spot.x - 1.7) * TILE, (cp.spot.y - 0.55) * TILE, 1.2 * TILE, 1.1 * TILE);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px system-ui";
    ctx.fillText(`Copier ${cp.id}`, (cp.spot.x - 1.65) * TILE, (cp.spot.y - 0.45) * TILE);
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

  const e = state.employee;
  dot(ctx, e.pos.x, e.pos.y, 0.36, "#1f2328", 1);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 9px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("You", e.pos.x * TILE, e.pos.y * TILE - 5);
  ctx.textAlign = "left";
}

function drawPrinter(ctx: CanvasRenderingContext2D, p: Printer): void {
  const x = p.tile.x * TILE;
  const y = p.tile.y * TILE;
  const size = TILE * 2;
  ctx.fillStyle = PRINTER_FILL[p.status];
  ctx.fillRect(x, y, size, size);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 12px system-ui";
  ctx.fillText(p.short, x + 5, y + 6);
  ctx.font = "10px system-ui";
  ctx.fillText(PRINTER_TEXT[p.status], x + 5, y + 24);
  if (p.queue.length) ctx.fillText(`+${p.queue.length} queued`, x + 5, y + 38);
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
