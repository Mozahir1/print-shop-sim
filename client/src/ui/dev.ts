// Dev mode drawer. The controls are built once (so inputs keep their values); the inspector re-renders.
// Open it with ` (backtick). Available in `npm run dev`, or in any build with ?dev in the URL.
import type { GameState, Timing } from "../sim/types";
import { PROFILES, TUNING } from "../sim/config";
import { botAct, createBot, type Bot } from "../sim/bot";
import { lineCustomers, tick, type Sim } from "../sim/sim";
import {
  breakPrinter,
  emptyTray,
  jamCopier,
  finishPrinting,
  finishTask,
  jamPrinter,
  restockAll,
  setToner,
  skipTo,
  spawnCustomer,
  spawnShippingCustomer,
  ringNow,
  truckNow,
  upcoming,
} from "../sim/dev";
import { stagedPackages, unsortedPackages } from "../sim/shipping";
import type { CallKind, ShipService } from "../sim/types";
import { formatClock, formatDuration } from "../sim/time";

export interface DevHooks {
  sim(): Sim;
  setSpeed(speed: number): void;
  refresh(): void;
  toast(msg: string): void;
}

export const dev = {
  enabled: false,
  bot: null as Bot | null,
};

const DEV_SPEEDS = [120, 300, 1200];

let hooks: DevHooks;
const $ = (id: string) => document.getElementById(id)!;

export function initDev(h: DevHooks, enabled: boolean, openNow: boolean): void {
  hooks = h;
  dev.enabled = enabled;
  if (!enabled) return;
  const state = h.sim().state;
  (window as unknown as { sim: Sim }).sim = h.sim(); // poke at it from the console

  const hours = Array.from({ length: Math.round(state.closeAt / 3600) }, (_, i) => (i + 1) * 3600);
  const printerRows = state.printers
    .map(
      (p) => `<div class="dev-row"><b>${p.short}</b>
        <button data-dev="jam" data-printer="${p.id}">Jam</button>
        <button data-dev="finishPrint" data-printer="${p.id}">Finish job</button>
        <button data-dev="toner" data-printer="${p.id}">${p.wideSecondsPerSqFt ? "Ink" : "Toner"} 5%</button>
        <button data-dev="break" data-printer="${p.id}">Break</button>
        ${p.trays.map((t) => `<button data-dev="empty" data-printer="${p.id}" data-stock="${t.stock}">Empty ${t.stock}</button>`).join("")}
      </div>`,
    )
    .join("");

  $("dev").innerHTML = `
    <div class="dev-head"><b>Dev mode</b><button data-dev="close" title="Close (\`)">✕</button></div>
    <p class="small dev-note">Toggle with \` (backtick). Anything that changes the shift marks it as not eligible for the leaderboard.</p>

    <h3>Seed</h3>
    <div class="dev-row">
      <input id="devSeed" type="number" value="${state.seed}" />
      <button data-dev="reseed">Restart with seed</button>
      <button data-dev="randomSeed">Random</button>
    </div>

    <h3>Time</h3>
    <div class="dev-row">${DEV_SPEEDS.map((s) => `<button data-dev="speed" data-speed="${s}">${s}×</button>`).join("")}</div>
    <div class="dev-row">
      <button data-dev="step" data-seconds="60">+1 min</button>
      <button data-dev="step" data-seconds="900">+15 min</button>
      <select id="devSkip">${hours.map((t) => `<option value="${t}">${formatClock(t)}</option>`).join("")}<option value="${state.closeAt + TUNING.overtimeLimit}">End of shift</option></select>
      <button data-dev="skip">Skip to</button>
    </div>

    <h3>Autoplay</h3>
    <div class="dev-row">
      <label><input type="checkbox" id="devBot" autocomplete="off" /> Bot works the shift</label>
      <label>reacts every <input id="devReaction" type="number" min="1" value="10" style="width:56px" /> s</label>
    </div>

    <h3>Customers</h3>
    <div class="dev-row">
      <select id="devProfile">${PROFILES.map((p) => `<option value="${p.id}">${p.name}</option>`).join("")}</select>
      <select id="devTiming">
        <option value="">Profile's timing</option>
        <option value="wait">Waits in store</option>
        <option value="back">Comes back later</option>
        <option value="tomorrow">Tomorrow</option>
      </select>
      <select id="devSelfServe" title="What they do about self-serve, if their job qualifies">
        <option value="">Self-serve: random</option>
        <option value="alone">Goes to self-serve alone</option>
        <option value="with_help">Needs to be shown over</option>
        <option value="full_service">Wants full service</option>
      </select>
    </div>
    <div class="dev-row">
      <label><input type="checkbox" id="devWeb" /> Web order</label>
      <button data-dev="spawn">Send in now</button>
    </div>

    <h3>Shipping</h3>
    <div class="dev-row">
      <select id="devShipKind">
        <option value="ship">Shipper</option>
        <option value="dropoff">Drop-off</option>
        <option value="package">Package pickup</option>
      </select>
      <select id="devShipService">
        <option value="">Random service</option>
        <option value="ground">Ground</option>
        <option value="two_day">Two-day</option>
        <option value="overnight">Overnight</option>
      </select>
      <select id="devShipPacked">
        <option value="">Packed: random</option>
        <option value="yes">Already packed</option>
        <option value="no">Needs a box</option>
      </select>
    </div>
    <div class="dev-row">
      <button data-dev="spawnShip">Send in now</button>
      <button data-dev="truckNow">Truck arrives now</button>
    </div>

    <h3>Phone</h3>
    <div class="dev-row">
      <select id="devCallKind">
        <option value="quote">Price quote</option>
        <option value="status">Order status</option>
        <option value="hours">Store hours</option>
        <option value="rates">Shipping rates</option>
      </select>
      <button data-dev="ring">Ring now</button>
    </div>

    <h3>You</h3>
    <div class="dev-row"><button data-dev="finishTask">Finish current task</button></div>

    <h3>Machines</h3>
    ${printerRows}
    <div class="dev-row">${state.copiers.map((cp) => `<button data-dev="jamCopier" data-copier="${cp.id}">Jam copier ${cp.id}</button>`).join("")}</div>
    <div class="dev-row"><button data-dev="restock">Restock everything</button></div>

    <h3>Inspector</h3>
    <div id="devInspect"></div>
    <div class="dev-row">
      <button data-dev="copy">Copy state JSON</button>
      <button data-dev="console">Log state to console</button>
    </div>`;

  ($("devBot") as HTMLInputElement).checked = false; // the bot never survives a reload, so the box shouldn't either
  $("dev").addEventListener("click", onClick);
  ($("devBot") as HTMLInputElement).addEventListener("change", (e) => setBot((e.target as HTMLInputElement).checked));
  ($("devReaction") as HTMLInputElement).addEventListener("change", () => dev.bot && setBot(true));

  window.addEventListener("keydown", (e) => {
    if (e.key !== "`" || (e.target as HTMLElement).tagName === "INPUT") return;
    e.preventDefault();
    toggleDev();
  });
  if (openNow) toggleDev(true);
}

