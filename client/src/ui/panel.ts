// DOM panels. Each section is rebuilt as an HTML string a few times a second and only written when it changed.
// Buttons carry their action in data-* attributes; main.ts handles them with one delegated listener.
import type { Copier, Customer, GameState, Job, PaperStock, Printer, TaskRequest } from "../sim/types";
import {
  averageRating,
  canStart,
  counterCustomer,
  customerById,
  estimateReadyAt,
  jobById,
  lineCustomers,
  money,
  previewTask,
  printerBacklog,
  printerById,
  printerSupports,
  quoteDue,
  selfServeBlockerFor,
  selfServeQueue,
  servingCustomerId,
  sheetsPerSecond,
} from "../sim/sim";
import { chooseAction } from "../sim/bot";
import {
  FINISHING_VERB,
  MEDIA_LABEL,
  describeQuantity,
  describeSpecs,
  finishSeconds,
  plural,
  fullServiceQuote,
  type FullServiceQuote,
  requestSentence,
  selfServePriceCents,
  selfServeSeconds,
  stockFor,
  takeOrderSeconds,
} from "../sim/orders";
import { formatClock, formatDuration } from "../sim/time";
import { STOCK_ITEMS, isLow, paperShortfall } from "../sim/inventory";
import { ringLeft, ringingCalls } from "../sim/phone";
import { printerStopped } from "../sim/upkeep";
import { SELF_SERVE, STOCK } from "../sim/config";
import {
  SERVICE_LABEL,
  packageById,
  purposeText,
  shipQuote,
  shipSentence,
  stagedPackages,
  unsortedPackages,
} from "../sim/shipping";
import type { ShiftReport } from "../sim/summary";
import type { LeaderboardRow } from "../api";

const $ = (id: string) => document.getElementById(id)!;

// Only touch the DOM when the markup actually changed, so buttons don't flicker under the mouse.
const lastHtml = new Map<string, string>();
function setHtml(id: string, html: string): void {
  if (lastHtml.get(id) === html) return;
  lastHtml.set(id, html);
  $(id).innerHTML = html;
}

export const ui = { ordersTab: "active" as "active" | "done" };

// The full true-state dashboard. Only shown in dev mode; normal play happens on the floor.
export function updatePanels(state: GameState, showTrueState: boolean): void {
  renderLog(state, showTrueState);
  if (!showTrueState) return;
  updateHeader(state);
  setHtml("you", renderYou(state));
  setHtml("counter", renderCounter(state));
  setHtml("shipping", renderShipping(state));
  setHtml("orders", renderOrders(state));
  setHtml("machines", renderMachines(state));
  setHtml("stockroom", renderStockroom(state));
}

// ---------- header ----------

function updateHeader(state: GameState): void {
  const left = state.closeAt - state.time;
  const s = state.stats;
  const lost = s.walkouts + s.balks + s.turnedAway + s.canceled + s.copierGaveUp;
  const t = state.truck;
  const phone = ringingCalls(state).some((c) => state.employee.task?.callId !== c.id); // not the one you're on
  const avg = averageRating(state);
  setHtml(
    "kpis",
    [
      kpi(money(state.revenueCents), "Sales"),
      kpi(String(s.ordersTaken + s.webOrders), "Orders"),
      kpi(String(s.pickups), "Picked up"),
      kpi(String(s.selfServed), "Self-serve"),
      kpi(String(s.shipments), "Shipped"),
      kpi(avg === null ? "–" : `${avg.toFixed(1)}★`, "Avg rating"),
      kpi(String(lost), "Lost customers"),
      kpi(left > 0 ? formatDuration(left) : "closed", "Until close"),
      kpi(t.status === "waiting" ? `until ${formatClock(t.leavesAt)}` : t.status, "Truck"),
      kpi(phone ? "ringing" : "quiet", "Phone"),
    ].join(""),
  );
}

function kpi(value: string, label: string): string {
  return `<div class="kpi"><b>${value}</b><span>${label}</span></div>`;
}

// ---------- you ----------

function renderYou(state: GameState): string {
  const task = state.employee.task;
  let body: string;
  if (task) {
    const walking = task.elapsed === 0 && !atStation(state);
    const frac = task.duration > 0 ? task.elapsed / task.duration : 1;
    const note = task.type === "finish_job" ? "You can stop anytime; progress is kept." : "";
    body = `
      <div class="task-label">${esc(task.label)}</div>
      <div class="muted small">${walking ? "Walking over..." : `${formatDuration(task.duration - task.elapsed)} left`}</div>
      <div class="bar"><div style="width:${(frac * 100).toFixed(1)}%"></div></div>
      <div class="btns" style="justify-content:space-between;align-items:center">
        <span class="muted small">${note}</span>
        <button class="btn" data-act="stop">Stop</button>
      </div>`;
  } else {
    const next = chooseAction(state);
    body = `
      <div class="task-label">Free</div>
      <div class="muted small">Pick something to do from the counter, orders or machines.</div>
      ${next ? `<div style="margin-top:10px" class="small"><span class="muted">Suggestion:</span> ${actionButton(state, next, previewTask(state, next).label)}</div>` : ""}`;
  }
  const phone = ringingCalls(state)
    .filter((c) => task?.callId !== c.id)
    .map(
      (c) => `<div class="alert-box" style="margin:0 0 10px"><span><b>Phone ringing</b> · voicemail in ${formatDuration(ringLeft(state, c))}</span>
        ${actionButton(state, { type: "answer_phone", callId: c.id }, "Answer", true)}</div>`,
    )
    .join("");
  return `<h2>You <span class="count">busy ${busyPct(state)}% of the shift</span></h2>${phone}${body}`;
}

