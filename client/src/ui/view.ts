// Turns game state into HTML for the panels: the station you're looking at, the tabs, the notes. Pure functions:
// main.ts decides when to call them and wires up the buttons. Buttons carry a task request as JSON in data-req; main.ts starts it.
import type { CounterAction, Customer, GameState, OrderEntry, Station, TaskRequest, TaskType } from "../sim/types";
import { canGoHome, canStart, currentCustomer, previewTask, sceneOf, STATION, workLeft } from "../sim/sim";
import { availableTasks, DONT, IGNORE } from "../sim/todo";
import { currentStep, isChoice, WORKFLOWS, STEP } from "../sim/workflow";
import { requestLines } from "../sim/dialogue";
import { NOTE_FADE, notes } from "../sim/notes";
import { managerMood } from "../sim/failures";
import { eventText } from "../sim/events";
import { quoteFor } from "../sim/quote";
import { isPrintKind } from "../sim/customers";
import { formatClock, formatDuration } from "../sim/time";
import { customerById, jobById, money } from "../sim/util";
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

// ---------- where things are: the tabs ----------

export type Tab = "counter" | "computer" | "printer" | "finishing" | "shipping" | "shelf";
export const TABS: { id: Tab; label: string }[] = [
  { id: "counter", label: "Counter" },
  { id: "computer", label: "Computer" },
  { id: "printer", label: "Printer" },
  { id: "finishing", label: "Finishing" },
  { id: "shipping", label: "Shipping" },
  { id: "shelf", label: "Pickup Shelf" },
];

// The screen a task is done on. (Self-serve is out front, by the counter.)
export function tabOf(type: TaskType): Tab {
  const st = STATION[type];
  return st === "self_serve" ? "counter" : st;
}

// Screens with something waiting for you (their tab pulses).
export function attention(state: GameState): Set<Tab> {
  const s = new Set<Tab>();
  const p = state.printer;
  if (p.status === "jammed" || p.status === "tray_empty" || state.jobs.some((j) => j.status === "printed")) s.add("printer");
  if (state.jobs.some((j) => j.status === "collected" || j.status === "finished")) s.add("finishing");
  if (state.truck.status === "waiting" || state.packages.some((x) => x.status === "labeled" || x.status === "scanned")) s.add("shipping");
  if (state.cardReader === "down" || state.wifi.down || state.jobs.some((j) => j.status === "new" && !j.walkUp) || state.messages.some((m) => !m.read && !m.snoozed && m.kind === "web_order")) s.add("computer");
  if (state.customers.some((c) => c.state === "line") || state.copier.status === "broken") s.add("counter");
  return s;
}

export function tabBar(active: Tab, pulse: Set<Tab>): string {
  return TABS.map((t) => `<button class="tab ${t.id === active ? "on" : ""} ${pulse.has(t.id) && t.id !== active ? "pulse" : ""}" data-act="tab" data-tab="${t.id}">${t.label}</button>`).join("");
}

// What you're holding: from the step you're on. Empty hands mean you're free.
export function held(state: GameState): string | null {
  const t = state.employee.task;
  if (t) return STEP[t.type].held;
  return currentStep(state)?.data.held ?? null;
}

// ---------- what you're doing ----------

export function doing(state: GameState, confirming: string | null): string {
  const wf = state.workflow;
  const task = state.employee.task;
  if (!wf) return `<span class="muted">Hands free.</span>`;
  const c = wf.customerId !== undefined ? customerById(state, wf.customerId) : undefined;
  const step = currentStep(state);
  let html = `<div class="row"><b>${esc(WORKFLOWS[wf.kind].label)}${c ? `: ${esc(c.name)}` : ""}</b>
    <button class="btn corner small" data-act="abandon" title="Walk away (counts as ignoring it)">${confirming === "abandon" ? "Sure? Walk away" : "Walk away"}</button></div>`;
  if (task) {
    const frac = task.duration > 0 ? task.elapsed / task.duration : 1;
    html += `<div class="small">${esc(task.label)} <span class="muted">${formatDuration(task.duration - task.elapsed)}</span><div class="bar"><div style="width:${(frac * 100).toFixed(1)}%"></div></div></div>`;
  } else if (step) html += `<div class="small muted">Next: ${esc(step.data.thought)}${tabOf(step.type) !== "counter" ? ` (${TABS.find((t) => t.id === tabOf(step.type))!.label})` : ""}</div>`;
  return html;
}

