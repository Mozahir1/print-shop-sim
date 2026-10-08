// The coworker on shift with you: an agent with their own customers, their own pace, and a personality.
//
// Work. The director brings in extra customers for them (on top of yours, by their capacity: see director.ts), and
// they serve those start to finish, through the same steps at the same times as you (scaled by how quick they are at
// each station, plus walking between stations and, for some, standing around between tasks): talk, take the order,
// enter and send it, collect it, finish and bag it, ring them up; pack and ship; scan drop-offs; hand over packages.
// They share the machines with you: their jobs go in the same printer queue (yours go first when they're due
// sooner), and while they're at the printer or the finishing table it's in use (your steps there wait). They never
// take a station while you're mid-step at it. They take breaks; at close they finish with whoever's still in the
// store, then go home. Their customers, orders, and packages are theirs: not on your to-do list, notes, or load.
//
// Personality (src/data/coworkers.json). They talk (speech bubbles over them, and the log), at their own rate, and
// each has hooks: A upsells, double-checks your orders, re-sorts the shelf, clears jams; Brody breaks things (his
// mishap is the day's bad luck), needs help, wanders off; C talks, tells a story across days, chats up your
// customers, and wants you to respond. Requests come to you as Do / Don't / Ignore (outcomes are data), and how you
// answer moves a hidden relationship that carries over and nudges how often they ask.
//
// Choices never consume randomness: everything that happens during the day is a keyed roll.
import type { Customer, CoworkerState, CoworkerTask, CrewRequest, GameState, Job, RequestOutcome, Station } from "./types";
import { CREW, DURATIONS, HEAT, RESPOND_MINUTES } from "./config";
import { coworkerDef, COWORKERS } from "./schedule";
import { createJob, createShipment, isPrintKind } from "./customers";
import { lastDueAt, quoteFor } from "./quote";
import { finishMinutes, FINISHING_LABEL, MEDIA_LABEL, machineFor, totalSheets, wrongFields } from "./orders";
import { currentStep } from "./workflow";
import { queueJob, startTask } from "./sim";
import { customerById, fill, jobById, log, packageById } from "./util";
import { emit } from "./bus";
import { keyedRoll, type Rng } from "./rng";
import { pickLine, type Line } from "./lines";
import { recordChoice, wear } from "./mood";
import { addHeat } from "./consequences";
import { recordFailure } from "./failures";
import { resolveEvent } from "./events";
import { think } from "./thoughts";

export function createCoworker(id: string, dayLength: number, rng: Rng, carried: { relationship?: number; story?: number } = {}): CoworkerState {
  const def = coworkerDef(id);
  const r = def.rates;
  const n = def.breaks.count;
  const breaks = Array.from({ length: n }, (_, i) => Math.round((dayLength * (i + 1)) / (n + 1) + (rng() * 2 - 1) * CREW.breakJitter));
  // (Every roll is made either way, so the stream doesn't depend on who's on.)
  const missRoll = rng();
  const missAt = Math.round(dayLength * (0.25 + rng() * 0.4));
  const missFor = Math.round(CREW.missing[0] + rng() * (CREW.missing[1] - CREW.missing[0]));
  const orgRoll = rng();
  const orgAt = Math.round(dayLength * (0.2 + rng() * 0.5));
  const chatAt = Math.round(5 + rng() * 15);
  const askAt = Math.round(25 + rng() * 40);
  const chatUpAt = Math.round(40 + rng() * 60);
  return {
    id,
    name: def.name,
    at: "counter",
    task: null,
    breaks,
    breakUntil: 0,
    said: null,
    nextChatAt: chatAt,
    nextRequestAt: r.requests > 0 ? askAt : Infinity,
    nextChatUpAt: r.chatUp > 0 ? chatUpAt : Infinity,
    idleUntil: 0,
    missingAt: missRoll < r.missing ? missAt : null,
    missingUntil: missFor, // (how long, until they go: then when they're back)
    reorganizeAt: orgRoll < r.reorganize ? orgAt : null,
    louderUntil: 0,
    relationship: carried.relationship ?? 0,
    story: carried.story ?? 0,
    storyToday: 0,
    checked: [],
    spoke: {},
    stats: { served: 0, ordersTaken: 0, jobsDone: 0, revenueCents: 0, minutesWorked: 0 },
  };
}

