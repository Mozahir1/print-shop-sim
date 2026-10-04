// The first-person view of the station you're at, drawn on a canvas. Everything is drawn through the asset map
// (art.ts), so real art drops in without touching this.
import type { GameState } from "../sim/types";
import { draw, lookFor, palette } from "./art";
import { atCounter, type Tab } from "./view";

export const W = 800;
export const H = 300;

export function drawStage(ctx: CanvasRenderingContext2D, state: GameState, tab: Tab): void {
  const p = palette();
  ctx.clearRect(0, 0, W, H);
  switch (tab) {
    case "counter": {
      const front = atCounter(state);
      const inLine = state.customers.filter((c) => c.state === "line" || c.state === "talking").length;
      draw(ctx, "bg.counter", 0, 0, W, H, p, { count: Math.max(0, inLine - 1) });
      if (front) draw(ctx, "portrait", W / 2 - 110, 20, 220, H * 0.74 - 20, p, { look: lookFor(front.id, front.kind === "business"), face: front.stage === "gone" ? "angry" : front.stage });
      return;
    }
    case "printer": {
      const waiting = state.jobs.filter((j) => j.status === "printed").reduce((n, j) => n + j.sheets, 0);
      return draw(ctx, "bg.printer", 0, 0, W, H, p, { status: state.printer.status, count: Math.ceil(waiting / 10) });
    }
    case "shipping":
      return draw(ctx, "bg.shipping", 0, 0, W, H, p, { count: state.packages.filter((x) => x.status === "binned").length });
    case "shelf": {
      const name = (id: number) => (state.customers.find((c) => c.id === id)?.name ?? "").split(" ")[0];
      const labels = [...state.jobs.filter((j) => j.status === "bagged").map((j) => name(j.customerId)), ...state.packages.filter((x) => x.kind === "held" && x.status === "held").map((x) => `Pkg ${name(x.customerId)}`)];
      return draw(ctx, "bg.shelf", 0, 0, W, H, p, { labels });
    }
    default:
      return draw(ctx, `bg.${tab}`, 0, 0, W, H, p);
  }
}

// The hand slot: what you're holding, or nothing.
export function drawHand(ctx: CanvasRenderingContext2D, item: string | null): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (item) draw(ctx, `item.${item}`, 4, 4, ctx.canvas.width - 8, ctx.canvas.height - 8, palette());
}