function atStation(state: GameState): boolean {
  const t = state.employee.task!;
  return Math.abs(state.employee.pos.x - t.station.x) < 0.05 && Math.abs(state.employee.pos.y - t.station.y) < 0.05;
}

function busyPct(state: GameState): number {
  return state.time > 0 ? Math.round((state.employee.busySeconds / state.time) * 100) : 0;
}

// ---------- counter ----------

function renderCounter(state: GameState): string {
  const line = lineCustomers(state);
  const seated = state.customers.filter((c) => c.state === "seated").length;
  const atCopiers = state.customers.filter((c) => c.state === "self_serve").length;
  const head = `<h2>Counter <span class="count">${plural(line.length, "person", "people")} in line · ${seated} waiting · ${atCopiers} at self-serve</span></h2>`;
  const c = counterCustomer(state);

  let body: string;
  if (!c) {
    body = `<div class="empty">${line.length ? `${esc(line[0].name)} is walking up to the counter.` : "Nobody at the counter."}</div>`;
  } else if (c.purpose === "order") {
    body = renderOrderAtCounter(state, c);
  } else if (c.purpose === "pickup") {
    body = renderPickupAtCounter(state, c);
  } else {
    body = renderShippingAtCounter(state, c);
  }

  const rest = line.filter((x) => x !== c);
  const list = rest.length
    ? `<ol class="line-list">${rest
        .map(
          (x, i) =>
            `<li><span>${i + 2}. ${esc(x.name)} <span class="muted">${purposeText(x)}</span></span><span class="${waitClass(state, x)}">${waited(state, x)}</span></li>`,
        )
        .join("")}</ol>`
    : "";
  return head + body + list;
}

function renderOrderAtCounter(state: GameState, c: Customer): string {
  const spec = c.request!.spec;
  const serving = servingCustomerId(state) === c.id;
  const due = quoteDue(state, c, state.time + takeOrderSeconds(spec));
  const est = estimateReadyAt(state, spec, due.dueAt);
  const timing = c.request!.timing;

  let ask: string;
  let needed: string;
  if (due.tomorrow) {
    ask = timing.kind === "tomorrow" ? "No rush, tomorrow morning is fine." : "If it can't be today, first thing tomorrow is fine.";
    needed = "Tomorrow morning (paid in advance)";
  } else if (timing.kind === "wait") {
    ask = `I'll wait for it. ${timing.minutes} minutes or so?`;
    needed = `By ${formatClock(due.dueAt)}, waiting in the store`;
  } else {
    ask = `Could I pick it up around ${formatClock(due.dueAt)}?`;
    needed = `By ${formatClock(due.dueAt)}, coming back for it`;
  }

  const lateBy = est.at - (due.tomorrow ? state.closeAt : due.dueAt);
  const shortfall = paperShortfall(state, spec);
  const capable = state.printers.some((p) => printerSupports(p, { spec }));
  const estText = shortfall
    ? `<span class="bad">${esc(shortfall)}</span>`
    : est.at === Infinity
      ? `<span class="bad">${capable ? "Every printer that can do this is out of toner or ink, with no spare in the stockroom" : "No printer here can do this"}</span>`
      : due.tomorrow
        ? lateBy <= 0
          ? `<span class="ok">Can be done today</span>`
          : `<span class="warn">Would run past closing</span>`
        : lateBy <= 0
          ? `<span class="ok">≈ ${formatClock(est.at)}, on time</span>`
          : `<span class="bad">≈ ${formatClock(est.at)}, about ${formatDuration(lateBy)} late</span>`;

  return `
    <div><b>${esc(c.name)}</b> <span class="muted">· ${serving ? "you're helping them" : `waiting ${waited(state, c)}`}</span></div>
    <div class="quote">“${esc(requestSentence(spec))} ${esc(ask)}”</div>
    <dl class="spec">
      <dt>Order</dt><dd>${esc(describeQuantity(spec))}</dd>
      <dt>Specs</dt><dd>${esc(describeSpecs(spec))}</dd>
      <dt>Full service</dt><dd>${quoteText(fullServiceQuote(spec, !due.tomorrow))}</dd>
      <dt>Self-serve</dt><dd>${selfServeText(state, c)}</dd>
      <dt>Needed</dt><dd>${needed}</dd>
      <dt>Your estimate</dt><dd>${estText}</dd>
    </dl>
    <div class="btns">
      ${actionButton(state, { type: "take_order" }, "Take order", true)}
      ${actionButton(state, { type: "usher_self_serve" }, "Send to self-serve")}
      ${actionButton(state, { type: "turn_away" }, "Turn away")}
    </div>`;
}

// "$12.30 + $2.00 service fee = $14.30"
function quoteText(q: FullServiceQuote): string {
  const extras = [q.serviceFeeCents ? `${money(q.serviceFeeCents)} service fee` : "", q.rushCents ? `${money(q.rushCents)} same-day rush (10%)` : ""].filter(Boolean);
  return extras.length ? `${money(q.printCents)} + ${extras.join(" + ")} = <b>${money(q.totalCents)}</b>` : `<b>${money(q.totalCents)}</b>`;
}

