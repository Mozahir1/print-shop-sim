// Turning snapshots into plain words, and the notepad: what you've seen, your order tickets, and your own notes.
// Opening the notepad is free; it only shows what you already know.
import type { GameState, StockItem } from "../sim/types";
import { STOCK } from "../sim/config";
import {
  KEYS,
  snapshot,
  type CopierSnap,
  type FinishingSnap,
  type PackageRoomSnap,
  type PanelSnap,
  type ShelfSnap,
  type Snapshot,
  type StockCountSnap,
  type StockGlanceSnap,
  type TraySnap,
} from "../sim/knowledge";
import { customerById } from "../sim/sim";
import { describeQuantity, describeSpecs } from "../sim/orders";
import { formatClock, formatDuration } from "../sim/time";
import { esc } from "./panel";

export const notepad = { open: false, notes: "", done: new Set<number>() };

// "just now" / "12 min ago"
export function ago(state: GameState, snap: Snapshot): string {
  const s = state.time - snap.at;
  return s < 60 ? "just now" : `${formatDuration(s)} ago`;
}

const stamp = (state: GameState, snap: Snapshot) => `<span class="muted small">(${formatClock(snap.at)}, ${ago(state, snap)})</span>`;

export function trayLine(state: GameState, printerId: string, stock: string): string {
  const snap = snapshot<TraySnap>(state, KEYS.tray(printerId, stock));
  if (!snap) return `${stockName(stock)}: <span class="muted">not checked</span>`;
  const d = snap.data;
  return `${stockName(stock)}: about ${d.level.toLocaleString("en-US")} / ${d.capacity.toLocaleString("en-US")} ${d.unit} ${stamp(state, snap)}`;
}

export function panelLine(state: GameState, printerId: string): string {
  const snap = snapshot<PanelSnap>(state, KEYS.panel(printerId));
  if (!snap) return `<span class="muted">Panel not checked.</span>`;
  const d = snap.data;
  const job = d.job ? `printing #${d.job.id} (${d.job.printed}/${d.job.total})` : statusWords(d.status);
  const out = d.output.length ? `; output tray: ${d.output.map((o) => `#${o.jobId} (${o.sheets})`).join(", ")}` : "; output tray empty";
  return `${job}, toner ${d.toner}${out} ${stamp(state, snap)}`;
}

export function copierLine(state: GameState, copierId: number): string {
  const snap = snapshot<CopierSnap>(state, KEYS.copier(copierId));
  if (!snap) return `<span class="muted">Not checked.</span>`;
  return `${snap.data.status === "ok" ? "Working" : snap.data.status === "jammed" ? "Jammed" : "Out of paper"}, paper ${snap.data.paper} ${stamp(state, snap)}`;
}

export function stockLine(state: GameState, item: StockItem): string {
  const count = snapshot<StockCountSnap>(state, KEYS.stockItem(item));
  const glance = snapshot<StockGlanceSnap>(state, KEYS.stockGlance);
  // Whichever you saw more recently.
  if (count && (!glance || count.at >= glance.at)) return `${count.data.count.toLocaleString("en-US")} ${STOCK[item].unit} ${stamp(state, count)}`;
  if (glance) return `${glance.data.items[item]} ${stamp(state, glance)}`;
  return `<span class="muted">not checked</span>`;
}

export function shelfLines(state: GameState): string {
  const snap = snapshot<ShelfSnap>(state, KEYS.shelf);
  if (!snap) return `<span class="muted">Not checked.</span>`;
  const list = snap.data.orders.length ? snap.data.orders.map((o) => `#${o.jobId} under ${esc(o.name)}`).join(", ") : "empty";
  return `${list} ${stamp(state, snap)}`;
}

export function finishingLines(state: GameState): string {
  const snap = snapshot<FinishingSnap>(state, KEYS.finishing);
  if (!snap) return `<span class="muted">Not checked.</span>`;
  const list = snap.data.jobs.length ? snap.data.jobs.map((j) => `#${j.jobId} (${esc(j.name)})`).join(", ") : "nothing waiting";
  return `${list} ${stamp(state, snap)}`;
}

