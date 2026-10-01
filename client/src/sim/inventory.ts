// The stockroom: back stock of paper, toner, ink, rolls and boxes. Machines and the shipping counter draw from it,
// and every task that takes supplies includes the walk to the stockroom and back.
import type { BoxSize, GameState, JobSpec, PaperStock, StockItem, Tray, Vec } from "./types";
import { stockFor, stockPerSheet, totalSheets } from "./orders";
import { STOCK, TUNING } from "./config";
import { STOCKROOM } from "./layout";
import { randInt, type Rng } from "./rng";
import { log } from "./util";

export const STOCK_ITEMS = Object.keys(STOCK) as StockItem[];

// Starting levels for a single shift, from the stockroom's own RNG stream.
export function generateStockroom(rng: Rng): Record<StockItem, number> {
  const out = {} as Record<StockItem, number>;
  for (const item of STOCK_ITEMS) out[item] = randInt(rng, STOCK[item].start[0], STOCK[item].start[1]);
  return out;
}

export function itemForTray(stock: PaperStock): StockItem {
  return stock === "roll" ? "wide_roll" : stock;
}

export function boxItem(size: BoxSize): StockItem {
  return `box_${size}` as StockItem;
}

export function boxUnitCents(size: BoxSize): number {
  const def = STOCK[boxItem(size)];
  return def.packCents / def.pack;
}

// Round trip from a machine to the stockroom and back, in seconds.
export function fetchSeconds(from: Vec): number {
  return Math.round((2 * Math.hypot(from.x - STOCKROOM.x, from.y - STOCKROOM.y)) / TUNING.walkSpeed);
}

// What loading this tray would take out of the stockroom: sheets up to the tray's capacity, or one whole roll.
export function paperToLoad(state: GameState, tray: Tray): number {
  const item = itemForTray(tray.stock);
  if (tray.stock === "roll") return Math.min(1, state.stockroom[item]);
  return Math.min(Math.floor(tray.capacity - tray.level), state.stockroom[item]);
}

// Takes `amount` of an item and logs when it runs low.
export function take(state: GameState, item: StockItem, amount: number): void {
  const before = state.stockroom[item];
  state.stockroom[item] = Math.max(0, before - amount);
  const after = state.stockroom[item];
  const def = STOCK[item];
  if (after === 0 && before > 0) log(state, `The stockroom is out of ${def.label.toLowerCase()}.`);
  else if (after <= def.low && before > def.low) log(state, `The stockroom is running low on ${def.label.toLowerCase()} (${after.toLocaleString("en-US")} ${def.unit} left).`);
}

export function isLow(state: GameState, item: StockItem): boolean {
  return state.stockroom[item] <= STOCK[item].low;
}

// Whether there's enough of the right paper on hand (trays plus stockroom) for a new order on top of open ones.
// Returns a reason if not. Used for the counter estimate and by the bot.
export function paperShortfall(state: GameState, spec: JobSpec): string | null {
  const stock = stockFor(spec.media);
  const item = itemForTray(stock);
  const trays = state.printers.flatMap((p) => p.trays.filter((t) => t.stock === stock));
  if (!trays.length) return null;
  const perUnit = stock === "roll" ? trays[0].capacity : 1; // a spare roll is a full roll's worth of feet
  // In the trays, on the shelf, and anything you're carrying or set down on the counter.
  const carried = [state.employee.hands, ...state.counterItems].reduce(
    (a, c) => a + (c?.kind === "paper" && c.stock === stock ? c.sheets : c?.kind === "roll" && stock === "roll" ? perUnit : 0),
    0,
  );
  const available = trays.reduce((a, t) => a + t.level, 0) + state.stockroom[item] * perUnit + carried;
  const committed = state.jobs
    .filter((j) => (j.status === "unsent" || j.status === "queued" || j.status === "printing") && stockFor(j.spec.media) === stock)
    .reduce((a, j) => a + (j.sheets - j.sheetsPrinted) * stockPerSheet(j.spec.media), 0);
  const need = totalSheets(spec) * stockPerSheet(spec.media);
  if (need <= available - committed) return null;
  const unit = stock === "roll" ? "ft of roll paper" : STOCK[item].label.toLowerCase();
  return `Not enough ${unit} on hand: this needs ${Math.ceil(need).toLocaleString("en-US")}, and about ${Math.max(0, Math.floor(available - committed)).toLocaleString("en-US")} is left after open orders.`;
}
