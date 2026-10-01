// Everything you can work out from an order's specs alone: sheets and price.
import type { Finishing, JobSpec, Media } from "./types";
import { CARDSTOCK_UPCHARGE, FINISHING_PRICE, FULL_SERVICE, PRICE_PER_SIDE } from "./config";

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
  serviceFeeCents: number; // $2 unless printing is over $50
  rushCents: number; // 10% on orders over $50 due the same day
  totalCents: number;
}

export function fullServiceQuote(spec: JobSpec, sameDay: boolean): FullServiceQuote {
  const printCents = priceCents(spec);
  const big = printCents > FULL_SERVICE.feeWaivedAboveCents;
  const serviceFeeCents = big ? 0 : FULL_SERVICE.serviceFeeCents;
  const rushCents = big && sameDay ? Math.round(printCents * FULL_SERVICE.rushRate) : 0;
  return { printCents, serviceFeeCents, rushCents, totalCents: printCents + serviceFeeCents + rushCents };
}

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
