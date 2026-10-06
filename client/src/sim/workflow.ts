// Workflows: multi-step jobs (take an order, ship a package, collect and finish a print job, ...).
// Each is data (src/data/workflows.json): ordered steps, and per step the station, what you're holding, your pose,
// how long it takes, what you're thinking, how you do it by hand (the building block), and the hint on its note. While a workflow is on, nothing unrelated can start (jobs printing
// on their own keep going). Steps run one after another; the workflow pauses wherever there's a choice to make.
// Which steps are done comes from the state of things, so a workflow you abandon can be picked up again later.
import type { Customer, GameState, Job, Package, Station, TaskRequest, TaskType, Workflow, WorkflowKind } from "./types";
import data from "../data/workflows.json";
import { customerById, jobById, packageById } from "./util";

// How a step is done by hand in the UI. The sim only sees the result.
export type Block = "form" | "hold" | "tap" | "drag" | "number" | "wait";

export interface StepData {
  station: Station;
  held: string | null; // what you're holding (drawn in your hands)
  pose: string;
  duration: number;
  thought: string; // the thought bubble while you do it
  doing: string; // "You can't do that, you're <doing>."
  block: Block;
  hint: string; // what the note says to do next
  hands?: Hand[]; // how you do it by hand, in order (none: one tap)
}

// One part of doing a step by hand, naming the scene objects it's done on (manifest keys, or "box" for the package
// you're working on, "held" for what's in your hand, "hands" for the hand slot, "customer"). See view/hands.ts.
export interface Hand {
  tap?: string; // tap n of these
  n?: number;
  hold?: string; // press and hold this tool...
  on?: string; // ...over this (left out: on the tool itself); the progress shows there
  drag?: string; // drag this...
  to?: string; // ...here
  pick?: "box" | "bag" | "package"; // pick the right one
  form?: "order" | "label";
  pay?: true; // ring up: type the total (card) or the change (cash)
  finish?: true; // staple (a tap per set), or cut / laminate (hold)
}

export const STEP = data.steps as Record<TaskType, StepData>;
export const NOTE_TEXT = data.notes; // the bits of a note that aren't a step's hint
export const WORKFLOWS = data.workflows as Record<WorkflowKind, { label: string; steps: TaskType[] }>;

export interface StepInfo {
  type: TaskType;
  done: boolean;
  req: TaskRequest; // doing it
  alts: TaskRequest[]; // the other ways (cutting the corner, letting it go)
  data: StepData;
}

// The step an alternative stands in for: doing the alternative counts as that step done.
export const ALT_OF: Partial<Record<TaskType, TaskType>> = {
  tape_shut: "pack",
  use_anyway: "reprint",
  out_of_order_sign: "fix_copier",
  let_truck_go: "hand_off",
  leave_unread: "open_message",
  hand_over: "ring_up",
  skip_finish: "finish",
  manual_ring_up: "ring_up",
};

// Steps where you choose: the workflow waits for you there instead of moving on by itself.
// (Entering an order waits for you to fill in the form.)
const CHOICE: ReadonlySet<TaskType> = new Set(["respond", "enter_order", "pack", "reprint", "hand_off", "open_message"]);

function ids(state: GameState, wf: Workflow): { c?: Customer; job?: Job; pkg?: Package } {
  const c = wf.customerId !== undefined ? customerById(state, wf.customerId) : undefined;
  const jobId = wf.jobId ?? c?.jobId ?? undefined;
  const pkgId = wf.packageId ?? c?.packageId ?? undefined;
  return { c, job: jobId != null ? jobById(state, jobId) : undefined, pkg: pkgId != null ? packageById(state, pkgId) : undefined };
}

// The steps that apply to this workflow, in order.
function plan(state: GameState, wf: Workflow): TaskType[] {
  const { c, job, pkg } = ids(state, wf);
  return WORKFLOWS[wf.kind].steps.filter((t) => {
    switch (t) {
      case "tape":
        return !pkg?.taped; // taped shut instead of boxed: no separate taping
      case "reprint":
        return job?.smudge === "found" || wf.done.includes("reprint") || wf.done.includes("use_anyway");
      case "finish":
        return job !== undefined && job.spec.finishing !== "none";
      case "fix_copier":
        return wf.kind === "fix_copier" || wf.fixFirst === true;
      case "make_good":
        return wf.kind === "complaint" && (c?.about === "damaged_box" || c?.about === "wrong_label");
      case "fetch_bag":
        return job !== undefined && !job.walkUp;
      case "enter_order":
        return wf.kind !== "complaint"; // a free reprint goes straight to the printer
      case "send_job":
        return wf.kind !== "complaint" || c?.about === "smudged_return";
      default:
        return true;
    }
  });
}

