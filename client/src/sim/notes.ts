// Sticky notes: the MC writes one for every order you take. It says what you entered on the computer (not what they
// actually asked for), and the next thing to do with it. Done orders get crossed off and fade.
import type { GameState, Job, Media, TaskType } from "./types";
import { NOTE_TEXT, STEP } from "./workflow";
import { FINISHING_LABEL } from "./orders";
import { formatClock } from "./time";
import { customerById, fill } from "./util";

export interface Note {
  jobId: number;
  text: string;
  hint: string;
  done: boolean;
  doneAt: number | null;
}

export const NOTE_FADE = 45; // game minutes a crossed-off note stays up

const PAPER: Record<Media, string> = { letter: "letter", legal: "legal", tabloid: "11x17", cardstock: "cardstock" };

export function notes(state: GameState): Note[] {
  const out: Note[] = [];
  const jobs = state.jobs.filter((j) => j.status !== "unread").sort((a, b) => a.dueDay - b.dueDay || a.dueAt - b.dueAt);
  for (const j of jobs) {
    const done = j.status === "picked_up" || j.status === "canceled";
    if (done && (j.closedAt === null || state.time - j.closedAt > NOTE_FADE)) continue;
    out.push({ jobId: j.id, text: noteText(state, j), hint: done ? NOTE_TEXT.done : hintFor(state, j), done, doneAt: j.closedAt });
  }
  return out.sort((a, b) => Number(a.done) - Number(b.done));
}

// "Resume x25, B&W, cardstock, 2-sided, staple, due 2:00 PM. Dana."
export function noteText(state: GameState, j: Job): string {
  const name = (customerById(state, j.customerId)?.name ?? "").split(" ")[0];
  const s = j.spec;
  const item = `${s.item[0].toUpperCase()}${s.item.slice(1)}`;
  const due = j.dueDay > state.day ? "tomorrow" : formatClock(j.dueAt);
  // Until it's in the computer, the details are only in what they said.
  if (j.status === "new" && !j.walkUp) return fill(NOTE_TEXT.new, { item, name, due });
  const parts = [`${item} x${s.copies}`, s.color === "color" ? "color" : "B&W", PAPER[s.media]];
  if (s.duplex) parts.push("2-sided");
  if (s.finishing !== "none") parts.push(s.finishing);
  return `${parts.join(", ")}, due ${due}. ${name}.`;
}

function hintFor(state: GameState, j: Job): string {
  if (j.status === "queued" || j.status === "printing") return NOTE_TEXT.printing;
  return fill(STEP[nextStep(j)].hint, { finishing: FINISHING_LABEL[j.spec.finishing] });
}

function nextStep(j: Job): TaskType {
  switch (j.status) {
    case "new":
      return j.walkUp ? "make_copies" : "enter_order";
    case "entered":
      return "send_job";
    case "printed":
      return "collect";
    case "collected":
      return j.smudge === "found" ? "reprint" : j.spec.finishing !== "none" ? "finish" : "bag";
    case "finished":
      return "bag";
    default:
      return j.prepaid ? "hand_over" : "ring_up";
  }
}
