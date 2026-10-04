// Doing a step by hand. Each step's parts come from the workflow data (tap N things, hold until the bar fills, drag
// an item to a slot, pick the right one, fill in a form, ring up). Nothing here takes skill: big jobs cost time, not
// precision. When every part's done, main.ts starts the step's task with what you did (form values, the bag you
// picked, the total you typed); the sim decides what that leads to.
import type { BoxSize, GameState, ShipService, TaskRequest } from "../sim/types";
import { STEP, type Hand } from "../sim/workflow";
import { canStart, cashGiven } from "../sim/sim";
import { BOX_ORDER, FINISHING_LABEL, SERVICE_LABEL, shipQuote } from "../sim/orders";
import { customerById, jobById, money, packageById } from "../sim/util";
import { esc, orderForm } from "./view";

export const HOLD_MS = 1200;
const MAX_TAPS = 10;

export interface Doing {
  key: string; // which step this is for
  req: TaskRequest; // built up as you go
  parts: Hand[];
  i: number; // the part you're on
  tapped: number; // taps so far on this part
  holdFrom: number | null; // performance.now() when you started holding
  selected: boolean; // drag: the item's picked up (tap a slot, or let go over it)
}

export function stepKey(req: TaskRequest): string {
  return [req.type, req.customerId, req.jobId, req.packageId, req.messageId].join(":");
}

export function hasHands(req: TaskRequest): boolean {
  return (STEP[req.type].hands?.length ?? 0) > 0;
}

export function startDoing(req: TaskRequest): Doing {
  return { key: stepKey(req), req: { ...req }, parts: STEP[req.type].hands ?? [], i: 0, tapped: 0, holdFrom: null, selected: false };
}

// The part, with finishing turned into what it is for this job: a tap per set for a small stapled run, a hold
// otherwise.
function part(state: GameState, d: Doing): Hand {
  const p = d.parts[d.i];
  if (!p.finish) return p;
  const spec = jobById(state, d.req.jobId!)!.spec;
  if (spec.finishing === "staple" && spec.copies <= MAX_TAPS) return { tap: "set to staple", n: spec.copies };
  return { hold: { staple: "Staple the sets", cut: "Cut the stack", laminate: "Laminate it", none: "" }[spec.finishing] };
}

// Moves on a part. Returns true when the whole step's done.
export function advance(d: Doing): boolean {
  d.i++;
  d.tapped = 0;
  d.holdFrom = null;
  d.selected = false;
  return d.i >= d.parts.length;
}

// Called by main.ts for each hand action. Returns "done" (part finished), "step" (whole step finished), an error
// message, or null (still going).
export function act(state: GameState, d: Doing, what: string, value: string | undefined, form: HTMLFormElement | null): "step" | string | null {
  const p = part(state, d);
  switch (what) {
    case "tap":
      if (++d.tapped < (p.n ?? 1)) return null;
      break;
    case "grab":
      d.selected = true;
      return null;
    case "drop":
      if (!d.selected) return "Pick it up first.";
      break;
    case "pick":
      if (p.pick === "box") {
        const err = canStart(state, { ...d.req, box: value as BoxSize }); // it has to fit
        if (err) return err;
        d.req.box = value as BoxSize;
      }
      if (p.pick === "bag") d.req.jobId = Number(value);
      if (p.pick === "package" && Number(value) !== customerById(state, d.req.customerId!)?.packageId) return "That's not theirs.";
      break;
    case "form": {
      const err = readForm(d, p, form);
      if (err) return err;
      break;
    }
    case "pay": {
      const cents = Math.round(Number((form?.elements.namedItem("amount") as HTMLInputElement | null)?.value.replace(/[$,]/g, "")) * 100);
      if (!Number.isFinite(cents) || form?.querySelector<HTMLInputElement>("[name=amount]")?.value.trim() === "") return "Type the amount.";
      if (customerById(state, d.req.customerId!)?.pays === "cash") d.req.change = cents;
      else d.req.amount = cents;
      break;
    }
    case "hold":
      break;
  }
  return advance(d) ? "step" : null;
}

function readForm(d: Doing, p: Hand, form: HTMLFormElement | null): string | null {
  if (!form) return "Fill in the form.";
  const get = (name: string) => (form.elements.namedItem(name) as RadioNodeList | HTMLInputElement | null)?.value ?? "";
  if (p.form === "order") {
    const copies = Number(get("copies"));
    const [media, color, duplex, finishing] = ["media", "color", "duplex", "finishing"].map(get);
    if (!copies || !media || !color || !duplex || !finishing) return "Fill in every field.";
    d.req.entry = { copies, media: media as never, color: color as never, duplex: duplex === "true", finishing: finishing as never };
  } else {
    const weightLb = Number(get("weight"));
    const service = get("service");
    if (!weightLb || !service) return "Fill in the weight and the service.";
    d.req.shipLabel = { weightLb, service: service as ShipService };
  }
  return null;
}

// What's due at the register for this customer.
export function dueCents(state: GameState, customerId: number): number {
  const c = customerById(state, customerId)!;
  if (c.kind === "ship" && c.packageId !== null) {
    const p = packageById(state, c.packageId)!;
    return shipQuote(p.weightLb, p.service!).totalCents;
  }
  return c.jobId !== null ? (jobById(state, c.jobId)?.priceCents ?? 0) : 0;
}

