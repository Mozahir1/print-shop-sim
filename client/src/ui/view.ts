// Turns game state into HTML for the small panels around the scene. Pure functions: main.ts decides when to call
// them and wires up the buttons. Buttons carry a task request as JSON in data-req; main.ts starts it.
import type { CounterAction, Customer, GameState, RequestKind, Station, TaskRequest } from "../sim/types";
import { canGoHome, canStart, currentCustomer, previewTask, sceneOf, workLeft } from "../sim/sim";
import { availableTasks, DONT, IGNORE, todoList } from "../sim/todo";
import { currentStep, isChoice, workflowSteps, WORKFLOWS, STEP } from "../sim/workflow";
import { managerMood } from "../sim/failures";
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

// A button that starts a task. Greyed out (with the reason on hover, and shown where you click) when it can't start.
export function taskButton(state: GameState, req: TaskRequest, opts: { label?: string; primary?: boolean; sub?: string; key?: string } = {}): string {
  const err = canStart(state, req);
  const t = previewTask(state, req);
  const cornerCut = DONT.has(req.type) || IGNORE.has(req.type) || req.choice === "turn_away" || req.choice === "ignore";
  const cls = ["btn", opts.primary ? "primary" : "", cornerCut ? "corner" : "", err ? "off" : ""].join(" ");
  const sub = opts.sub ? `<span class="kind">${esc(opts.sub)}${opts.key ? ` <kbd>${opts.key}</kbd>` : ""}</span>` : "";
  // (Answers at the counter say what they cost you in their own label.)
  const dur = req.type === "respond" ? "" : `<span class="dur">${formatDuration(t.duration)}</span>`;
  return `<button class="${cls}" data-act="task" data-req="${esc(JSON.stringify(req))}" data-err="${esc(err ?? "")}" title="${esc(err ?? "")}">${sub}${esc(opts.label ?? t.label)}${dur}</button>`;
}

// ---------- the top bar ----------

export function clock(state: GameState): string {
  return state.time >= state.closeAt ? `${formatClock(state.time)} (closed)` : formatClock(state.time);
}

export function managerMoodHtml(state: GameState): string {
  const mood = managerMood(state.manager.heat);
  return `<span class="mood ${mood}" title="How the manager seems">Manager: ${mood}</span>`;
}

export function goHomeButton(state: GameState): string {
  if (canGoHome(state)) return "";
  const left = workLeft(state).length;
  return `<button class="btn ${left ? "corner" : "primary"}" data-act="goHome" title="${left ? `${left} thing${left === 1 ? "" : "s"} left undone` : "Everything's done"}">Go home <kbd>G</kbd></button>`;
}

// Today's bad luck, while it needs you.
export function banner(state: GameState): string | null {
  const e = state.event;
  if (e?.status !== "active") return null;
  const t = eventText(e.kind);
  return `<b>${esc(t.title)}.</b> ${esc(t.prompt)}`;
}

// ---------- the job card: what you're doing ----------

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
  business: "Take the order",
};

function answerLabels(state: GameState, c: Customer): { take: string; turnAway: string } {
  switch (sceneOf(state, c)) {
    case "missing_order":
      return { take: "Rush it now, they wait", turnAway: "Apologize and refund" };
    case "copier_broken":
      return { take: "Fix the copier now, they wait", turnAway: "Sorry, it's broken" };
    case "complaint":
      return { take: c.about === "smudged_return" ? "Reprint them free" : "File a claim", turnAway: "Apologize" };
    default: {
      const q = quoteFor(state, c);
      if (!isPrintKind(c.kind) || !q.standard) return { take: DO_LABEL[c.kind], turnAway: "Turn them away" };
      const take = q.walkUp ? `Make them yourself (${money(q.standard.totalCents)}, ${formatDuration(q.yourMinutes)})` : `Take the order (${money(q.standard.totalCents)})`;
      return { take, turnAway: "Turn them away" };
    }
  }
}

