// Turns game state into HTML. Pure functions: main.ts decides when to call them and wires up the buttons.
// Buttons carry a task request as JSON in data-req; main.ts starts it.
import type { CounterAction, Customer, GameState, RequestKind, Station, TaskRequest } from "../sim/types";
import { canStart, currentCustomer, previewTask, STATION } from "../sim/sim";
import { availableTasks, DONT, IGNORE, todoList } from "../sim/todo";
import { eventText } from "../sim/events";
import { quoteFor } from "../sim/quote";
import { isPrintKind } from "../sim/customers";
import { SERVICE_LABEL, describeQuantity, describeSpecs } from "../sim/orders";
import { formatClock, formatDuration } from "../sim/time";
import { customerById, jobById, money, packageById } from "../sim/util";
import type { DayReport } from "../sim/summary";
import type { Ending, Game } from "../sim/game";
import type { LeaderboardRow } from "../api";

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// A button that starts a task. Greyed out (with the reason on hover) when it can't start right now.
export function taskButton(state: GameState, req: TaskRequest, opts: { label?: string; primary?: boolean; sub?: string } = {}): string {
  const err = canStart(state, req);
  const t = previewTask(state, req);
  const cornerCut = DONT.has(req.type) || IGNORE.has(req.type) || req.choice === "turn_away" || req.choice === "ignore";
  const cls = ["btn", opts.primary ? "primary" : "", cornerCut ? "corner" : "", err ? "off" : ""].join(" ");
  const sub = opts.sub ? `<span class="kind">${esc(opts.sub)}</span>` : "";
  return `<button class="${cls}" data-act="task" data-req="${esc(JSON.stringify(req))}" title="${esc(err ?? "")}">${sub}${esc(opts.label ?? t.label)}<span class="dur">${formatDuration(t.duration)}</span></button>`;
}

// ---------- the top bar ----------

export function hudTask(state: GameState): string {
  const t = state.employee.task;
  if (!t) return `<b>Free.</b> <span class="muted">Pick something from the to-do list.</span>`;
  const frac = t.duration > 0 ? t.elapsed / t.duration : 1;
  return `<div class="row"><span><b>${esc(t.label)}</b> <span class="muted">${formatDuration(t.duration - t.elapsed)} left</span></span>
    <button class="btn" data-act="stop" style="padding:1px 8px">Stop</button></div>
    <div class="bar"><div style="width:${(frac * 100).toFixed(1)}%"></div></div>`;
}

export function clock(state: GameState): string {
  return state.time >= state.closeAt ? `${formatClock(state.time)} (closed)` : formatClock(state.time);
}

// The MC's latest monologue line.
export function caption(state: GameState): string {
  const c = state.captions.at(-1);
  return c ? `<b>You:</b> "${esc(c.text)}"` : "";
}

// Today's bad luck, while it needs you.
export function banner(state: GameState): string | null {
  const e = state.event;
  if (e?.status !== "active") return null;
  const t = eventText(e.kind);
  return `<b>${esc(t.title)}.</b> ${esc(t.prompt)}`;
}

// ---------- stations ----------

export const STATIONS: { id: Station; label: string }[] = [
  { id: "computer", label: "Computer" },
  { id: "printer", label: "Printer" },
  { id: "finishing", label: "Finishing" },
  { id: "self_serve", label: "Self-serve" },
  { id: "shipping", label: "Shipping" },
];

export function stationButtons(state: GameState, open: Station | null): string {
  return STATIONS.map(({ id, label }) => {
    const unread = id === "computer" ? state.messages.filter((m) => !m.read && !m.snoozed).length : 0;
    const busy = availableTasks(state, id).length > 0;
    const mark = unread ? `<span class="badge">${unread}</span>` : busy ? `<span class="dot"></span>` : "";
    return `<button class="btn ${open === id ? "on" : ""}" data-act="station" data-station="${id}">${label}${mark}</button>`;
  }).join("");
}

