// Dev mode drawer (backtick): the true state the player never sees, and buttons to make things happen.
import type { Sim } from "../sim/sim";
import type { Game } from "../sim/game";
import { BOT_STYLES, type BotStyle } from "../sim/bot";
import type { EventKind } from "../sim/types";
import { DIRECTOR, HEAT } from "../sim/config";
import { activeCount } from "../sim/todo";
import { formatClock } from "../sim/time";
import { currentStep } from "../sim/workflow";
import { esc } from "./view";
import { SKIP_LABELS, type SkipTo } from "../sim/dev";

export const EVENT_KINDS: EventKind[] = ["printer_jam", "copier_dies", "card_reader_down", "box_rips", "wifi_drop"];
export const SPAWN_KINDS = ["quick_copies", "large_job", "poster", "business_cards", "large_format", "ship", "dropoff", "package_pickup", "self_serve_help", "web_order"] as const;

export function devPanel(sim: Sim, game: Game, bot: BotStyle | null): string {
  const s = sim.state;
  const m = s.manager;
  const d = s.director;
  const e = s.event;
  const flags = m.flags.length ? m.flags.map((f) => `${f.kind} (${f.name}) day ${f.dueDay} at ${formatClock(f.dueAt)}`).join("\n") : "none";
  const btn = (act: string, label: string, data = "") => `<button class="btn" data-act="${act}" ${data}>${esc(label)}</button>`;
  return `<div class="row"><h2>Dev mode</h2>${btn("closeDev", "×")}</div>
    <section><h2>True state</h2><pre>${esc(
      [
        `heat ${Math.round(m.heat)} / 100 (warning at ${HEAT.warnAt}, write-up at ${HEAT.writeUpAt})`,
        `heat today: complaints ${m.heatBy.complaints}, ignoring ${m.heatBy.ignoring}, lost sales ${m.heatBy.lost_sales}`,
        `write-ups ${game.writeUps} · complaints today ${m.complaints}`,
        `active things ${activeCount(s)} (band ${DIRECTOR.floor} to ${DIRECTOR.ceiling}) · arrivals ${d.arrivals} (${DIRECTOR.perDay.join(" to ")}), work ${d.spent}/${d.budget} min`,
        `next arrival ${formatClock(d.nextAt)}${d.enabled ? "" : " (held)"}`,
        `bad luck: ${e ? `${e.kind}, ${e.status}, due ${formatClock(e.at)}` : "none today"}`,
        `workflow: ${s.workflow ? `${s.workflow.kind} (next: ${currentStep(s)?.type ?? "none"})` : "none"}`,
        `failures today: ${s.failures.length}`,
        `printer paper runs out after ${s.printer.paperOutAt === Infinity ? "never" : Math.round(s.printer.paperOutAt) + " sheets"} (${Math.round(s.printer.sheetsToday)} so far)`,
        `truck ${s.truck.status}, due ${formatClock(s.truck.arrivesAt)}`,
        `flags:\n${flags}`,
        `visits due: ${m.visitsDue.map((v) => v.name).join(", ") || "none"}`,
      ].join("\n"),
    )}</pre></section>
    <section><h2>Bot</h2><div class="btns">${BOT_STYLES.map((st) => `<button class="btn ${bot === st ? "primary" : ""}" data-act="bot" data-style="${st}">${st}</button>`).join("")}${btn("bot", "off", 'data-style=""')}</div></section>
    <section><h2>Skip to</h2><div class="btns">${(Object.keys(SKIP_LABELS) as SkipTo[]).map((k) => btn("skipTo", SKIP_LABELS[k], `data-to="${k}"`)).join("")}</div><p class="muted small">The clock runs ahead until it gets there (people in line still lose patience on the way).</p></section>
    <section><h2>Time</h2><div class="btns">${btn("speed", "10×", 'data-speed="15"')}${btn("speed", "30×", 'data-speed="45"')}${btn("skipDay", "Skip to end of day")}${btn("arrivals", d.enabled ? "Hold arrivals" : "Resume arrivals")}</div></section>
    <section><h2>Bad luck</h2><div class="btns">${EVENT_KINDS.map((k) => btn("event", k.replace(/_/g, " "), `data-kind="${k}"`)).join("")}</div></section>
    <section><h2>Send in</h2><div class="btns">${SPAWN_KINDS.map((k) => btn("spawn", k.replace(/_/g, " "), `data-kind="${k}"`)).join("")}</div></section>
    <section><h2>State</h2><div class="btns">${btn("copyState", "Copy state as JSON")}</div><p class="muted small">Also: window.sim, window.game in the console.</p></section>`;
}
