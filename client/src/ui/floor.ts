// The store floor as the main screen. Every interactive thing on the floor is an object with a click target;
// clicking it walks you there and opens a small menu of what you can do at that spot.
import type { Customer, GameState, Vec } from "../sim/types";
import { FINISHING_STATION, PACKAGE_ROOM, PICKUP_SHELF, REGISTER, SHIPPING_SCALE, STOCKROOM, zones } from "../sim/layout";
import { counterCustomer, jobById, lineCustomers, money, quoteDue } from "../sim/sim";
import { sentence } from "../sim/util";
import { FINISHING_VERB, describeQuantity, fullServiceQuote, requestSentence, selfServePriceCents, takeOrderSeconds } from "../sim/orders";
import { formatClock } from "../sim/time";
import { packageById, purposeText, shipQuote, shipSentence } from "../sim/shipping";
import { ringingCalls } from "../sim/phone";
import { carryLabel } from "../sim/hands";
import { KEYS, snapshot, type FinishingSnap } from "../sim/knowledge";
import { actionButton, esc } from "./panel";
import { copierLine, finishingLines, packageRoomLines, panelLine, shelfLines, trayLine } from "./notes";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloorObject {
  id: string;
  label: string;
  rect: Rect;
  spot: Vec; // where you walk to
  body(state: GameState): string; // menu contents
}

const zone = (id: string): Rect => {
  const z = zones.find((z) => z.id === id)!;
  return { x: z.x, y: z.y, w: z.w, h: z.h };
};

export const REGISTER_RECT: Rect = { x: 10.1, y: 4.65, w: 0.8, h: 0.5 };
export const PHONE_RECT: Rect = { x: 11.1, y: 4.65, w: 0.55, h: 0.5 };