// ---------- whose is it ----------

export function isCrew(state: GameState, customerId: number | undefined): boolean {
  return customerId !== undefined && customerById(state, customerId)?.crew === true;
}

export function crewJob(state: GameState, j: Job): boolean {
  return isCrew(state, j.customerId);
}

// Why you can't do something because it's the coworker's (their customer, order, or package), or null.
export function theirs(state: GameState, req: { customerId?: number; jobId?: number; packageId?: number }): string | null {
  const cw = state.coworker;
  if (!cw) return null;
  const ids = [req.customerId, req.jobId !== undefined ? jobById(state, req.jobId)?.customerId : undefined, req.packageId !== undefined ? packageById(state, req.packageId)?.customerId : undefined];
  return ids.some((id) => isCrew(state, id)) ? `${cw.name} is taking care of that.` : null;
}

// How many of their customers are on the go (in the store, or with an order that isn't done).
export function crewLoad(state: GameState): number {
  return state.customers.filter((c) => {
    if (!c.crew) return false;
    if (c.state === "line" || c.state === "talking" || c.state === "waiting") return true;
    const j = c.state === "away" && c.jobId !== null ? jobById(state, c.jobId) : undefined;
    return !!j && j.dueDay <= state.day && j.status !== "bagged" && j.status !== "picked_up" && j.status !== "canceled";
  }).length;
}

// Whether they've room for a new customer. (On break, someone can still come in and wait for them.)
export function crewTakesNew(state: GameState): boolean {
  const cw = state.coworker;
  return !!cw && cw.at !== "gone" && cw.at !== "missing" && state.time < state.closeAt && crewLoad(state) < CREW.maxActive;
}

// ---------- shared stations ----------

const SHARED: ReadonlySet<Station> = new Set(["printer", "finishing"]);

// "In use: A, about 4 min" while the coworker's working at a shared station (the printer, the finishing table).
export function inUse(state: GameState, station: Station): string | null {
  const t = state.coworker?.task;
  if (!t || t.station !== station || !SHARED.has(station)) return null;
  return `In use: ${state.coworker!.name}, about ${Math.max(1, Math.ceil(t.until - state.time))} min.`;
}

// Whether you're in the middle of a step at this station (they won't take it from you).
function youreAt(state: GameState, station: Station): boolean {
  if (state.employee.task?.station === station) return true;
  return state.workflow !== null && currentStep(state)?.data.station === station;
}

// ---------- what they say ----------

// They say something (a line from their pool, by moment): a speech bubble over them, and the log. Returns it, or null
// if they have nothing for that moment.
export function crewSays(state: GameState, moment: string, vars: Record<string, string | number> = {}, tags: Record<string, string | undefined> = {}): string | null {
  const cw = state.coworker;
  if (!cw) return null;
  const pool = coworkerDef(cw.id).lines as unknown as Line[];
  if (!pool.some((l) => l.moment === moment && Object.entries(tags).every(([k, v]) => v === undefined || l[k] === v))) return null;
  const text = fill(pickLine(pool, moment, tags, nextLine(state, moment)).text, vars);
  speak(state, text);
  return text;
}

// Which line next: through them in turn, from a different place each day.
function nextLine(state: GameState, moment: string): number {
  const cw = state.coworker!;
  const i = cw.spoke[moment] ?? 0;
  cw.spoke[moment] = i + 1;
  return Math.floor(keyedRoll(state.seed, "line-start", moment) * 1000) + i;
}

function speak(state: GameState, text: string): void {
  const cw = state.coworker!;
  cw.said = { text, at: state.time };
  log(state, `${cw.name}: "${text}"`);
  emit("crew_said", { text });
}

