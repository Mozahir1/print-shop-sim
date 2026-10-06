// Turns game state into HTML for the panels: the station you're looking at, the tabs, the notes. Pure functions:
// main.ts decides when to call them and wires up the buttons. Buttons carry a task request as JSON in data-req; main.ts starts it.
import type { CounterAction, Customer, GameState, OrderEntry, ShipService, Station, TaskRequest, TaskType } from "../sim/types";
import { SERVICE_LABEL } from "../sim/orders";
import { canStart, currentCustomer, previewTask, sceneOf, STATION, workLeft } from "../sim/sim";
import { availableTasks, DONT, IGNORE } from "../sim/todo";
import { currentStep, isChoice, STEP } from "../sim/workflow";
import { requestLines } from "../sim/dialogue";
import { NOTE_FADE, notes, type NoteDetail } from "../sim/notes";
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

// Today's bad luck, while it needs you: a few words in the top bar (what it means is in the log, and on the Devices app).
export function banner(state: GameState): string | null {
  const e = state.event;
  if (e?.status !== "active") return null;
  return `${eventText(e.kind).title}.`;
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
  if (state.cardReader === "down" || state.wifi.down || state.jobs.some((j) => j.status === "new") || state.messages.some((m) => !m.read && !m.snoozed && m.kind === "web_order")) s.add("computer");
  if (state.customers.some((c) => c.state === "line") || state.copier.status === "broken") s.add("counter");
  return s;
}

// What you're holding: from the step you're on. Empty hands mean you're free.
export function held(state: GameState): string | null {
  const t = state.employee.task;
  if (t) return STEP[t.type].held;
  return currentStep(state)?.data.held ?? null;
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
      const take = `Take the order (${money(q.standard.totalCents)})`;
      return { take, turnAway: "Turn them away" };
    }
  }
}

// What the shop knows (not what they asked for: that's in what they said): price, when it'd be ready, your time.
function quoteLine(state: GameState, c: Customer): string {
  const q = quoteFor(state, c);
  if (!isPrintKind(c.kind) || !q.standard || sceneOf(state, c)) return "";
  const fee = q.standard.serviceFeeCents ? ` (incl. ${money(q.standard.serviceFeeCents)} fee)` : "";
  const ready = q.tomorrow ? `ready tomorrow morning, by ${formatClock(q.morningAt)}` : `ready by ${formatClock(q.standardReadyAt)}`;
  const yours = `about ${formatDuration(q.yourMinutes)} of your time, printer ${formatDuration(q.printMinutes)}`;
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
  return `<div class="choices answers">
    ${btn("take", labels.take, "Do", "Enter", true)}
    ${print && q.rush ? btn("rush", `Take it as a rush (${money(q.rush.totalCents)})`, "Do") : ""}
    ${print && q.selfServeCents !== null ? btn("self_serve", `Send to self-serve (${money(q.selfServeCents)})`, "Do") : ""}
    ${btn("turn_away", labels.turnAway, "Don't", "X")}
    ${btn("ignore", "Ignore them", "Ignore", "I")}
    ${taskButton(state, { type: "ask_again", customerId: c.id }, { label: "What was that?", sub: "Ask" })}
  </div>`;
}

// Who's across the counter: whoever you're serving there, or whoever you're talking to. Nobody steps up while you're
// in the middle of something (a job printing on its own doesn't count): they wait in line until you're free.
export function atCounter(state: GameState): Customer | undefined {
  const front = currentCustomer(state);
  const wf = state.workflow;
  const step = currentStep(state);
  const t = state.employee.task;
  const serving = wf?.customerId !== undefined && tabOf((t ?? step?.req ?? { type: "talk" }).type) === "counter" ? customerById(state, wf.customerId) : undefined;
  if (serving?.state === "waiting") return serving;
  if (front?.state === "talking") return front;
  return wf ? undefined : front;
}

// Everyone in line who isn't at the counter.
export function inLine(state: GameState): Customer[] {
  const at = atCounter(state);
  return state.customers.filter((c) => c.state === "line" && c.id !== at?.id);
}