export function toggleDev(open?: boolean): void {
  const el = $("dev");
  const show = open ?? el.hidden;
  el.hidden = !show;
  document.body.classList.toggle("dev-open", show);
  if (show) updateDev(hooks.sim().state);
}

export function setBot(on: boolean): void {
  const reaction = Math.max(1, Number(($("devReaction") as HTMLInputElement).value) || 10);
  const wasOn = dev.bot !== null;
  dev.bot = on ? createBot(reaction) : null;
  ($("devBot") as HTMLInputElement).checked = on; // keep the box honest (also when stopped from the header)
  const state = hooks.sim().state;
  if (on) {
    state.devUsed = true;
    state.log.push({ time: state.time, text: `[dev] Bot took over (reacts every ${reaction}s).` });
  } else if (wasOn) {
    state.log.push({ time: state.time, text: "[dev] Bot stopped. You're on your own." });
  }
  hooks.refresh();
}

function onClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-dev]");
  if (!el) return;
  const sim = hooks.sim();
  const state = sim.state;
  const d = el.dataset;
  const printer = d.printer ?? "";
  let err: string | null = null;

  switch (d.dev) {
    case "close":
      toggleDev(false);
      return;
    case "reseed":
    case "randomSeed": {
      const seed = d.dev === "reseed" ? Number(($("devSeed") as HTMLInputElement).value) : Math.floor(Math.random() * 1e9);
      const url = new URL(location.href);
      url.searchParams.set("dev", "");
      url.searchParams.set("seed", String(seed));
      location.href = url.toString();
      return;
    }
    case "speed":
      hooks.setSpeed(Number(d.speed));
      break;
    case "step":
      for (let i = 0; i < Number(d.seconds); i++) {
        if (dev.bot) botAct(dev.bot, state, 1);
        tick(sim, 1);
      }
      break;
    case "skip":
      skipTo(sim, Number(($("devSkip") as HTMLSelectElement).value), dev.bot ?? undefined);
      break;
    case "spawn": {
      const timing = ($("devTiming") as HTMLSelectElement).value as Timing["kind"] | "";
      const web = ($("devWeb") as HTMLInputElement).checked;
      if (state.time >= state.closeAt) err = "The store is closed; nobody else is coming in.";
      else if (web && timing === "wait") err = "Web customers can't wait in the store.";
      else {
        const ss = ($("devSelfServe") as HTMLSelectElement).value as "alone" | "with_help" | "full_service" | "";
        spawnCustomer(state, ($("devProfile") as HTMLSelectElement).value, timing || undefined, web, ss || undefined);
      }
      break;
    }
    case "spawnShip": {
      if (state.time >= state.closeAt) {
        err = "The store is closed; nobody else is coming in.";
        break;
      }
      const kind = ($("devShipKind") as HTMLSelectElement).value as "ship" | "dropoff" | "package";
      const service = ($("devShipService") as HTMLSelectElement).value as ShipService | "";
      const packed = ($("devShipPacked") as HTMLSelectElement).value;
      spawnShippingCustomer(state, kind, { service: service || undefined, packed: packed ? packed === "yes" : undefined });
      break;
    }
    case "truckNow":
      err = truckNow(state);
      break;
    case "ring":
      ringNow(state, ($("devCallKind") as HTMLSelectElement).value as CallKind);
      break;
    case "finishTask":
      err = finishTask(state);
      break;
    case "jam":
      jamPrinter(state, printer);
      break;
    case "finishPrint":
      err = finishPrinting(state, printer);
      break;
    case "toner":
      setToner(state, printer, 5);
      break;
    case "empty":
      emptyTray(state, printer, d.stock as never);
      break;
    case "restock":
      restockAll(state);
      break;
    case "break":
      breakPrinter(state, printer);
      break;
    case "jamCopier":
      jamCopier(state, Number(d.copier));
      break;
    case "copy":
      navigator.clipboard.writeText(JSON.stringify(state, null, 2)).then(
        () => hooks.toast("Copied the full game state."),
        () => hooks.toast("Couldn't access the clipboard. Use 'Log state to console' instead."),
      );
      return;
    case "console":
      console.log("game state", structuredClone(state));
      hooks.toast("Logged to the browser console. The live sim is also on window.sim.");
      return;
  }
  if (err) hooks.toast(err);
  hooks.refresh();
}