function selfServeText(state: GameState, c: Customer): string {
  const blocker = selfServeBlockerFor(c);
  if (blocker) return `<span class="muted">Not possible: ${esc(blocker.charAt(0).toLowerCase() + blocker.slice(1))}</span>`;
  if (c.selfServeDeclined) return `<span class="muted">They want full service</span>`;
  const spec = c.request!.spec;
  const queue = selfServeQueue(state).length;
  const free = state.copiers.filter((cp) => cp.userId === null).length;
  const wait = free ? "a copier is free" : queue ? `${plural(queue, "person", "people")} already waiting for a copier` : "both copiers in use, nobody waiting";
  const saves = fullServiceQuote(spec, true).totalCents - selfServePriceCents(spec);
  return `<span class="ok">${money(selfServePriceCents(spec))}</span> (saves them ${money(saves)}), about ${formatDuration(selfServeSeconds(spec))} at the copier (${wait})`;
}

function renderPickupAtCounter(state: GameState, c: Customer): string {
  const job = jobById(state, c.jobId!)!;
  const serving = servingCustomerId(state) === c.id;
  const ready = job.status === "ready";
  return `
    <div><b>${esc(c.name)}</b> <span class="muted">· ${serving ? "you're helping them" : `waiting ${waited(state, c)}`}</span></div>
    <div class="quote">“Hi, I'm here to pick up an order.”</div>
    <dl class="spec">
      <dt>Order</dt><dd>#${job.id}: ${esc(describeQuantity(job.spec))}</dd>
      <dt>Status</dt><dd>${statusText(state, job)}</dd>
      <dt>Payment</dt><dd>${job.prepaid ? "Already paid" : `${money(job.priceCents)} due`}</dd>
    </dl>
    <div class="btns">
      ${
        ready
          ? actionButton(state, { type: "ring_up" }, job.prepaid ? "Hand over order" : `Ring up ${money(job.priceCents)}`, true)
          : actionButton(state, { type: "explain_delay" }, "Tell them it's not ready", true)
      }
    </div>`;
}

function renderShippingAtCounter(state: GameState, c: Customer): string {
  const serving = servingCustomerId(state) === c.id;
  const who = `<div><b>${esc(c.name)}</b> <span class="muted">· ${serving ? "you're helping them" : `waiting ${waited(state, c)}`}</span></div>`;

  if (c.purpose === "ship") {
    const r = c.ship!;
    const q = shipQuote(r);
    const t = state.truck;
    const express = r.service !== "ground";
    const truck =
      t.status === "gone"
        ? `<span class="${express ? "bad" : "warn"}">The truck already left; it goes out tomorrow${express ? ", and they'll be unhappy about it" : ""}</span>`
        : `<span class="ok">Goes on today's truck (${formatClock(t.arrivesAt)})</span>`;
    return `${who}
      <div class="quote">“${esc(shipSentence(r))}”</div>
      <dl class="spec">
        <dt>Package</dt><dd>${r.weightLb} lb · ${SERVICE_LABEL[r.service]} · ${r.packed ? "already packed" : `needs a ${r.box} box`}</dd>
        <dt>Price</dt><dd>${money(q.rateCents)} shipping${q.packingCents ? ` + ${money(q.packingCents)} packing` : ""} = <b>${money(q.totalCents)}</b></dd>
        <dt>Carrier cost</dt><dd>${money(q.carrierCents)} <span class="muted">(you keep ${money(q.totalCents - q.carrierCents - q.materialCents)})</span></dd>
        <dt>Truck</dt><dd>${truck}</dd>
      </dl>
      <div class="btns">
        ${actionButton(state, { type: "ship_package" }, "Ship package", true)}
        ${actionButton(state, { type: "turn_away" }, "Turn away")}
      </div>`;
  }

  if (c.purpose === "dropoff") {
    const n = c.dropoffCount;
    return `${who}
      <div class="quote">“Just dropping off ${n === 1 ? "a prepaid return" : `${n} prepaid returns`}. The labels are on already.”</div>
      <dl class="spec"><dt>Packages</dt><dd>${n}, prepaid (no charge)</dd></dl>
      <div class="btns">${actionButton(state, { type: "accept_dropoff" }, "Accept drop-off", true)}</div>`;
  }

  const pkg = packageById(state, c.packageId!)!;
  const unsorted = pkg.status === "unsorted";
  return `${who}
    <div class="quote">“I got a notice that you're holding a package for me.”</div>
    <dl class="spec">
      <dt>Package</dt><dd>P${pkg.id} · ${pkg.weightLb} lb</dd>
      <dt>Status</dt><dd>${unsorted ? `<span class="warn">Still in the unsorted morning delivery</span>` : `<span class="ok">On the hold shelf</span>`}</dd>
    </dl>
    <div class="btns">
      ${unsorted ? actionButton(state, { type: "check_in_packages" }, `Check in the delivery (${unsortedPackages(state).length})`, true) : ""}
      ${actionButton(state, { type: "release_package" }, "Release package", !unsorted)}
    </div>`;
}

// ---------- shipping ----------

