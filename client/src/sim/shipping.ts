// Shipping: customers sending packages, prepaid drop-offs, held packages from the morning delivery,
// and the carrier truck that comes once a day. sim.ts routes the tasks here and calls runTruck() every tick.
import type { BoxSize, Customer, GameState, Package, ShipRequest, ShipService, Task, TaskRequest, Truck } from "./types";
import { CARRIER_SHARE, DURATIONS, PACKING_FEE, PACKING_MATERIAL_CENTS, SHIPPING, SHIP_RATE } from "./config";
import { DOOR, PACKAGE_ROOM, REGISTER, SHIPPING_SCALE } from "./layout";
import { randInt, type Rng } from "./rng";
import { poisson, randomName, weighted } from "./schedule";
import { formatClock } from "./time";
import { clampRating, counterCustomer, customerById, log, money, near, sendAway } from "./util";
import { boxItem, boxUnitCents, fetchSeconds, take } from "./inventory";

const MIN = 60;
const HOUR = 3600;

export const SERVICE_LABEL: Record<ShipService, string> = { ground: "Ground", two_day: "Two-day", overnight: "Overnight" };

// ---------- the day's shipping customers ----------

// Generated from the shipping RNG stream, so they never change what the print customers or machines roll.
export function generateShipping(rng: Rng, firstId: number, closeAt: number): { customers: Customer[]; packages: Package[] } {
  const arrivals: { at: number | null; purpose: "ship" | "dropoff" | "package"; weight?: number }[] = [];

  // Morning delivery: held packages, and the people they belong to.
  const inbound = poisson(rng, SHIPPING.inboundMean);
  const heldWeights: number[] = [];
  for (let i = 0; i < inbound; i++) {
    const weight = rollWeight(rng);
    const comes = rng() < SHIPPING.ownersComeToday;
    const at = Math.round(15 * MIN + rng() * (closeAt - 35 * MIN));
    heldWeights.push(weight);
    arrivals.push({ at: comes ? at : null, purpose: "package", weight });
  }
  SHIPPING.shippersPerHour.forEach((rate, hour) => {
    const n = poisson(rng, rate);
    for (let i = 0; i < n; i++) arrivals.push({ at: Math.round((hour + rng()) * HOUR), purpose: "ship" });
  });
  SHIPPING.dropoffsPerHour.forEach((rate, hour) => {
    const n = poisson(rng, rate);
    for (let i = 0; i < n; i++) arrivals.push({ at: Math.round((hour + rng()) * HOUR), purpose: "dropoff" });
  });

  const customers: Customer[] = [];
  const packages: Package[] = [];
  arrivals.forEach((a, i) => {
    const c = makeShippingCustomer(rng, firstId + i, a.at, a.purpose);
    if (a.purpose === "package") {
      const pkg: Package = {
        id: packages.length + 1,
        customerId: c.id,
        direction: "in",
        kind: "held",
        service: null,
        weightLb: a.weight!,
        pricePaidCents: 0,
        status: "unsorted",
        createdAt: 0,
        shippedAt: null,
        releasedAt: null,
        missedTrucks: 0,
      };
      packages.push(pkg);
      c.packageId = pkg.id;
    }
    customers.push(c);
  });
  return { customers, packages };
}

// Also used by dev mode. `at` null means they don't come in today.
export function makeShippingCustomer(rng: Rng, id: number, at: number | null, purpose: "ship" | "dropoff" | "package"): Customer {
  const name = randomName(rng);
  const ship: ShipRequest | null = purpose === "ship" ? rollShipment(rng) : null;
  const dropoffCount = purpose === "dropoff" ? randInt(rng, SHIPPING.dropoffPackages[0], SHIPPING.dropoffPackages[1]) : 0;
  return {
    id,
    name,
    profileId: purpose === "ship" ? "shipping" : purpose === "dropoff" ? "dropoff" : "package_pickup",
    state: "outside",
    pos: { ...DOOR },
    visitAt: at,
    purpose,
    request: null,
    ship,
    dropoffCount,
    packageId: null,
    webOrderAt: null,
    jobId: null,
    linePatience: randInt(rng, SHIPPING.linePatience[0], SHIPPING.linePatience[1]) * MIN,
    lateTolerance: 10 * MIN,
    balkLineLength: randInt(rng, 5, 9),
    returnDelay: randInt(rng, 30, 90) * MIN,
    arrivalJitter: 0,
    selfServeRoll: 1,
    lineTicket: null,
    waitStart: null,
    lineWaitTotal: 0,
    seatedUntil: null,
    selfServeTicket: null,
    selfServeDeclined: false,
    returns: 0,
    penalty: 0,
    rating: null,
    outcome: null,
  };
}

