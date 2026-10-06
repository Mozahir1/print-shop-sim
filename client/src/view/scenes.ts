// The six stations. Each shows the state of its things and the moments the sim tells it about; the hands-on part of
// every step comes from Station (station.ts) and the step data.
import Phaser from "phaser";
import { currentCustomer } from "../sim/sim";
import { currentStep } from "../sim/workflow";
import { customerById, jobById, packageById } from "../sim/util";
import { on } from "../sim/bus";
import { boxFor } from "../sim/orders";
import type { BoxSize, Customer } from "../sim/types";
import { atCounter, computerPanel, dialogueHtml, labelForm, orderForm } from "../ui/view";
import { SPOT, playAnim, sound, sprite } from "./assets";
import { FONT } from "./config";
import { ctl, keypad, part, register, state } from "./run";
import { bounce, say, shake, sparkle } from "./juice";
import { Station, type Candidate, type Obj } from "./station";
import { money } from "../sim/util";

// An in-world DOM overlay at (x, y) in game pixels. It only redraws when what it shows changes (so a form never loses
// what you've typed).
function overlay(scene: Station, x: number, y: number, cls: string): (html: string) => void {
  const el = document.createElement("div");
  el.className = `overlay-ui ${cls}`;
  Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
  document.getElementById("layer")!.append(el);
  scene.doms.push(el);
  let last = "";
  return (html) => {
    if (html === last) return;
    last = html;
    el.innerHTML = html;
    el.hidden = !html;
  };
}

function listen(scene: Phaser.Scene, offs: (() => void)[]): void {
  scene.events.once("shutdown", () => offs.forEach((f) => f()));
}

// ---------- the counter ----------

export class CounterScene extends Station {
  private cust!: Phaser.GameObjects.Container;
  private body!: Phaser.GameObjects.Sprite;
  private face!: Phaser.GameObjects.Sprite;
  private prop!: Phaser.GameObjects.Sprite; // what a complaint brings back
  private held!: Phaser.GameObjects.Sprite;
  private sign!: Phaser.GameObjects.Sprite;
  private others: Phaser.GameObjects.Sprite[] = [];
  private shownId = -1;
  private leaving = false;
  private dialog!: (html: string) => void;
  private pad!: Phaser.GameObjects.Container;
  private padText!: Phaser.GameObjects.Text;

  constructor() {
    super("counter", ["counter", "self_serve"]);
  }

  protected build(): void {
    const [cx, cy] = SPOT.counterCustomer;
    for (let i = 0; i < 3; i++) this.others.push(sprite(this, "customer/body_a", 600 - i * 30, 246).setScale(0.6).setAlpha(0.45).setDepth(4).setVisible(false));
    this.body = sprite(this, "customer/body_a", 0, 0);
    this.face = sprite(this, "customer/face_fine", 0, -92);
    this.cust = this.add.container(cx, cy, [this.body, this.face]).setDepth(8).setVisible(false).setSize(70, 130);
    this.prop = sprite(this, "shipping/box_damaged", cx - 60, 236).setDepth(12).setVisible(false);
    this.held = sprite(this, "item/bag", SPOT.counterHeld[0], SPOT.counterHeld[1]).setInteractive({ useHandCursor: true }).setVisible(false);
    const copier = this.objs.get("counter/copier")!;
    this.sign = sprite(this, "counter/sign", copier.x, copier.y - 20).setDepth(25).setVisible(false);
    this.dialog = overlay(this, 8, 24, "dialog");
    this.buildPad();
    listen(this, [
      on("customer_left", (e) => e.customerId === this.shownId && this.walkOut(e.mood === "angry")),
      on("mood_changed", (e) => {
        if (e.customerId !== this.shownId) return;
        const c = customerById(state(), e.customerId);
        if (c?.said && e.stage !== "fine") say(this, this.cust.x, this.cust.y - 150, c.said, e.stage === "angry" ? "#b3261e" : "#a86400");
        if (e.stage !== "fine") shake(this.cust);
      }),
      on("payment_done", () => {
        const r = this.objs.get("counter/register")!;
        sound(this, "register_ding");
        sparkle(this, r.x, r.y - 20);
      }),
      on("failure", (e) => {
        if (e.customerId !== this.shownId) return;
        shake(this.cust);
        this.body.setTint(0xffb3b3);
        this.time.delayedCall(500, () => this.body.clearTint());
      }),
      on("copier_broken", () => shake(this.objs.get("counter/copier")!)),
    ]);
  }

