// The phone. Calls are scheduled for the whole day from their own RNG stream. Each one rings for 30 seconds, then goes
// to voicemail. Answered quote calls can turn into a web order later; those "lead" customers are generated up front
// and only switched on when you answer, so the same seed and the same play always give the same day.
import type { Call, CallKind, Customer, GameState, Task, TaskRequest } from "./types";
import { PHONE } from "./config";
import { REGISTER } from "./layout";
import { randInt, type Rng } from "./rng";
import { makeCustomer, poisson, weighted } from "./schedule";
import { formatClock } from "./time";
import { customerById, log } from "./util";

const MIN = 60;

export const CALL_LABEL: Record<CallKind, string> = {
  quote: "price quote",
  status: "order status",
  hours: "store hours",
  rates: "shipping rates",
};

export function generateCalls(rng: Rng, firstCustomerId: number): { calls: Call[]; leads: Customer[] } {
  const times: number[] = [];
  PHONE.callsPerHour.forEach((rate, hour) => {
    const n = poisson(rng, rate);
    for (let i = 0; i < n; i++) times.push(Math.round((hour + rng()) * 3600));
  });
  times.sort((a, b) => a - b);

  const kinds = Object.keys(PHONE.kindWeights) as CallKind[];
  const calls: Call[] = [];
  const leads: Customer[] = [];
  times.forEach((ringsAt, i) => {
    const kind = weighted(rng, kinds, (k) => PHONE.kindWeights[k]);
    const [lo, hi] = PHONE.talkSeconds[kind];
    const talkSeconds = randInt(rng, lo, hi);
    const converts = rng() < PHONE.quoteConversion;
    const leadDelay = randInt(rng, PHONE.leadDelayMinutes[0], PHONE.leadDelayMinutes[1]) * MIN;
    let leadCustomerId: number | null = null;
    if (kind === "quote" && converts) {
      const lead = makeCustomer(rng, firstCustomerId + leads.length, ringsAt, true);
      lead.webOrderAt = null; // dormant until the call is answered
      leads.push(lead);
      leadCustomerId = lead.id;
    }
    calls.push({ id: i + 1, kind, ringsAt, talkSeconds, status: "scheduled", leadCustomerId, leadDelay, answeredAt: null });
  });
  return { calls, leads };
}

export function ringingCalls(state: GameState): Call[] {
  return state.calls.filter((c) => c.status === "ringing");
}

export function callById(state: GameState, id: number): Call | undefined {
  return state.calls.find((c) => c.id === id);
}

// Seconds of ringing left before voicemail.
export function ringLeft(state: GameState, call: Call): number {
  return Math.max(0, call.ringsAt + PHONE.ringSeconds - state.time);
}

export function runPhone(state: GameState): void {
  for (const call of state.calls) {
    if (call.status === "scheduled" && state.time >= call.ringsAt && call.ringsAt < state.closeAt) {
      call.status = "ringing";
      log(state, "The phone is ringing.");
    }
    if (call.status !== "ringing" || ringLeft(state, call) > 0) continue;
    if (state.employee.task?.callId === call.id) continue; // you're on your way to it, it keeps ringing
    call.status = "missed";
    state.stats.missedCalls++;
    log(state, "Missed a call. It went to voicemail.");
  }
}

export function canAnswer(state: GameState, req: TaskRequest): string | null {
  const call = callById(state, req.callId ?? -1);
  if (!call) return "No such call.";
  if (call.status === "missed") return "It already went to voicemail.";
  if (call.status !== "ringing") return "That call isn't ringing.";
  return null;
}

export function buildAnswerTask(state: GameState, req: TaskRequest): Task {
  const call = callById(state, req.callId!)!;
  return { ...req, elapsed: 0, label: "On the phone", station: REGISTER, duration: call.talkSeconds };
}

export function completeAnswer(state: GameState, task: Task): void {
  const call = callById(state, task.callId!)!;
  call.status = "answered";
  call.answeredAt = state.time;
  state.stats.callsAnswered++;
  const lines: Record<CallKind, string> = {
    quote: "gave a price over the phone",
    status: "checked on an order for a caller",
    hours: "told a caller the store hours",
    rates: "quoted shipping rates over the phone",
  };
  let note = "";
  if (call.leadCustomerId !== null) {
    const lead = customerById(state, call.leadCustomerId)!;
    const at = state.time + call.leadDelay;
    if (at < state.closeAt) {
      lead.webOrderAt = at;
      state.stats.quoteLeads++;
      note = ` They said they'd place the order online${at - state.time < 3600 ? " shortly" : ` this afternoon`}.`;
    }
  }
  log(state, `Answered the phone and ${lines[call.kind]} (${formatClock(call.ringsAt)} call).${note}`);
}