// Small talk, at their rate: the metrics (A), the story (C, a part at a time across days), gossip about the others.
function chat(state: GameState): void {
  const cw = state.coworker!;
  const def = coworkerDef(cw.id);
  const roll = keyedRoll(state.seed, "crew-chat", state.time);
  const breakIn = cw.breaks.length ? cw.breaks[0] - state.time : Infinity;
  if (breakIn > 0 && breakIn <= 60 && roll < 0.25 && crewSays(state, "chat_break", { minutes: breakIn })) return;
  if (state.manager.heat >= HEAT.warnAt && roll < 0.5 && crewSays(state, "chat_dip")) return think(state, "coworker_metrics", { coworker: cw.id });
  const story = def.story ?? [];
  if (cw.story < story.length && cw.storyToday < CREW.storyPerDay && roll < 0.45) {
    speak(state, story[cw.story]);
    cw.story++;
    cw.storyToday++;
    if (cw.storyToday === 1) think(state, "coworker_story", { coworker: cw.id });
    return;
  }
  const others = COWORKERS.filter((c) => c.id !== cw.id).map((c) => c.id);
  if (def.hooks.includes("gossip") && roll > 0.7 && crewSays(state, "gossip", {}, { about: others[Math.floor(roll * 10) % others.length] })) return;
  crewSays(state, "chat");
  if (def.hooks.includes("upsell") && roll < 0.3) think(state, "coworker_metrics", { coworker: cw.id });
}

// ---------- requests ----------

// They ask you something. One at a time; it goes away on its own (as an Ignore) if you don't answer.
function ask(state: GameState, kind: string, text: string, customerId?: number): void {
  const cw = state.coworker!;
  const def = coworkerDef(cw.id).requests.find((r) => r.id === kind)!;
  state.request = { id: state.nextId++, from: cw.id, kind, text, do: def.do, dont: def.dont, at: state.time, until: state.time + CREW.requestWait, customerId };
  speak(state, text);
  emit("crew_request", { text });
  think(state, "coworker_request", { coworker: cw.id });
}

export function requestOutcome(r: CrewRequest, choice: "do" | "dont" | "ignore"): RequestOutcome {
  return coworkerDef(r.from).requests.find((d) => d.id === r.kind)!.outcomes[choice];
}

// Your answer. Do may take a few minutes of yours (help_coworker: like a quick chore, it can interrupt a job but not a
// customer); Don't and Ignore are instant. Returns why not, or null.
export function answerRequest(state: GameState, choice: "do" | "dont" | "ignore"): string | null {
  const r = state.request;
  if (!r) return "Nobody's asking you anything.";
  if (choice === "do" && (requestOutcome(r, "do").minutes ?? 0) > 0) return startTask(state, { type: "help_coworker" });
  resolveRequest(state, choice);
  return null;
}

// What your answer leads to.
export function resolveRequest(state: GameState, choice: "do" | "dont" | "ignore"): void {
  const r = state.request;
  const cw = state.coworker;
  if (!r || !cw) return;
  state.request = null;
  const out = requestOutcome(r, choice);
  recordChoice(state, choice, "coworker", r.customerId, choice === "ignore" ? { auto: true } : {});
  cw.relationship += out.relationship ?? 0;
  if (out.revenueCents) {
    state.revenueCents += out.revenueCents;
    log(state, `Upsold an add-on: +$${(out.revenueCents / 100).toFixed(2)}.`);
  }
  const c = r.customerId !== undefined ? customerById(state, r.customerId) : undefined;
  if (out.mood && c) c.mood += out.mood;
  if (out.louder) {
    cw.louderUntil = state.time + CREW.louderFor;
    cw.nextChatAt = Math.min(cw.nextChatAt, state.time + 3);
  }
  if (out.reply) crewSays(state, out.reply);
  if (out.flub) flub(state);
}

// They did it themselves, wrong: now there's something for you to fix (on the computer).
function flub(state: GameState): void {
  const cw = state.coworker!;
  const job = state.jobs.find((j) => crewJob(state, j) && !["bagged", "picked_up", "canceled"].includes(j.status));
  const text = job ? `Fix ${cw.name}'s mistake on order #${job.id}` : `Fix ${cw.name}'s mistake on the computer`;
  state.mistakes.push({ id: state.nextId++, by: cw.name, text, jobId: job?.id, fixed: false });
  if (job) crewSays(state, "flub", { job: job.id });
  else crewSays(state, "flub_general");
}