function renderShipping(state: GameState): string {
  const t = state.truck;
  const staged = stagedPackages(state);
  const express = staged.filter((p) => p.service === "two_day" || p.service === "overnight").length;
  const shippedToday = state.packages.filter((p) => p.status === "shipped").length;
  const unsorted = unsortedPackages(state).length;
  const onHold = state.packages.filter((p) => p.status === "on_hold").length;

  let truck: string;
  if (t.status === "coming") {
    const until = t.arrivesAt - state.time;
    truck = `<div class="small">Carrier pickup at <b>${formatClock(t.arrivesAt)}</b> <span class="muted">(in ${formatDuration(until)})</span>. The driver waits ${formatDuration(t.leavesAt - t.arrivesAt)}.</div>`;
  } else if (t.status === "waiting") {
    truck = `<div class="alert-box"><span><b>The truck is here.</b> Leaves at ${formatClock(t.leavesAt)} (${formatDuration(t.leavesAt - state.time)})</span>
      ${actionButton(state, { type: "hand_off_truck" }, "Hand off", true)}</div>`;
  } else if (t.handedOff) {
    truck = `<div class="small ok">Truck picked up at ${formatClock(t.departedAt!)}.</div>`;
  } else {
    truck = `<div class="small ${state.stats.missedTruckPackages ? "bad" : "muted"}">The truck left at ${formatClock(t.departedAt!)}${state.stats.missedTruckPackages ? ` without ${plural(state.stats.missedTruckPackages, "package")}` : ""}.</div>`;
  }

  return `<h2>Shipping <span class="count">${plural(state.stats.shipments, "shipment")} today</span></h2>
    ${truck}
    <dl class="spec">
      <dt>Outbound bins</dt><dd>${plural(staged.length, "package")} staged${express ? ` <span class="warn">(${express} express)</span>` : ""}${shippedToday ? ` · ${shippedToday} shipped` : ""}</dd>
      <dt>Morning delivery</dt><dd>${unsorted ? `<span class="warn">${unsorted} unsorted</span>` : "all checked in"} · ${onHold} on the hold shelf</dd>
    </dl>
    <div class="btns">
      ${t.status === "waiting" ? "" : actionButton(state, { type: "hand_off_truck" }, "Hand off to driver")}
      ${actionButton(state, { type: "check_in_packages" }, `Check in delivery${unsorted ? ` (${unsorted})` : ""}`, unsorted > 0)}
    </div>`;
}

function waited(state: GameState, c: Customer): string {
  return c.waitStart === null ? "" : formatDuration(state.time - c.waitStart);
}

function waitClass(state: GameState, c: Customer): string {
  if (c.waitStart === null) return "muted";
  const w = state.time - c.waitStart;
  return w > c.linePatience * 0.75 ? "bad" : w > 180 ? "warn" : "muted";
}

// ---------- orders ----------

const ACTIVE: Job["status"][] = ["unsent", "queued", "printing", "printed", "bagged", "ready"];

function renderOrders(state: GameState): string {
  const active = state.jobs.filter((j) => ACTIVE.includes(j.status)).sort((a, b) => a.dueAt - b.dueAt || a.id - b.id);
  const done = state.jobs.filter((j) => !ACTIVE.includes(j.status)).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  const tab = ui.ordersTab;
  const rows = tab === "active" ? active : done;

  const head = `<h2>Orders <span class="tabs">
      <button data-act="tab" data-tab="active" class="${tab === "active" ? "on" : ""}">Open (${active.length})</button>
      <button data-act="tab" data-tab="done" class="${tab === "done" ? "on" : ""}">Closed (${done.length})</button>
    </span></h2>`;

  if (!rows.length) return head + `<div class="empty">${tab === "active" ? "No open orders." : "Nothing closed yet."}</div>`;

  return (
    head +
    `<div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Customer</th><th>Order</th><th>Due</th><th>Status</th><th>Next step</th></tr></thead>
      <tbody>${rows.map((j) => orderRow(state, j)).join("")}</tbody>
    </table></div>`
  );
}

function orderRow(state: GameState, j: Job): string {
  const c = customerById(state, j.customerId)!;
  return `<tr>
    <td><b>${j.id}</b></td>
    <td>${esc(c.name)}<br><span class="muted small">${customerWhere(state, c, j)}</span></td>
    <td>${j.channel === "web" ? `<span class="tag info">Online</span> ` : ""}${esc(describeQuantity(j.spec))}<br><span class="muted small">${esc(describeSpecs(j.spec))} · ${money(j.priceCents)}${feeNote(j)}${j.prepaid ? " paid" : ""}</span></td>
    <td>${dueCell(state, j)}</td>
    <td>${statusText(state, j)}</td>
    <td>${nextStep(state, j)}</td>
  </tr>`;
}

function feeNote(j: Job): string {
  if (j.rushCents) return ` incl. ${money(j.rushCents)} rush`;
  if (j.serviceFeeCents) return ` incl. ${money(j.serviceFeeCents)} fee`;
  return "";
}

function customerWhere(state: GameState, c: Customer, j: Job): string {
  if (j.status === "picked_up" || j.status === "canceled") return j.channel === "web" ? "online order" : "counter order";
  if (c.state === "seated") return `<span class="warn">waiting in store</span>`;
  if (c.state === "line") return `<span class="warn">in line for it</span>`;
  if (c.visitAt !== null) return `back around ${formatClock(c.visitAt)}`;
  return j.channel === "web" ? "online order" : "picking up later";
}