function rollWeight(rng: Rng): number {
  const u = rng();
  return 1 + Math.floor((SHIPPING.maxWeightLb - 1) * u * u); // mostly light, the odd heavy one
}

export function rollShipment(rng: Rng): ShipRequest {
  const weightLb = rollWeight(rng);
  const service = weighted(rng, Object.keys(SHIPPING.serviceWeights) as ShipService[], (s) => SHIPPING.serviceWeights[s]);
  const packed = rng() < SHIPPING.packedChance;
  return { weightLb, service, packed, box: boxFor(weightLb) };
}

export function boxFor(weightLb: number): BoxSize {
  if (weightLb <= SHIPPING.boxMaxLb.small) return "small";
  if (weightLb <= SHIPPING.boxMaxLb.medium) return "medium";
  return "large";
}

export function createTruck(): Truck {
  return {
    arrivesAt: SHIPPING.truckArrives,
    leavesAt: SHIPPING.truckArrives + SHIPPING.truckWaits,
    status: "coming",
    handedOff: false,
    departedAt: null,
    warned: false,
  };
}

// ---------- money ----------

export interface ShipQuote {
  rateCents: number; // retail shipping rate
  packingCents: number; // 0 if they brought it packed
  totalCents: number; // what the customer pays
  carrierCents: number; // what the carrier charges us
  materialCents: number; // packing material
}

export function shipQuote(r: ShipRequest): ShipQuote {
  const rate = SHIP_RATE[r.service];
  const rateCents = rate.base + rate.perLb * Math.ceil(r.weightLb);
  const packingCents = r.packed ? 0 : PACKING_FEE[r.box];
  return {
    rateCents,
    packingCents,
    totalCents: rateCents + packingCents,
    carrierCents: Math.round(rateCents * CARRIER_SHARE),
    materialCents: r.packed ? 0 : PACKING_MATERIAL_CENTS,
  };
}

export function shipSeconds(r: ShipRequest): number {
  return DURATIONS.shipBase + (r.packed ? 0 : DURATIONS.pack[r.box]);
}

// ---------- lookups ----------

export function packageById(state: GameState, id: number): Package | undefined {
  return state.packages.find((p) => p.id === id);
}

export function stagedPackages(state: GameState): Package[] {
  return state.packages.filter((p) => p.status === "staged");
}

export function unsortedPackages(state: GameState): Package[] {
  return state.packages.filter((p) => p.status === "unsorted");
}

// The truck is here and there's something to give it.
export function truckNeedsHandoff(state: GameState): boolean {
  return state.truck.status === "waiting" && stagedPackages(state).length > 0;
}

function isExpress(service: ShipService | null): boolean {
  return service === "two_day" || service === "overnight";
}

// ---------- tasks ----------

// Why you can't do this shipping task right now, or null if you can.
export function canStartShipping(state: GameState, req: TaskRequest): string | null {
  switch (req.type) {
    case "ship_package":
    case "accept_dropoff":
    case "release_package": {
      const c = counterCustomer(state);
      if (!c) return "Nobody is at the counter.";
      const wants = { ship_package: "ship", accept_dropoff: "dropoff", release_package: "package" }[req.type];
      if (c.purpose !== wants) return `${c.name} isn't here for that (${purposeText(c)}).`;
      if (req.type === "ship_package" && !c.ship!.packed && state.stockroom[boxItem(c.ship!.box)] < 1) {
        return `The stockroom is out of ${c.ship!.box} boxes. You can turn them away (or ship it if they bring it packed).`;
      }
      if (req.type === "release_package") {
        const pkg = packageById(state, c.packageId!)!;
        if (pkg.status === "unsorted") return "Their package is still in this morning's unsorted delivery. Check the delivery in first.";
      }
      return null;
    }
    case "check_in_packages":
      return unsortedPackages(state).length ? null : "There's nothing waiting to be checked in.";
    case "hand_off_truck": {
      const t = state.truck;
      if (t.status === "coming") return `The truck isn't here yet. It comes at ${formatClock(t.arrivesAt)}.`;
      if (t.status === "gone") return "The truck has already left for today.";
      if (!stagedPackages(state).length) return "There's nothing staged to go out.";
      return null;
    }
    default:
      return "Not a shipping task.";
  }
}