  private buildPad(): void {
    const [x, y] = SPOT.keypad;
    const bg = this.add.rectangle(0, 0, 160, 176, 0x2f3a48).setOrigin(0).setStrokeStyle(1, 0x10141a);
    this.padText = this.add.text(8, 6, "", { ...FONT, color: "#7cff9a", fontSize: "10px", lineSpacing: 2 });
    const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "back", "ok"];
    const items: Phaser.GameObjects.GameObject[] = [bg, this.padText];
    keys.forEach((k, i) => {
      const w = k === "ok" ? 144 : 44;
      const kx = 8 + (i % 3) * 50;
      const ky = 56 + Math.floor(i / 3) * 24;
      const r = this.add.rectangle(kx, ky, w, 20, k === "ok" ? 0x2e7d4f : 0xe9e7e1).setOrigin(0).setInteractive({ useHandCursor: true });
      r.on("pointerdown", () => {
        this.tweens.add({ targets: r, alpha: 0.6, duration: 60, yoyo: true });
        sound(this, "pick_up");
        keypad(k);
      });
      items.push(r, this.add.text(kx + w / 2, ky + 10, k === "back" ? "<" : k === "ok" ? "OK" : k, { ...FONT, color: k === "ok" ? "#ffffff" : "#1f2328" }).setOrigin(0.5));
    });
    this.pad = this.add.container(x, y, items).setDepth(60).setVisible(false);
  }

  protected special(name: string): Obj | undefined {
    return name === "customer" ? this.cust : name === "held" ? this.held : undefined;
  }

  protected tapAround(name: string): Obj | undefined {
    return name.startsWith("counter/copier") ? this.objs.get("counter/copier") : undefined;
  }

  // A customer comes in through the door.
  private walkIn(c: Customer): void {
    this.shownId = c.id;
    const variant = c.kind === "business" ? "business" : "abc"[c.id % 3];
    this.body.setTexture(`customer/body_${variant}`);
    const [cx, cy] = SPOT.counterCustomer;
    this.cust.setPosition(SPOT.doorway[0], cy).setVisible(true).setAlpha(1);
    playAnim(this.body, "walk");
    this.tweens.add({ targets: this.cust, x: cx, duration: 600, ease: "Sine.easeOut", onComplete: () => playAnim(this.body, "idle") });
  }

  private walkOut(angry: boolean): void {
    this.leaving = true;
    if (angry) shake(this.cust);
    playAnim(this.body, "walk");
    this.tweens.add({
      targets: this.cust,
      x: SPOT.doorway[0] + 60,
      alpha: 0,
      delay: angry ? 250 : 400,
      duration: angry ? 350 : 700,
      onComplete: () => {
        this.cust.setVisible(false);
        this.shownId = -1;
        this.leaving = false;
      },
    });
  }

  protected refresh(): void {
    const s = state();
    const who = atCounter(s);
    if (!this.leaving && who && who.id !== this.shownId) this.walkIn(who);
    if (!this.leaving && !who && this.shownId !== -1) {
      this.cust.setVisible(false);
      this.shownId = -1;
    }
    if (who && who.id === this.shownId) this.face.setTexture(`customer/face_${who.stage === "gone" ? "angry" : who.stage}`);
    // What a complaint brings back: the crushed box, the smudged copies, the package that bounced.
    const about = who?.kind === "complaint" ? who.about : null;
    this.prop.setVisible(!!about && !this.leaving).setTexture(about === "smudged_return" ? "printer/stack" : "shipping/box_damaged");
    const line = s.customers.filter((c) => (c.state === "line" || c.state === "talking") && c.id !== who?.id).length;
    this.others.forEach((o, i) => o.setVisible(i < line));
    const copier = this.objs.get("counter/copier")!;
    copier.setTexture(s.copier.status === "broken" ? "counter/copier_broken" : "counter/copier");
    this.sign.setVisible(s.copier.sign);
    this.objs.get("counter/reader")!.setTexture(s.cardReader === "down" ? "counter/reader_down" : "counter/reader");
    const d = ctl.doing;
    this.held.setVisible(!!d && part(d).drag === "held");
    this.held.setTexture(customerById(s, d?.req.customerId ?? -1)?.kind === "package_pickup" ? "item/box" : "item/bag");
    const front = currentCustomer(s);
    this.dialog(dialogueHtml(s, ctl.talk.id === front?.id ? ctl.talk.n : 0, ctl.confirming?.key ?? null));
    const paying = !!d && !!part(d).pay;
    this.pad.setVisible(paying);
    if (paying) {
      const r = register(d!.req.customerId!);
      this.padText.setText(`Due ${money(r.due)}\n${r.cash === null ? "Card. Type the total." : `Cash ${money(r.cash)}. Change?`}\n> ${d!.typed || "_"}`);
    }
  }
}