function stationStatus(state: GameState, station: Station): string {
  switch (station) {
    case "printer": {
      const p = state.printer;
      const what = { idle: "Idle", printing: `Printing order #${p.currentJobId}`, jammed: "Jammed", tray_empty: "Tray empty" }[p.status];
      const queue = p.queue.length ? ` · ${p.queue.length} queued` : "";
      return `${what}${queue}`;
    }
    case "self_serve":
      return state.copier.status === "ok" ? "Copier working." : state.copier.sign ? "Copier broken (out of order sign on it)." : "Copier broken.";
    case "shipping": {
      const binned = state.packages.filter((p) => p.status === "binned").length;
      const truck = { coming: "The truck hasn't come yet.", waiting: "The truck is here.", gone: "The truck has gone." }[state.truck.status];
      return `${binned} in the outbound bin. ${truck}`;
    }
    case "computer":
      return [state.cardReader === "down" ? "Card reader: down." : "", state.wifi.down ? "Wi-Fi: down." : ""].filter(Boolean).join(" ");
    default:
      return "";
  }
}

// Extra detail for a task button, so you know what you're confirming.
function detail(state: GameState, req: TaskRequest): string {
  if (req.type === "enter_order" || req.type === "send_job") {
    const job = jobById(state, req.jobId!)!;
    return `${describeQuantity(job.spec)}: ${describeSpecs(job.spec)}`;
  }
  if (req.type === "weigh" || req.type === "pack" || req.type === "label") {
    const pkg = packageById(state, req.packageId!)!;
    return `${customerById(state, pkg.customerId)?.name ?? ""}, ${pkg.weightLb} lb`;
  }
  return "";
}

export function stationPanel(state: GameState, station: Station): string {
  const label = STATIONS.find((s) => s.id === station)!.label;
  const status = stationStatus(state, station);
  let html = `<div class="row"><h2>${label}</h2><button class="btn" data-act="station" data-station="${station}" style="padding:0 8px">×</button></div>`;
  if (status) html += `<p class="muted small" style="margin:0 0 8px">${esc(status)}</p>`;
  const reqs = availableTasks(state, station);
  html += reqs.length
    ? `<ul class="plain">${reqs
        .map((r) => {
          const d = detail(state, r);
          return `<li>${taskButton(state, r)}${d ? `<div class="muted small">${esc(d)}</div>` : ""}</li>`;
        })
        .join("")}</ul>`
    : `<p class="muted">Nothing to do here right now.</p>`;
  if (station === "computer") html += inbox(state);
  return html;
}

function inbox(state: GameState): string {
  const msgs = state.messages.slice().reverse();
  if (!msgs.length) return "";
  return `<h2 style="margin-top:14px">Inbox</h2>${msgs
    .map((m) => {
      const body = m.read || m.kind !== "web_order" ? `<div class="small">${esc(m.body)}</div>` : `<div class="small muted">Open it to see the order.</div>`;
      const state_ = m.snoozed && !m.read ? ` <span class="muted small">(left unread)</span>` : "";
      return `<div class="msg ${m.read ? "" : "unread"}"><div class="subj">${esc(m.subject)}${state_}</div>${body}</div>`;
    })
    .join("")}`;
}

// ---------- the counter ----------

// What Do means for each kind of request (print requests get the full menu: take, rush, self-serve).
const DO_LABEL: Record<RequestKind, string> = {
  quick_copies: "Take the order",
  large_job: "Take the order",
  poster: "Take the order",
  ship: "Take the package",
  dropoff: "Take the drop-off",
  order_pickup: "Get their order",
  package_pickup: "Get their package",
  self_serve_help: "Help them",
  complaint: "Hear them out",
};