export function buildShippingTask(state: GameState, req: TaskRequest): Task {
  const base = { ...req, elapsed: 0 };
  switch (req.type) {
    case "ship_package": {
      const c = counterCustomer(state)!;
      const fetch = c.ship!.packed ? 0 : fetchSeconds(SHIPPING_SCALE); // grab a box
      return { ...base, label: `Shipping ${c.name}'s package`, station: SHIPPING_SCALE, duration: shipSeconds(c.ship!) + fetch, customerId: c.id };
    }
    case "accept_dropoff": {
      const c = counterCustomer(state)!;
      const duration = DURATIONS.dropoffBase + DURATIONS.dropoffPerPackage * c.dropoffCount;
      return { ...base, label: `Taking ${c.name}'s drop-off`, station: REGISTER, duration, customerId: c.id };
    }
    case "release_package": {
      const c = counterCustomer(state)!;
      return { ...base, label: `Getting ${c.name}'s package from the hold shelf`, station: REGISTER, duration: DURATIONS.releasePackage, customerId: c.id };
    }
    case "check_in_packages": {
      const n = unsortedPackages(state).length;
      return { ...base, label: `Checking in the morning delivery (${n})`, station: PACKAGE_ROOM, duration: DURATIONS.checkInBase + DURATIONS.checkInPerPackage * n };
    }
    case "hand_off_truck": {
      const n = stagedPackages(state).length;
      return { ...base, label: `Handing ${n} package${n === 1 ? "" : "s"} to the driver`, station: PACKAGE_ROOM, duration: DURATIONS.handOffBase + DURATIONS.handOffPerPackage * n };
    }
    default:
      throw new Error(`not a shipping task: ${req.type}`);
  }
}

export function completeShippingTask(state: GameState, task: Task): void {
  const c = task.customerId !== undefined ? customerById(state, task.customerId)! : null;
  switch (task.type) {
    case "ship_package": {
      const r = c!.ship!;
      const q = shipQuote(r);
      const pkg = newPackage(state, c!.id, "shipment", r.service, r.weightLb, q.totalCents);
      state.revenueCents += q.totalCents;
      state.costCents += q.carrierCents + q.materialCents;
      state.stats.carrierCostCents += q.carrierCents;
      if (!r.packed) {
        take(state, boxItem(r.box), 1);
        state.costCents += boxUnitCents(r.box);
      }
      state.stats.shipments++;
      state.stats.shippingRevenueCents += q.totalCents;
      const late = state.truck.status === "gone" && isExpress(r.service);
      if (late) c!.penalty += 1; // it won't leave until tomorrow
      c!.outcome = "shipped";
      c!.rating = clampRating(5 - c!.penalty);
      sendAway(c!, null);
      const packing = r.packed ? "" : ` (boxed it in a ${r.box} box)`;
      log(state, `Shipped ${c!.name}'s ${r.weightLb} lb package ${SERVICE_LABEL[r.service].toLowerCase()}${packing} for ${money(q.totalCents)}. Package P${pkg.id} is staged.${late ? " The truck already left, so it goes out tomorrow." : ""}`);
      return;
    }
    case "accept_dropoff": {
      for (let i = 0; i < c!.dropoffCount; i++) newPackage(state, c!.id, "dropoff", null, 1 + (i % 3), 0);
      state.stats.dropoffs++;
      state.stats.dropoffPackages += c!.dropoffCount;
      c!.outcome = "dropped_off";
      c!.rating = clampRating(5 - c!.penalty);
      sendAway(c!, null);
      log(state, `Took ${c!.dropoffCount} prepaid return${c!.dropoffCount === 1 ? "" : "s"} from ${c!.name}.`);
      return;
    }
    case "release_package": {
      const pkg = packageById(state, c!.packageId!)!;
      pkg.status = "released";
      pkg.releasedAt = state.time;
      state.stats.packagePickups++;
      c!.outcome = "package_picked_up";
      c!.rating = clampRating(5 - c!.penalty);
      sendAway(c!, null);
      log(state, `${c!.name} picked up package P${pkg.id}.`);
      return;
    }
    case "check_in_packages": {
      const list = unsortedPackages(state);
      for (const p of list) p.status = "on_hold";
      log(state, `Checked in ${list.length} package${list.length === 1 ? "" : "s"} from the morning delivery. They're on the hold shelf.`);
      return;
    }
    case "hand_off_truck": {
      const list = stagedPackages(state);
      for (const p of list) {
        p.status = "shipped";
        p.shippedAt = state.time;
      }
      const t = state.truck;
      t.status = "gone";
      t.handedOff = true;
      t.departedAt = state.time;
      log(state, `Handed ${list.length} package${list.length === 1 ? "" : "s"} to the driver. The truck is gone for the day.`);
      return;
    }
  }
}