// You're going home with their mistakes unfixed: each is a failure you see, and the manager may well blame you.
export function mistakesAtClose(state: GameState): void {
  for (const m of state.mistakes.filter((x) => !x.fixed)) {
    recordFailure(state, "crew_mistake", { name: m.by, ...(m.jobId !== undefined ? { job: m.jobId } : {}) }, { jobId: m.jobId });
    if (keyedRoll(state.seed, "blame", m.id) < CREW.blameChance) {
      addHeat(state, CREW.blameHeat, "ignoring");
      log(state, `The manager blamed you for ${m.by}'s mistake.`);
    }
  }
}

// A's upsell nag: right after you take a print order (that could be laminated), now and then.
export function onYourOrder(state: GameState, c: Customer, job: Job): void {
  const cw = state.coworker;
  if (!cw || state.request || cw.at === "gone" || cw.at === "missing" || cw.at === "break") return;
  const def = coworkerDef(cw.id);
  if (!def.hooks.includes("upsell") || job.spec.finishing === "laminate" || machineFor(job.spec) !== "printer") return;
  if (keyedRoll(state.seed, "upsell", job.id) >= def.rates.upsell * nudge(cw)) return;
  const text = fill(pickLine(def.lines as unknown as Line[], "ask_upsell", {}, nextLine(state, "ask_upsell")).text, { name: c.name });
  ask(state, "upsell", text, c.id);
}

// How you've been with them nudges how much they come to you (helping Brody makes Brody ask more).
function nudge(cw: CoworkerState): number {
  return Math.max(0.2, 1 + CREW.relationshipNudge * Math.max(-5, Math.min(10, cw.relationship)));
}

// ---------- what they do ----------

interface Plan {
  kind: CoworkerTask["kind"];
  what: string;
  station: Station;
  minutes: number;
  customerId?: number;
  jobId?: number;
}

const steps = (...types: (keyof typeof DURATIONS)[]) => types.reduce((a, t) => a + DURATIONS[t], 0);

// The next thing they'd do, most urgent first: whoever's waiting on them at the counter, then their orders (soonest
// due first). Nothing at a shared station you're working at.
function nextPlan(state: GameState): Plan | null {
  const cw = state.coworker!;
  const def = coworkerDef(cw.id);
  const speed = def.speed;
  const plan = (p: Omit<Plan, "minutes">, minutes: number): Plan => {
    const walk = cw.at !== p.station ? CREW.walk : 0; // (they walk over)
    return { ...p, minutes: Math.max(1, Math.round(minutes * speed[p.station] + walk)) };
  };
  // A hook first: A clears a jam before you notice.
  if (def.hooks.includes("fix_jam") && state.printer.status === "jammed" && !youreAt(state, "printer") && keyedRoll(state.seed, "fix-jam", state.event?.firedAt ?? state.day) < def.rates.fixJam)
    return plan({ kind: "fix_jam", what: "Clearing the jam", station: "printer" }, steps("clear_jam"));
  const mine = state.customers.filter((c) => c.crew).sort((a, b) => a.lineTicket - b.lineTicket || a.arrivedAt - b.arrivedAt);
  // In the store, waiting on them.
  for (const c of mine) {
    if (c.state !== "waiting") continue;
    const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
    if (job && job.status === "bagged" && job.dueDay <= state.day) return plan({ kind: "pickup", what: `Ringing up ${c.name}`, station: "counter", customerId: c.id }, steps("fetch_bag", "ring_up"));
    if (c.kind === "ship" && c.packageId !== null && packageById(state, c.packageId)?.status === "new") return plan({ kind: "ship", what: `Shipping ${c.name}'s package`, station: "shipping", customerId: c.id }, steps("pack", "tape", "weigh", "label", "ring_up", "bin"));
    if (c.kind === "dropoff") return plan({ kind: "dropoff", what: `Scanning ${c.name}'s drop-off`, station: "shipping", customerId: c.id }, steps("scan_dropoff", "bin"));
    if (c.kind === "package_pickup") return plan({ kind: "package", what: `Finding ${c.name}'s package`, station: "shelf", customerId: c.id }, steps("find_package", "hand_over"));
  }
  const front = mine.find((c) => c.state === "line");
  if (front) return plan({ kind: "serve", what: `Helping ${front.name}`, station: "counter", customerId: front.id }, DURATIONS.talk + (isPrintKind(front.kind) ? RESPOND_MINUTES.take : 1));
  // Their orders.
  const jobs = state.jobs.filter((j) => crewJob(state, j)).sort((a, b) => a.dueDay - b.dueDay || a.dueAt - b.dueAt);
  for (const j of jobs) {
    const wide = machineFor(j.spec) === "wide";
    const p: Plan | null =
      j.status === "new" || j.status === "entered" // (entered: carried over from yesterday, to send again)
        ? plan({ kind: "enter", what: `Entering order #${j.id}`, station: "computer", jobId: j.id }, j.status === "new" ? steps("enter_order", "send_job") : steps("send_job"))
        : j.status === "printed" && !wide
          ? plan({ kind: "collect", what: `Collecting order #${j.id}`, station: "printer", jobId: j.id }, steps("collect"))
          : j.status === "printed" && wide
            ? plan({ kind: "finish", what: `Trimming order #${j.id}`, station: "finishing", jobId: j.id }, steps("trim", "roll", "bag"))
            : j.status === "collected" || j.status === "finished"
              ? plan({ kind: "finish", what: `Finishing order #${j.id}`, station: "finishing", jobId: j.id }, (j.status === "collected" ? finishMinutes(j.spec) : 0) + steps("bag"))
              : null;
    if (p && !(SHARED.has(p.station) && youreAt(state, p.station))) return p;
  }
  return null;
}