// Done-ness comes from the state of things (a ripped box means boxing isn't done after all). One-off steps with
// nothing to look at (fixing the card reader, the truck, ...) count as done once done in this workflow.
function stepDone(state: GameState, wf: Workflow, t: TaskType): boolean {
  const { c, job, pkg } = ids(state, wf);
  const jobAt = (...statuses: Job["status"][]) => job !== undefined && statuses.includes(job.status);
  const pkgAt = (...statuses: Package["status"][]) => pkg !== undefined && statuses.includes(pkg.status);
  switch (t) {
    case "talk":
      return c !== undefined && c.state !== "line";
    case "respond":
      return c !== undefined && c.state !== "line" && c.state !== "talking";
    case "enter_order":
      return job !== undefined && !jobAt("new", "unread");
    case "send_job":
      return job !== undefined && !jobAt("new", "unread", "entered");
    case "collect":
      return jobAt("collected", "finished", "bagged", "picked_up");
    case "reprint":
      return job !== undefined && job.smudge !== "found";
    case "finish":
      return jobAt("finished", "bagged", "picked_up");
    case "bag":
      return jobAt("bagged", "picked_up");
    case "fetch_bag":
      return (c?.fetched ?? null) !== null || jobAt("picked_up", "canceled");
    case "ring_up":
    case "hand_over":
    case "manual_ring_up":
      if (wf.kind === "ship") return pkg?.paid === true;
      return wf.kind === "release_package" ? pkgAt("picked_up") : jobAt("picked_up", "canceled");
    case "pack":
      return pkg !== undefined && !pkgAt("new");
    case "tape":
      return pkgAt("packed", "weighed", "labeled", "binned", "shipped");
    case "weigh":
      return pkgAt("weighed", "labeled", "binned", "shipped");
    case "label":
      return pkgAt("labeled", "binned", "shipped");
    case "bin":
      return pkgAt("binned", "shipped");
    case "scan_dropoff":
      return pkg !== undefined;
    case "find_package":
      return pkgAt("found", "picked_up");
    case "escort":
      return c !== undefined && (c.state === "self_serve" || c.state === "gone");
    case "help_self_serve":
      return c !== undefined && c.state === "gone";
    case "make_copies":
      return jobAt("bagged", "picked_up");
    case "fix_copier":
      return wf.kind === "fix_copier" ? wf.done.includes(t) : state.copier.status === "ok";
    default:
      return wf.done.includes(t);
  }
}

// The request for a step, with whichever ids it needs.
function requestFor(state: GameState, wf: Workflow, t: TaskType): TaskRequest {
  const { c, job, pkg } = ids(state, wf);
  if (t === "ring_up" && job) {
    if (job.prepaid || job.priceCents === 0) return { type: "hand_over", customerId: c?.id };
    if (state.cardReader === "down") return { type: "manual_ring_up", customerId: c?.id };
  }
  if (t === "ring_up" && wf.kind === "release_package") return { type: "hand_over", customerId: c?.id };
  if (t === "ring_up" && state.cardReader === "down") return { type: "manual_ring_up", customerId: c?.id };
  if (t === "fetch_bag") return { type: t, customerId: c?.id, jobId: job?.id };
  switch (t) {
    case "talk":
    case "ask_again":
    case "respond":
    case "ring_up":
    case "hand_over":
    case "manual_ring_up":
    case "scan_dropoff":
    case "find_package":
    case "help_self_serve":
    case "escort":
    case "make_good":
    case "usher_out":
      return { type: t, customerId: c?.id };
    case "enter_order":
    case "send_job":
    case "make_copies":
    case "collect":
    case "reprint":
    case "use_anyway":
    case "finish":
    case "skip_finish":
    case "bag":
      return { type: t, jobId: job?.id };
    case "weigh":
    case "pack":
    case "tape":
    case "tape_shut":
    case "label":
    case "bin":
      return { type: t, packageId: pkg?.id };
    case "open_message":
    case "leave_unread":
      return { type: t, messageId: wf.messageId };
    default:
      return { type: t };
  }
}

