// Everything you can work out from an order's specs alone: sheets, prices and fees, self-serve, shipping.
import type { BoxSize, Finishing, JobSpec, Media, ShipService } from "./types";
import {
  CARDSTOCK_UPCHARGE,
  FINISHING_PRICE,
  FULL_SERVICE,
  PACKING_FEE,
  POSTAGE_CUT,
  PRICE_PER_SIDE,
  SELF_SERVE,
  SELF_SERVE_PER_SIDE,
  SHIPPING,
  SHIP_RATE,
} from "./config";

export function sheetsPerCopy(spec: JobSpec): number {
  return spec.duplex ? Math.ceil(spec.originals / 2) : spec.originals;
}

export function totalSheets(spec: JobSpec): number {
  return sheetsPerCopy(spec) * spec.copies;
}

export function impressions(spec: JobSpec): number {
  return spec.originals * spec.copies;
}

// Price-list size for the per-side rate. Cardstock is letter-sized.
function sideSize(media: Media): "letter" | "legal" | "tabloid" {
  return media === "legal" || media === "tabloid" ? media : "letter";
}

export function priceCents(spec: JobSpec): number {
  const sheets = totalSheets(spec);
  let cents = PRICE_PER_SIDE[spec.color][sideSize(spec.media)] * impressions(spec);
  if (spec.media === "cardstock") cents += CARDSTOCK_UPCHARGE * sheets;
  return cents + finishingPrice(spec.finishing, sheets);
}

function finishingPrice(f: Finishing, sheets: number): number {
  switch (f) {
    case "none":
    case "staple":
      return FINISHING_PRICE.staple;
    case "cut":
      return FINISHING_PRICE.cutPer250Sheets * Math.ceil(sheets / 250);
    case "laminate":
      return FINISHING_PRICE.laminateSheet * sheets;
  }
}

export interface FullServiceQuote {
  printCents: number; // the price list
  serviceFeeCents: number; // flat, on small orders
  rushCents: number; // a share of the printing, if it's a rush
  totalCents: number;
}

export function fullServiceQuote(spec: JobSpec, rush: boolean): FullServiceQuote {
  const printCents = priceCents(spec);
  const serviceFeeCents = printCents < FULL_SERVICE.serviceFeeUnderCents ? FULL_SERVICE.serviceFeeCents : 0;
  const rushCents = rush ? Math.max(FULL_SERVICE.rushMinCents, Math.round(printCents * FULL_SERVICE.rushRate)) : 0;
  return { printCents, serviceFeeCents, rushCents, totalCents: printCents + serviceFeeCents + rushCents };
}

// ---------- self-serve ----------

// Why this job can't be done at the self-serve copier, or null if it can: plain paper and nothing that needs the
// back counter (a stapler is out there). Whether they're staying in the store is up to the customer.
export function selfServeBlocker(spec: JobSpec): string | null {
  if (spec.media === "cardstock") return "Self-serve only has plain paper.";
  if (spec.finishing === "cut" || spec.finishing === "laminate") return `It needs to be ${FINISHING_LABEL[spec.finishing].toLowerCase()}${spec.finishing === "cut" ? "" : "d"}, which is done behind the counter.`;
  return null;
}

export function selfServePriceCents(spec: JobSpec): number {
  return SELF_SERVE_PER_SIDE[spec.color][sideSize(spec.media)] * impressions(spec);
}

// How long they spend at the copier.
export function selfServeSeconds(spec: JobSpec): number {
  return Math.min(SELF_SERVE.maxSeconds, Math.round(SELF_SERVE.setupSeconds + impressions(spec) / SELF_SERVE.sidesPerSecond));
}

// ---------- shipping ----------

export function boxFor(weightLb: number): BoxSize {
  return weightLb <= SHIPPING.boxMaxLb.small ? "small" : weightLb <= SHIPPING.boxMaxLb.medium ? "medium" : "large";
}

export interface ShipQuote {
  postageCents: number;
  packingCents: number;
  totalCents: number; // what the customer pays
  storeCents: number; // what the store keeps: packing plus a small cut of postage
}

export function shipQuote(weightLb: number, service: ShipService): ShipQuote {
  const rate = SHIP_RATE[service];
  const postageCents = rate.base + rate.perLb * Math.ceil(weightLb);
  const packingCents = PACKING_FEE[boxFor(weightLb)];
  return { postageCents, packingCents, totalCents: postageCents + packingCents, storeCents: packingCents + Math.round(postageCents * POSTAGE_CUT) };
}

export const SERVICE_LABEL: Record<ShipService, string> = { ground: "Ground", two_day: "2-day", overnight: "Overnight" };

// ---------- words ----------

export const MEDIA_LABEL: Record<Media, string> = {
  letter: 'Letter 8.5×11"',
  legal: 'Legal 8.5×14"',
  tabloid: 'Tabloid 11×17"',
  cardstock: 'Cardstock 8.5×11"',
};

export const FINISHING_LABEL: Record<Finishing, string> = {
  none: "No finishing",
  staple: "Staple",
  cut: "Cut",
  laminate: "Laminate",
};

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

// "25 copies of a 3-page resume"
export function describeQuantity(spec: JobSpec): string {
  return `${plural(spec.copies, "copy", "copies")} of a ${spec.originals}-page ${spec.item}`;
}

// One line of specs: "Color · Double-sided · Cardstock 8.5×11" · Laminate"
export function describeSpecs(spec: JobSpec): string {
  const parts = [spec.color === "color" ? "Color" : "B&W", spec.duplex ? "Double-sided" : "Single-sided", MEDIA_LABEL[spec.media]];
  if (spec.finishing !== "none") parts.push(FINISHING_LABEL[spec.finishing]);
  return parts.join(" · ");
}