function dueCell(state: GameState, j: Job): string {
  if (j.dueTomorrow) return `Tomorrow<br><span class="muted small">finish today</span>`;
  const time = formatClock(j.dueAt);
  if (j.status === "picked_up" || j.status === "canceled") return time;
  const doneAt = j.readyAt ?? state.time;
  const diff = j.dueAt - doneAt;
  if (j.readyAt !== null) return `${time}<br><span class="small ${diff < 0 ? "bad" : "ok"}">${diff < 0 ? `ready ${formatDuration(-diff)} late` : "ready on time"}</span>`;
  return `${time}<br><span class="small ${diff < 0 ? "bad" : diff < 900 ? "warn" : "muted"}">${diff < 0 ? `${formatDuration(-diff)} late` : `in ${formatDuration(diff)}`}</span>`;
}

function statusText(state: GameState, j: Job): string {
  switch (j.status) {
    case "unsent":
      return `<span class="tag warn">Not sent to a printer</span>`;
    case "queued": {
      const p = printerById(state, j.printerId!)!;
      const pos = p.queue.indexOf(j.id) + 1;
      return `<span class="tag info">Queued on ${p.short}</span><br><span class="muted small">${pos === 1 ? "next up" : `${pos - 1} ahead of it`}</span>`;
    }
    case "printing": {
      const p = printerById(state, j.printerId!)!;
      const frac = j.sheetsPrinted / j.sheets;
      const blocked = printerStopped(p);
      const left = (j.sheets - j.sheetsPrinted) / sheetsPerSecond(p, j);
      const label = blocked
        ? `<span class="tag bad">Stopped: ${PRINTER_STATUS[p.status].toLowerCase()}</span>`
        : `<span class="tag info">${p.status === "warming_up" ? "Warming up" : "Printing"} on ${p.short}</span>`;
      return `${label}<div class="bar ${blocked ? "bad" : ""}"><div style="width:${(frac * 100).toFixed(1)}%"></div></div><span class="muted small">${Math.floor(j.sheetsPrinted)}/${j.sheets} sheets${blocked ? "" : ` · ${formatDuration(left)} left`}</span>`;
    }
    case "printed": {
      const verb = FINISHING_VERB[j.ticket.finishing].toLowerCase();
      const started = j.finishWorkDone > 0 ? ` (${Math.round((j.finishWorkDone / finishSeconds({ ...j.spec, finishing: j.ticket.finishing })) * 100)}% done)` : "";
      return `<span class="tag warn">Printed, needs: ${verb}</span><span class="muted small">${started}</span>`;
    }
    case "bagged":
      return `<span class="tag warn">Bagged, not on the shelf yet</span>`;
    case "ready":
      return `<span class="tag ok">On pickup shelf</span>`;
    case "picked_up":
      return `<span class="tag">Picked up ${formatClock(j.closedAt!)}</span>`;
    case "canceled":
      return `<span class="tag bad">Canceled ${formatClock(j.closedAt!)}</span>`;
  }
}

function nextStep(state: GameState, j: Job): string {
  const task = state.employee.task;
  if (task && task.jobId === j.id && (task.type === "send_job" || task.type === "finish_job")) return `<span class="muted small">You're on it</span>`;

  if (j.status === "unsent") {
    const options = state.printers.filter((p) => printerSupports(p, j));
    const best = options.slice().sort((a, b) => printerBacklog(state, a, j.dueAt) - printerBacklog(state, b, j.dueAt))[0];
    return `<div class="btns">${options
      .map((p) => {
        const wait = printerBacklog(state, p, j.dueAt);
        const title = wait > 0 ? `About ${formatDuration(wait)} of work ahead of it on this printer` : "Printer is free";
        return actionButton(state, { type: "send_job", jobId: j.id, printerId: p.id }, `Send to ${p.short}`, p === best, title);
      })
      .join("")}</div>`;
  }
  if (j.status === "printed") {
    const verb = FINISHING_VERB[j.ticket.finishing];
    return actionButton(state, { type: "finish_job", jobId: j.id }, j.finishWorkDone > 0 ? `Resume: ${verb.toLowerCase()}` : verb, true);
  }
  if (j.status === "ready") return `<span class="muted small">Waiting for customer</span>`;
  if (j.status === "queued" || j.status === "printing") {
    const p = printerById(state, j.printerId!)!;
    if (printerStopped(p) && p.status !== "jammed") {
      return actionButton(state, { type: "recall_job", jobId: j.id }, "Recall", true, "Pull it off this printer so you can send it to another one");
    }
  }
  return "";
}

// ---------- machines ----------

export const PRINTER_STATUS: Record<Printer["status"], string> = {
  idle: "Idle",
  warming_up: "Warming up",
  printing: "Printing",
  jammed: "Paper jam",
  out_of_paper: "Out of paper",
  out_of_toner: "Out of toner",
  output_full: "Output tray full",
  needs_service: "Needs service",
};

