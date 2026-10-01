// The computer at the register. It only knows what's been entered into it: orders and their payment, what was sent to
// which printer, labels it printed, messages and voicemails. It doesn't know what's physically printed, bagged, or
// shelved. Every app view is a snapshot taken when you open or refresh it.
import type { AppId, Computer, Customer, GameState, Job, JobSpec, Message, Printer, Task, TaskRequest } from "./types";
import { COMPUTER } from "./config";
import { REGISTER } from "./layout";
import { describeQuantity, describeSpecs, stockFor } from "./orders";
import { formatClock } from "./time";
import { callById, CALL_LABEL } from "./phone";
import { observe, snapshot, type Snapshot } from "./knowledge";
import { customerById, jobById, log, money } from "./util";

export const APP_LABEL: Record<AppId, string> = {
  pos: "POS / Orders",
  inbox: "Inbox",
  printserver: "Print server",
  shipping: "Shipping",
  voicemail: "Voicemail",
};

export function createComputer(): Computer {
  return { app: null, messages: [], voicemails: [], labels: [], nextMessageId: 1 };
}

// ---------- what each app shows (snapshots) ----------

export type PosStatus = "ordered" | "sent to printer" | "paid";

export interface PosView {
  orders: { jobId: number; name: string; status: PosStatus; due: string; totalCents: number; prepaid: boolean; channel: Job["channel"] }[];
}

export interface InboxView {
  messages: { id: number; kind: Message["kind"]; subject: string; read: boolean; replied: boolean; at: number }[];
}

export interface PrintServerView {
  printers: { id: string; name: string; code: string; current: { jobId: number; name: string } | null; queue: { jobId: number; name: string }[] }[];
}

export interface ShippingView {
  labels: { packageId: number; name: string; service: string; weightLb: number; at: number }[];
  pickup: string;
}

export interface VoicemailView {
  voicemails: { id: number; from: string; number: string; about: string; at: number; calledBack: boolean }[];
}

export const appKey = (app: AppId) => `app:${app}`;

// What the system shows for a printer: an error code, never a paper level or toner percentage.
export function errorCode(p: Printer): string {
  switch (p.status) {
    case "jammed":
      return "Error: paper jam";
    case "out_of_paper": {
      const empty = p.trays.find((t) => t.level < 1);
      return `Error: paper out${empty ? ` (${empty.stock === "roll" ? "roll" : `${empty.stock} tray`})` : ""}`;
    }
    case "out_of_toner":
      return `Error: ${p.wideSecondsPerSqFt ? "ink" : "toner"} out`;
    case "needs_service":
      return "Error: service required";
    case "output_full":
      return "Error: output tray full";
    case "printing":
    case "warming_up":
      return "Printing";
    case "idle":
      return "Ready";
  }
}

// The POS knows an order was taken, whether it was sent to a printer, and whether it's paid. Nothing physical.
export function posStatus(job: Job): PosStatus {
  if (job.status === "picked_up") return "paid";
  if (job.status === "unsent") return "ordered";
  return "sent to printer";
}

export function snapshotApp(state: GameState, app: AppId): Snapshot {
  const name = (j: Job) => customerById(state, j.customerId)?.name ?? "?";
  switch (app) {
    case "pos":
      return observe<PosView>(state, appKey(app), {
        orders: state.jobs
          .filter((j) => j.status !== "canceled" && (j.channel === "counter" || j.opened))
          .map((j) => ({
            jobId: j.id,
            name: name(j),
            status: posStatus(j),
            due: j.dueTomorrow ? "tomorrow" : formatClock(j.dueAt),
            totalCents: j.priceCents,
            prepaid: j.prepaid,
            channel: j.channel,
          })),
      });
    case "inbox":
      return observe<InboxView>(state, appKey(app), {
        messages: state.computer.messages.map((m) => ({ id: m.id, kind: m.kind, subject: m.subject, read: m.read, replied: m.replied, at: m.at })),
      });
    case "printserver":
      return observe<PrintServerView>(state, appKey(app), {
        printers: state.printers.map((p) => ({
          id: p.id,
          name: p.name,
          code: errorCode(p),
          current: p.currentJobId !== null ? { jobId: p.currentJobId, name: name(jobById(state, p.currentJobId)!) } : null,
          queue: p.queue.map((id) => ({ jobId: id, name: name(jobById(state, id)!) })),
        })),
      });
    case "shipping":
      return observe<ShippingView>(state, appKey(app), {
        labels: state.computer.labels.map((l) => ({ packageId: l.packageId, name: l.name, service: l.service, weightLb: l.weightLb, at: l.at })),
        pickup: `Carrier pickup today at ${formatClock(state.truck.arrivesAt)}.`,
      });
    case "voicemail":
      for (const v of state.computer.voicemails) v.heard = true;
      return observe<VoicemailView>(state, appKey(app), {
        voicemails: state.computer.voicemails.map((v) => ({ id: v.id, from: v.from, number: v.number, about: CALL_LABEL[v.about], at: v.at, calledBack: v.calledBack })),
      });
  }
}

