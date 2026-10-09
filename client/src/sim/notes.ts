// Sticky notes: the MC writes one for every order you take. It says what you entered on the computer (not what they
// actually asked for), and the next thing to do with it. The ones that need you come first (soonest due first), then
// the ones waiting on the shelf for their customer. Done orders get crossed off and fade quickly.
import type { GameState, Job, JobStatus, Media, Station, TaskType } from "./types";
import { NOTE_TEXT, STEP } from "./workflow";
import { FINISHING_LABEL, MACHINE_LABEL, MEDIA_LABEL, PAPER, machineFor } from "./orders";
import { formatClock } from "./time";
import { customerById, fill, money } from "./util";

export interface Note {
  jobId: number;
  text: string;
  hint: string;
  done: boolean;
  doneAt: number | null;
}

export const NOTE_FADE = 10; // game minutes a crossed-off note stays up


export function notes(state: GameState): Note[] {
  const out: Note[] = [];
  const jobs = state.jobs.filter((j) => j.status !== "unread" && !customerById(state, j.customerId)?.crew).sort((a, b) => a.dueDay - b.dueDay || a.dueAt - b.dueAt);
  for (const j of jobs) {
    const done = j.status === "picked_up" || j.status === "canceled";
    if (done && (j.closedAt === null || state.time - j.closedAt > NOTE_FADE)) continue;
    out.push({ jobId: j.id, text: noteText(state, j), hint: done ? NOTE_TEXT.done : hintFor(state, j), done, doneAt: j.closedAt });
  }
  const rank = (n: Note): number => {
    const j = state.jobs.find((x) => x.id === n.jobId)!;
    return n.done ? 2 : j.status === "bagged" ? 1 : 0;
  };
  return out.map((n, i) => ({ n, i, r: rank(n) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.n);
}

// "#12 Resume x25, B&W, cardstock, 2-sided, staple, due 2:00 PM. Dana R." (The order number and initial tell apart two
// orders for the same name: they're on the bag too.)
export function noteText(state: GameState, j: Job): string {
  const name = customerById(state, j.customerId)?.name ?? "";
  const s = j.spec;
  const item = `${s.item[0].toUpperCase()}${s.item.slice(1)}`;
  const due = j.dueDay > state.day ? `tomorrow ${formatClock(j.dueAt)}` : formatClock(j.dueAt);
  // Until it's in the computer, the details are only in what they said.
  if (j.status === "new") return fill(NOTE_TEXT.new, { job: j.id, item, name, due });
  const parts = [`${item} x${s.copies}`, s.color === "color" ? "color" : "B&W"];
  if (s.media !== "business_card") parts.push(PAPER[s.media]);
  if (s.duplex) parts.push("2-sided");
  if (s.finishing !== "none") parts.push(s.finishing);
  return `#${j.id} ${parts.join(", ")}, due ${due}. ${name}${name.endsWith(".") ? "" : "."}`;
}

function hintFor(state: GameState, j: Job): string {
  if (j.status === "queued" || j.status === "printing") return NOTE_TEXT.printing;
  if (j.status === "bagged" && customerById(state, j.customerId)?.state === "away") return NOTE_TEXT.pickup;
  return fill(STEP[nextStep(j)].hint, { finishing: FINISHING_LABEL[j.spec.finishing], machine: MACHINE_LABEL[machineFor(j.spec)] });
}

function nextStep(j: Job): TaskType {
  switch (j.status) {
    case "new":
      return "enter_order";
    case "entered":
      return "send_job";
    case "printed":
      return machineFor(j.spec) === "wide" ? "trim" : "collect";
    case "collected":
      if (machineFor(j.spec) === "wide") return "roll";
      return j.smudge === "found" ? "reprint" : j.spec.finishing !== "none" ? "finish" : "bag";
    case "finished":
      return "bag";
    default:
      return j.prepaid ? "hand_over" : "ring_up";
  }
}

// ---------- a note, unfolded ----------

// Everything about one order, for when you tap its note: the details (what you entered, or until then what they
// asked for), and every step from taking it to handing it over, with the ones done ticked off.
export interface NoteDetail {
  jobId: number;
  name: string;
  item: string;
  entered: boolean; // in the computer yet (if not, the details are only what they asked for)
  rows: [string, string][];
  steps: { text: string; station: Station; state: "done" | "now" | "todo" }[];
  done: boolean;
}

const RANK: Record<JobStatus, number> = { unread: 0, new: 0, entered: 1, queued: 2, printing: 2, printed: 3, collected: 4, finished: 5, bagged: 6, picked_up: 7, canceled: 7 };

export function noteDetail(state: GameState, jobId: number): NoteDetail | null {
  const j = state.jobs.find((x) => x.id === jobId);
  if (!j) return null;
  const s = j.spec;
  const name = customerById(state, j.customerId)?.name ?? "";
  const due = `${j.dueDay > state.day ? "Tomorrow" : "Today"}, ${formatClock(j.dueAt)}`;
  const rows: [string, string][] = [
    ["Copies", `${s.copies}`],
    ["Pages each", `${s.originals}`],
    ["Color", s.color === "color" ? "Color" : "B&W"],
    ["Sides", s.duplex ? "2-sided" : "1-sided"],
    ["Paper", MEDIA_LABEL[s.media]],
    ["Finishing", FINISHING_LABEL[s.finishing]],
    ["Due", `${due}${j.rush ? " (rush)" : ""}`],
    ["Price", `${money(j.priceCents)}${j.prepaid ? " (paid online)" : ""}`],
  ];
  const rank = RANK[j.status];
  const fin = FINISHING_LABEL[s.finishing];
  const wide = machineFor(s) === "wide"; // (a large print is trimmed and rolled up instead of collected)
  const plan: [TaskType | "printing", boolean][] = [
    ["enter_order", rank > 0],
    ["send_job", rank > 1],
    ["printing", rank > 2],
    ...(wide ? ([["trim", rank > 3], ["roll", rank > 4]] as [TaskType, boolean][]) : ([["collect", rank > 3]] as [TaskType, boolean][])),
    ...(j.smudge === "found" ? ([["reprint", false]] as [TaskType, boolean][]) : []),
    ...(s.finishing !== "none" ? ([["finish", rank > 4 || (rank === 4 && j.skipped)]] as [TaskType, boolean][]) : []),
    ["bag", rank > 5],
    [j.prepaid ? "hand_over" : "ring_up", rank >= 7],
  ];
  let now = j.status !== "canceled";
  const steps = plan.map(([t, isDone]) => {
    const st = isDone ? "done" : now ? "now" : "todo";
    if (st === "now") now = false;
    if (t === "printing") return { text: NOTE_TEXT.printing, station: (wide ? "finishing" : "printer") as Station, state: st as "done" | "now" | "todo" };
    const hint = fill(STEP[t].hint, { finishing: fin, machine: MACHINE_LABEL[machineFor(s)] });
    const when = t === "ring_up" || t === "hand_over" ? `${hint} when they come back` : hint;
    return { text: when, station: STEP[t].station, state: st as "done" | "now" | "todo" };
  });
  return { jobId: j.id, name, item: `${s.item[0].toUpperCase()}${s.item.slice(1)}`, entered: rank > 0, rows, steps, done: rank >= 7 };
}
