// The computer at the register, as a station view. App views come from snapshots (what the screen showed when you
// opened or refreshed it); forms are what you type. Every button on it is a task.
import type { AppId, ColorMode, Finishing, GameState, JobSpec, Media, ShipService } from "../sim/types";
import { APP_LABEL, appView, unreadCount, type InboxView, type PosView, type PrintServerView, type ShippingView, type VoicemailView } from "../sim/computer";
import { counterCustomer, customerById, jobById, money, quoteDue } from "../sim/sim";
import { FINISHING_LABEL, MEDIA_LABEL, describeQuantity, describeSpecs, requestSentence } from "../sim/orders";
import { REGISTER } from "../sim/layout";
import { sentence } from "../sim/util";
import { formatClock, formatDuration } from "../sim/time";
import { SERVICE_LABEL, shipQuote, boxFor } from "../sim/shipping";
import { actionButton, esc } from "./panel";

const APPS: AppId[] = ["pos", "inbox", "printserver", "shipping", "voicemail"];

export const computerUi = { open: false, rate: "" };

export function atRegister(state: GameState): boolean {
  return Math.abs(state.employee.pos.x - REGISTER.x) < 0.05 && Math.abs(state.employee.pos.y - REGISTER.y) < 0.05;
}

export function renderComputer(state: GameState): string {
  const c = state.computer;
  const newVm = c.voicemails.filter((v) => !v.heard).length;
  const unread = unreadCount(state);
  const icons = APPS.map((app) => {
    const badge = app === "inbox" && unread ? ` <span class="badge">${unread}</span>` : app === "voicemail" && newVm ? ` <span class="badge">${newVm}</span>` : "";
    return actionButton(state, { type: "open_app", app }, APP_LABEL[app] + badge, c.app === app, undefined, true, true);
  }).join("");

  const here = atRegister(state);
  const head = `<div class="station-head"><b>Computer</b><span class="muted small">${here ? "at the register" : "you're not at the register; using it walks you over"}</span>
    <button class="btn" data-act="closeComputer" style="padding:0 8px">×</button></div>
    <div class="desktop">${icons}</div>`;
  if (!c.app) return head + `<div class="muted small" style="padding:12px 0">Pick an app. Opening one takes a few seconds.</div>`;
  return head + appHeader(state, c.app) + appBody(state, c.app);
}

function appHeader(state: GameState, app: AppId): string {
  const snap = appView(state, app);
  const asOf = snap ? `as of ${formatClock(snap.at)}${state.time - snap.at >= 60 ? ` (${formatDuration(state.time - snap.at)} ago)` : ""}` : "not loaded yet";
  return `<div class="app-head"><b>${APP_LABEL[app]}</b><span class="muted small">${asOf}</span>${actionButton(state, { type: "refresh_app" }, "Refresh", false, undefined, true)}</div>`;
}

function appBody(state: GameState, app: AppId): string {
  switch (app) {
    case "pos":
      return posBody(state);
    case "inbox":
      return inboxBody(state);
    case "printserver":
      return printServerBody(state);
    case "shipping":
      return shippingBody(state);
    case "voicemail":
      return voicemailBody(state);
  }
}

// ---------- POS ----------

function posBody(state: GameState): string {
  const c = counterCustomer(state);
  let counter = `<div class="muted small">Nobody at the counter.</div>`;
  if (c && c.purpose === "order") {
    const spec = c.request!.spec;
    const due = quoteDue(state, c);
    const t = c.request!.timing;
    const when = due.tomorrow ? "Tomorrow is fine." : t.kind === "wait" ? `I'll wait, ${t.minutes} minutes or so?` : `Around ${formatClock(due.dueAt)}?`;
    counter = `<div class="quote">${esc(c.name)}: “${esc(requestSentence(spec))} ${esc(when)}”</div>
      <div class="form-title">New order for ${esc(c.name)}</div>
      ${specForm("pos")}
      <div class="btns" style="margin-top:8px"><button class="btn primary" data-act="enterOrder">Enter order</button></div>`;
  } else if (c && c.purpose === "pickup") {
    const job = jobById(state, c.jobId!)!;
    counter = `<div class="quote">${esc(c.name)}: “${esc(sentence(`I'm here to pick up an order for ${c.name}`))}”</div>
      <div class="btns">${actionButton(state, { type: "ring_up" }, job.prepaid ? `Hand over #${job.id} (paid online)` : `Ring up #${job.id}: ${money(job.priceCents)}`, true)}</div>`;
  } else if (c) {
    counter = `<div class="muted small">${esc(c.name)} is at the counter, but not for a print order.</div>`;
  }

  const view = appView<PosView>(state, "pos");
  const rows = view
    ? view.data.orders.length
      ? `<table class="mini"><thead><tr><th>#</th><th>Name</th><th>Status</th><th>Due</th><th>Total</th></tr></thead><tbody>${view.data.orders
          .map((o) => `<tr><td>${o.jobId}${o.channel === "web" ? " <span class=\"tag info\">Online</span>" : ""}</td><td>${esc(o.name)}</td><td>${o.status}</td><td>${o.due}</td><td>${money(o.totalCents)}${o.prepaid ? " paid" : ""}</td></tr>`)
          .join("")}</tbody></table>`
      : `<div class="muted small">No orders yet.</div>`
    : `<div class="muted small">Refresh to see the order list.</div>`;
  return `<div class="app-section"><h4>At the counter</h4>${counter}</div><div class="app-section"><h4>Orders</h4>${rows}
    <div class="muted small">The POS knows what was ordered, sent and paid. Whether it's printed or on the shelf, you have to go look.</div></div>`;
}