function altsFor(state: GameState, wf: Workflow, t: TaskType): TaskRequest[] {
  switch (t) {
    case "pack":
      return [requestFor(state, wf, "tape_shut")];
    case "finish":
      return [requestFor(state, wf, "skip_finish")];
    case "reprint":
      return [requestFor(state, wf, "use_anyway")];
    case "fix_copier":
      return wf.kind === "fix_copier" ? [{ type: "out_of_order_sign" }] : [];
    case "hand_off":
      return [{ type: "let_truck_go" }];
    case "open_message":
      return [requestFor(state, wf, "leave_unread")];
    case "respond":
      return [requestFor(state, wf, "ask_again")]; // plus the counter's answers (see actionBlocker in sim.ts)
    default:
      return [];
  }
}

export function workflowSteps(state: GameState, wf: Workflow): StepInfo[] {
  return plan(state, wf).map((t) => {
    const req = requestFor(state, wf, t);
    return { type: req.type, done: stepDone(state, wf, t), req, alts: altsFor(state, wf, t), data: STEP[req.type] };
  });
}

// The next thing to do in the workflow you're in, or null if you're not in one.
export function currentStep(state: GameState): StepInfo | null {
  const wf = state.workflow;
  if (!wf) return null;
  return workflowSteps(state, wf).find((s) => !s.done) ?? null;
}

export function isChoice(step: StepInfo): boolean {
  return CHOICE.has(step.type) || step.alts.length > 0;
}

// (Getting a bag off the shelf is for a customer: which bag you take is up to you.)
function same(a: TaskRequest, b: TaskRequest): boolean {
  return a.type === b.type && a.customerId === b.customerId && (a.type === "fetch_bag" || a.jobId === b.jobId) && a.packageId === b.packageId && a.messageId === b.messageId;
}

// Whether this request is the step you're on (or one of its alternatives).
export function isCurrentStep(state: GameState, req: TaskRequest): boolean {
  const step = currentStep(state);
  if (!step) return false;
  const bare = { ...req, choice: undefined };
  return same(bare, step.req) || step.alts.some((a) => same(bare, a));
}

export function lockMessage(type: TaskType): string {
  return `You can't do that, you're ${STEP[type].doing}.`;
}

// The workflow a task starts when you're not in one. Picking up a half-done one works too.
export function workflowFor(state: GameState, req: TaskRequest): Workflow {
  const wf = (kind: WorkflowKind, extra: Partial<Workflow> = {}): Workflow => ({ kind, done: [], startedAt: state.time, ...extra });
  const c = req.customerId !== undefined ? customerById(state, req.customerId) : undefined;
  const pkg = req.packageId !== undefined ? packageById(state, req.packageId) : undefined;
  switch (req.type) {
    case "talk":
    case "ask_again":
    case "respond":
      return wf("counter", { customerId: req.customerId });
    case "enter_order":
    case "send_job":
      return wf("take_order", { jobId: req.jobId, customerId: jobById(state, req.jobId!)?.customerId });
    case "collect":
    case "reprint":
    case "use_anyway":
    case "finish":
    case "skip_finish":
    case "bag":
      return wf("collect_finish", { jobId: req.jobId });
    case "fetch_bag":
    case "ring_up":
    case "hand_over":
    case "manual_ring_up":
      if (c?.kind === "package_pickup") return wf("release_package", { customerId: c.id });
      if (c?.kind === "ship") return wf("ship", { customerId: c.id, packageId: c.packageId ?? undefined });
      return wf("ring_up", { customerId: c?.id, jobId: c?.jobId ?? undefined });
    case "make_good":
      return wf("complaint", { customerId: req.customerId });
    case "weigh":
    case "pack":
    case "tape":
    case "tape_shut":
    case "label":
      return wf("ship", { packageId: req.packageId, customerId: pkg?.customerId });
    case "bin":
      return wf("bin", { packageId: req.packageId });
    case "scan_dropoff":
      return wf("dropoff", { customerId: req.customerId });
    case "find_package":
      return wf("release_package", { customerId: req.customerId });
    case "help_self_serve":
      return wf("self_serve_help", { customerId: req.customerId });
    case "escort":
      return wf("self_serve", { customerId: req.customerId });
    case "make_copies":
      return wf("walk_up", { jobId: req.jobId, customerId: jobById(state, req.jobId!)?.customerId });
    case "fix_copier":
    case "out_of_order_sign":
      return wf("fix_copier");
    case "hand_off":
    case "let_truck_go":
      return wf("hand_off");
    case "open_message":
    case "leave_unread":
      return wf("inbox", { messageId: req.messageId });
    case "clear_jam":
    case "load_paper":
    case "fix_card_reader":
    case "restart_router":
      return wf(req.type);
    case "usher_out":
      return wf("usher_out", { customerId: req.customerId });
  }
}