// ---------- the computer ----------

export class ComputerScene extends Station {
  private screen!: (html: string) => void;
  protected freeButtons = false; // (the monitor lists them)

  constructor() {
    super("computer", ["computer"]);
  }

  protected build(): void {
    this.screen = overlay(this, 116, 46, "monitor");
  }

  protected refresh(): void {
    const s = state();
    const d = ctl.doing;
    this.screen(d && part(d).form === "order" ? orderForm(s, d.req.jobId!) : computerPanel(s));
  }
}

// ---------- the printer ----------

export class PrinterScene extends Station {
  private light!: Phaser.GameObjects.Sprite;
  private status!: Phaser.GameObjects.Text;

  constructor() {
    super("printer", ["printer"]);
  }

  protected build(): void {
    this.light = sprite(this, "printer/light_idle", 400, 76);
    this.status = this.add.text(320, 222, "", { ...FONT, color: "#1f2328" }).setOrigin(0.5, 0).setDepth(40);
    listen(this, [
      on("sheet_printed", () => this.objs.get("printer/stack")?.getData("dragging") || sound(this, "printer_hum")),
      on("job_printed", () => bounce(this.objs.get("printer/stack")!)),
      on("jam", () => {
        sound(this, "jam");
        shake(this.objs.get("printer/body")!);
      }),
      on("tray_empty", () => shake(this.objs.get("printer/tray")!)),
    ]);
  }

  protected tapAround(name: string): Obj | undefined {
    return name === "printer/jam_sheet" ? this.objs.get("printer/jam_panel") : this.objs.get(name);
  }

  protected refresh(): void {
    const s = state();
    const p = s.printer;
    const cur = p.currentJobId !== null ? jobById(s, p.currentJobId) : undefined;
    const done = s.jobs.filter((j) => j.status === "printed");
    const sheets = done.reduce((n, j) => n + j.sheets, 0) + (cur?.sheetsPrinted ?? 0);
    // The output tray: the stack grows sheet by sheet while it prints.
    const stack = this.objs.get("printer/stack")!;
    if (!stack.getData("dragging")) stack.setVisible(sheets > 0).setScale(1, Math.min(1.6, 0.15 + sheets / 120));
    this.light.setTexture(`printer/light_${p.status}`);
    const d = ctl.doing;
    this.objs.get("printer/jam_panel")!.setTexture(p.status === "jammed" && d?.req.type === "clear_jam" && d.i >= 1 ? "printer/jam_panel_open" : "printer/jam_panel");
    this.objs.get("printer/tray")!.setTexture(p.status === "tray_empty" ? "printer/tray_open" : "printer/tray");
    this.status.setText(p.status === "jammed" ? "Jammed" : p.status === "tray_empty" ? "Out of paper" : cur ? `Printing #${cur.id}: ${Math.floor(cur.sheetsPrinted)} of ${cur.sheets}` : done.length ? `${done.length} ready to collect` : "Idle");
  }
}

// ---------- the finishing table ----------

export class FinishingScene extends Station {
  constructor() {
    super("finishing", ["finishing"]);
  }