// The quote: what they want, when, what it costs (fees itemized), and when it could be ready.
function quoteHtml(state: GameState, c: Customer): string {
  const q = quoteFor(state, c);
  const rows: string[] = [];
  if (isPrintKind(c.kind) && c.spec && q.standard) {
    rows.push(`<dt>Wants</dt><dd>${esc(describeQuantity(c.spec))}<br><span class="muted small">${esc(describeSpecs(c.spec))}</span></dd>`);
    const when = c.timing === "tomorrow" ? "Tomorrow is fine" : `${c.timing === "wait" ? "Waiting" : "Coming back"}, needs it by ${formatClock(c.needBy!)}`;
    rows.push(`<dt>When</dt><dd>${when}</dd>`);
    const fee = q.standard.serviceFeeCents ? `${money(q.standard.printCents)} + ${money(q.standard.serviceFeeCents)} fee = ` : "";
    const ready = q.tomorrow ? "ready tomorrow" : `ready by ${formatClock(q.standardReadyAt)}`;
    rows.push(`<dt>Full service</dt><dd>${fee}<b>${money(q.standard.totalCents)}</b>, ${ready}</dd>`);
    if (q.rush) rows.push(`<dt>Rush</dt><dd>+ ${money(q.rush.rushCents)} = <b>${money(q.rush.totalCents)}</b>, ready by ${formatClock(q.rushReadyAt)}</dd>`);
    rows.push(
      q.walkUp
        ? `<dt>Your time</dt><dd><b>${formatDuration(q.yourMinutes)}</b>, all at once: you make the copies while they wait, and you can't leave it</dd>`
        : `<dt>Your time</dt><dd>about <b>${formatDuration(q.yourMinutes)}</b> of work (enter it, then collect, finish, bag), printer ${formatDuration(q.printMinutes)}</dd>`,
    );
    rows.push(`<dt>Self-serve</dt><dd>${q.selfServeCents !== null ? `<b>${money(q.selfServeCents)}</b>, they do it. Your time: ${formatDuration(q.selfServeMinutes)}` : `<span class="muted">${esc(q.selfServeBlocker ?? "")}</span>`}</dd>`);
  } else if (q.ship) {
    rows.push(`<dt>Package</dt><dd>${c.weightLb} lb, ${SERVICE_LABEL[c.service]}: <b>${money(q.ship.totalCents)}</b> <span class="muted small">(store keeps ${money(q.ship.storeCents)})</span></dd>`);
  }
  return rows.length ? `<dl class="spec">${rows.join("")}</dl>` : "";
}

function answers(state: GameState, c: Customer, confirming: string | null): string {
  const q = quoteFor(state, c);
  const labels = answerLabels(state, c);
  const btn = (choice: CounterAction, label: string, sub: string, key?: string, primary = false) => {
    const req: TaskRequest = { type: "respond", customerId: c.id, choice };
    const err = canStart(state, req);
    if (err && !err.startsWith("You can't do that")) return ""; // not an option for them
    const sure = choice === "turn_away" && confirming === "turn_away" ? "Sure? Click again" : label;
    return taskButton(state, req, { label: sure, sub, key, primary });
  };
  const print = isPrintKind(c.kind) && !sceneOf(state, c);
  return `<div class="choices">
    ${btn("take", labels.take, "Do", "Enter", true)}
    ${print && q.rush ? btn("rush", `Rush it (${money(q.rush.totalCents)})`, "Do") : ""}
    ${print && q.selfServeCents !== null ? btn("self_serve", `Send to self-serve (${money(q.selfServeCents)}, ${formatDuration(q.selfServeMinutes)})`, "Do") : ""}
    ${btn("turn_away", labels.turnAway, "Don't", "X")}
    ${btn("ignore", "Ignore them", "Ignore", "I")}
  </div>`;
}