// ---------- inbox ----------

function inboxBody(state: GameState): string {
  const view = appView<InboxView>(state, "inbox");
  if (!view) return `<div class="muted small">Refresh to load your messages.</div>`;
  if (!view.data.messages.length) return `<div class="muted small">No messages.</div>`;
  return view.data.messages
    .slice()
    .reverse()
    .map((m) => {
      const live = state.computer.messages.find((x) => x.id === m.id)!;
      const head = `<div><b>${m.read ? "" : "● "}${esc(m.subject)}</b> <span class="muted small">${formatClock(m.at)}</span></div>`;
      if (!live.read) return `<div class="menu-row">${head}${actionButton(state, { type: "open_message", messageId: m.id }, "Open")}</div>`;
      const reply = live.kind === "email" ? (live.replied ? `<span class="muted small">Replied</span>` : actionButton(state, { type: "reply_email", messageId: m.id }, "Reply")) : "";
      return `<div class="menu-row">${head}<div class="small">${esc(live.body)}</div>${reply}</div>`;
    })
    .join("");
}

// ---------- print server ----------

function printServerBody(state: GameState): string {
  const view = appView<PrintServerView>(state, "printserver");
  const printers = view
    ? view.data.printers
        .map((p) => {
          const queue = p.queue.length
            ? p.queue
                .map(
                  (q) => `<div class="queue-row">#${q.jobId} ${esc(q.name)}
                    ${actionButton(state, { type: "move_job", jobId: q.jobId, dir: "up" }, "↑", false, "Move up", true)}
                    ${actionButton(state, { type: "move_job", jobId: q.jobId, dir: "down" }, "↓", false, "Move down", true)}
                    ${actionButton(state, { type: "cancel_job", jobId: q.jobId }, "Cancel", false, undefined, true)}</div>`,
                )
                .join("")
            : `<span class="muted small">queue empty</span>`;
          const error = p.code.startsWith("Error");
          const current = p.current
            ? `<div class="small">Now: #${p.current.jobId} ${esc(p.current.name)} ${error ? actionButton(state, { type: "recall_job", jobId: p.current.jobId }, "Recall", false, "Pull it off so you can send it elsewhere", true) : ""}</div>`
            : "";
          return `<div class="menu-row"><div><b>${esc(p.name)}</b> <span class="tag ${error ? "bad" : p.code === "Ready" ? "" : "info"}">${esc(p.code)}</span></div>${current}${queue}</div>`;
        })
        .join("")
    : `<div class="muted small">Refresh to see the printers.</div>`;

  // Orders the system has that haven't been sent anywhere. You set every option yourself.
  const ready = state.jobs.filter((j) => j.status === "unsent" && j.opened);
  const send = ready.length
    ? ready
        .map((j) => {
          const name = customerById(state, j.customerId)?.name ?? "?";
          const options = state.printers.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
          return `<div class="menu-row"><div><b>#${j.id}</b> ${esc(name)} · due ${j.dueTomorrow ? "tomorrow" : formatClock(j.dueAt)}</div>
            <div class="small muted">Ticket: ${esc(describeQuantity(j.ticket))} · ${esc(describeSpecs(j.ticket))}${j.sheetsPrinted > 0 ? ` · ${Math.floor(j.sheetsPrinted)} sheets already printed` : ""}</div>
            ${specForm(`ps-${j.id}`)}
            <div class="btns" style="margin-top:6px"><select id="ps-${j.id}-printer">${options}</select><button class="btn primary" data-act="sendJob" data-job="${j.id}">Send</button></div></div>`;
        })
        .join("")
    : `<div class="muted small">Nothing waiting to be sent. Online orders show up here once you've opened them.</div>`;
  return `<div class="app-section"><h4>Printers</h4>${printers}</div><div class="app-section"><h4>Ready to send</h4>${send}</div>`;
}

// ---------- shipping ----------

