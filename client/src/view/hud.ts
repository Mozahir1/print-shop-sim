// The HUD: real DOM over the canvas, in the regions from layout.ts. The top bar (clock, manager, what you're doing,
// what's next), the right rail (sticky notes), the bottom bar (station tabs, speed), and over the stage, one modal at
// a time (a screen, or the station's dialogue, form, or keypad), short messages, and tooltips.
import { canGoHome, workLeft } from "../sim/sim";
import { managerMood } from "../sim/failures";
import { formatClock } from "../sim/time";
import { STEP, workflowSteps, WORKFLOWS } from "../sim/workflow";
import { customerById } from "../sim/util";
import { noteDetail, notes, NOTE_FADE } from "../sim/notes";
import type { GameState } from "../sim/types";
import { attention, banner, esc, inLine, noteHtml, tabOf, TABS, type Tab } from "../ui/view";
import { choreNow } from "../sim/todo";
import { currentThought } from "../sim/thoughts";
import { devPanel } from "../ui/dev";
import { ART, H, REGION, W, type Region } from "./layout";
import { SPEEDS } from "./config";
import { ctl, nextHint, quiet } from "./run";
import { SPRITES } from "./assets";
import { held } from "../ui/view";
import type Phaser from "phaser";

const $ = (id: string) => document.getElementById(id)!;

// Station tab icons (simple line drawings, 24x24).
const ICON: Record<Tab, string> = {
  counter: '<path d="M4 17h16M6 17a6 6 0 0 1 12 0M12 8v3M10 8h4"/>',
  computer: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M9 20h6M12 16v4"/>',
  printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1"/><path d="M7 14h10v7H7z"/>',
  finishing: '<path d="M3 10h14l4 3H3zM3 16h18"/><path d="M8 16v3M16 16v3"/>',
  shipping: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  shelf: '<path d="M7 8V6a5 5 0 0 1 10 0v2"/><path d="M4 8h16l-1 13H5z"/>',
};

let u = 1; // CSS pixels per layout pixel

