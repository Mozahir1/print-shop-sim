// Everything you can work out from an order's specs alone: sheets, price, cost, how long it takes.
import type { Finishing, JobSpec, Media, PaperStock } from "./types";
import {
  FULL_SERVICE,
  SELF_SERVE,
  SELF_SERVE_PER_SIDE,
  CARDSTOCK_UPCHARGE,
  COST,
  DURATIONS,
  FINISHING_PRICE,
  PRICE_PER_SIDE,
  WIDE_PRICE,
  finishingWork,
} from "./config";

export function isWide(media: Media): media is "wide_18x24" | "wide_24x36" {
  return media === "wide_18x24" || media === "wide_24x36";
}

export function stockFor(media: Media): PaperStock {
  return isWide(media) ? "roll" : media;
}

// Paper used per sheet: 1 sheet from a tray, or feet off a 36" roll.
export function stockPerSheet(media: Media): number {
  if (media === "wide_18x24") return 2;
  if (media === "wide_24x36") return 3;
  return 1;
}

export function sqFt(media: Media): number {
  if (media === "wide_18x24") return 3;
  if (media === "wide_24x36") return 6;
  return 0;
}

export function sheetsPerCopy(spec: JobSpec): number {
  if (isWide(spec.media) || !spec.duplex) return spec.originals;
  return Math.ceil(spec.originals / 2);
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
  let cents: number;
  if (isWide(spec.media)) {
    cents = WIDE_PRICE[spec.color][spec.media] * sheets;
  } else {
    cents = PRICE_PER_SIDE[spec.color][sideSize(spec.media)] * impressions(spec);
    if (spec.media === "cardstock") cents += CARDSTOCK_UPCHARGE * sheets;
  }
  return cents + finishingPrice(spec.finishing, spec, sheets);
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

function finishingPrice(f: Finishing, spec: JobSpec, sheets: number): number {
  switch (f) {
    case "none":
    case "staple":
      return FINISHING_PRICE.staple;
    case "fold":
      return FINISHING_PRICE.foldPerSheet * sheets;
    case "cut":
      return FINISHING_PRICE.cutPer250Sheets * Math.ceil(sheets / 250);
    case "laminate":
      return (isWide(spec.media) ? FINISHING_PRICE.laminateWide : FINISHING_PRICE.laminateLetter) * sheets;
    case "coil_bind":
      return FINISHING_PRICE.coilBindPerBook * spec.copies;
  }
}

// Material cost of printing one sheet of this job (toner/ink + paper).
export function printCostPerSheet(spec: JobSpec): number {
  if (isWide(spec.media)) return COST.wideSqFt[spec.color] * sqFt(spec.media);
  const sidesPerSheet = impressions(spec) / totalSheets(spec);
  const sizeMult = spec.media === "tabloid" ? 2 : 1;
  return COST.sidePerColor[spec.color] * sidesPerSheet * sizeMult + COST.sheet[spec.media];
}

export function finishCostCents(spec: JobSpec): number {
  const sheets = totalSheets(spec);
  if (spec.finishing === "laminate") return (isWide(spec.media) ? COST.laminateWide : COST.laminatePouchLetter) * sheets;
  if (spec.finishing === "coil_bind") return COST.coilPerBook * spec.copies;
  return 0;
}

// Seconds of your time to finish and bag a printed job.
export function finishSeconds(spec: JobSpec): number {
  const sheets = totalSheets(spec);
  const work = finishingWork(spec.finishing, spec.copies, sheets, sheetsPerCopy(spec), isWide(spec.media));
  return Math.round(work + DURATIONS.bag + DURATIONS.bagPer500Sheets * Math.floor(sheets / 500));
}

// Finishing follows the ticket (it travels with the job); everything printed follows what the printer was told.
export function finishingSpec(job: { spec: JobSpec; ticket: JobSpec }): JobSpec {
  return { ...job.spec, finishing: job.ticket.finishing };
}

export function takeOrderSeconds(spec: JobSpec): number {
  let s = DURATIONS.takeOrderBase;
  if (spec.media !== "letter") s += DURATIONS.takeOrderPerOption;
  if (spec.duplex) s += DURATIONS.takeOrderPerOption;
  if (spec.finishing !== "none") s += DURATIONS.takeOrderPerOption;
  if (totalSheets(spec) > 100) s += DURATIONS.takeOrderBigRun;
  return s;
}

// ---------- self-serve ----------

// Why this job can't be done at the self-serve copiers, or null if it can.
// Any narrow format job on regular 20 lb bond qualifies, at any length. Stapling is fine (there's a stapler out there).
export function selfServeBlocker(spec: JobSpec): string | null {
  if (isWide(spec.media)) return "Wide format only runs on the production wide format printer.";
  if (spec.media === "cardstock") return "They want cardstock. Self-serve only stocks 20 lb bond.";
  if (spec.finishing !== "none" && spec.finishing !== "staple") {
    return `It needs ${FINISHING_LABEL[spec.finishing].toLowerCase()}, which is done behind the counter.`;
  }
  return null;
}

export function selfServePriceCents(spec: JobSpec): number {
  return SELF_SERVE_PER_SIDE[spec.color][sideSize(spec.media)] * impressions(spec);
}

// How long a customer spends at the copier: setup, then the copier's speed.
export function selfServeSeconds(spec: JobSpec): number {
  const ppm = SELF_SERVE.ppm[spec.color] * (spec.media === "tabloid" ? 0.5 : 1);
  return Math.round(SELF_SERVE.setupSeconds + (impressions(spec) / ppm) * 60);
}

// ---------- words ----------

export const MEDIA_LABEL: Record<Media, string> = {
  letter: 'Letter 8.5×11"',
  legal: 'Legal 8.5×14"',
  tabloid: 'Tabloid 11×17"',
  cardstock: 'Cardstock 8.5×11"',
  wide_18x24: '18×24" (wide format)',
  wide_24x36: '24×36" (wide format)',
};

export const FINISHING_LABEL: Record<Finishing, string> = {
  none: "No finishing",
  staple: "Staple",
  fold: "Fold",
  cut: "Cut",
  laminate: "Laminate",
  coil_bind: "Coil bind",
};

// Verb for the finishing button, e.g. "Bind & bag".
export const FINISHING_VERB: Record<Finishing, string> = {
  none: "Bag",
  staple: "Staple & bag",
  fold: "Fold & bag",
  cut: "Cut & bag",
  laminate: "Laminate & bag",
  coil_bind: "Bind & bag",
};

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

// "25 copies of a 3-page resume" / "2 copies each of 3 posters"
export function describeQuantity(spec: JobSpec): string {
  if (isWide(spec.media)) {
    const sheets = plural(spec.originals, spec.item);
    if (spec.copies === 1) return sheets;
    if (spec.originals === 1) return `${plural(spec.copies, "copy", "copies")} of a ${spec.item}`;
    return `${plural(spec.copies, "copy", "copies")} each of ${sheets}`;
  }
  return `${plural(spec.copies, "copy", "copies")} of a ${spec.originals}-page ${spec.item}`;
}

// One line of specs: "Color · Double-sided · Cardstock 8.5×11" · Coil bind"
export function describeSpecs(spec: JobSpec): string {
  const parts = [spec.color === "color" ? "Color" : "B&W"];
  if (!isWide(spec.media)) parts.push(spec.duplex ? "Double-sided" : "Single-sided");
  parts.push(MEDIA_LABEL[spec.media]);
  if (spec.finishing !== "none") parts.push(FINISHING_LABEL[spec.finishing]);
  return parts.join(" · ");
}

// What the customer says at the counter.
export function requestSentence(spec: JobSpec): string {
  const bits: string[] = [];
  if (spec.color === "color") bits.push("in color");
  else bits.push("black and white");
  if (spec.duplex) bits.push("double-sided");
  if (spec.media === "cardstock") bits.push("on cardstock");
  if (spec.media === "legal") bits.push("on legal paper");
  if (spec.media === "tabloid") bits.push("on 11×17");
  if (spec.media === "wide_18x24") bits.push("at 18×24");
  if (spec.media === "wide_24x36") bits.push("at 24×36");
  const fin: Record<Finishing, string> = {
    none: "",
    staple: "stapled",
    fold: "folded",
    cut: "cut down",
    laminate: "laminated",
    coil_bind: "coil bound",
  };
  if (fin[spec.finishing]) bits.push(fin[spec.finishing]);
  return `I need ${describeQuantity(spec)}, ${bits.join(", ")}.`;
}