export function jobCard(state: GameState, confirming: string | null): string {
  const wf = state.workflow;
  const task = state.employee.task;
  if (!wf) {
    const front = currentCustomer(state);
    let html = `<h2>You</h2><p class="free">Hands empty. You're free.</p>`;
    if (front?.state === "line") html += `<div class="btns">${taskButton(state, { type: "talk", customerId: front.id }, { primary: true, label: `Talk to ${front.name}`, sub: "Next", key: "Enter" })}</div>`;
    else html += `<p class="muted small">Pick something from the to-do list, or click a station.</p>`;
    if (state.time >= state.closeAt) {
      const left = workLeft(state);
      html += `<p class="small ${left.length ? "warn" : "ok"}">${left.length ? `Still to do: ${esc(left.join(", "))}.` : "Everything's done. Go home on time."}</p>`;
    }
    return html;
  }
  const c = wf.customerId !== undefined ? customerById(state, wf.customerId) : undefined;
  const steps = workflowSteps(state, wf);
  const step = currentStep(state);
  let html = `<div class="row"><h2>${esc(WORKFLOWS[wf.kind].label)}${c ? `: ${esc(c.name)}` : ""}</h2>
    <button class="btn corner small" data-act="abandon" title="Walk away (counts as ignoring it)">${confirming === "abandon" ? "Sure? Walk away" : "Walk away"}</button></div>`;
  html += `<ol class="steps">${steps
    .map((s) => {
      const now = !s.done && s.type === step?.type;
      return `<li class="${s.done ? "done" : now ? "now" : ""}">${s.done ? "✓" : now ? "▶" : "·"} ${esc(STEP[s.type].thought.replace(/\.$/, ""))}</li>`;
    })
    .join("")}</ol>`;
  if (task) {
    const frac = task.duration > 0 ? task.elapsed / task.duration : 1;
    html += `<div class="doing"><b>${esc(task.label)}</b> <span class="muted">${formatDuration(task.duration - task.elapsed)}</span><div class="bar"><div style="width:${(frac * 100).toFixed(1)}%"></div></div></div>`;
    return html;
  }
  if (!step) return html;
  if (step.type === "respond" && c) {
    html += `<div class="said">"${esc(c.said ?? "")}"</div>${quoteHtml(state, c)}${answers(state, c, confirming)}`;
    const left = Math.max(0, (c.answerBy ?? state.time) - state.time);
    html += `<p class="muted small">Waiting for your answer (${formatDuration(left)}).</p>`;
  } else if (isChoice(step)) {
    html += `<div class="choices">${taskButton(state, step.req, { primary: true, sub: "Do", key: "Enter" })}${step.alts.map((a) => taskButton(state, a, { sub: "Don't", key: "X" })).join("")}</div>`;
  } else {
    html += `<div class="btns">${taskButton(state, step.req, { primary: true, sub: "Next step", key: "Enter" })}</div>`;
  }
  return html;
}

// ---------- station menus (open where you click) ----------

export const STATION_LABEL: Record<Station | "truck", string> = { computer: "Computer", printer: "Printer", finishing: "Finishing table", self_serve: "Self-serve copier", shipping: "Shipping", counter: "Counter", truck: "The truck" };

// Extra detail for a task button, so you know what you're confirming.
function detail(state: GameState, req: TaskRequest): string {
  if (req.type === "enter_order" || req.type === "send_job") {
    const job = jobById(state, req.jobId!)!;
    return `${describeQuantity(job.spec)}: ${describeSpecs(job.spec)}${job.rush ? " (rush)" : ""}, due ${formatClock(job.dueAt)}`;
  }
  if (req.type === "weigh" || req.type === "pack" || req.type === "label") {
    const pkg = packageById(state, req.packageId!)!;
    return `${customerById(state, pkg.customerId)?.name ?? ""}, ${pkg.weightLb} lb`;
  }
  return "";
}

function inbox(state: GameState): string {
  const msgs = state.messages.slice().reverse().slice(0, 6);
  if (!msgs.length) return "";
  return `<h2 style="margin-top:10px">Inbox</h2>${msgs
    .map((m) => {
      const body = m.read || m.kind !== "web_order" ? `<div class="small">${esc(m.body)}</div>` : `<div class="small muted">Open it to see the order.</div>`;
      return `<div class="msg ${m.read ? "" : "unread"}"><div class="subj">${esc(m.subject)}${m.snoozed && !m.read ? ` <span class="muted small">(left unread)</span>` : ""}</div>${body}</div>`;
    })
    .join("")}`;
}

export function stationMenu(state: GameState, station: Station | "truck"): string {
  const at: Station = station === "truck" ? "shipping" : station;
  const reqs = availableTasks(state, at).filter((r) => station !== "truck" || r.type === "hand_off" || r.type === "let_truck_go");
  let html = `<div class="row"><h2>${STATION_LABEL[station]}</h2><button class="btn small" data-act="closePop">×</button></div>`;
  html += reqs.length
    ? `<ul class="plain">${reqs
        .map((r) => {
          const d = detail(state, r);
          return `<li>${taskButton(state, r)}${d ? `<div class="muted small">${esc(d)}</div>` : ""}</li>`;
        })
        .join("")}</ul>`
    : `<p class="muted small">Nothing to do here right now.</p>`;
  if (station === "computer") html += inbox(state);
  return html;
}