export function appView<T>(state: GameState, app: AppId): Snapshot<T> | undefined {
  return snapshot<T>(state, appKey(app));
}

// Switching to another app first takes a few seconds; it's already up if it's the one on screen.
export function appSwitchSeconds(state: GameState, app: AppId): number {
  return state.computer.app === app ? 0 : COMPUTER.openAppSeconds;
}

// ---------- inbox ----------

export function deliverWebOrder(state: GameState, job: Job, c: Customer): void {
  const due = job.dueTomorrow ? "tomorrow" : formatClock(job.dueAt);
  state.computer.messages.push({
    id: state.computer.nextMessageId++,
    kind: "web_order",
    at: state.time,
    customerId: c.id,
    jobId: job.id,
    subject: `Web order from ${c.name}`,
    body: `${describeQuantity(job.ticket)}. ${describeSpecs(job.ticket)}. Pickup: ${due}. Paid online: ${money(job.priceCents)}.`,
    read: false,
    replied: false,
  });
}

// Online customers write in to check on their order a while before they're due to pick it up.
export function runInbox(state: GameState): void {
  for (const job of state.jobs) {
    if (job.channel !== "web" || job.dueTomorrow || job.status === "picked_up" || job.status === "canceled") continue;
    const sendAt = Math.max(job.orderedAt + 10 * 60, job.dueAt - COMPUTER.statusEmailBeforeDue);
    if (state.time < sendAt || state.computer.messages.some((m) => m.kind === "email" && m.jobId === job.id)) continue;
    const c = customerById(state, job.customerId)!;
    state.computer.messages.push({
      id: state.computer.nextMessageId++,
      kind: "email",
      at: state.time,
      customerId: c.id,
      jobId: job.id,
      subject: `Order #${job.id}: still on for ${formatClock(job.dueAt)}?`,
      body: `Hi, just checking my order (#${job.id}) will be ready at ${formatClock(job.dueAt)}. Thanks, ${c.name}`,
      read: false,
      replied: false,
    });
  }
}

export function unreadCount(state: GameState): number {
  return state.computer.messages.filter((m) => !m.read).length;
}

// Late with an order and you never answered their email about it: that stings a bit more.
export function emailPenalty(state: GameState, job: Job): number {
  const late = !job.dueTomorrow && job.readyAt !== null && job.readyAt > job.dueAt;
  const ignored = state.computer.messages.some((m) => m.kind === "email" && m.jobId === job.id && !m.replied);
  return late && ignored ? COMPUTER.unansweredLatePenalty : 0;
}

// ---------- tasks ----------

export function canStartComputer(state: GameState, req: TaskRequest): string | null {
  switch (req.type) {
    case "open_app":
      return req.app ? null : "Open which app?";
    case "refresh_app":
      return state.computer.app ? null : "No app is open.";
    case "open_message": {
      const m = state.computer.messages.find((x) => x.id === req.messageId);
      return m ? null : "No such message.";
    }
    case "reply_email": {
      const m = state.computer.messages.find((x) => x.id === req.messageId);
      if (!m || m.kind !== "email") return "No such email.";
      if (!m.read) return "Open it first.";
      if (m.replied) return "You already replied.";
      return null;
    }
    case "call_back": {
      const v = state.computer.voicemails.find((x) => x.id === req.voicemailId);
      if (!v) return "No such voicemail.";
      if (v.calledBack) return "You already called them back.";
      return null;
    }
    case "move_job":
    case "cancel_job": {
      const job = jobById(state, req.jobId ?? -1);
      if (!job || job.status !== "queued") return "Only jobs waiting in a print queue can be moved or canceled.";
      if (req.type === "move_job") {
        const q = state.printers.find((p) => p.id === job.printerId)!.queue;
        const i = q.indexOf(job.id);
        if (req.dir === "up" && i === 0) return "It's already next in line.";
        if (req.dir === "down" && i === q.length - 1) return "It's already last in line.";
      }
      return null;
    }
    default:
      return "Not a computer task.";
  }
}

export function buildComputerTask(state: GameState, req: TaskRequest): Task {
  const base = { ...req, elapsed: 0, station: REGISTER };
  switch (req.type) {
    case "open_app":
      return { ...base, label: `Opening ${APP_LABEL[req.app!]}`, duration: appSwitchSeconds(state, req.app!) || COMPUTER.refreshSeconds };
    case "refresh_app":
      return { ...base, label: `Refreshing ${APP_LABEL[state.computer.app!]}`, duration: COMPUTER.refreshSeconds };
    case "open_message":
      return { ...base, label: "Reading a message", duration: appSwitchSeconds(state, "inbox") + COMPUTER.openMessageSeconds };
    case "reply_email":
      return { ...base, label: "Replying to an email", duration: appSwitchSeconds(state, "inbox") + COMPUTER.replyEmailSeconds };
    case "call_back": {
      const v = state.computer.voicemails.find((x) => x.id === req.voicemailId)!;
      return { ...base, label: `Calling ${v.from} back`, duration: appSwitchSeconds(state, "voicemail") + callById(state, v.callId)!.talkSeconds };
    }
    case "move_job":
      return { ...base, label: `Moving order #${req.jobId} ${req.dir} the queue`, duration: appSwitchSeconds(state, "printserver") + COMPUTER.moveJobSeconds };
    case "cancel_job":
      return { ...base, label: `Canceling order #${req.jobId} on the print server`, duration: appSwitchSeconds(state, "printserver") + COMPUTER.cancelJobSeconds };
    default:
      throw new Error(`not a computer task: ${req.type}`);
  }
}