function shippingBody(state: GameState): string {
  const view = appView<ShippingView>(state, "shipping");
  const labels = view
    ? view.data.labels.length
      ? `<table class="mini"><tbody>${view.data.labels.map((l) => `<tr><td>P${l.packageId}</td><td>${esc(l.name)}</td><td>${l.service.replace("_", "-")}</td><td>${l.weightLb} lb</td><td>${formatClock(l.at)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="muted small">No labels printed today.</div>`
    : `<div class="muted small">Refresh to see today's labels.</div>`;
  return `<div class="app-section"><div class="small">${view ? esc(view.data.pickup) : ""}</div></div>
    <div class="app-section"><h4>Rate a package</h4>
      <div class="btns"><input id="rate-weight" type="number" min="1" max="70" value="5" style="width:70px" /> lb
      <select id="rate-service">${(Object.keys(SERVICE_LABEL) as ShipService[]).map((s) => `<option value="${s}">${SERVICE_LABEL[s]}</option>`).join("")}</select>
      <label><input id="rate-packed" type="checkbox" checked /> already packed</label>
      <button class="btn" data-act="rate">Rate</button></div>
      <div class="small" style="margin-top:4px">${esc(computerUi.rate)}</div></div>
    <div class="app-section"><h4>Labels printed today</h4>${labels}
    <div class="muted small">The system knows what labels it printed, not what's in the bins.</div></div>`;
}

export function rateFromForm(): string {
  const weight = Math.max(1, Number((document.getElementById("rate-weight") as HTMLInputElement).value) || 1);
  const service = (document.getElementById("rate-service") as HTMLSelectElement).value as ShipService;
  const packed = (document.getElementById("rate-packed") as HTMLInputElement).checked;
  const q = shipQuote({ weightLb: weight, service, packed, box: boxFor(weight) });
  return `${SERVICE_LABEL[service]}, ${weight} lb: ${money(q.rateCents)}${q.packingCents ? ` + ${money(q.packingCents)} packing (${boxFor(weight)} box)` : ""} = ${money(q.totalCents)}`;
}

// ---------- voicemail ----------

function voicemailBody(state: GameState): string {
  const view = appView<VoicemailView>(state, "voicemail");
  if (!view) return `<div class="muted small">Refresh to check voicemail.</div>`;
  if (!view.data.voicemails.length) return `<div class="muted small">No messages.</div>`;
  return view.data.voicemails
    .slice()
    .reverse()
    .map(
      (v) => `<div class="menu-row"><div><b>${esc(v.from)}</b> ${esc(v.number)} <span class="muted small">${formatClock(v.at)}</span></div>
        <div class="small">Calling about ${esc(v.about)}.</div>
        ${v.calledBack ? `<span class="muted small">Called back</span>` : actionButton(state, { type: "call_back", voicemailId: v.id }, "Call back")}</div>`,
    )
    .join("");
}

// ---------- the order form (plain defaults: you set anything else yourself) ----------

const MEDIA_OPTIONS: Media[] = ["letter", "legal", "tabloid", "cardstock", "wide_18x24", "wide_24x36"];
const FINISHING_OPTIONS: Finishing[] = ["none", "staple", "fold", "cut", "laminate", "coil_bind"];

function specForm(prefix: string): string {
  return `<div class="spec-form">
    <label>Pages <input id="${prefix}-originals" type="number" min="1" value="1" /></label>
    <label>Copies <input id="${prefix}-copies" type="number" min="1" value="1" /></label>
    <label>Color <select id="${prefix}-color"><option value="bw">B&amp;W</option><option value="color">Color</option></select></label>
    <label>Paper <select id="${prefix}-media">${MEDIA_OPTIONS.map((m) => `<option value="${m}">${esc(MEDIA_LABEL[m])}</option>`).join("")}</select></label>
    <label><input id="${prefix}-duplex" type="checkbox" /> Double-sided</label>
    <label>Finishing <select id="${prefix}-finishing">${FINISHING_OPTIONS.map((f) => `<option value="${f}">${FINISHING_LABEL[f]}</option>`).join("")}</select></label>
  </div>`;
}

export function readSpecForm(prefix: string, item: string): JobSpec {
  const val = (k: string) => (document.getElementById(`${prefix}-${k}`) as HTMLInputElement | HTMLSelectElement).value;
  return {
    item,
    originals: Math.max(1, Math.floor(Number(val("originals")) || 1)),
    copies: Math.max(1, Math.floor(Number(val("copies")) || 1)),
    color: val("color") as ColorMode,
    media: val("media") as Media,
    duplex: (document.getElementById(`${prefix}-duplex`) as HTMLInputElement).checked,
    finishing: val("finishing") as Finishing,
  };
}

// Re-render without losing what's typed: keep every input's value and the focus across the swap.
export function setComputerHtml(el: HTMLElement, html: string): void {
  const values = new Map<string, string | boolean>();
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[id], select[id]").forEach((i) => {
    values.set(i.id, i instanceof HTMLInputElement && i.type === "checkbox" ? i.checked : i.value);
  });
  const focused = document.activeElement?.id;
  el.innerHTML = html;
  values.forEach((v, id) => {
    const i = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!i) return;
    if (typeof v === "boolean") (i as HTMLInputElement).checked = v;
    else i.value = v;
  });
  if (focused) (document.getElementById(focused) as HTMLElement | null)?.focus();
}