// ---------- inspector ----------

let lastHtml = "";
export function updateDev(state: GameState): void {
  if (!dev.enabled || $("dev").hidden) return;
  const html = renderInspector(state);
  if (html === lastHtml) return;
  lastHtml = html;
  $("devInspect").innerHTML = html;
}

function renderInspector(state: GameState): string {
  const t = state.employee.task;
  const next = upcoming(state, 8);
  const line = lineCustomers(state);
  const seated = state.customers.filter((c) => c.state === "seated");

  const rows = (items: string[], empty: string) => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : `<div class="dev-dim">${empty}</div>`);

  return `
    <div class="dev-kv">
      <span>Sim time</span><span>${Math.floor(state.time)}s (${formatClock(state.time)})</span>
      <span>Seed</span><span>${state.seed}</span>
      <span>Leaderboard</span><span>${state.devUsed ? "not eligible (dev used)" : "eligible"}</span>
      <span>Bot</span><span>${dev.bot ? `on, ${dev.bot.reactionTime}s` : "off"}</span>
      <span>Your task</span><span>${t ? `${t.type} ${Math.floor(t.elapsed)}/${Math.round(t.duration)}s` : "none"}</span>
      <span>Customers today</span><span>${state.customers.length}</span>
      <span>Truck</span><span>${state.truck.status}, ${stagedPackages(state).length} staged, ${unsortedPackages(state).length} unsorted</span>
    </div>
    <h4>Next up</h4>
    ${rows(
      next.map((n) => (n.customer ? `${formatClock(n.at)} · ${n.customer.name} ${n.what} <span class="dev-dim">(${n.customer.profileId})</span>` : `${formatClock(n.at)} · ${n.what}`)),
      "Nobody else today.",
    )}
    <h4>Line patience left</h4>
    ${rows(
      line.map((c) => `${c.name}: ${c.waitStart === null ? "being helped" : formatDuration(c.linePatience - (state.time - c.waitStart))}`),
      "Line is empty.",
    )}
    <h4>Seated, leaves at</h4>
    ${rows(seated.map((c) => `${c.name} (order #${c.jobId}): ${formatClock(c.seatedUntil!)}`), "Nobody waiting.")}
    <h4>Printers</h4>
    ${rows(
      state.printers.map(
        (p) =>
          `${p.short}: ${p.status}, job ${p.currentJobId ?? "–"}, queue [${p.queue.join(", ")}], next jam in ~${Math.round(p.sheetsUntilJam)} sheets, toner ${p.toner.toFixed(1)}%`,
      ),
      "",
    )}`;
}