// Lays the HUD over the canvas: the root font size makes 1rem 20 layout pixels, and each region is placed from the
// layout in real CSS pixels.
export function place(canvas: HTMLCanvasElement): void {
  const r = canvas.getBoundingClientRect();
  if (!r.width) return;
  u = r.width / W;
  document.documentElement.style.fontSize = `${20 * u}px`;
  Object.assign($("hud").style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${(H * u).toFixed(2)}px` });
  for (const [name, g] of Object.entries(REGION)) {
    Object.assign($(name).style, { left: `${g.x * u}px`, top: `${g.y * u}px`, width: `${g.w * u}px`, height: `${g.h * u}px` });
  }
}

export function scale(): number {
  return u;
}

export function regionEl(name: Region): HTMLElement {
  return $(name);
}

// ---------- what you're holding ----------

let textures: Phaser.Textures.TextureManager | null = null;
const pictures = new Map<string, string>();

// A sprite's picture as an image URL, for the DOM (the top bar, and the thing following your pointer).
function picture(key: string): string {
  if (!pictures.has(key) && textures?.exists(key)) pictures.set(key, textures.getBase64(key) as string);
  return pictures.get(key) ?? "";
}

let pointer = { x: 0, y: 0 }; // where the pointer is, in CSS pixels from the HUD's corner
function follow(e: PointerEvent): void {
  const r = $("hud").getBoundingClientRect();
  pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  if (ctl.carry) Object.assign($("ghost").style, { left: `${pointer.x}px`, top: `${pointer.y}px` });
}

export function build(game: Phaser.Game): void {
  textures = game.textures;
  document.addEventListener("pointermove", follow);
  document.addEventListener("pointerdown", follow, true);
  $("tabs").innerHTML = TABS.map((t) => `<button class="tab" data-act="tab" data-tab="${t.id}" id="tab-${t.id}">${t.id === "counter" ? `<span class="badge" id="lineBadge" hidden></span>` : ""}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[t.id]}</svg><span>${t.label}</span></button>`).join("");
  $("speed").innerHTML = `<button class="btn" data-act="pause" id="pauseBtn">Pause</button>${SPEEDS.map((n, i) => `<button class="btn" data-act="speed" data-speed="${n}">${["1x", "2x", "4x"][i]}</button>`).join("")}`;
}

// ---------- modals: one at a time, over the stage ----------

const boxes = new Map<HTMLElement, { tab: Tab; html: string }>();

// A station's modal box (its dialogue, form, or keypad). It's shown while you're at that station and it has something
// in it, and redrawn only when what it shows changes (so a form never loses what you've typed).
export function modalBox(tab: Tab, cls: string): ((html: string, as?: string) => void) & { el: HTMLElement } {
  const el = document.createElement("div");
  el.className = `modal-box ${cls}`;
  el.hidden = true;
  $("modal").append(el);
  boxes.set(el, { tab, html: "" });
  const set = (html: string, as = cls) => {
    const b = boxes.get(el)!;
    if (html === b.html) return;
    b.html = html;
    el.className = `modal-box ${as}`; // (the counter's box is the dialogue, or the keypad)
    el.innerHTML = html;
  };
  return Object.assign(set, { el });
}

// Where the modal that's up sits, in layout pixels from the stage's corner (so things on the stage can keep clear of it).
export function modalRect(): { x: number; y: number; w: number; h: number } | null {
  const box = [...document.querySelectorAll<HTMLElement>("#modal .modal-box")].find((el) => !el.hidden);
  if (!box) return null;
  const r = box.getBoundingClientRect();
  const st = $("stage").getBoundingClientRect();
  return { x: (r.left - st.left) / u, y: (r.top - st.top) / u, w: r.width / u, h: r.height / u };
}

// A part of a modal box, redrawn only when it changes (so the computer's badges never redraw a form you're typing in).
export function modalPart(box: HTMLElement, selector: string, html: string): void {
  const el = box.querySelector<HTMLElement>(selector);
  if (!el || el.dataset.html === html) return;
  el.dataset.html = html;
  el.innerHTML = html;
}

// What's up, in order: a screen (start, report), the note you opened, or the station's own.
function showModals(): void {
  $("screen").hidden = !ctl.screen;
  const note = !ctl.screen && ctl.note !== null && ctl.sim ? noteDetail(ctl.sim.state, ctl.note) : null;
  if (ctl.note !== null && !note) ctl.note = null;
  $("note").hidden = !note;
  if (note) put("note", noteHtml(ctl.sim!.state, note, ctl.tab));
  let shown = !!note;
  for (const [el, b] of boxes) {
    const show = !ctl.screen && !shown && b.tab === ctl.tab && !!b.html;
    if (show) shown = true;
    if (el.hidden === show) el.hidden = !show;
  }
}

// ---------- messages and tooltips ----------

function flashIn(id: string, msg: string, ms: number, timers: Record<string, number>): void {
  const el = $(id);
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(timers[id]);
  timers[id] = window.setTimeout(() => el.classList.remove("show"), ms);
}
const timers: Record<string, number> = {};

export function toast(msg: string): void {
  flashIn("toast", msg, 1900, timers);
}

export function failure(msg: string): void {
  flashIn("flash", msg, 4000, timers);
}

// A name over a thing on the stage, at (x, y) in layout pixels from the stage's corner.
export function tooltip(text: string | null, x = 0, y = 0): void {
  const el = $("tooltip");
  el.hidden = !text;
  if (!text) return;
  el.textContent = text;
  // (Centered over it, but never off the edge.)
  const half = el.offsetWidth / 2 + 4;
  const room = (el.offsetParent as HTMLElement | null)?.clientWidth ?? Infinity;
  Object.assign(el.style, { left: `${Math.max(half, Math.min(x * u, room - half))}px`, top: `${y * u}px` });
}

// ---------- every frame ----------

const last: Record<string, string> = {};
function put(id: string, html: string): void {
  if (last[id] === html) return;
  last[id] = html;
  $(id).innerHTML = html;
}
function toggle(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function update(time: number, bellUntil: number): void {
  showModals();
  const sim = ctl.sim;
  if (!sim) {
    toggle($("homeBtn"), "ghost", true);
    toggle($("walkBtn"), "ghost", true);
    return;
  }
  const s = sim.state;
  put("clock", `Day ${s.day} · ${formatClock(s.time)}${s.time >= s.closeAt ? " (closed)" : ""}`);
  put("mood", `Manager: <b>${esc(managerMood(s.manager.heat))}</b>`);
  put("crew", crewLine(s));
  put("doing", doingLine(s));
  const next = nextHint();
  const away = !!next && next.tab !== ctl.tab;
  const t = s.employee.task;
  put("next", next ? (away ? `Next: go to ${esc(tabName(next.tab))}. ${esc(next.text)}` : `Next: ${esc(next.text)}`) : t ? `Busy ${esc(STEP[t.type].doing)}...` : quiet(s) ? "Quiet. Time flies." : "");
  holdingBox(s);
  const b = banner(s);
  $("banner").hidden = !b;
  if (b) put("banner", esc(b));
  const home = canGoHome(s) === null;
  toggle($("homeBtn"), "ghost", !home);
  toggle($("homeBtn"), "on", home && !workLeft(s).length);
  toggle($("walkBtn"), "ghost", !s.workflow);
  toggle($("walkBtn"), "on", ctl.confirming?.key === "abandon");
  // Tabs: where you are, and where you're needed. In the middle of something, only where its next step is (and the
  // counter, when the bell's just gone); otherwise everywhere something's waiting.
  const pulse = s.workflow && next ? new Set<Tab>([next.tab]) : attention(s);
  const chore = s.workflow ? choreNow(s) : undefined; // (a quick chore you could put the job down for)
  if (chore) pulse.add(tabOf(chore.req.type));
  if (time < bellUntil) pulse.add("counter");
  for (const t of TABS) {
    const el = $(`tab-${t.id}`);
    toggle(el, "on", t.id === ctl.tab);
    toggle(el, "pulse", t.id !== ctl.tab && pulse.has(t.id));
  }
  // How many are waiting in line, on the Counter tab (you can see it from anywhere).
  const waiting = inLine(s).length;
  $("lineBadge").hidden = !waiting;
  if (waiting) put("lineBadge", String(waiting));
  $("lineBadge").title = `${waiting} waiting in line`;
  toggle($("pauseBtn"), "on", ctl.paused);
  put("pauseBtn", ctl.paused ? "Paused" : "Pause");
  document.querySelectorAll<HTMLElement>("#speed [data-speed]").forEach((el) => toggle(el, "on", !ctl.paused && ctl.speed === Number(el.dataset.speed)));
  rail(s);
  if (!$("dev").hidden) put("dev", devPanel(sim, ctl.game!, ctl.bot?.style ?? null));
}

function tabName(t: Tab): string {
  return TABS.find((x) => x.id === t)!.label;
}

// What you're holding, in the top bar: what you've picked up (tap it to put it back), or what the step you're on
// has you holding. And what you've picked up follows the pointer.
function holdingBox(s: GameState): void {
  const c = ctl.carry;
  // (Not while you're about to pick it up, or typing on a form or the register.)
  const d = ctl.doing;
  const p = d?.parts[d.i];
  const reaching = !!p && ((!!p.drag && !c) || !!p.pick || !!p.form || !!p.pay);
  const key = c ? c.texture : held(s) && !reaching ? `item/${held(s)}` : null;
  const el = $("holding");
  el.hidden = !key;
  toggle(el, "carry", !!c);
  if (key) put("holding", `<img src="${picture(key)}" alt=""><span><span class="what">Holding: <b>${esc(SPRITES[key]?.label ?? "")}</b></span>${c ? `<small>Tap to put it back</small>` : ""}</span>`);
  const ghost = $("ghost") as HTMLImageElement;
  ghost.hidden = !c;
  if (c && ghost.dataset.key !== c.texture) {
    ghost.dataset.key = c.texture;
    ghost.src = picture(c.texture);
    const [w, h] = SPRITES[c.texture]?.size ?? [28, 28];
    Object.assign(ghost.style, { width: `${w * ART * u}px`, height: `${h * ART * u}px`, left: `${pointer.x}px`, top: `${pointer.y}px` });
  }
  if (!c) delete ghost.dataset.key;
}

// "Working with: Brody (at the printer)"
const WHERE: Record<string, string> = { missing: "missing", counter: "at the counter", computer: "at the computer", printer: "at the printer", finishing: "at the finishing table", shipping: "at shipping", shelf: "at the pickup shelf", self_serve: "at self-serve", break: "on break", gone: "gone home" };
function crewLine(s: GameState): string {
  const cw = s.coworker;
  if (!cw) return "";
  $("crew").title = cw.task ? cw.task.what : "";
  return `Working with: <b>${esc(cw.name)}</b> (${WHERE[cw.at] ?? ""})`;
}

// What's going on by itself while your hands are free: " Order #3 is printing."
function background(s: GameState): string {
  const on: string[] = [];
  if (s.printer.status === "printing" && s.printer.currentJobId !== null) on.push(`order #${s.printer.currentJobId} printing`);
  if (s.machines.cards.currentJobId !== null) on.push(`order #${s.machines.cards.currentJobId}'s cards`);
  if (s.machines.wide.currentJobId !== null) on.push(`order #${s.machines.wide.currentJobId} on the wide-format printer`);
  if (s.cardReader === "restarting") on.push("the card reader restarting");
  if (s.wifi.restarting) on.push("the router restarting");
  return on.length ? ` <span class="muted">Meanwhile: ${esc(on.join(", "))}.</span>` : "";
}