// ---------- the counter ----------

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
      if (!isPrintKind(c.kind) || !q.standard) return { take: c.kind === "ship" && q.ship ? `Take the package (${money(q.ship.totalCents)})` : "Help them", turnAway: "Turn them away" };
      const take = q.walkUp ? `Make them yourself (${money(q.standard.totalCents)}, ${formatDuration(q.yourMinutes)})` : `Take the order (${money(q.standard.totalCents)})`;
      return { take, turnAway: "Turn them away" };
    }
  }
}

// What the shop knows (not what they asked for: that's in what they said): price, when it'd be ready, your time.
function quoteLine(state: GameState, c: Customer): string {
  const q = quoteFor(state, c);
  if (!isPrintKind(c.kind) || !q.standard || sceneOf(state, c)) return "";
  const fee = q.standard.serviceFeeCents ? ` (incl. ${money(q.standard.serviceFeeCents)} fee)` : "";
  const ready = q.walkUp ? "made now while they wait" : q.tomorrow ? "ready tomorrow" : `ready by ${formatClock(q.standardReadyAt)}`;
  const yours = q.walkUp ? `${formatDuration(q.yourMinutes)} of your time, all at once` : `about ${formatDuration(q.yourMinutes)} of your time, printer ${formatDuration(q.printMinutes)}`;
  return `<p class="small muted">Full service ${money(q.standard.totalCents)}${fee}, ${ready}: ${yours}.${q.rush ? ` Rush ready by ${formatClock(q.rushReadyAt)}.` : ""}</p>`;
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
    ${print && q.rush ? btn("rush", `Take it as a rush (${money(q.rush.totalCents)})`, "Do") : ""}
    ${print && q.selfServeCents !== null ? btn("self_serve", `Send to self-serve (${money(q.selfServeCents)})`, "Do") : ""}
    ${btn("turn_away", labels.turnAway, "Don't", "X")}
    ${btn("ignore", "Ignore them", "Ignore", "I")}
  </div>`;
}

// Who's across the counter: the next in line, or whoever you're serving at the counter right now.
export function atCounter(state: GameState): Customer | undefined {
  const front = currentCustomer(state);
  const wf = state.workflow;
  const step = currentStep(state);
  const t = state.employee.task;
  const serving = wf?.customerId !== undefined && tabOf((t ?? step?.req ?? { type: "talk" }).type) === "counter" ? customerById(state, wf.customerId) : undefined;
  return serving?.state === "waiting" ? serving : front;
}

// The textbox: what they say, one line at a time (shown says how many lines are out so far).
export function counterPanel(state: GameState, shown: number, confirming: string | null, byHand = false): string {
  const front = currentCustomer(state);
  const step = currentStep(state);
  let html = "";
  if (front?.state === "talking") {
    const lines = requestLines(state, front);
    const out = lines.slice(0, Math.max(1, shown));
    if (front.said && !lines.includes(front.said) && shown >= lines.length) out.push(front.said); // how they took your answer
    const more = shown < lines.length;
    html += `<div class="textbox" data-act="nextLine"><div class="who">${esc(front.name)}</div>${out.map((l, i) => `<p class="${i === out.length - 1 ? "" : "muted"}">${esc(l)}</p>`).join("")}${more ? `<span class="more">▸ tap</span>` : ""}</div>`;
    if (!more && step?.type === "respond" && !state.employee.task) {
      html += quoteLine(state, front) + answers(state, front, confirming);
      html += `<div class="row">${taskButton(state, { type: "ask_again", customerId: front.id }, { label: "What was that?" })}<span class="muted small">Waiting for your answer (${formatDuration(Math.max(0, (front.answerBy ?? state.time) - state.time))}).</span></div>`;
    }
    return html;
  }
  // (The textbox is always there, so nothing below it jumps when someone speaks up.)
  const who = atCounter(state);
  const said = who?.said && who.saidAt !== null && state.time - who.saidAt < 10;
  html += `<div class="textbox"><div class="who">${esc(who?.name ?? "\u00a0")}</div><p class="${said ? "" : "muted"}">${said ? esc(who!.said!) : who ? "..." : "Nobody at the counter."}</p></div>`;
  if (front?.state === "line") html += `<div class="btns">${taskButton(state, { type: "talk", customerId: front.id }, { primary: true, label: `Next, please (${front.name})`, key: "Enter" })}</div>`;
  html += (byHand ? "" : stepButtons(state, "counter")) + stationTasks(state, ["counter", "self_serve"]);
  if (state.time >= state.closeAt) {
    const left = workLeft(state);
    html += `<p class="small ${left.length ? "warn" : "ok"}">${left.length ? `Still to do: ${esc(left.join(", "))}.` : "Everything's done. Go home on time."}</p>`;
  }
  return html;
}

// ---------- the computer ----------

const FORM: { field: keyof OrderEntry; label: string; options: [string, string][] }[] = [
  { field: "media", label: "Paper", options: [["letter", "Letter"], ["legal", "Legal"], ["tabloid", "Tabloid 11x17"], ["cardstock", "Cardstock"]] },
  { field: "color", label: "Color", options: [["bw", "B&W"], ["color", "Color"]] },
  { field: "duplex", label: "Sides", options: [["false", "1-sided"], ["true", "2-sided"]] },
  { field: "finishing", label: "Finishing", options: [["none", "None"], ["staple", "Staple"], ["cut", "Cut"], ["laminate", "Laminate"]] },
];

// The order form, blank: you fill it in from what they said. (Its HTML only depends on the order, so redrawing the
// panel never wipes what you've picked.)
export function orderForm(state: GameState, jobId: number): string {
  const job = jobById(state, jobId)!;
  const who = customerById(state, job.customerId);
  return `<form class="orderform" data-job="${job.id}"><h2>New order #${job.id}: ${esc(who?.name ?? "")}, ${esc(job.spec.item)}</h2>
    <label class="field"><span>Copies</span><input type="number" name="copies" min="1" max="9999" inputmode="numeric" required></label>
    ${FORM.map((f) => `<fieldset class="field"><span>${f.label}</span><div class="chips">${f.options.map(([v, l]) => `<label class="chip-opt"><input type="radio" name="${f.field}" value="${v}"><span>${l}</span></label>`).join("")}</div></fieldset>`).join("")}
    <button type="button" class="btn primary" data-act="hand" data-what="form">Enter order</button></form>`;
}

export function computerPanel(state: GameState, byHand = false): string {
  return (byHand ? "" : stepButtons(state, "computer")) + stationTasks(state, ["computer"]) + inbox(state);
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

// ---------- the other stations (each gets its hands-on screen in a later step) ----------

// (byHand: you're doing the step by hand, so its buttons give way to that.)
export function stationPanel(state: GameState, tab: Tab, byHand = false): string {
  const html = (byHand ? "" : stepButtons(state, tab)) + stationTasks(state, [tab as Station]);
  return html || `<p class="muted small">Nothing to do here right now.</p>`;
}

// The step you're on, if it's done here and waits for you (a choice: do it, or cut the corner). A step you do by hand
// with no choice to make shows its hands-on part instead (main.ts).
function stepButtons(state: GameState, tab: Tab): string {
  const step = currentStep(state);
  if (!step || state.employee.task || tabOf(step.type) !== tab || step.type === "respond") return "";
  if (STEP[step.type].hands?.length && !step.alts.length) return "";
  if (isChoice(step)) return `<div class="choices">${taskButton(state, step.req, { primary: true, sub: "Do", key: "Enter" })}${step.alts.map((a) => taskButton(state, a, { sub: "Don't", key: "X" })).join("")}</div>`;
  return `<div class="btns">${taskButton(state, step.req, { primary: true, sub: "Next step", key: "Enter" })}</div>`;
}

// Everything else you could start here (most of it picks a workflow back up, or starts one).
function stationTasks(state: GameState, stations: Station[]): string {
  if (state.workflow) return ""; // you're in the middle of something
  const reqs = stations.flatMap((st) => availableTasks(state, st)).filter((r) => r.type !== "talk");
  if (state.time >= state.closeAt) for (const c of state.customers) if (stations.includes("counter") && canStart(state, { type: "usher_out", customerId: c.id }) === null) reqs.push({ type: "usher_out", customerId: c.id });
  return reqs.length ? `<div class="btns" style="margin-top:8px">${reqs.map((r) => taskButton(state, r)).join("")}</div>` : "";
}

// ---------- notes (the to-do list) ----------

export function notesHtml(state: GameState): string {
  const list = notes(state);
  if (!list.length) return `<p class="muted small">No orders yet.</p>`;
  return list
    .map((n) => {
      const fade = n.done && n.doneAt !== null ? Math.max(0.15, 1 - (state.time - n.doneAt) / NOTE_FADE) : 1;
      return `<div class="note ${n.done ? "done" : ""}" style="opacity:${fade.toFixed(2)}"><div>${esc(n.text)}</div><div class="hint">${esc(n.hint)}</div></div>`;
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
    <p class="muted small">Listen to what each customer wants (tap through what they say, or press Enter), then Do, Don't, or Ignore. Enter orders on the computer exactly as they asked: what you type is what gets made, and it's what your sticky notes say. The tabs at the bottom are the stations. At 5 PM, finish up and go home. Space pauses; 1 to 3 change speed.</p>
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