// The dialogue box: what they say, one line at a time (shown says how many lines are out so far), and your answers.
export function dialogueHtml(state: GameState, shown: number, confirming: string | null): string {
  const front = currentCustomer(state);
  const step = currentStep(state);
  let html = "";
  if (front?.state === "talking" && (!step || step.type === "talk" || step.type === "respond")) {
    const lines = requestLines(state, front);
    const out = lines.slice(0, Math.max(1, shown));
    if (front.said && !lines.includes(front.said) && shown >= lines.length) out.push(front.said); // how they took your answer
    const more = shown < lines.length;
    const cols = out.length > 4 ? " cols" : ""; // (a long request reads in two columns, so the answers fit under it)
    html += `<div class="textbox${cols}" data-act="nextLine"><div class="who">${esc(front.name)}</div>${out.map((l, i) => `<p class="${i === out.length - 1 ? "" : "muted"}">${esc(l)}</p>`).join("")}${more ? `<span class="more">▸ tap</span>` : ""}</div>`;
    if (!more && step?.type === "respond" && !state.employee.task) {
      html += quoteLine(state, front) + answers(state, front, confirming);
      html += `<p class="small muted">Waiting for your answer (${formatDuration(Math.max(0, (front.answerBy ?? state.time) - state.time))}).</p>`;
    }
    return html;
  }
  // Nobody talking: only what you can do here (call the next person, show people out at closing). Nothing to do, no
  // modal: what they say while they wait shows over them (see CounterScene).
  if (front?.state === "line" && !state.workflow) html += `<p>${esc(front.name)} is waiting.</p><div class="btns">${taskButton(state, { type: "talk", customerId: front.id }, { primary: true, label: `Next, please (${front.name})`, key: "Enter" })}</div>`;
  if (state.time >= state.closeAt) {
    const out = state.customers.filter((c) => canStart(state, { type: "usher_out", customerId: c.id }) === null);
    if (out.length) html += `<div class="btns">${out.map((c) => taskButton(state, { type: "usher_out", customerId: c.id })).join("")}</div>`;
    const left = workLeft(state);
    html += `<p class="small ${left.length ? "warn" : "ok"}">${left.length ? `Still to do: ${esc(left.join(", "))}.` : "Everything's done. Go home on time."}</p>`;
  }
  return html;
}

// The register's keypad: what's due, the card or the cash they hand you, and what you've typed.
export function keypadHtml(due: number, cash: number | null, typed: string): string {
  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back"];
  const label = (k: string) => (k === "back" ? "Del" : k);
  return `<div class="display"><div>Due ${money(due)}</div><div>${cash === null ? "Card. Type the total." : `Cash ${money(cash)}. Type the change.`}</div><div class="typed">$ ${esc(typed || "_")}</div></div>
    <div class="keys">${keys.map((k) => `<button class="btn" data-act="key" data-key="${k}">${label(k)}</button>`).join("")}<button class="btn okkey" data-act="key" data-key="ok">OK</button></div>`;
}

// ---------- the computer ----------

const FORM: { field: keyof OrderEntry; label: string; options: [string, string][] }[] = [
  { field: "media", label: "Paper", options: [["letter", "Letter"], ["legal", "Legal"], ["tabloid", "Tabloid 11x17"], ["cardstock", "Cardstock"]] },
  { field: "color", label: "Color", options: [["bw", "B&W"], ["color", "Color"]] },
  { field: "duplex", label: "Sides", options: [["false", "1-sided"], ["true", "2-sided"]] },
  { field: "finishing", label: "Finishing", options: [["none", "None"], ["staple", "Staple"], ["cut", "Cut"], ["laminate", "Laminate"]] },
];

// The order form: blank, filled in from what they said (it's quoted at the top while it's only in their words); or,
// for a web order, filled in already from the website (check it, and enter it). Its HTML only depends on the order,
// so redrawing never wipes what you've picked.
export function orderForm(state: GameState, jobId: number, web?: { messageId: number }): string {
  const job = jobById(state, jobId)!;
  const who = customerById(state, job.customerId);
  const pre = web ? job.spec : undefined;
  const said = !web && who && isPrintKind(who.kind) && who.jobId === job.id ? requestLines(state, who) : [];
  const value = (f: keyof OrderEntry) => (pre ? String(pre[f]) : "");
  const quote = said.length ? `<blockquote class="said">${said.map((l) => `<p>${esc(l)}</p>`).join("")}</blockquote>` : "";
  const submit = web ? `<button type="button" class="btn primary" data-act="webSubmit" data-msg="${web.messageId}">Enter order</button>` : `<button type="button" class="btn primary" data-act="form">Enter order</button>`;
  return `<form class="orderform" data-job="${job.id}"><h2>${web ? "Web order" : "New order"} #${job.id}: ${esc(who?.name ?? "")}, ${esc(job.spec.item)}</h2>${quote}
    <div class="fields"><label class="field"><span>Copies</span><input type="number" name="copies" min="1" max="9999" inputmode="numeric" required value="${value("copies")}"></label>
    ${["color", "duplex", "media", "finishing"]
      .map((k) => FORM.find((f) => f.field === k)!)
      .map((f) => `<fieldset class="field${f.field === "media" || f.field === "finishing" ? " wide" : ""}"><span>${f.label}</span><div class="chips">${f.options.map(([v, l]) => `<label class="chip-opt"><input type="radio" name="${f.field}" value="${v}"${value(f.field) === v ? " checked" : ""}><span>${l}</span></label>`).join("")}</div></fieldset>`)
      .join("")}</div>
    ${submit}</form>`;
}