function newPackage(state: GameState, customerId: number, kind: Package["kind"], service: ShipService | null, weightLb: number, price: number): Package {
  const pkg: Package = {
    id: state.nextPackageId++,
    customerId,
    direction: "out",
    kind,
    service,
    weightLb,
    pricePaidCents: price,
    status: "staged",
    createdAt: state.time,
    shippedAt: null,
    releasedAt: null,
    missedTrucks: 0,
  };
  state.packages.push(pkg);
  return pkg;
}

// ---------- the truck ----------

export function runTruck(state: GameState): void {
  const t = state.truck;
  if (t.status === "coming" && state.time >= t.arrivesAt) {
    t.status = "waiting";
    const n = stagedPackages(state).length;
    log(state, `The carrier truck is here. The driver leaves at ${formatClock(t.leavesAt)}; ${n} package${n === 1 ? " is" : "s are"} staged.`);
  }
  if (t.status !== "waiting") return;
  if (!t.warned && state.time >= t.leavesAt - 5 * MIN) {
    t.warned = true;
    if (stagedPackages(state).length) log(state, "The driver is leaving in 5 minutes.");
  }
  // The driver doesn't pull away while you're standing there handing packages over.
  const task = state.employee.task;
  const handingOff = task?.type === "hand_off_truck" && near(state.employee.pos, task.station);
  if (state.time >= t.leavesAt && !handingOff) departWithoutHandoff(state);
}

function departWithoutHandoff(state: GameState): void {
  const t = state.truck;
  t.status = "gone";
  t.departedAt = state.time;
  const missed = stagedPackages(state);
  if (!missed.length) {
    log(state, "The driver left. There was nothing to pick up.");
    return;
  }
  let refunds = 0;
  for (const p of missed) {
    p.missedTrucks++;
    state.stats.missedTruckPackages++;
    if (isExpress(p.service)) {
      // The delivery date is blown, so the customer gets their money back. It still ships tomorrow.
      state.revenueCents -= p.pricePaidCents;
      state.stats.refundsCents += p.pricePaidCents;
      refunds += p.pricePaidCents;
    }
  }
  log(
    state,
    `The driver left without a hand-off. ${missed.length === 1 ? "1 package missed the truck and goes" : `${missed.length} packages missed the truck and go`} out tomorrow` +
      (refunds ? `; express packages were refunded (${money(refunds)}).` : "."),
  );
}

// ---------- words ----------

export function purposeText(c: Customer): string {
  switch (c.purpose) {
    case "order":
      return "new order";
    case "pickup":
      return `pickup #${c.jobId}`;
    case "ship":
      return "shipping";
    case "dropoff":
      return "drop-off";
    case "package":
      return "package pickup";
  }
}

export function shipSentence(r: ShipRequest): string {
  const when = { ground: "Ground is fine.", two_day: "It needs to get there in two days.", overnight: "It has to be there tomorrow." }[r.service];
  return `I need to ship this. It's about ${r.weightLb} lb. ${when} ${r.packed ? "It's already packed." : "Can you box it up for me?"}`;
}