// It's done: the same results the steps have when you do them.
function finish(state: GameState, t: CoworkerTask): void {
  const cw = state.coworker!;
  const c = t.customerId !== undefined ? customerById(state, t.customerId) : undefined;
  const job = t.jobId !== undefined ? jobById(state, t.jobId) : c?.jobId != null ? jobById(state, c.jobId) : undefined;
  switch (t.kind) {
    case "serve":
      if (c && c.state === "line") serve(state, c);
      return;
    case "pickup":
      if (!c || !job) return;
      job.status = "picked_up";
      job.closedAt = state.time;
      if (!job.prepaid) {
        state.revenueCents += job.priceCents;
        cw.stats.revenueCents += job.priceCents;
      }
      return done(state, c);
    case "ship": {
      const p = c?.packageId != null ? packageById(state, c.packageId) : undefined;
      if (!c || !p) return;
      p.status = "binned"; // (packed properly, labeled, rung up, in the bin)
      p.paid = true;
      state.revenueCents += p.priceCents;
      cw.stats.revenueCents += p.priceCents;
      return done(state, c);
    }
    case "dropoff": {
      if (!c) return;
      const id = state.nextId++;
      state.packages.push({ id, customerId: c.id, kind: "dropoff", weightLb: 2, service: null, box: null, priceCents: 0, status: "binned", taped: false, paid: true, label: null });
      c.packageId = id;
      return done(state, c);
    }
    case "package": {
      const p = c?.packageId != null ? packageById(state, c.packageId) : undefined;
      if (!c || !p) return;
      p.status = "picked_up";
      return done(state, c);
    }
    case "enter":
      if (!job || (job.status !== "new" && job.status !== "entered")) return;
      job.status = "queued"; // (entered exactly as asked, and sent)
      queueJob(state, job);
      return;
    case "collect":
      if (!job || job.status !== "printed") return;
      if (job.smudge === "found") {
        // Smudged: they run it again.
        Object.assign(job, { status: "queued", sheetsPrinted: 0, smudge: "none" });
        queueJob(state, job);
        return;
      }
      job.status = "collected";
      return;
    case "finish":
      if (!job || !["printed", "collected", "finished"].includes(job.status)) return;
      job.status = "bagged";
      cw.stats.jobsDone++;
      log(state, `${cw.name} bagged order #${job.id}.`);
      return;
    case "fix_jam":
      if (state.printer.status !== "jammed") return;
      state.printer.status = state.printer.currentJobId !== null ? "printing" : "idle";
      resolveEvent(state, "printer_jam", "fixed");
      crewSays(state, "fix_jam");
      return;
  }
}

