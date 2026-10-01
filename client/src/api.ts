// Talks to the Spring Boot server. Every call fails soft, so the game still works offline.
import type { ShiftSummary } from "./sim/summary";

const API = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export interface LeaderboardRow {
  rank: number;
  playerName: string;
  score: number;
  cashCents: number;
  satisfaction: number;
  createdAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(API + path, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function getDailySeed(): Promise<number | null> {
  try {
    const body = await request<{ seed: number }>("/api/daily-seed");
    return body.seed;
  } catch {
    return null;
  }
}

export function postShift(summary: ShiftSummary): Promise<{ id: number }> {
  return request("/api/shifts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(summary),
  });
}

export function getLeaderboard(): Promise<LeaderboardRow[]> {
  return request("/api/leaderboard?limit=10");
}
