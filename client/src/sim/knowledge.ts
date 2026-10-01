// What the player knows, as opposed to what's true. The sim knows everything; the player only knows what they've
// looked at, and that goes stale. Each snapshot is a plain-data copy of the facts at the moment they were observed,
// never a live reference. Observing never touches randomness.
import type { CopierStatus, GameState, Printer, PrinterStatus, StockItem, Tray } from "./types";
import { STOCK } from "./config";
import { customerById } from "./util";

export interface Snapshot<T = unknown> {
  key: string;
  at: number; // sim time it was observed
  data: T;
}

export type Fill = "full" | "half" | "low" | "empty";
export type Rough = "none" | "one" | "a few" | "plenty";

export interface TraySnap {
  printerId: string;
  stock: string;
  level: number; // rounded to the nearest 50 sheets (10 ft for a roll)
  capacity: number;
  unit: "sheets" | "ft";
}

export interface PanelSnap {
  printerId: string;
  status: PrinterStatus;
  toner: Fill;
  job: { id: number; printed: number; total: number } | null;
  output: { jobId: number; sheets: number }[];
}

export interface CopierSnap {
  copierId: number;
  status: CopierStatus;
  paper: Fill;
}

export interface StockGlanceSnap {
  items: Record<StockItem, Rough>;
}

export interface StockCountSnap {
  item: StockItem;
  count: number;
}

export interface ShelfSnap {
  orders: { jobId: number; name: string }[];
}

export interface PackageRoomSnap {
  staged: number;
  stagedExpress: number;
  onHold: { packageId: number; name: string }[];
  unsorted: number;
}

export interface FinishingSnap {
  jobs: { jobId: number; name: string; sheets: number }[];
}

export const KEYS = {
  tray: (printerId: string, stock: string) => `tray:${printerId}:${stock}`,
  panel: (printerId: string) => `panel:${printerId}`,
  copier: (copierId: number) => `copier:${copierId}`,
  stockGlance: "stock:glance",
  stockItem: (item: StockItem) => `stock:${item}`,
  shelf: "shelf",
  packageRoom: "package-room",
  finishing: "finishing",
};

// ---------- reading ----------

export function knows(state: GameState, key: string): boolean {
  return key in state.knowledge;
}

export function snapshot<T>(state: GameState, key: string): Snapshot<T> | undefined {
  return state.knowledge[key] as Snapshot<T> | undefined;
}

// Seconds since it was last observed, or null if never.
export function age(state: GameState, key: string): number | null {
  const s = state.knowledge[key];
  return s ? state.time - s.at : null;
}

// ---------- writing ----------

export function observe<T>(state: GameState, key: string, data: T): Snapshot<T> {
  const snap: Snapshot<T> = { key, at: state.time, data: structuredClone(data) };
  state.knowledge[key] = snap;
  return snap;
}

export function fillBucket(fraction: number): Fill {
  if (fraction >= 0.6) return "full";
  if (fraction >= 0.25) return "half";
  if (fraction > 0.02) return "low";
  return "empty";
}

export function roughCount(item: StockItem, count: number): Rough {
  if (count <= 0) return "none";
  const packs = count / STOCK[item].pack;
  // Paper and boxes come in packs; "one" means about one pack's worth.
  if (packs < 1.5) return count === 1 || packs >= 0.5 ? "one" : "a few";
  return packs < 4 ? "a few" : "plenty";
}

export function observeTray(state: GameState, p: Printer, tray: Tray): Snapshot<TraySnap> {
  const roll = tray.stock === "roll";
  const step = roll ? 10 : 50;
  return observe(state, KEYS.tray(p.id, tray.stock), {
    printerId: p.id,
    stock: tray.stock,
    level: Math.round(tray.level / step) * step,
    capacity: tray.capacity,
    unit: roll ? "ft" : "sheets",
  } satisfies TraySnap);
}

export function observePanel(state: GameState, p: Printer): Snapshot<PanelSnap> {
  const job = p.currentJobId !== null ? state.jobs.find((j) => j.id === p.currentJobId) : undefined;
  return observe(state, KEYS.panel(p.id), {
    printerId: p.id,
    status: p.status,
    toner: fillBucket(p.toner / 100),
    job: job ? { id: job.id, printed: Math.floor(job.sheetsPrinted), total: job.sheets } : null,
    output: p.output.map((o) => ({ jobId: o.jobId, sheets: Math.floor(o.sheets) })),
  } satisfies PanelSnap);
}

export function observeCopier(state: GameState, copierId: number): Snapshot<CopierSnap> {
  const cp = state.copiers.find((c) => c.id === copierId)!;
  return observe(state, KEYS.copier(cp.id), { copierId: cp.id, status: cp.status, paper: fillBucket(cp.paper / cp.capacity) } satisfies CopierSnap);
}

export function glanceStock(state: GameState): Snapshot<StockGlanceSnap> {
  const items = {} as Record<StockItem, Rough>;
  for (const item of Object.keys(STOCK) as StockItem[]) items[item] = roughCount(item, state.stockroom[item]);
  return observe(state, KEYS.stockGlance, { items } satisfies StockGlanceSnap);
}

export function countStock(state: GameState, item: StockItem): Snapshot<StockCountSnap> {
  return observe(state, KEYS.stockItem(item), { item, count: state.stockroom[item] } satisfies StockCountSnap);
}

export function observeShelf(state: GameState): Snapshot<ShelfSnap> {
  const orders = state.jobs
    .filter((j) => j.status === "ready" && j.location === "shelf")
    .map((j) => ({ jobId: j.id, name: customerById(state, j.filedUnder ?? j.customerId)?.name ?? "?" }));
  return observe(state, KEYS.shelf, { orders } satisfies ShelfSnap);
}

export function observePackageRoom(state: GameState): Snapshot<PackageRoomSnap> {
  const staged = state.packages.filter((p) => p.status === "staged");
  return observe(state, KEYS.packageRoom, {
    staged: staged.length,
    stagedExpress: staged.filter((p) => p.service === "two_day" || p.service === "overnight").length,
    onHold: state.packages.filter((p) => p.status === "on_hold").map((p) => ({ packageId: p.id, name: customerById(state, p.customerId)?.name ?? "?" })),
    unsorted: state.packages.filter((p) => p.status === "unsorted").length,
  } satisfies PackageRoomSnap);
}

export function observeFinishing(state: GameState): Snapshot<FinishingSnap> {
  const jobs = state.jobs
    .filter((j) => j.location === "finishing")
    .map((j) => ({ jobId: j.id, name: customerById(state, j.customerId)?.name ?? "?", sheets: j.sheets }));
  return observe(state, KEYS.finishing, { jobs } satisfies FinishingSnap);
}