// At the counter: they take the order (on the usual terms) or the request.
function serve(state: GameState, c: Customer): void {
  const cw = state.coworker!;
  const job = c.jobId !== null ? jobById(state, c.jobId) : undefined;
  if (job) {
    c.state = "waiting"; // back for their order: they get it once it's bagged
    return;
  }
  if (isPrintKind(c.kind) && c.spec) {
    const q = quoteFor(state, c);
    const tomorrow = c.timing === "tomorrow" || q.tomorrow;
    const dueAt = tomorrow ? q.morningAt : Math.min(lastDueAt(state), c.timing === "back" ? Math.max(q.standardReadyAt, c.needBy ?? q.standardReadyAt) : q.standardReadyAt);
    const j = createJob(state, c, "counter", { rush: false, dueDay: tomorrow ? state.day + 1 : state.day, dueAt });
    cw.stats.ordersTaken++;
    c.state = c.timing === "wait" && !tomorrow ? "waiting" : "away";
    log(state, `${cw.name} took ${c.name}'s order #${j.id}.`);
    return;
  }
  c.state = "waiting";
  if (c.kind === "ship") createShipment(state, c);
}

// Served: they leave happy. (Their visits count for the coworker, not in your numbers.)
function done(state: GameState, c: Customer): void {
  c.state = "gone";
  c.outcome = "served";
  c.leftAt = state.time;
  state.coworker!.stats.served++;
  emit("customer_left", { customerId: c.id, mood: "happy" });
}

// ---------- hooks that happen between tasks ----------

// A double-checks the orders you've entered and catches a wrong one before it prints. Genuinely helpful.
function doubleCheck(state: GameState): boolean {
  const cw = state.coworker!;
  const def = coworkerDef(cw.id);
  if (!def.hooks.includes("double_check")) return false;
  for (const j of state.jobs) {
    if (crewJob(state, j) || (j.status !== "entered" && j.status !== "queued") || cw.checked.includes(j.id)) continue;
    const wrong = wrongFields(j.asked, j.spec);
    if (!wrong.length) continue;
    cw.checked.push(j.id);
    if (keyedRoll(state.seed, "double-check", j.id) >= def.rates.doubleCheck * nudge(cw)) continue;
    const f = wrong[0];
    const field = f === "copies" ? `${j.asked.copies} copies` : f === "color" ? (j.asked.color === "color" ? "color" : "black and white") : f === "duplex" ? (j.asked.duplex ? "2-sided" : "1-sided") : f === "media" ? MEDIA_LABEL[j.asked.media] : FINISHING_LABEL[j.asked.finishing].toLowerCase();
    j.spec = { ...j.asked };
    j.sheets = totalSheets(j.spec);
    crewSays(state, "double_check", { job: j.id, field });
    return true;
  }
  return false;
}

// C chats up the customers waiting in your line: lovely for C, a little patience gone for them.
function chatUp(state: GameState): void {
  const cw = state.coworker!;
  const def = coworkerDef(cw.id);
  cw.nextChatUpAt = state.time + Math.round((60 / def.rates.chatUp) * (0.6 + keyedRoll(state.seed, "chat-up", state.time) * 0.8));
  const c = state.customers.filter((x) => !x.crew && x.state === "line").sort((a, b) => b.lineTicket - a.lineTicket)[0];
  if (!c) return;
  wear(state, c, CREW.chatUpMinutes);
  crewSays(state, "chat_up");
  log(state, `${cw.name} is chatting up ${c.name}.`);
}

// Brody wanders off for a bit. His customers in line come over to yours.
function goMissing(state: GameState): void {
  const cw = state.coworker!;
  cw.at = "missing";
  cw.missingUntil = state.time + cw.missingUntil; // (it held how long)
  cw.missingAt = null;
  crewSays(state, "missing");
  const moved = state.customers.filter((c) => c.crew && (c.state === "line" || c.state === "talking"));
  for (const c of moved) {
    c.crew = false; // yours now
    c.state = "line";
  }
  if (moved.length) log(state, `${cw.name} went missing. ${moved.length === 1 ? `${moved[0].name} came` : `${moved.length} of his customers came`} over to your line.`);
  think(state, "coworker_missing", { coworker: cw.id });
}

// ---------- each minute ----------