function renderMachines(state: GameState): string {
  const queue = selfServeQueue(state);
  return `<h2>Machines</h2><div class="grid">${state.printers.map((p) => machineCard(state, p)).join("")}</div>
    <h2 style="margin-top:14px">Self-serve <span class="count">${queue.length ? `${plural(queue.length, "person", "people")} waiting: ${queue.map((c) => esc(c.name)).join(", ")}` : "nobody waiting"}</span></h2>
    <div class="grid">${state.copiers.map((cp) => copierCard(state, cp)).join("")}</div>`;
}

function copierCard(state: GameState, cp: Copier): string {
  const user = cp.userId !== null ? customerById(state, cp.userId)! : null;
  const stopped = cp.status !== "ok";
  let body = `<div class="muted small">Free.</div>`;
  if (user && !cp.work) body = `<div class="small">${esc(user.name)} is walking over.</div>`;
  if (user && cp.work) {
    const spec = user.request!.spec;
    const total = selfServeSeconds(spec);
    const ppm = SELF_SERVE.ppm[spec.color] * (spec.media === "tabloid" ? 0.5 : 1);
    const left = Math.max(0, cp.work.setupLeft) + (cp.work.sidesLeft / ppm) * 60;
    const waiting = stopped && cp.stoppedSince !== null ? `<div class="small bad">${esc(user.name)} has been waiting ${formatDuration(state.time - cp.stoppedSince)} for help</div>` : "";
    body = `<div class="small">${esc(user.name)}: ${esc(describeQuantity(spec))}</div>
      <div class="bar ${stopped ? "bad" : ""}"><div style="width:${(((total - left) / total) * 100).toFixed(1)}%"></div></div>
      <div class="muted small">${stopped ? "stopped" : cp.work.setupLeft > 0 ? "setting up" : `${formatDuration(left)} left`}</div>${waiting}`;
  }
  let alert = "";
  if (cp.status === "jammed") alert = `<div class="alert-box"><span>Paper jam</span>${actionButton(state, { type: "fix_copier", copierId: cp.id }, "Clear jam", true)}</div>`;
  if (cp.status === "out_of_paper") alert = `<div class="alert-box"><span>Out of paper</span>${actionButton(state, { type: "refill_copier", copierId: cp.id }, "Refill", true)}</div>`;
  const frac = cp.paper / cp.capacity;
  const tag = stopped ? `<span class="tag bad">${cp.status === "jammed" ? "Jammed" : "Out of paper"}</span>` : `<span class="tag ${user ? "info" : ""}">${user ? "In use" : "Free"}</span>`;
  return `<div class="machine ${stopped ? "alert" : ""}">
    <div class="mhead"><b>Self-serve copier ${cp.id}</b>${tag}</div>
    ${alert}
    ${body}
    <div class="supply"><span>Letter</span>
      <div class="bar ${frac < 0.15 ? "bad" : frac < 0.3 ? "warn" : "ok"}"><div style="width:${(frac * 100).toFixed(1)}%"></div></div>
      ${actionButton(state, { type: "refill_copier", copierId: cp.id }, "Refill", false, undefined, true)}
      <span></span><span class="lvl">${Math.floor(cp.paper).toLocaleString("en-US")} / ${cp.capacity.toLocaleString("en-US")} sheets</span><span></span></div>
    <div class="muted small" style="margin-top:8px">Today: ${Math.round(cp.sheetsToday).toLocaleString("en-US")} sheets · ${plural(cp.jamsToday, "jam")}</div>
  </div>`;
}

