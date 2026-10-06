// The computer: four apps on the monitor, one at a time. Orders (the order form, and every open order with where it
// is), Email (every message, newest first, web orders flagged), Devices (the machines: OK, or what's wrong and where
// to fix it), and Shipping (the label form, what's going out, and the truck). Icons down the left, with badges for
// what needs you. Pure HTML from the state; ComputerScene puts it on the monitor.
import type { GameState, JobStatus, Package } from "../sim/types";
import { SERVICE_LABEL } from "../sim/orders";
import { customerById, jobById } from "../sim/util";
import { describeSpec, needsAction } from "../sim/messages";
import { formatClock } from "../sim/time";
import { esc, labelForm, orderForm, stepButtons, taskButton } from "./view";

export type App = "orders" | "email" | "devices" | "shipping";
export const APPS: { id: App; label: string; icon: string }[] = [
  { id: "orders", label: "Orders", icon: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 10h6M9 14h6M9 18h4"/>' },
  { id: "email", label: "Email", icon: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 6l9 7 9-7"/>' },
  { id: "devices", label: "Devices", icon: '<rect x="3" y="9" width="18" height="8" rx="1"/><path d="M7 9V4h10v5M7 17v3h10v-3"/>' },
  { id: "shipping", label: "Shipping", icon: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>' },
];

export const STATUS: Record<JobStatus, string> = {
  unread: "In the email",
  new: "Not entered yet",
  entered: "Entered",
  queued: "Waiting to print",
  printing: "Printing",
  printed: "Ready to collect",
  collected: "Collected",
  finished: "Finished",
  bagged: "Bagged",
  picked_up: "Picked up",
  canceled: "Canceled",
};

// What needs you in each app: orders to enter or send, unread email, machines that are down, packages to deal with.
export function badges(s: GameState): Record<App, number> {
  return {
    orders: s.jobs.filter((j) => j.status === "new" || j.status === "entered").length,
    email: s.messages.filter((m) => !m.read && !m.snoozed).length,
    devices: problems(s).length,
    shipping: s.packages.filter((p) => p.status === "labeled" || p.status === "scanned").length + (s.truck.status === "waiting" ? 1 : 0),
  };
}

export function appIcons(s: GameState, current: App): string {
  const b = badges(s);
  return APPS.map(
    (a) =>
      `<button class="app${a.id === current ? " on" : ""}" data-act="app" data-app="${a.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${a.icon}</svg><span>${a.label}</span>${b[a.id] ? `<span class="badge">${b[a.id]}</span>` : ""}</button>`,
  ).join("");
}

// The step you're on, when it's done on the computer and waits for a button (whatever app you're in).
export function stepBar(s: GameState): string {
  const html = stepButtons(s, "computer");
  return html ? `<div class="stepbar">${html}</div>` : "";
}

// ---------- Orders ----------

export function ordersApp(s: GameState, formFor: number | null): string {
  if (formFor !== null) return orderForm(s, formFor);
  const jobs = s.jobs.filter((j) => j.status !== "canceled" && j.status !== "unread");
  // Open orders, soonest due first (as many as fit); the picked-up ones in a line.
  const open = jobs.filter((j) => j.status !== "picked_up").sort((a, b) => a.dueDay - b.dueDay || a.dueAt - b.dueAt);
  const done = jobs.filter((j) => j.status === "picked_up");
  if (!jobs.length) return `<h1>Orders</h1><p class="muted">No orders yet today.</p>`;
  const row = (j: (typeof jobs)[number]) => {
    const who = customerById(s, j.customerId)?.name ?? "";
    const due = j.dueDay > s.day ? `tomorrow ${formatClock(j.dueAt)}` : formatClock(j.dueAt);
    const action =
      j.status === "new" ? taskButton(s, { type: "enter_order", jobId: j.id }, { label: "Enter it", primary: true }) : j.status === "entered" ? taskButton(s, { type: "send_job", jobId: j.id }, { label: "Send to printer", primary: true }) : "";
    return `<div class="order st-${j.status}"><button class="what" data-act="note" data-job="${j.id}"><b>#${j.id} ${esc(who)}</b><span>${esc(describeSpec(j.spec))}. Due ${due}${j.rush ? ", rush" : ""}.</span></button><span class="status">${STATUS[j.status]}</span>${action}</div>`;
  };
  const shown = open.slice(0, 5);
  const more = open.length - shown.length;
  return `<h1>Orders</h1><div class="list">${shown.map(row).join("") || `<p class="muted">Nothing open.</p>`}</div>
    <p class="small muted">${more ? `+${more} more open (see the notes). ` : ""}${done.length ? `Picked up today: ${done.map((j) => `#${j.id}`).join(", ")}. ` : ""}Tap an order for everything about it.</p>`;
}

// ---------- Email ----------

export function emailApp(s: GameState, open: number | null, webForm: number | null): string {
  const m = open !== null ? s.messages.find((x) => x.id === open) : undefined;
  if (m && webForm === m.id && m.jobId !== null) return orderForm(s, m.jobId, { messageId: m.id });
  if (m) {
    const job = m.jobId !== null ? jobById(s, m.jobId) : undefined;
    const actions =
      m.kind === "web_order" && !m.read && job
        ? `<button class="btn primary" data-act="webForm" data-msg="${m.id}">Enter this order</button>${m.snoozed ? "" : taskButton(s, { type: "leave_unread", messageId: m.id }, { label: "Leave it for later" })}`
        : "";
    return `<div class="mail-open"><button class="btn" data-act="mail" data-msg="">Back to Email</button>
      <h1>${esc(m.subject)}</h1><p class="small muted">From ${esc(m.from)} at ${formatClock(m.at)}</p>
      <div class="body">${esc(m.body)}</div><div class="btns">${actions}</div></div>`;
  }
  const list = s.messages.slice().reverse(); // newest first
  if (!list.length) return `<h1>Email</h1><p class="muted">No email.</p>`;
  return `<h1>Email</h1><div class="list">${list
    .slice(0, 8)
    .map(
      (x) =>
        `<button class="mail${x.read ? "" : " unread"}" data-act="mail" data-msg="${x.id}">${needsAction(x) ? `<span class="flag">Action</span>` : ""}<b>${esc(x.from)}</b><span>${esc(x.subject)}</span><time>${formatClock(x.at)}</time></button>`,
    )
    .join("")}</div>${list.length > 8 ? `<p class="small muted">${list.length - 8} older</p>` : ""}`;
}

// ---------- Devices ----------

interface Device {
  name: string;
  ok: boolean;
  line: string; // OK, or what's wrong and where to fix it
  fix?: string; // a button to fix it from here
}

export function devices(s: GameState): Device[] {
  const p = s.printer;
  const printing = p.currentJobId !== null ? `Printing order #${p.currentJobId}${p.queue.length ? `, ${p.queue.length} waiting` : ""}.` : "Idle.";
  return [
    { name: "Production printer", ok: p.status !== "jammed" && p.status !== "tray_empty", line: p.status === "jammed" ? "Paper jam. Go to the Printer and clear it." : p.status === "tray_empty" ? "Out of paper. Go to the Printer and load a ream." : `OK. ${printing}` },
    { name: "Self-serve copier", ok: s.copier.status === "ok", line: s.copier.status === "ok" ? "OK." : s.copier.sign ? "Broken, with an out of order sign on it. Fix it at the Counter." : "Broken. Go to the Counter and fix it." },
    { name: "Card reader", ok: s.cardReader !== "down", line: s.cardReader === "down" ? "Down: cards won't go through. Hold the reset button on the reader box, below this screen." : "OK.", fix: s.cardReader === "down" ? "fix_card_reader" : undefined },
    { name: "Wi-Fi", ok: !s.wifi.down, line: s.wifi.down ? "Down: web orders are stuck until it's back. Hold the router's power button, below this screen." : "OK.", fix: s.wifi.down ? "restart_router" : undefined },
  ];
}

export function problems(s: GameState): Device[] {
  return devices(s).filter((d) => !d.ok);
}

export function devicesApp(s: GameState): string {
  return `<h1>Devices</h1><div class="list">${devices(s)
    .map((d) => `<div class="device${d.ok ? "" : " down"}"><b>${esc(d.name)}</b><span>${esc(d.line)}</span>${d.fix ? taskButton(s, { type: d.fix as "fix_card_reader" }, { label: "Fix it", primary: true }) : ""}</div>`)
    .join("")}</div>`;
}

// ---------- Shipping ----------

const PKG: Partial<Record<Package["status"], string>> = {
  boxed: "In a box, needs taping",
  packed: "Packed, needs weighing",
  weighed: "Weighed, needs a label",
  labeled: "Labeled, not in the bin yet",
  scanned: "Scanned, not in the bin yet",
  binned: "In the outbound bin",
  shipped: "Gone with the truck",
};

export function shippingApp(s: GameState, labelFor: number | null): string {
  if (labelFor !== null) return labelForm(s, labelFor);
  const t = s.truck;
  const truck = t.status === "coming" ? `The truck comes at ${formatClock(t.arrivesAt)}.` : t.status === "waiting" ? `The truck is here until ${formatClock(t.leavesAt)}. Hand off the outbound bin at Shipping.` : "The truck has come and gone for today.";
  const out = s.packages.filter((p) => PKG[p.status]);
  return `<h1>Shipping</h1><p class="truck${t.status === "waiting" ? " now" : ""}">${esc(truck)}</p><h2>Today's outbound</h2>${
    out.length
      ? `<div class="list">${out.map((p) => `<div class="pkg"><b>#${p.id} ${esc(customerById(s, p.customerId)?.name ?? "")}</b><span>${p.kind === "dropoff" ? "Drop-off" : `${p.weightLb} lb, ${p.service ? SERVICE_LABEL[p.service] : ""}`}</span><span class="status">${PKG[p.status]}</span></div>`).join("")}</div>`
      : `<p class="muted">Nothing going out yet.</p>`
  }<p class="small muted">Labels are printed at Shipping, once the box is weighed.</p>`;
}