export function runCoworker(state: GameState, dt: number): void {
  const cw = state.coworker;
  if (!cw || cw.at === "gone" || state.over) return;
  const def = coworkerDef(cw.id);
  // A request you didn't answer goes away on its own (an Ignore). Not while you're helping with it.
  if (state.request && state.time >= state.request.until && state.employee.task?.type !== "help_coworker") resolveRequest(state, "ignore");
  if (cw.task) {
    cw.stats.minutesWorked += dt;
    if (state.time < cw.task.until) return chatter(state);
    const t = cw.task;
    cw.task = null;
    finish(state, t);
    cw.idleUntil = state.time + Math.round(def.rates.dawdle * (0.5 + keyedRoll(state.seed, "dawdle", state.time)));
  }
  if (cw.at === "missing") {
    if (state.time < cw.missingUntil) return;
    cw.at = "counter";
    crewSays(state, "back");
  }
  if (cw.at === "break") {
    if (state.time < cw.breakUntil) return;
    cw.at = "counter";
    if (!crewSays(state, "back_break")) crewSays(state, "back");
  }
  if (cw.breaks.length && state.time >= cw.breaks[0] && state.time < state.closeAt) {
    cw.breaks.shift();
    cw.at = "break";
    cw.breakUntil = state.time + def.breaks.minutes;
    crewSays(state, "break");
    return;
  }
  if (cw.missingAt !== null && state.time >= cw.missingAt && state.time < state.closeAt) return goMissing(state);
  if (cw.reorganizeAt !== null && state.time >= cw.reorganizeAt) {
    cw.reorganizeAt = null;
    state.shelfOrder = 1 + Math.floor(keyedRoll(state.seed, "shelf-order", state.day) * 1e6);
    crewSays(state, "reorganize");
  }
  chatter(state);
  if (state.time < cw.idleUntil) return; // (standing around)
  if (doubleCheck(state)) return;
  const p = nextPlan(state);
  if (!p) {
    cw.at = "counter";
    // After close, with nobody of theirs in the store: their shift's over.
    if (state.time >= state.closeAt && !state.customers.some((c) => c.crew && (c.state === "line" || c.state === "talking" || c.state === "waiting"))) {
      crewSays(state, "bye");
      cw.at = "gone";
      if (state.request?.from === cw.id && state.employee.task?.type !== "help_coworker") state.request = null;
      log(state, `${cw.name} went home.`);
    }
    return;
  }
  cw.at = p.station;
  cw.task = { kind: p.kind, what: p.what, station: p.station, customerId: p.customerId, jobId: p.jobId, until: state.time + p.minutes, total: p.minutes };
  if (keyedRoll(state.seed, "working", state.time) < CREW.workingLine) crewSays(state, "working");
}

// The talking (and asking) they do whatever they're doing.
function chatter(state: GameState): void {
  const cw = state.coworker!;
  const def = coworkerDef(cw.id);
  if (cw.at === "break" || cw.at === "missing" || cw.at === "gone") return;
  const louder = state.time < cw.louderUntil;
  if (state.time >= cw.nextChatAt && def.rates.chat > 0) {
    chat(state);
    cw.nextChatAt = state.time + Math.max(3, Math.round((60 / def.rates.chat) * (0.6 + keyedRoll(state.seed, "chat-gap", state.time) * 0.8) * (louder ? 0.5 : 1)));
  }
  if (state.time >= cw.nextChatUpAt && state.time < state.closeAt) chatUp(state);
  if (state.time >= cw.nextRequestAt && !state.request && state.time < state.closeAt) {
    const r = def.requests.find((x) => x.id !== "upsell");
    if (r) {
      const line = pickLine(def.lines as unknown as Line[], `ask_${r.id}`, {}, nextLine(state, `ask_${r.id}`));
      ask(state, r.id, line.text);
    }
    cw.nextRequestAt = state.time + Math.max(15, Math.round((60 / (def.rates.requests * nudge(cw))) * (0.6 + keyedRoll(state.seed, "ask-gap", state.time) * 0.8)));
  }
}

// You're going home: their customers still in the store go too (with an order: they'll be back for it tomorrow).
export function crewGoesHome(state: GameState): void {
  for (const c of state.customers) {
    if (!c.crew || (c.state !== "line" && c.state !== "talking" && c.state !== "waiting")) continue;
    const j = c.jobId !== null ? jobById(state, c.jobId) : undefined;
    if (j && j.status !== "picked_up") c.state = "away";
    else {
      c.state = "gone";
      c.outcome = "closed";
      c.leftAt = state.time;
    }
  }
  state.request = null;
}
