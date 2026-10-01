// Store floor plan. 1 tile = 1 meter. Change numbers here to rearrange the store.
import type { Vec } from "./types";

export const MAP_W = 22; // the last 2 m are the loading area outside the package room
export const MAP_H = 12;

export interface Zone {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export const zones: Zone[] = [
  { id: "production", label: "Production (staff only)", x: 6, y: 0, w: 14, h: 4.6, color: "#e4e9e1" },
  { id: "counter", label: "Counter", x: 6, y: 4.6, w: 11, h: 0.8, color: "#c8b597" },
  { id: "finishing", label: "Finishing table", x: 17.4, y: 0.8, w: 2.4, h: 2.2, color: "#d6d0c4" },
  { id: "shelf", label: "Pickup shelf", x: 6.2, y: 3.7, w: 2.6, h: 0.7, color: "#c9d3df" },
  { id: "waiting", label: "Waiting area", x: 0.4, y: 0.6, w: 4.6, h: 4.6, color: "#ece6da" },
  { id: "door", label: "Entrance", x: 0, y: 11.3, w: 2.4, h: 0.7, color: "#b8b8b8" },
  { id: "self-service", label: "Self-service area", x: 0.4, y: 5.6, w: 4.6, h: 5.7, color: "#e8e8e8" },
  { id: "scale", label: "Shipping scale", x: 15.4, y: 3.7, w: 1.6, h: 0.7, color: "#d9c9a8" },
  { id: "package-room", label: "Package room (staff)", x: 17.2, y: 5.6, w: 2.8, h: 2.9, color: "#e4dccb" },
  { id: "stockroom", label: "Stockroom (staff)", x: 17.2, y: 8.7, w: 2.8, h: 3.0, color: "#ddd6c8" },
  { id: "loading", label: "Loading area", x: 20.2, y: 0, w: 1.8, h: 12, color: "#cfcfcf" },
];

// Where the carrier truck parks while it waits, outside the package room door.
export const TRUCK_BAY = { x: 20.3, y: 5.4, w: 1.6, h: 3.2 };

export const DOOR: Vec = { x: 1.2, y: 11.6 };
export const REGISTER: Vec = { x: 10.5, y: 4.1 }; // where you stand to serve the counter and send jobs
export const FINISHING_STATION: Vec = { x: 18.6, y: 3.5 };
export const SHIPPING_SCALE: Vec = { x: 16.2, y: 4.1 }; // right end of the counter, staff side
export const PACKAGE_ROOM: Vec = { x: 19.4, y: 7.0 }; // by the door to the truck
export const STOCKROOM: Vec = { x: 18.6, y: 10.2 };

// Self-serve copiers along the left wall of the self-service area; the customer stands to the right of each.
export const COPIER_SPOTS: Vec[] = [
  { x: 2.4, y: 6.6 },
  { x: 2.4, y: 8.6 },
];
export const SELF_SERVE_HELP_SPOT: Vec = { x: 3.4, y: 7.6 }; // where you stand to show someone the copier

// Queue for the next free copier, along the right side of the self-service area.
export function selfServeQueueSlot(i: number): Vec {
  if (i <= 4) return { x: 4.4, y: 6.2 + i * 0.9 };
  return { x: 3.5, y: 10.6 - (i - 5) * 0.9 };
}

// Slot 0 is the front of the line, facing the register. The line runs down, then left.
export function lineSlot(i: number): Vec {
  if (i <= 4) return { x: 10.5, y: 6.2 + i * 0.9 };
  return { x: 10.5 - (i - 4) * 0.9, y: 9.8 };
}

const SEATS: Vec[] = [];
for (let y = 1.6; y < 5; y += 1.1) {
  for (let x = 1.2; x < 5; x += 1.1) SEATS.push({ x, y });
}

// Deterministic by customer id, so player actions don't consume randomness.
export function seatFor(customerId: number): Vec {
  return SEATS[customerId % SEATS.length];
}