  protected tapAround(name: string): Obj | undefined {
    return name === "finishing/set" ? this.objs.get("finishing/stack") : this.objs.get(name);
  }

  protected refresh(): void {
    const s = state();
    const d = ctl.doing;
    const wfJob = s.workflow?.jobId !== undefined ? jobById(s, s.workflow.jobId) : undefined;
    const onTable = !!wfJob && (wfJob.status === "collected" || wfJob.status === "finished");
    const bagging = d?.req.type === "bag";
    const stack = this.objs.get("finishing/stack")!;
    if (!stack.getData("dragging")) stack.setVisible(onTable && (!bagging || d!.i === 0)).setScale(1, wfJob ? Math.min(1.6, 0.3 + wfJob.sheets / 150) : 1);
    const label = this.objs.get("finishing/name_label")!;
    if (!label.getData("dragging")) label.setVisible(bagging && d!.i <= 1);
    const bag = this.objs.get("finishing/bag")!;
    if (!bag.getData("dragging")) bag.setVisible(bagging);
  }
}

// ---------- shipping ----------

const BOX_TEX: Record<BoxSize, string> = { small: "shipping/box_small", medium: "shipping/box_medium", large: "shipping/box_large" };

export class ShippingScene extends Station {
  private work!: Phaser.GameObjects.Sprite; // the box you're working on
  private readout!: Phaser.GameObjects.Text;
  private binText!: Phaser.GameObjects.Text;
  private labelForm!: (html: string) => void;
  private weighed = -1;

  constructor() {
    super("shipping", ["shipping"]);
  }

  protected build(): void {
    this.work = sprite(this, "shipping/box_medium", SPOT.shippingWork[0], SPOT.shippingWork[1]).setInteractive({ useHandCursor: true }).setVisible(false);
    const scale = this.objs.get("shipping/scale")!;
    this.readout = this.add.text(scale.x, scale.y + 8, "0 lb", { ...FONT, color: "#7cff9a", backgroundColor: "#1f2a1f", padding: { x: 3, y: 1 } }).setOrigin(0.5).setDepth(41);
    const bin = this.objs.get("shipping/bin")!;
    this.binText = this.add.text(bin.x, bin.y - 56, "", { ...FONT }).setOrigin(0.5).setDepth(41);
    this.labelForm = overlay(this, 300, 30, "labelform");
    listen(this, [on("package_binned", () => bounce(this.objs.get("shipping/bin")!)), on("truck_arrived", () => sound(this, "thunk"))]);
  }

  private pkg() {
    const s = state();
    const wf = s.workflow;
    const id = wf?.packageId ?? (wf?.customerId !== undefined ? customerById(s, wf.customerId)?.packageId : null);
    return id != null ? packageById(s, id) : undefined;
  }

  protected special(name: string): Obj | undefined {
    if (name !== "box") return undefined;
    return this.pkg()?.kind === "dropoff" ? this.objs.get("shipping/dropoff") : this.work;
  }

  protected candidates(what: string): Candidate[] {
    if (what !== "box") return [];
    return (["small", "medium", "large"] as BoxSize[]).map((b) => ({ obj: this.objs.get(BOX_TEX[b])!, value: b }));
  }

  protected tapAround(name: string): Obj | undefined {
    return name === "shipping/paper" ? this.work : this.objs.get(name);
  }

  protected showPart(): void {
    const d = ctl.doing!;
    this.labelForm(part(d).form === "label" ? labelForm(state(), d.req.packageId!) : "");
  }

