// Turning sim seconds into wall-clock text. Sim time 0 is opening time; the day is compressed so that
// TUNING.dayLength sim seconds read as open to close on the wall clock.
import { TUNING } from "./config";

// Wall-clock minutes per sim second.
const CLOCK_RATE = ((TUNING.closeHour - TUNING.openHour) * 60) / TUNING.dayLength;

// "9:05 AM"
export function formatClock(t: number): string {
  const total = Math.floor(TUNING.openHour * 60 + t * CLOCK_RATE);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

// "8s", "1 min 5s"
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s}s`;
  return s % 60 ? `${Math.floor(s / 60)} min ${s % 60}s` : `${s / 60} min`;
}
