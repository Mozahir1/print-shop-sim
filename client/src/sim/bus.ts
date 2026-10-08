// Sim to view events: the sim says what just happened, the view animates it. Nothing in the sim listens, so the bot,
// the tests, and batch runs never notice it's here (and it never changes what happens).
import type { EventKind, FailureKind, Mood, PatienceStage } from "./types";

export interface SimEvents {
  customer_arrived: { customerId: number };
  customer_left: { customerId: number; mood: Mood };
  mood_changed: { customerId: number; stage: PatienceStage };
  job_printing: { jobId: number };
  sheet_printed: { jobId: number; sheets: number }; // throttled: every few sheets
  job_printed: { jobId: number };
  jam: Record<string, never>;
  tray_empty: Record<string, never>;
  copier_broken: Record<string, never>;
  truck_arrived: Record<string, never>;
  truck_left: Record<string, never>;
  crew_said: { text: string };
  crew_request: { text: string };
  package_binned: { packageId: number };
  bag_shelved: { jobId: number };
  payment_done: { customerId: number; cents: number };
  failure: { kind: FailureKind; text: string; customerId?: number };
  event_started: { kind: EventKind };
  event_resolved: { kind: EventKind };
}

type Handler<K extends keyof SimEvents> = (e: SimEvents[K]) => void;
const handlers: { [K in keyof SimEvents]?: Handler<K>[] } = {};

export function on<K extends keyof SimEvents>(kind: K, h: Handler<K>): () => void {
  const list = (handlers[kind] ??= []) as Handler<K>[];
  list.push(h);
  return () => list.splice(list.indexOf(h), 1);
}

export function emit<K extends keyof SimEvents>(kind: K, e: SimEvents[K]): void {
  for (const h of (handlers[kind] ?? []) as Handler<K>[]) h(e);
}

export const SHEETS_PER_EVENT = 5;