function machineCard(state: GameState, p: Printer): string {
  const blocked = printerStopped(p);
  const job = p.currentJobId !== null ? jobById(state, p.currentJobId)! : null;
  const pillClass = blocked ? "bad" : p.status === "idle" ? "" : "info";
  const ink = p.wideSecondsPerSqFt ? "Ink" : "Toner";

  let current = `<div class="muted small">Nothing printing.</div>`;
  if (job) {
    const left = (job.sheets - job.sheetsPrinted) / sheetsPerSecond(p, job);
    current = `<div class="small">Order #${job.id} · ${Math.floor(job.sheetsPrinted)}/${job.sheets} sheets${blocked ? "" : ` · ${formatDuration(left + (p.status === "warming_up" ? p.warmupLeft : 0))} left`}</div>
      <div class="bar ${blocked ? "bad" : ""}"><div style="width:${((job.sheetsPrinted / job.sheets) * 100).toFixed(1)}%"></div></div>`;
  }

  let alert = "";
  if (p.status === "jammed") {
    alert = `<div class="alert-box"><span>Paper jam</span>${actionButton(state, { type: "clear_jam", printerId: p.id }, "Clear jam", true)}</div>`;
  } else if (p.status === "out_of_paper" && job) {
    const stock = stockOf(job);
    alert = `<div class="alert-box"><span>Out of ${stockName(stock)}</span>${actionButton(state, { type: "load_paper", printerId: p.id, stock }, "Load", true)}</div>`;
  } else if (p.status === "out_of_toner") {
    alert = `<div class="alert-box"><span>Out of ${ink.toLowerCase()}</span>${actionButton(state, { type: "replace_toner", printerId: p.id }, "Replace", true)}</div>`;
  } else if (p.status === "needs_service" && p.breakdown) {
    const b = p.breakdown;
    const when = b.phase === "tech" ? `Technician working on it, done about ${formatClock(b.fixedAt)}` : `Technician due about ${formatClock(b.techArrivesAt)}`;
    alert = `<div class="alert-box"><span><b>Out of service.</b> ${when}. Recall its jobs to send them elsewhere.</span></div>`;
  }

  const queue = p.queue.length
    ? `<div class="muted small">Queue: ${p.queue.map((id) => `#${id}`).join(", ")} (${formatDuration(printerBacklog(state, p) - (job ? (job.sheets - job.sheetsPrinted) / sheetsPerSecond(p, job) : 0))} of printing)</div>`
    : "";

  const trays = p.trays
    .map((t) => {
      const frac = t.level / t.capacity;
      const unit = t.stock === "roll" ? "ft" : "";
      return `<div class="supply"><span>${stockName(t.stock, true)}</span>
        <div class="bar ${frac < 0.15 ? "bad" : frac < 0.3 ? "warn" : "ok"}"><div style="width:${(frac * 100).toFixed(1)}%"></div></div>
        ${actionButton(state, { type: "load_paper", printerId: p.id, stock: t.stock }, "Load", false, undefined, true)}
        <span></span><span class="lvl">${Math.floor(t.level).toLocaleString("en-US")} / ${t.capacity.toLocaleString("en-US")}${unit ? " " + unit : " sheets"}</span><span></span></div>`;
    })
    .join("");
  const tonerFrac = p.toner / 100;
  const toner = `<div class="supply"><span>${ink}</span>
      <div class="bar ${tonerFrac < 0.1 ? "bad" : tonerFrac < 0.25 ? "warn" : "ok"}"><div style="width:${p.toner.toFixed(1)}%"></div></div>
      ${actionButton(state, { type: "replace_toner", printerId: p.id }, "Replace", false, undefined, true)}
      <span></span><span class="lvl">${Math.round(p.toner)}%</span><span></span></div>`;

  return `<div class="machine ${blocked ? "alert" : ""}">
    <div class="mhead"><b>${esc(p.name)}</b><span class="tag ${pillClass}">${PRINTER_STATUS[p.status]}</span></div>
    <div class="muted small">${p.colors.includes("color") ? "Color and B&W" : "B&W only"} · ${p.media.map((m) => MEDIA_LABEL[m].split(" (")[0]).join(", ")}</div>
    ${alert}
    <div style="margin-top:8px">${current}</div>
    ${queue}
    ${trays}${toner}
    <div class="muted small" style="margin-top:8px">Today: ${Math.round(p.sheetsToday).toLocaleString("en-US")} sheets · ${plural(p.jamsToday, "jam")}</div>
  </div>`;
}

function stockOf(job: Job): PaperStock {
  return stockFor(job.spec.media);
}

function stockName(stock: string, short = false): string {
  const names: Record<string, [string, string]> = {
    letter: ["Letter", "letter paper"],
    legal: ["Legal", "legal paper"],
    tabloid: ["Tabloid", "tabloid paper"],
    cardstock: ["Cardstock", "cardstock"],
    roll: ["Roll", "roll paper"],
  };
  return names[stock][short ? 0 : 1];
}

// ---------- stockroom ----------

function renderStockroom(state: GameState): string {
  const rows = STOCK_ITEMS.map((item) => {
    const def = STOCK[item];
    const n = state.stockroom[item];
    const tag = n === 0 ? `<span class="tag bad">Out</span>` : isLow(state, item) ? `<span class="tag warn">Low</span>` : "";
    return `<tr><td>${def.label}</td><td style="text-align:right">${n.toLocaleString("en-US")} <span class="muted small">${def.unit}</span></td><td>${tag}</td></tr>`;
  }).join("");
  const low = STOCK_ITEMS.filter((i) => state.stockroom[i] === 0 || isLow(state, i)).length;
  return `<h2>Stockroom <span class="count">${low ? `${low} item${low === 1 ? "" : "s"} low or out` : "all stocked"}</span></h2>
    <div class="muted small" style="margin-bottom:6px">Loading paper, swapping toner and boxing shipments take from here, including the walk back here to get it. No deliveries until tomorrow.</div>
    <div class="table-wrap"><table><tbody>${rows}</tbody></table></div>`;
}

// ---------- log ----------

let lastLogKey = "";
// Your own actions only. In dev mode (true state), everything that happened in the store.
function renderLog(state: GameState, everything: boolean): void {
  const entries = everything ? state.log : state.log.filter((e) => e.you);
  const last = entries[entries.length - 1];
  const key = `${everything}:${entries.length}:${last?.time}:${last?.text}`;
  if (key === lastLogKey) return;
  lastLogKey = key;
  const box = $("log");
  const list = box.querySelector("ol");
  const atBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 30;
  box.innerHTML = `<h2>${everything ? "Everything that happened (dev)" : "What you've done"}</h2><ol>${entries
    .slice(-120)
    .map((e) => `<li><time>${formatClock(e.time)}</time><span${!e.you ? ' class="muted"' : ""}>${esc(e.text)}</span></li>`)
    .join("")}</ol>`;
  const ol = box.querySelector("ol")!;
  if (atBottom) ol.scrollTop = ol.scrollHeight;
}

// ---------- buttons ----------

