// The stockroom shelves as a station view: what you last saw of each item, and taking, counting, or putting back.
import type { GameState, StockItem } from "../sim/types";
import { STOCK } from "../sim/config";
import { carryLabel } from "../sim/hands";
import { actionButton } from "./panel";
import { stockLine } from "./notes";

export function renderStockroomView(state: GameState): string {
  const h = state.employee.hands;
  const rows = (Object.keys(STOCK) as StockItem[])
    .map((item) => {
      const def = STOCK[item];
      return `<tr><td><b>${def.label}</b><br><span class="muted small">${def.packLabel}</span></td>
        <td class="small">${stockLine(state, item)}</td>
        <td><div class="btns">${actionButton(state, { type: "take_stock", item }, "Take", false, undefined, true)}${actionButton(state, { type: "count_stock", item }, "Count", false, undefined, true)}</div></td></tr>`;
    })
    .join("");
  return `<div class="station-head"><b>Stockroom</b><span class="muted small">you carry one thing at a time</span>
      <button class="btn" data-act="closeStation" style="padding:0 8px">×</button></div>
    <div class="btns" style="margin-bottom:8px">
      ${actionButton(state, { type: "glance_stock" }, "Look over the shelves")}
      ${h ? actionButton(state, { type: "put_back" }, `Put back ${carryLabel(state, h)}`) : ""}
    </div>
    <table class="mini"><thead><tr><th>Item</th><th>Last seen</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="muted small" style="margin-top:6px">A glance tells you roughly what's there; counting one item tells you exactly. Taking paper gets you a case (or whatever's left).</div>`;
}
