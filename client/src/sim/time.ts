// Turning sim time into wall-clock text. Sim time is in game minutes since opening (9:00 AM): one sim step is one
// minute on the clock.
import { TUNING } from "./config";

// "9:05 AM"
export function formatClock(t: number): string {
  const total = Math.floor(TUNING.openHour * 60 + t);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

// "5 min", "1 h 5 min"
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.ceil(minutes));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}