// A task button. If you can't do it right now it still renders (greyed out) with the reason as its tooltip.
// htmlLabel: the label is trusted markup (e.g. a badge), not text to escape.
export function actionButton(state: GameState, req: TaskRequest, text: string, primary = false, title?: string, compact = false, htmlLabel = false): string {
  const reason = canStart(state, req);
  const dur = reason ? null : previewTask(state, req).duration;
  const durText = dur !== null && !compact ? ` <span class="dur">· ${formatDuration(dur)}</span>` : "";
  const tip = reason ?? title ?? (dur !== null ? `Takes about ${formatDuration(dur)}` : "");
  const attrs = [
    `data-act="task"`,
    `data-type="${req.type}"`,
    req.jobId !== undefined ? `data-job="${req.jobId}"` : "",
    req.printerId ? `data-printer="${req.printerId}"` : "",
    req.stock ? `data-stock="${req.stock}"` : "",
    req.callId !== undefined ? `data-call="${req.callId}"` : "",
    req.copierId !== undefined ? `data-copier="${req.copierId}"` : "",
    req.app ? `data-app="${req.app}"` : "",
    req.messageId !== undefined ? `data-message="${req.messageId}"` : "",
    req.voicemailId !== undefined ? `data-voicemail="${req.voicemailId}"` : "",
    req.dir ? `data-dir="${req.dir}"` : "",
    req.item ? `data-item="${req.item}"` : "",
    req.index !== undefined ? `data-index="${req.index}"` : "",
    req.filedUnder !== undefined ? `data-filed="${req.filedUnder}"` : "",
    tip ? `title="${esc(tip)}"` : "",
    reason ? `aria-disabled="true"` : "",
  ].join(" ");
  return `<button class="btn ${primary && !reason ? "primary" : ""} ${reason ? "off" : ""}" ${attrs}>${htmlLabel ? text : esc(text)}${durText}</button>`;
}

// ---------- end screen ----------

export function showEndScreen(r: ShiftReport): void {
  $("end").classList.add("show");
  const row = (label: string, value: string) => `<tr><td>${label}</td><td>${value}</td></tr>`;
  $("summary").innerHTML = `<table class="report">
    ${row("Sales", money(r.revenueCents))}
    ${row("Materials used", money(r.costCents))}
    ${row("<b>Gross profit</b>", `<b>${money(r.profitCents)}</b>`)}
    ${row("Orders taken at the counter", String(r.ordersTaken))}
    ${row("Online orders", String(r.webOrders))}
    ${row("Service / rush fees charged", `${money(r.serviceFeesCents)} / ${money(r.rushFeesCents)}`)}
    ${row("Orders picked up", String(r.pickups))}
    ${row("Self-serve customers", `${r.selfServed} (${money(r.selfServeRevenueCents)})`)}
    ${row("Packages shipped", `${r.shipments} (${money(r.shippingRevenueCents)})`)}
    ${row("Drop-off packages", String(r.dropoffPackages))}
    ${row("Held packages picked up", String(r.packagePickups))}
    ${row("Packages that missed the truck", String(r.missedTruckPackages))}
    ${row("Refunds", money(r.refundsCents))}
    ${row("Calls answered / missed", `${r.callsAnswered} / ${r.missedCalls}`)}
    ${row("Web orders from quote calls", String(r.quoteLeads))}
    ${row("Copier jams / customers who gave up", `${r.copierJams} / ${r.copierGaveUp}`)}
    ${row("Printer breakdowns / jobs recalled", `${r.breakdowns} / ${r.recalls}`)}
    ${row("Sheets ruined in jams", String(r.wastedSheets))}
    ${row("Ready on time", r.onTimePct === null ? "–" : `${r.onTimePct}%`)}
    ${row("Average wait in line", r.avgLineWaitMin === null ? "–" : `${r.avgLineWaitMin.toFixed(1)} min`)}
    ${row("Average customer rating", r.avgRating === null ? "–" : `${r.avgRating.toFixed(1)} / 5`)}
    ${row("Walked out of line / didn't come in", `${r.walkouts} / ${r.balks}`)}
    ${row("Turned away / canceled", `${r.turnedAway} / ${r.canceled}`)}
    ${row("Orders still in production", String(r.leftForTomorrow))}
    ${row("Sheets printed", r.sheets.toLocaleString("en-US"))}
    ${row("Paper jams", String(r.jams))}
    ${row("Time you were busy", `${r.busyPct}%`)}
    ${row("Times you checked on something", String(r.checks))}
    ${row("<b>Score</b>", `<b>${r.score.toLocaleString("en-US")}</b>`)}
  </table>
  <h2>Mistakes${r.mistakes.length ? ` (${r.mistakes.length})` : ""}</h2>
  ${
    r.mistakes.length
      ? `<ul class="small">${r.mistakes.map((m) => `<li><span class="muted">${formatClock(m.time)}</span> ${esc(m.text)}</li>`).join("")}</ul>`
      : `<p class="small muted">None. Nice work.</p>`
  }
  <p class="muted small">Score is gross profit times customer satisfaction squared, so unhappy customers cost you a lot.</p>`;
}

export function showLeaderboard(rows: LeaderboardRow[] | null): void {
  $("leaderboard").innerHTML =
    rows === null
      ? "Server offline. Start the backend to see the leaderboard."
      : rows.length === 0
        ? "No scores yet."
        : `<ol>${rows.map((r) => `<li>${esc(r.playerName)}: ${r.score.toLocaleString("en-US")} (${money(r.cashCents)} sales)</li>`).join("")}</ol>`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