export function floorObjects(state: GameState): FloorObject[] {
  const objects: FloorObject[] = [];

  for (const p of state.printers) {
    objects.push({
      id: `printer:${p.id}`,
      label: p.name,
      rect: { x: p.tile.x, y: p.tile.y, w: 2, h: 2 },
      spot: p.station,
      body: (s) => {
        const ink = p.wideSecondsPerSqFt ? "ink" : "toner";
        const known = `<div class="small known">${panelLine(s, p.id)}<br>${p.trays.map((t) => trayLine(s, p.id, t.stock)).join("<br>")}</div>`;
        const items = [
          actionButton(s, { type: "check_panel", printerId: p.id }, "Check the panel"),
          actionButton(s, { type: "check_trays", printerId: p.id }, "Check the trays"),
          actionButton(s, { type: "collect_output", printerId: p.id }, "Collect the output tray", true),
          actionButton(s, { type: "clear_jam", printerId: p.id }, "Clear a jam"),
          ...p.trays.map((t) => {
            const h = s.employee.hands;
            const label = t.stock === "roll" ? "Change the roll" : h?.kind === "paper" ? `Put your ${h.stock} in the ${t.stock} tray` : `Load the ${t.stock} tray`;
            return actionButton(s, { type: "load_paper", printerId: p.id, stock: t.stock }, label);
          }),
          actionButton(s, { type: "replace_toner", printerId: p.id }, `Replace the ${ink}`),
        ];
        return known + list(items);
      },
    });
  }

  for (const cp of state.copiers) {
    objects.push({
      id: `copier:${cp.id}`,
      label: `Self-serve copier ${cp.id}`,
      rect: { x: cp.spot.x - 1.7, y: cp.spot.y - 0.55, w: 1.2, h: 1.1 },
      spot: cp.station,
      body: (s) =>
        `<div class="small known">${copierLine(s, cp.id)}</div>` +
        list([
          actionButton(s, { type: "check_copier", copierId: cp.id }, "Check it"),
          actionButton(s, { type: "fix_copier", copierId: cp.id }, "Clear a jam"),
          actionButton(s, { type: "refill_copier", copierId: cp.id }, "Refill paper"),
        ]),
    });
  }

  objects.push({ id: "register", label: "Register and computer", rect: REGISTER_RECT, spot: REGISTER, body: () => "" }); // opens the computer

  objects.push({
    id: "phone",
    label: "Phone",
    rect: PHONE_RECT,
    spot: REGISTER,
    body: (s) => {
      const calls = ringingCalls(s);
      if (!calls.length) return note("It isn't ringing. Missed calls go to voicemail on the computer.");
      return list(calls.map((c) => actionButton(s, { type: "answer_phone", callId: c.id }, "Answer", true)));
    },
  });

  objects.push({
    id: "counter",
    label: "Counter",
    rect: zone("counter"),
    spot: REGISTER,
    body: (s) => {
      const items = [
        s.employee.hands ? actionButton(s, { type: "set_down" }, "Set down what you're holding") : "",
        ...s.counterItems.map((c, i) => actionButton(s, { type: "pick_up", index: i }, `Pick up ${carryLabel(s, c)}`)),
      ].filter(Boolean);
      return items.length ? list(items) : note("Nothing on the counter.");
    },
  });

  objects.push({
    id: "finishing",
    label: "Finishing table",
    rect: zone("finishing"),
    spot: FINISHING_STATION,
    body: (s) => {
      // You can work on what you know is here, plus whatever you're carrying.
      const h = s.employee.hands;
      const known = snapshot<FinishingSnap>(s, KEYS.finishing)?.data.jobs.map((j) => j.jobId) ?? [];
      const ids = [...new Set([...(h?.kind === "output" ? [h.jobId] : []), ...known])];
      const finish = ids
        .map((id) => jobById(s, id))
        .filter((j) => j && j.status === "printed")
        .map((j) => actionButton(s, { type: "finish_job", jobId: j!.id }, `${FINISHING_VERB[j!.ticket.finishing]}: #${j!.id}, ${describeQuantity(j!.ticket)}`, true));
      return `<div class="small known">${finishingLines(s)}</div>` + list([
        h?.kind === "output" ? actionButton(s, { type: "drop_output" }, `Put down ${carryLabel(s, h)}`) : "",
        ...finish,
        actionButton(s, { type: "check_finishing" }, "Look over the table"),
      ]);
    },
  });

  objects.push({
    id: "shelf",
    label: "Pickup shelf",
    rect: zone("shelf"),
    spot: PICKUP_SHELF,
    body: (s) =>
      `<div class="small known">${shelfLines(s)}</div>` +
      list([
        s.employee.hands?.kind === "bag" ? shelveForm(s) : "",
        actionButton(s, { type: "check_shelf" }, "Check the shelf"),
      ]),
  });

  objects.push({
    id: "scale",
    label: "Shipping scale",
    rect: zone("scale"),
    spot: SHIPPING_SCALE,
    body: (s) => list([actionButton(s, { type: "ship_package" }, "Ship the package at the counter", true)]),
  });

  objects.push({
    id: "package-room",
    label: "Package room",
    rect: zone("package-room"),
    spot: PACKAGE_ROOM,
    body: (s) =>
      `<div class="small known">${packageRoomLines(s)}</div>` +
      list([
        s.employee.hands?.kind === "packages" ? actionButton(s, { type: "stage_packages" }, `Put ${carryLabel(s, s.employee.hands)} in the outbound bin`, true) : "",
        actionButton(s, { type: "scan_package_room" }, "Look over the package room"),
        actionButton(s, { type: "check_in_packages" }, "Check in the delivery"),
        actionButton(s, { type: "hand_off_truck" }, "Hand off to the driver"),
      ]),
  });

  objects.push({ id: "stockroom", label: "Stockroom", rect: zone("stockroom"), spot: STOCKROOM, body: () => "" }); // opens the stockroom view

  return objects;
}

// ---------- talking to customers ----------