// The quote: what they want, when, what it costs (fees itemized), and when it could be ready.
function quoteHtml(state: GameState, c: Customer): string {
  const q = quoteFor(state, c);
  const rows: string[] = [];
  if (isPrintKind(c.kind) && c.spec && q.standard) {
    rows.push(`<dt>Wants</dt><dd>${esc(describeQuantity(c.spec))}<br><span class="muted small">${esc(describeSpecs(c.spec))}</span></dd>`);
    const when = c.timing === "tomorrow" ? "Tomorrow is fine" : `${c.timing === "wait" ? "Waiting in the store" : "Coming back"}, needs it by ${formatClock(c.needBy!)}`;
    rows.push(`<dt>When</dt><dd>${when}</dd>`);
    const fee = q.standard.serviceFeeCents ? `${money(q.standard.printCents)} + ${money(q.standard.serviceFeeCents)} service fee = ` : "";
    const ready = q.tomorrow ? "ready tomorrow" : `ready by ${formatClock(q.standardReadyAt)}`;
    rows.push(`<dt>Full service</dt><dd>${fee}<b>${money(q.standard.totalCents)}</b>, ${ready}</dd>`);
    if (q.rush) rows.push(`<dt>Rush</dt><dd>${money(q.standard.totalCents)} + ${money(q.rush.rushCents)} rush fee = <b>${money(q.rush.totalCents)}</b>, ready by ${formatClock(q.rushReadyAt)}</dd>`);
    rows.push(`<dt>Self-serve</dt><dd>${q.selfServeCents !== null ? `<b>${money(q.selfServeCents)}</b>, they do it themselves` : `<span class="muted">${esc(q.selfServeBlocker ?? "")}</span>`}</dd>`);
  } else if (q.ship) {
    rows.push(`<dt>Package</dt><dd>${c.weightLb} lb, ${SERVICE_LABEL[c.service]}</dd>`);
    rows.push(`<dt>Price</dt><dd>${money(q.ship.postageCents)} postage + ${money(q.ship.packingCents)} packing = <b>${money(q.ship.totalCents)}</b> <span class="muted small">(the store keeps ${money(q.ship.storeCents)})</span></dd>`);
  }
  return rows.length ? `<dl class="spec">${rows.join("")}</dl>` : "";
}

export function counter(state: GameState): string {
  const c = currentCustomer(state);
  let html = `<h2>Counter</h2>`;
  if (!c) html += `<p class="muted">Nobody at the counter.</p>`;
  else if (c.state === "line") {
    html += `<div class="who">${esc(c.name)}</div>`;
    html += c.said ? `<div class="said">"${esc(c.said)}"</div>` : `<p class="muted">Waiting to be helped.</p>`;
    html += `<div class="btns">${taskButton(state, { type: "talk", customerId: c.id }, { primary: true })}</div>`;
  } else {
    html += `<div class="who">${esc(c.name)}</div><div class="said">"${esc(c.said ?? "")}"</div>${quoteHtml(state, c)}`;
    const reply = (choice: CounterAction, label: string, sub: string, primary = false) => {
      const req: TaskRequest = { type: "respond", customerId: c.id, choice };
      return canStart(state, req) === null || /busy/.test(canStart(state, req)!) ? taskButton(state, req, { label, sub, primary }) : "";
    };
    const q = quoteFor(state, c);
    const print = isPrintKind(c.kind) && q.standard;
    html += `<div class="choices">
      ${reply("take", print ? `Take the order (${money(q.standard!.totalCents)})` : DO_LABEL[c.kind], "Do", true)}
      ${print && q.rush ? reply("rush", `Take it as a rush (${money(q.rush.totalCents)})`, "Do") : ""}
      ${print && q.selfServeCents !== null ? reply("self_serve", `Send them to self-serve (${money(q.selfServeCents)})`, "Do") : ""}
      ${reply("turn_away", "Turn them away", "Don't")}
      ${reply("ignore", "Ignore them", "Ignore")}
    </div>`;
    const left = Math.max(0, (c.answerBy ?? state.time) - state.time);
    html += `<p class="muted small">They're waiting for an answer (${formatDuration(left)}).</p>`;
  }
  const line = state.customers.filter((x) => x.state === "line" && x.id !== c?.id).length;
  if (line) html += `<p class="muted small">${line} more in line.</p>`;
  const waiting = state.customers.filter((x) => x.state === "waiting");
  if (waiting.length) html += `<h2 style="margin-top:14px">Waiting in the store</h2><ul class="plain">${waiting.map((x) => waitingRow(state, x)).join("")}</ul>`;
  return html;
}

function waitingRow(state: GameState, c: Customer): string {
  const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
  const what = job ? `order #${job.id} (${job.status === "bagged" ? "ready" : job.status.replace("_", " ")})` : c.kind.replace(/_/g, " ");
  const counterTasks = availableTasks(state, "counter").filter((r) => r.customerId === c.id && r.type !== "talk");
  return `<li><div class="row"><span><b>${esc(c.name)}</b> <span class="muted small">${esc(what)}</span></span><span class="btns">${counterTasks.map((r) => taskButton(state, r)).join("")}</span></div>
    ${c.said ? `<div class="muted small">"${esc(c.said)}"</div>` : ""}</li>`;
}