export function packageRoomLines(state: GameState): string {
  const snap = snapshot<PackageRoomSnap>(state, KEYS.packageRoom);
  if (!snap) return `<span class="muted">Not checked.</span>`;
  const d = snap.data;
  return `${d.staged} staged to go out${d.stagedExpress ? ` (${d.stagedExpress} express)` : ""}, ${d.onHold.length} on hold, ${d.unsorted} unsorted ${stamp(state, snap)}`;
}

function statusWords(status: string): string {
  return status.replace(/_/g, " ");
}

function stockName(stock: string): string {
  return stock === "roll" ? "Roll" : stock.charAt(0).toUpperCase() + stock.slice(1);
}

// ---------- the notepad ----------

export function renderNotepad(state: GameState): string {
  const seen: string[] = [];
  for (const p of state.printers) {
    const trays = p.trays.filter((t) => snapshot(state, KEYS.tray(p.id, t.stock))).map((t) => trayLine(state, p.id, t.stock));
    const panel = snapshot(state, KEYS.panel(p.id)) ? panelLine(state, p.id) : "";
    if (trays.length || panel) seen.push(`<b>${esc(p.name)}</b>: ${[panel, ...trays].filter(Boolean).join("<br>")}`);
  }
  for (const cp of state.copiers) if (snapshot(state, KEYS.copier(cp.id))) seen.push(`<b>Self-serve copier ${cp.id}</b>: ${copierLine(state, cp.id)}`);
  const stockSeen = (Object.keys(STOCK) as StockItem[]).filter((i) => snapshot(state, KEYS.stockItem(i)) || snapshot(state, KEYS.stockGlance));
  if (stockSeen.length) seen.push(`<b>Stockroom</b>: ${stockSeen.map((i) => `${STOCK[i].label}: ${stockLine(state, i)}`).join("<br>")}`);
  if (snapshot(state, KEYS.shelf)) seen.push(`<b>Pickup shelf</b>: ${shelfLines(state)}`);
  if (snapshot(state, KEYS.finishing)) seen.push(`<b>Finishing table</b>: ${finishingLines(state)}`);
  if (snapshot(state, KEYS.packageRoom)) seen.push(`<b>Package room</b>: ${packageRoomLines(state)}`);

  // A ticket for every order taken at the counter or opened from the inbox, with the specs as entered.
  const tickets = state.jobs
    .filter((j) => j.channel === "counter" || j.opened)
    .map((j) => {
      const name = customerById(state, j.customerId)?.name ?? "?";
      const done = notepad.done.has(j.id);
      return `<label class="ticket ${done ? "done" : ""}"><input type="checkbox" data-act="ticketDone" data-job="${j.id}" ${done ? "checked" : ""} />
        <span><b>#${j.id}</b> ${esc(name)}${j.channel === "web" ? ` <span class="tag info">Online</span>` : ""} · due ${j.dueTomorrow ? "tomorrow" : formatClock(j.dueAt)}<br>
        <span class="small">${esc(describeQuantity(j.ticket))} · ${esc(describeSpecs(j.ticket))}</span></span></label>`;
    });

  return `<div class="station-head"><b>Notepad</b><span class="muted small">free to look at; it only knows what you've seen</span>
      <button class="btn" data-act="closeNotepad" style="padding:0 8px">×</button></div>
    <div class="app-section"><h4>Order tickets</h4>${tickets.length ? tickets.join("") : `<div class="muted small">No orders yet.</div>`}</div>
    <div class="app-section"><h4>What you've seen</h4>${seen.length ? seen.map((x) => `<div class="menu-row small">${x}</div>`).join("") : `<div class="muted small">Nothing checked yet. Look at things on the floor to fill this in.</div>`}</div>
    <div class="app-section"><h4>Notes</h4><textarea id="notepadText" rows="5" style="width:100%" placeholder="Anything you want to remember">${esc(notepad.notes)}</textarea></div>`;
}