// The part you're on, as HTML.
export function handsHtml(state: GameState, d: Doing, now: number): string {
  const p = part(state, d);
  const finishing = d.req.jobId !== undefined ? FINISHING_LABEL[jobById(state, d.req.jobId)?.spec.finishing ?? "none"] : "";
  const head = `<div class="row"><b>${esc(STEP[d.req.type].hint.replace("{finishing}", finishing))}</b><span class="muted small">${d.i + 1} of ${d.parts.length}</span></div>`;
  return `<div class="hands">${head}${partHtml(state, d, p, now)}</div>`;
}

function partHtml(state: GameState, d: Doing, p: Hand, now: number): string {
  if (p.tap) {
    const n = p.n ?? 1;
    const left = n - d.tapped;
    const targets = Array.from({ length: left }, (_, i) => `<button class="target" style="margin-top:${(i * 37) % 23}px" data-act="hand" data-what="tap">${esc(p.tap!)}</button>`).join("");
    return `<p class="small muted">Tap ${n === 1 ? "it" : `each one (${left} left)`}.</p><div class="targets">${targets}</div>`;
  }
  if (p.hold) {
    const frac = d.holdFrom === null ? 0 : Math.min(1, (now - d.holdFrom) / HOLD_MS);
    return `<button class="btn primary holdbtn" data-hold="1">${esc(p.hold)}<div class="bar"><div style="width:${(frac * 100).toFixed(0)}%"></div></div></button><p class="small muted">Press and hold.</p>`;
  }
  if (p.drag) {
    const pkg = p.drag === "bag" && customerById(state, d.req.customerId ?? -1)?.kind === "package_pickup";
    const item = p.drag === "item" ? "their item" : pkg ? "package" : p.drag;
    return `<div class="dragrow"><button class="dragitem ${d.selected ? "on" : ""}" data-drag="1">${esc(item)}</button><span class="muted">→</span><button class="slot" data-slot="1" data-act="hand" data-what="drop">${esc(p.to!)}</button></div><p class="small muted">Drag it over (or tap it, then tap where it goes).</p>`;
  }
  if (p.pick) return pickHtml(state, d, p.pick);
  if (p.form === "order") return orderForm(state, d.req.jobId!);
  if (p.form === "label") return labelForm(state, d.req.packageId!);
  if (p.pay) return payHtml(state, d);
  return "";
}

function pickHtml(state: GameState, d: Doing, what: NonNullable<Hand["pick"]>): string {
  const opt = (value: string | number, label: string) => `<button class="btn" data-act="hand" data-what="pick" data-value="${value}">${esc(label)}</button>`;
  const first = (id: number) => (customerById(state, id)?.name ?? "").split(" ")[0];
  if (what === "box") return `<p class="small muted">Pick a box.</p><div class="btns">${BOX_ORDER.map((b) => opt(b, `${b[0].toUpperCase()}${b.slice(1)} box`)).join("")}</div>`;
  if (what === "bag") {
    const bags = state.jobs.filter((j) => j.status === "bagged");
    return `<p class="small muted">Find ${esc(customerById(state, d.req.customerId!)?.name ?? "their")}'s bag.</p><div class="btns">${bags.map((j) => opt(j.id, `${first(j.customerId)}, #${j.id}`)).join("") || `<span class="muted">Nothing on the shelf.</span>`}</div>`;
  }
  const held = state.packages.filter((x) => x.kind === "held" && x.status === "held");
  return `<p class="small muted">Find ${esc(customerById(state, d.req.customerId!)?.name ?? "their")}'s package.</p><div class="btns">${held.map((x) => opt(x.id, `Package: ${first(x.customerId)}`)).join("")}</div>`;
}

// The shipping label: read the weight off the scale, and the service they asked for. (HTML depends only on the
// package, so redraws keep what you've typed.)
function labelForm(state: GameState, packageId: number): string {
  const p = packageById(state, packageId)!;
  const services = (Object.keys(SERVICE_LABEL) as ShipService[]).map((s) => `<label class="chip-opt"><input type="radio" name="service" value="${s}"><span>${SERVICE_LABEL[s]}</span></label>`).join("");
  return `<form class="orderform"><p class="scale">Scale: <b>${p.weightLb} lb</b></p>
    <label class="field"><span>Weight (lb)</span><input type="number" name="weight" min="1" max="150" inputmode="numeric"></label>
    <fieldset class="field"><span>Service</span><div class="chips">${services}</div></fieldset>
    <button type="button" class="btn primary" data-act="hand" data-what="form">Print the label</button></form>`;
}

function payHtml(state: GameState, d: Doing): string {
  const c = customerById(state, d.req.customerId!)!;
  const due = dueCents(state, c.id);
  const ask = c.pays === "cash" ? `They hand you <b>${money(cashGiven(due))}</b> cash. Type the change.` : "They hand you a card. Type the total.";
  return `<form class="orderform" data-pay="${c.id}"><p>Total due: <b>${money(due)}</b></p><p class="small">${ask}</p>
    <label class="field"><span>${c.pays === "cash" ? "Change" : "Total"} ($)</span><input type="text" name="amount" inputmode="decimal" autocomplete="off"></label>
    <button type="button" class="btn primary" data-act="hand" data-what="pay">${c.pays === "cash" ? "Give change" : "Charge it"}</button></form>`;
}