  protected refresh(): void {
    const s = state();
    const d = ctl.doing;
    const p = this.pkg();
    const ship = p?.kind === "ship";
    const picking = !!d && part(d).pick === "box";
    const boxIn = !!d && !!d.req.box && (d.req.type === "pack" || d.req.type === "tape_shut");
    for (const b of ["small", "medium", "large"] as BoxSize[]) this.objs.get(BOX_TEX[b])!.setVisible(ship && p!.status === "new" && picking);
    const item = this.objs.get("shipping/item")!;
    if (!item.getData("dragging")) item.setVisible(ship && p!.status === "new" && (!d || !boxIn || d.i <= 1));
    const paper = this.objs.get("shipping/paper")!;
    paper.setVisible(false);
    // The box: open while you pack it, taped after; on the scale once it's weighed.
    const onBox = ship && (p!.status !== "new" || boxIn);
    if (!this.work.getData("dragging")) {
      this.work.setVisible(onBox && p!.status !== "binned" && p!.status !== "shipped");
      const size = d?.req.box ?? p?.box ?? boxFor(p?.weightLb ?? 1);
      this.work.setTexture(ship && ["packed", "weighed", "labeled"].includes(p!.status) ? "shipping/box_closed" : BOX_TEX[size]);
      const onScale = ship && (p!.status === "weighed" || p!.status === "labeled");
      const scale = this.objs.get("shipping/scale")!;
      this.work.setPosition(onScale ? scale.x : SPOT.shippingWork[0], onScale ? scale.y - 26 : SPOT.shippingWork[1]);
    }
    // The scale ticks up to the weight once the box is on it.
    if (ship && p!.status === "weighed" && this.weighed !== p!.id) {
      this.weighed = p!.id;
      const o = { v: 0 };
      this.tweens.add({ targets: o, v: p!.weightLb, duration: 600, onUpdate: () => this.readout.setText(`${Math.round(o.v)} lb`) });
    }
    if (!(ship && (p!.status === "weighed" || p!.status === "labeled"))) this.readout.setText("0 lb");
    const scanning = currentStep(s)?.type === "scan_dropoff";
    const drop = this.objs.get("shipping/dropoff")!;
    if (!drop.getData("dragging")) drop.setVisible(scanning || (p?.kind === "dropoff" && p.status === "scanned"));
    const label = this.objs.get("shipping/label")!;
    if (!label.getData("dragging")) label.setVisible(!!d && d.req.type === "label" && d.i === 1);
    this.objs.get("shipping/truck")!.setVisible(s.truck.status === "waiting");
    this.binText.setText(`Outbound: ${s.packages.filter((x) => x.status === "binned").length}`);
    if (!d || part(d).form !== "label") this.labelForm("");
  }
}

// ---------- the pickup shelf ----------

export class ShelfScene extends Station {
  private items = new Map<string, Phaser.GameObjects.Container>();
  private sig2 = "";

  constructor() {
    super("shelf", ["shelf"]);
  }

  protected candidates(what: string): Candidate[] {
    const out: Candidate[] = [];
    for (const [k, c] of this.items) if (k.startsWith(what === "bag" ? "bag:" : "package:")) out.push({ obj: c, value: Number(k.split(":")[1]) });
    return out;
  }

  protected refresh(): void {
    const s = state();
    const fetched = new Set(s.customers.map((c) => c.fetched));
    const want = new Map<string, string>();
    for (const j of s.jobs) if (j.status === "bagged" && !fetched.has(j.id)) want.set(`bag:${j.id}`, customerById(s, j.customerId)?.name.split(" ")[0] ?? "");
    for (const p of s.packages) if (p.kind === "held" && p.status === "held") want.set(`package:${p.id}`, customerById(s, p.customerId)?.name.split(" ")[0] ?? "");
    const sig = [...want].join("|");
    if (sig === this.sig2) return;
    this.sig2 = sig;
    this.items.forEach((c) => c.destroy());
    this.items.clear();
    let bags = 0;
    let pkgs = 0;
    for (const [k, name] of want) {
      const bag = k.startsWith("bag:");
      const [x0, y0, dx, dy, cols] = bag ? SPOT.shelfBags : SPOT.shelfPackages;
      const n = bag ? bags++ : pkgs++;
      const spr = sprite(this, bag ? "shelf/bag" : "shelf/package", 0, 0);
      const tag = this.add.text(0, 8, name, { ...FONT, fontSize: "8px", backgroundColor: "#ffffff", padding: { x: 2, y: 0 } }).setOrigin(0.5);
      const c = this.add.container(x0 + (n % cols) * dx, y0 + Math.floor(n / cols) * dy, [spr, tag]).setSize(48, 52).setDepth(20).setInteractive({ useHandCursor: true });
      this.items.set(k, c);
    }
  }
}