// ---------- to-do list ----------

export function todo(state: GameState): string {
  const items = todoList(state);
  if (!items.length) return `<li class="muted">Nothing right now.</li>`;
  return items
    .map((item) => {
      const station = STATIONS.find((s) => s.id === STATION[item.req.type])?.label ?? "Counter";
      return `<li><span>${esc(item.text)} <span class="muted small">· ${station}</span></span>
        <span class="btns">${taskButton(state, item.req, { primary: true })}${item.alts.map((a) => taskButton(state, a)).join("")}</span></li>`;
    })
    .join("");
}

export function logList(state: GameState): string {
  return state.log
    .slice(-40)
    .reverse()
    .map((e) => `<li><time>${formatClock(e.time)}</time><span>${esc(e.text)}</span></li>`)
    .join("");
}

// ---------- screens ----------

export function startScreen(saved: Game | null, name: string): string {
  const cont = saved && !saved.fired ? `<button class="btn primary" data-act="continue">Continue (day ${saved.day})</button>` : "";
  return `<h1>Print Shop</h1>
    <p>You work the counter at a print and ship shop. Customers come in, you decide how to deal with them. The job is not hard. Caring is optional. Not caring adds up.</p>
    <p class="muted small">Talk to whoever is at the counter, then pick an answer. Use the stations on the left, or just work down the to-do list. Space pauses; 1 to 3 change speed.</p>
    <p><label>Your name (for the leaderboard): <input type="text" id="name" maxlength="50" value="${esc(name)}"></label></p>
    <div class="btns">${cont}<button class="btn ${cont ? "" : "primary"}" data-act="newGame">New game</button></div>`;
}

export function reportScreen(r: DayReport, posted: string): string {
  return `<h1>End of day ${r.day}: performance summary</h1>
    <dl class="report">
      <dt>Customers served</dt><dd>${r.served}</dd>
      <dt>Customer delight rate</dt><dd>${r.happyPct}%</dd>
      <dt>Customer feedback received</dt><dd>${r.complaints}</dd>
      <dt>Orders taken</dt><dd>${r.ordersTaken} (${r.rushOrders} rush)</dd>
      <dt>Orders not ready on time</dt><dd>${r.lateOrders}</dd>
      <dt>Self-serve customers</dt><dd>${r.selfServed}</dd>
      <dt>Customers turned away</dt><dd>${r.turnedAway}</dd>
      <dt>Revenue opportunities declined</dt><dd>${money(r.lostSalesCents)}</dd>
      <dt>Sheets printed</dt><dd>${r.sheets.toLocaleString("en-US")}</dd>
      <dt>Revenue</dt><dd>${money(r.revenueCents)}</dd>
      <dt>Team Spirit Index</dt><dd>${r.teamSpirit}</dd>
    </dl>
    <div class="tone">${esc(r.tone)}</div>
    <p class="muted small" id="posted">${esc(posted)}</p>
    <div id="board"></div>
    <div class="btns"><button class="btn primary" data-act="nextDay">Start next day</button></div>`;
}

export function leaderboard(rows: LeaderboardRow[]): string {
  if (!rows.length) return "";
  return `<h2 style="margin-top:12px">Leaderboard (customers served in a day)</h2><ul class="plain small">${rows
    .map((r) => `<li class="row"><span>${r.rank}. ${esc(r.playerName)}</span><span>${r.score} served · ${r.satisfaction}% delighted</span></li>`)
    .join("")}</ul>`;
}

export function endingScreen(e: Ending, days: number): string {
  return `<h1>Fired</h1>
    <div class="tone">${esc(e.message)}</div>
    <p>${esc(e.text)}</p>
    <p class="muted"><i>"${esc(e.mc)}"</i></p>
    <p class="muted small">You lasted ${days} day${days === 1 ? "" : "s"}.</p>
    <div class="btns"><button class="btn primary" data-act="newGame">New game</button></div>`;
}
