// Turning sim seconds into wall-clock text. Sim time 0 is opening time.
import { TUNING } from "./config";

// "9:05 AM"
export function formatClock(t: number): string {
  const total = Math.floor(TUNING.openHour * 60 + t / 60);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

// "40s", "12 min", "1 h 5 min"
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
