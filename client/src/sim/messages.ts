// Every message-like thing (web orders, customer feedback, manager notes, corporate memos, rewards) goes through here,
// and none of them can be posted without a real body: the Email app on the computer shows all of them.
import type { GameState, JobSpec, Message, MessageKind } from "./types";
import { FINISHING_LABEL } from "./orders";

export interface NewMessage {
  kind: MessageKind;
  from: string;
  subject: string;
  body: string;
  jobId?: number | null;
  at?: number; // (default: now)
}

export function postMessage(state: GameState, m: NewMessage, opts: { held?: boolean } = {}): Message {
  if (!m.subject.trim()) throw new Error("A message needs a subject.");
  if (!m.body.trim() || m.body.trim() === m.subject.trim()) throw new Error(`A message needs a body of its own: "${m.subject}"`);
  if (!m.from.trim()) throw new Error(`A message needs a sender: "${m.subject}"`);
  const msg: Message = { id: state.nextId++, kind: m.kind, from: m.from, at: m.at ?? state.time, subject: m.subject, body: m.body, jobId: m.jobId ?? null, read: false, snoozed: false };
  (opts.held ? state.heldMessages : state.messages).push(msg);
  return msg;
}

// Something you have to do something about (a web order to enter), as opposed to something to read.
export function needsAction(m: Message): boolean {
  return m.kind === "web_order" && !m.read;
}

const PAPER: Record<JobSpec["media"], string> = { letter: "letter", legal: "legal", tabloid: "11x17", cardstock: "cardstock" };

// "Handout, 18 copies of 4 pages, B&W, letter, 1-sided, cut"
export function describeSpec(s: JobSpec): string {
  const item = `${s.item[0].toUpperCase()}${s.item.slice(1)}`;
  const pages = s.originals > 1 ? ` of ${s.originals} pages` : "";
  return `${item}, ${s.copies} ${s.copies === 1 ? "copy" : "copies"}${pages}, ${s.color === "color" ? "color" : "B&W"}, ${PAPER[s.media]}, ${s.duplex ? "2-sided" : "1-sided"}, ${FINISHING_LABEL[s.finishing].toLowerCase()}`;
}