// The shipping label: the weight you read off the scale and the service they asked for. (Depends only on the
// package, so it never redraws under you.)
export function labelForm(state: GameState, packageId: number): string {
  const services = (Object.keys(SERVICE_LABEL) as ShipService[]).map((s) => `<label class="chip-opt"><input type="radio" name="service" value="${s}"><span>${SERVICE_LABEL[s]}</span></label>`).join("");
  return `<form class="orderform"><h2>Label for package #${packageId}</h2>
    <label class="field"><span>Weight (lb)</span><input type="number" name="weight" min="1" max="150" inputmode="numeric"></label>
    <fieldset class="field"><span>Service</span><div class="chips">${services}</div></fieldset>
    <button type="button" class="btn primary" data-act="form">Print the label</button></form>`;
}

// The step you're on, if it's done here and waits for you (a choice: do it, or cut the corner). A step you do by hand
// with no choice to make shows its hands-on part instead (main.ts).
export function stepButtons(state: GameState, tab: Tab): string {
  const step = currentStep(state);
  if (!step || state.employee.task || tabOf(step.type) !== tab || step.type === "respond") return "";
  if (STEP[step.type].hands?.length && !step.alts.length) return "";
  if (isChoice(step)) return `<div class="choices">${taskButton(state, step.req, { primary: true, sub: "Do", key: "Enter" })}${step.alts.map((a) => taskButton(state, a, { sub: "Don't", key: "X" })).join("")}</div>`;
  return `<div class="btns">${taskButton(state, step.req, { primary: true, sub: "Next step", key: "Enter" })}</div>`;
}

// ---------- notes (the to-do list) ----------

// A note, unfolded: everything about the order, and what's left to do, step by step. Until it's in the computer, the
// details are what they asked for (with what they said); after, what you entered (mistakes and all).
export function noteHtml(state: GameState, d: NoteDetail, here: Tab): string {
  const asked = !d.entered ? requestFor(state, d.jobId) : [];
  const tab = (st: Station): Tab => (st === "self_serve" ? "counter" : st); // (self-serve is out front, by the counter)
  const now = d.steps.find((x) => x.state === "now");
  const go = now && tab(now.station) !== here ? `<button class="btn primary" data-act="tab" data-tab="${tab(now.station)}">Go to ${esc(TABS.find((t) => t.id === tab(now.station))!.label)}</button>` : "";
  return `<h1>${esc(d.item)} for ${esc(d.name)}</h1>
    <p class="small muted">${d.entered ? "What you entered on the computer." : "Not in the computer yet. This is what they asked for."}</p>
    ${asked.length ? `<blockquote>${asked.map((l) => `<p>${esc(l)}</p>`).join("")}</blockquote>` : ""}
    <div class="cols"><div><h2>Details</h2><dl class="spec">${d.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>
    <div><h2>Steps</h2><ol class="steps">${d.steps.map((x) => `<li class="${x.state}"><span class="mark" aria-hidden="true">${x.state === "done" ? "✓" : x.state === "now" ? "▶" : "○"}</span><span class="txt">${esc(x.text)}</span><span class="where">${esc(TABS.find((t) => t.id === tab(x.station))!.label)}</span></li>`).join("")}</ol></div></div>
    <div class="btns">${go}<button class="btn" data-act="closeNote">Got it</button></div>`;
}

// What they said, while the order's only in their words.
function requestFor(state: GameState, jobId: number): string[] {
  const j = jobById(state, jobId);
  const c = j ? customerById(state, j.customerId) : undefined;
  return c && c.jobId === jobId && isPrintKind(c.kind) ? requestLines(state, c) : [];
}

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