export function completeComputerTask(state: GameState, task: Task): void {
  const c = state.computer;
  switch (task.type) {
    case "open_app":
      c.app = task.app!;
      snapshotApp(state, c.app);
      return;
    case "refresh_app":
      snapshotApp(state, c.app!);
      return;
    case "open_message": {
      c.app = "inbox";
      const m = c.messages.find((x) => x.id === task.messageId)!;
      m.read = true;
      if (m.kind === "web_order" && m.jobId !== null) {
        const job = jobById(state, m.jobId)!;
        if (!job.opened) {
          job.opened = true;
          log(state, `Opened online order #${job.id}: ${describeQuantity(job.ticket)}, due ${job.dueTomorrow ? "tomorrow" : formatClock(job.dueAt)}.`);
        }
      }
      snapshotApp(state, "inbox");
      return;
    }
    case "reply_email": {
      c.app = "inbox";
      const m = c.messages.find((x) => x.id === task.messageId)!;
      m.replied = true;
      log(state, `Replied to ${customerById(state, m.customerId)?.name ?? "a customer"} about order #${m.jobId}.`);
      snapshotApp(state, "inbox");
      return;
    }
    case "call_back": {
      c.app = "voicemail";
      const v = c.voicemails.find((x) => x.id === task.voicemailId)!;
      v.calledBack = true;
      v.heard = true;
      state.stats.callbacks++;
      const call = callById(state, v.callId)!;
      let note = "";
      const lead = call.leadCustomerId !== null ? customerById(state, call.leadCustomerId) : undefined;
      if (lead) {
        const at = state.time + call.leadDelay;
        if (lead.webOrderAt === null && at < state.closeAt) {
          lead.webOrderAt = at;
          state.stats.quoteLeads++;
          note = " They said they'd place the order online.";
        }
      }
      log(state, `Called ${v.from} back about ${CALL_LABEL[v.about]}.${note}`);
      snapshotApp(state, "voicemail");
      return;
    }
    case "move_job": {
      c.app = "printserver";
      const job = jobById(state, task.jobId!)!;
      if (job.status !== "queued") return;
      const q = state.printers.find((p) => p.id === job.printerId)!.queue;
      const i = q.indexOf(job.id);
      const j = task.dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= q.length) return;
      [q[i], q[j]] = [q[j], q[i]];
      log(state, `Moved order #${job.id} ${task.dir} the print queue.`);
      snapshotApp(state, "printserver");
      return;
    }
    case "cancel_job": {
      c.app = "printserver";
      const job = jobById(state, task.jobId!)!;
      if (job.status !== "queued") return;
      const p = state.printers.find((x) => x.id === job.printerId)!;
      p.queue = p.queue.filter((id) => id !== job.id);
      job.status = "unsent";
      job.printerId = null;
      job.location = "none";
      log(state, `Took order #${job.id} out of the print queue. It can be sent again.`);
      snapshotApp(state, "printserver");
      return;
    }
  }
}

// ---------- right vs. wrong ----------

// Ways what you'd hand over differs from what the customer asked for: print settings, and finishing from the ticket.
export function jobMismatches(job: Job): string[] {
  const want = job.requested;
  const got: JobSpec = { ...job.spec, finishing: job.ticket.finishing };
  const out: string[] = [];
  if (got.copies !== want.copies) out.push(`${got.copies} copies instead of ${want.copies}`);
  if (got.originals !== want.originals) out.push(`${got.originals} pages instead of ${want.originals}`);
  if (got.color !== want.color) out.push(got.color === "color" ? "color instead of B&W" : "B&W instead of color");
  if (got.media !== want.media) out.push(`${got.media} instead of ${want.media}`);
  if (got.duplex !== want.duplex) out.push(got.duplex ? "double-sided instead of single" : "single-sided instead of double");
  if (got.finishing !== want.finishing) out.push(`${got.finishing === "none" ? "no finishing" : got.finishing} instead of ${want.finishing === "none" ? "none" : want.finishing}`);
  // Right settings, wrong paper in the tray.
  if (job.printedOn && got.media === want.media && job.printedOn !== stockFor(want.media)) out.push(`printed on ${job.printedOn} instead of ${want.media}`);
  return out;
}

export function specsEqual(a: JobSpec, b: JobSpec): boolean {
  return a.copies === b.copies && a.originals === b.originals && a.color === b.color && a.media === b.media && a.duplex === b.duplex && a.finishing === b.finishing;
}