export function customerBody(state: GameState, c: Customer): string {
  const atCounter = counterCustomer(state)?.id === c.id;
  if (!atCounter) {
    const place = c.state === "line" ? `In line (${lineCustomers(state).indexOf(c) + 1}${ordinal(lineCustomers(state).indexOf(c) + 1)})` : "Waiting";
    return note(`${esc(c.name)}. ${place}.`);
  }
  const say = (t: string) => `<div class="quote">“${esc(t)}”</div>`;

  switch (c.purpose) {
    case "order": {
      const spec = c.request!.spec;
      const due = quoteDue(state, c, state.time + takeOrderSeconds(spec));
      const t = c.request!.timing;
      const when = due.tomorrow ? "Tomorrow is fine." : t.kind === "wait" ? `I'll wait for it, ${t.minutes} minutes or so?` : `Could I pick it up around ${formatClock(due.dueAt)}?`;
      const q = fullServiceQuote(spec, !due.tomorrow);
      return `${say(`${requestSentence(spec)} ${when}`)}
        <div class="muted small">Full service ${money(q.totalCents)} · self-serve would be ${money(selfServePriceCents(spec))}</div>
        ${list([
          `<button class="btn primary" data-act="openPos">Enter it in the POS</button>`,
          actionButton(state, { type: "usher_self_serve" }, "Send to self-serve"),
          actionButton(state, { type: "turn_away" }, "Turn away"),
        ])}`;
    }
    case "pickup": {
      const job = jobById(state, c.jobId!)!;
      return `${say(sentence(`Hi, I'm here to pick up an order for ${c.name}`))}
        ${list([
          `<button class="btn primary" data-act="openPos">${job.prepaid ? "Hand over their order (POS)" : "Ring them up (POS)"}</button>`,
          actionButton(state, { type: "explain_delay" }, "Tell them it isn't ready"),
        ])}`;
    }
    case "ship": {
      const q = shipQuote(c.ship!);
      return `${say(shipSentence(c.ship!))}<div class="muted small">${money(q.totalCents)}</div>
        ${list([actionButton(state, { type: "ship_package" }, "Ship it", true), actionButton(state, { type: "turn_away" }, "Turn away")])}`;
    }
    case "dropoff":
      return `${say(`Just dropping off ${c.dropoffCount === 1 ? "a prepaid return" : `${c.dropoffCount} prepaid returns`}.`)}
        ${list([actionButton(state, { type: "accept_dropoff" }, "Take the drop-off", true)])}`;
    case "copier_help": {
      const cp = state.copiers.find((x) => x.userId === c.id);
      return `${say(`Copier ${cp?.id ?? ""} stopped in the middle of my copies. Can someone take a look?`)}
        ${list([actionButton(state, { type: "acknowledge_copier" }, "Tell them you'll fix it", true)])}`;
    }
    case "package": {
      const pkg = packageById(state, c.packageId!)!;
      return `${say(sentence(`I got a notice you're holding a package for ${c.name}`))}
        ${list([
          actionButton(state, { type: "release_package" }, "Get their package", true),
          pkg.status === "unsorted" ? actionButton(state, { type: "check_in_packages" }, "Check in the delivery") : "",
        ])}`;
    }
  }
}

// You pick the name to file it under (the ticket's name is the default). Pick the wrong one and it's lost until you search.
function shelveForm(state: GameState): string {
  const h = state.employee.hands as Extract<NonNullable<GameState["employee"]["hands"]>, { kind: "bag" }>;
  const job = jobById(state, h.jobId)!;
  const names = new Map<number, string>();
  for (const j of state.jobs) {
    if (j.status === "picked_up" || j.status === "canceled") continue;
    const c = state.customers.find((x) => x.id === j.customerId);
    if (c) names.set(c.id, c.name);
  }
  const options = [...names.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, name]) => `<option value="${id}" ${id === job.customerId ? "selected" : ""}>${esc(name)}</option>`)
    .join("");
  return `<div class="menu-row"><div class="small">Order #${job.id}. File it under:</div>
    <div class="btns"><select id="shelveName">${options}</select><button class="btn primary" data-act="shelveAs">Shelve it</button></div></div>`;
}

function ordinal(n: number): string {
  return n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
}

function list(items: string[]): string {
  return `<div class="menu-list">${items.filter(Boolean).join("")}</div>`;
}

function note(text: string): string {
  return `<div class="muted small">${text}</div>`;
}

// ---------- hit testing ----------

export type Target = { kind: "object"; id: string } | { kind: "customer"; id: number };

// What's under a point on the floor (in meters). Customers in line come first; they stand in front of things.
export function hitTest(state: GameState, x: number, y: number): Target | null {
  for (const c of state.customers) {
    if (c.state !== "line") continue;
    if (Math.hypot(c.pos.x - x, c.pos.y - y) <= 0.5) return { kind: "customer", id: c.id };
  }
  for (const o of floorObjects(state)) {
    const r = o.rect;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { kind: "object", id: o.id };
  }
  return null;
}

// Where to walk for a target, and what to call it.
export function targetInfo(state: GameState, t: Target): { spot: Vec; label: string; rect: Rect } | null {
  if (t.kind === "customer") {
    const c = state.customers.find((x) => x.id === t.id);
    if (!c || c.state !== "line") return null;
    return { spot: REGISTER, label: `${c.name} · ${purposeText(c)}`, rect: { x: c.pos.x - 0.4, y: c.pos.y - 0.4, w: 0.8, h: 0.8 } };
  }
  const o = floorObjects(state).find((x) => x.id === t.id);
  return o ? { spot: o.spot, label: o.label, rect: o.rect } : null;
}

export function targetBody(state: GameState, t: Target): string {
  if (t.kind === "customer") {
    const c = state.customers.find((x) => x.id === t.id);
    return c ? customerBody(state, c) : "";
  }
  return floorObjects(state).find((x) => x.id === t.id)?.body(state) ?? "";
}