export function customerMenu(state: GameState, id: number): string {
  const c = customerById(state, id);
  if (!c) return "";
  const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
  const reqs = (["counter", "shipping", "self_serve"] as Station[]).flatMap((st) => availableTasks(state, st)).filter((r) => r.customerId === id);
  const what = job ? `order #${job.id}: ${job.status === "bagged" ? "ready" : job.status.replace("_", " ")}${job.dueDay === state.day ? `, due ${formatClock(job.dueAt)}` : ""}` : c.kind.replace(/_/g, " ");
  return `<div class="row"><h2>${esc(c.name)}</h2><button class="btn small" data-act="closePop">×</button></div>
    <p class="muted small">${esc(what)}. ${c.stage === "fine" ? "" : `They're ${c.stage}.`}</p>
    ${reqs.length ? `<div class="btns">${reqs.map((r) => taskButton(state, r)).join("")}</div>` : ""}`;
}

// ---------- to-do list, most urgent first ----------

export function todo(state: GameState, confirming: string | null): string {
  const items = todoList(state);
  if (!items.length) return `<li class="muted">Nothing right now.</li>`;
  return items
    .slice(0, 8)
    .map((item) => {
      const c = item.customerId !== undefined ? customerById(state, item.customerId) : undefined;
      const urgency = c && c.stage !== "fine" ? c.stage : "";
      const waited = c && ["line", "talking", "waiting"].includes(c.state) && c.waited > 0 ? ` <span class="wait ${urgency}">${formatDuration(c.waited)}</span>` : "";
      const alts = item.alts.map((a) => taskButton(state, a, { label: a.choice === "turn_away" && confirming === "turn_away" ? "Sure? Click again" : undefined })).join("");
      return `<li class="${urgency}"><span>${esc(item.text)}${waited}</span><span class="btns">${taskButton(state, item.req, { primary: true })}${alts}</span></li>`;
    })
    .join("");
}

export function logList(state: GameState): string {
  return state.log
    .slice(-30)
    .reverse()
    .map((e) => `<li><time>${formatClock(e.time)}</time><span>${esc(e.text)}</span></li>`)
    .join("");
}

// ---------- screens ----------

export function startScreen(saved: Game | null, name: string): string {
  const cont = saved && !saved.fired ? `<button class="btn primary" data-act="continue">Continue (day ${saved.day})</button>` : "";
  return `<h1>Print Shop</h1>
    <p>You work the counter at a print and ship shop. Customers come in, you decide how to deal with them. The job is not hard. Caring is optional. Not caring adds up.</p>
    <p class="muted small">Click the customer at the counter (or press Enter) to talk to them, then Do, Don't, or Ignore. Click a station to see what you can do there. At 5 PM, finish up and go home. Space pauses; 1 to 3 change speed.</p>
    <p><label>Your name (for the leaderboard): <input type="text" id="name" maxlength="50" value="${esc(name)}"></label></p>
    <div class="btns">${cont}<button class="btn ${cont ? "" : "primary"}" data-act="newGame">New game</button></div>`;
}

export function reportScreen(r: DayReport, posted: string): string {
  const failures = r.failures.length ? `<h2 style="margin-top:12px">What went wrong</h2><ul class="failures">${r.failures.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : `<p class="ok">Nothing went wrong today.</p>`;
  return `<h1>End of day ${r.day}: performance summary</h1>
    <p>${esc(r.wentHome)}</p>
    <dl class="report">
      <dt>Customers served</dt><dd>${r.served}</dd>
      <dt>Customer delight rate</dt><dd>${r.happyPct}%</dd>
      <dt>Customer feedback received</dt><dd>${r.complaints}</dd>
      <dt>Orders taken</dt><dd>${r.ordersTaken} (${r.rushOrders} rush)</dd>
      <dt>Orders not ready on time</dt><dd>${r.lateOrders}</dd>
      <dt>Self-serve customers</dt><dd>${r.selfServed}</dd>
      <dt>Customers turned away</dt><dd>${r.turnedAway}</dd>
      <dt>Revenue opportunities declined</dt><dd>${money(r.lostSalesCents)}</dd>
      <dt>Revenue</dt><dd>${money(r.revenueCents)}</dd>
      <dt>Team Spirit Index</dt><dd>${r.teamSpirit}</dd>
    </dl>
    ${failures}
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