// "Helping Dana: Take an order, step 3 of 4"
function doingLine(s: GameState): string {
  const wf = s.workflow;
  if (!wf) return s.employee.task ? "Busy." : `Hands free.${background(s)}`;
  const steps = workflowSteps(s, wf);
  const at = Math.max(0, steps.findIndex((x) => !x.done));
  const who = wf.customerId !== undefined ? customerById(s, wf.customerId)?.name : undefined;
  const what = `${WORKFLOWS[wf.kind].label}, step ${Math.min(at + 1, steps.length)} of ${steps.length}`;
  const after = s.setAside ? ` <span class="muted">(then back to ${esc(WORKFLOWS[s.setAside.kind].label.toLowerCase())})</span>` : "";
  return (who ? `Helping <b>${esc(who)}</b>: ${esc(what)}` : `<b>${esc(what)}</b>`) + after;
}

// The sticky notes: up to 4, as many as fit, then "+N more". And the last few things that happened.
function rail(s: GameState): void {
  // What your coworker's asking, and what you're thinking.
  const r = s.request;
  const rq = $("request");
  rq.hidden = !r;
  if (r) {
    const name = s.coworker?.name ?? "";
    const left = Math.max(1, Math.ceil(r.until - s.time));
    put("request", `<div class="from">${esc(name)} asks</div><p>${esc(r.text)}</p><div class="btns"><button class="btn primary" data-act="crewAnswer" data-choice="do">${esc(r.do)}</button><button class="btn" data-act="crewAnswer" data-choice="dont">${esc(r.dont)}</button><button class="btn" data-act="crewAnswer" data-choice="ignore">Ignore</button></div><div class="small">Goes away in ${left} min.</div>`);
  }
  const t = currentThought(s);
  $("thought").hidden = !t;
  if (t) put("thought", esc(t));
  const list = notes(s);
  // A page of notes at a time: as many as fit, from the one you paged to. (Back to the top when the notes change.)
  const ids = list.map((n) => n.jobId).join(",");
  if (ids !== last.noteIds) {
    last.noteIds = ids;
    ctl.notesFrom = 0;
  }
  const from = ctl.notesFrom < list.length ? ctl.notesFrom : 0;
  const html = list.length
    ? list
        .slice(from, from + 4)
        .map((n) => {
          const fade = n.done && n.doneAt !== null ? Math.max(0.35, 1 - (s.time - n.doneAt) / NOTE_FADE) : 1;
          const open = ctl.note === n.jobId ? " open" : "";
          return `<button class="note${n.done ? " done" : ""}${open}" data-act="note" data-job="${n.jobId}" style="opacity:${fade.toFixed(2)}" aria-label="Open the note for order ${n.jobId}"><div>${esc(n.text)}</div><div class="hint">${esc(n.hint)}</div></button>`;
        })
        .join("")
    : `<div class="note empty">No orders yet.</div>`;
  const recent = s.log.slice(-2).reverse().map((e) => `<div><time>${formatClock(e.time)}</time>${esc(e.text)}</div>`).join("");
  const extra = `${r?.id ?? ""}|${t ?? ""}|${from}`; // (the request card and the thought take room from the notes)
  if (last.notes === html && last.recent === recent && last.railExtra === extra) return;
  last.railExtra = extra;
  put("notes", html);
  put("recent", recent);
  // Drop notes from the bottom until the rest fit (nothing's ever cut off). The rest are a tap away.
  const box = $("notes");
  const kids = [...box.children] as HTMLElement[];
  for (const k of kids) k.hidden = false;
  for (let i = kids.length - 1; i > 0 && box.scrollHeight > box.clientHeight + 1; i--) kids[i].hidden = true;
  const shown = kids.filter((k) => !k.hidden).length;
  const after = list.length - from - shown;
  const more = after > 0 ? `<button class="morebtn" data-act="moreNotes" data-from="${from + shown}">+${after} more ▸</button>` : from > 0 ? `<button class="morebtn" data-act="moreNotes" data-from="0">Back to the first notes ▴</button>` : "";
  put("more", more);
}
