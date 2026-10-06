// A station scene: its objects come from the manifest layout, and the hands-on part of whatever step you're on is set
// up on them from the step data: drag the actual sprite onto its target, hold a tool over something (progress shows
// on it, letting go pauses), tap things, or pick one by looking. Steps with nothing to do by hand get in-world
// buttons. Subclasses only add what that station shows (the stack growing, the customer walking in, ...).
import Phaser from "phaser";
import { availableTasks } from "../sim/todo";
import { currentStep, STEP } from "../sim/workflow";
import { canStart, previewTask } from "../sim/sim";
import type { Station as SimStation, TaskRequest } from "../sim/types";
import { LAYOUT, SPOT, SPRITES, sound, sprite } from "./assets";
import { BOTTOM, FONT, HOLD_MS, SNAP } from "./config";
import { ctl, doTask, hands, holding, nextPart, part, picked, state, stepKey, tapped } from "./run";
import { bounce, say, snapBack, sparkle, squash } from "./juice";
import { tabOf, type Tab } from "../ui/view";

export type Obj = Phaser.GameObjects.Sprite | Phaser.GameObjects.Container;
export interface Candidate {
  obj: Obj;
  value: string | number;
}

export abstract class Station extends Phaser.Scene {
  objs = new Map<string, Phaser.GameObjects.Sprite>();
  private home = new Map<Obj, { x: number; y: number }>();
  private temp: Phaser.GameObjects.GameObject[] = []; // what the current part or buttons put up
  private sig = "";
  private holdTool: Obj | null = null;
  private holdOn: Obj | null = null;
  private holdingNow = false;
  private bar!: Phaser.GameObjects.Graphics;
  doms: HTMLElement[] = []; // this station's overlays (see overlay() in scenes.ts)

  constructor(public tab: Tab, private stations: SimStation[]) {
    super(tab);
  }

  // ---------- what subclasses fill in ----------
  protected build(): void {}
  protected refresh(): void {} // every frame: show the state of things
  protected special(_name: string): Obj | undefined {
    return undefined;
  } // "box", "held", "customer"
  protected candidates(_what: string): Candidate[] {
    return [];
  }
  protected tapAround(name: string): Obj | undefined {
    return this.objs.get(name);
  } // where tap targets that aren't in the layout appear
  protected showPart(): void {} // forms and the keypad
  protected freeButtons = true;

  create(): void {
    for (const o of LAYOUT[this.tab]) {
      const s = sprite(this, o.key, o.x, o.y);
      this.objs.set(o.key, s);
      this.home.set(s, { x: o.x, y: o.y });
      if (SPRITES[o.key].layer === "interactive") s.setInteractive({ useHandCursor: true });
      s.setData("starts", o.starts ?? []);
    }
    this.bar = this.add.graphics().setDepth(55);
    this.build();
    this.input.on("gameobjectdown", (_p: Phaser.Input.Pointer, o: Obj) => this.down(o));
    this.input.on("pointerup", () => (this.holdingNow = false));
    this.input.on("dragstart", (_p: Phaser.Input.Pointer, o: Obj) => {
      o.setData("dragging", true).setDepth(50);
      squash(o);
      sound(this, "pick_up");
    });
    this.input.on("drag", (_p: Phaser.Input.Pointer, o: Obj, x: number, y: number) => o.setPosition(x, y));
    this.input.on("dragend", (p: Phaser.Input.Pointer, o: Obj) => this.dropped(p, o));
    // DOM overlays belong to the station you're looking at.
    this.events.on("sleep", () => this.doms.forEach((d) => (d.style.display = "none")));
    this.events.on("wake", () => {
      this.doms.forEach((d) => (d.style.display = ""));
      this.sig = "";
    });
    if (ctl.tab !== this.tab) {
      this.scene.sleep(); // (the UI scene wakes the one you're looking at)
      this.doms.forEach((d) => (d.style.display = "none"));
    }
  }

  update(_t: number, dt: number): void {
    if (!ctl.sim) return;
    this.refresh();
    const sig = this.signature();
    if (sig !== this.sig) {
      this.sig = sig;
      this.rebuild();
    }
    this.bar.clear();
    const d = ctl.doing;
    if (d && this.holdOn && part(d).hold) {
      if (this.holdingNow && holding(dt)) {
        this.holdingNow = false;
        this.done(this.holdOn);
        return;
      }
      const frac = Math.min(1, d.held / HOLD_MS);
      const b = this.holdOn.getBounds();
      this.bar.fillStyle(0x1f2328, 0.7).fillRect(b.centerX - 26, b.top - 10, 52, 6);
      this.bar.fillStyle(0x2e7d4f, 1).fillRect(b.centerX - 25, b.top - 9, 50 * frac, 4);
    }
  }

  // What the interaction was built for; when it changes, it's built again.
  private signature(): string {
    const s = state();
    const d = ctl.doing;
    if (d) return `d:${d.key}:${d.i}:${tabOf(d.req.type) === this.tab}`;
    const step = currentStep(s);
    if (step) return `s:${stepKey(step.req)}:${!!s.employee.task}:${step.alts.length}`;
    return `f:${this.free().map(stepKey).join(",")}`;
  }

  protected find(name: string): Obj | undefined {
    return this.special(name) ?? this.objs.get(name);
  }

  private clearTemp(): void {
    this.temp.forEach((o) => o.destroy());
    this.temp = [];
    this.holdTool = this.holdOn = null;
    for (const o of [...this.objs.values(), ...this.specials()]) if (o.input?.draggable) this.input.setDraggable(o, false);
  }

  protected specials(): Obj[] {
    return ["box", "held", "customer"].map((n) => this.special(n)).filter((o): o is Obj => !!o);
  }

  private rebuild(): void {
    this.clearTemp();
    const s = state();
    const d = ctl.doing;
    if (d) {
      if (tabOf(d.req.type) === this.tab) this.setUpPart();
      return;
    }
    const step = currentStep(s);
    if (step && !s.employee.task) {
      if (tabOf(step.type) !== this.tab || step.type === "respond" || step.type === "talk") return;
      if (hands(step.req) && !step.alts.length) return; // (it's started for you: see follow() in run.ts)
      const reqs = [step.req, ...step.alts];
      this.buttons(reqs.map((r, i) => ({ label: `${reqs.length > 1 ? (i ? "Don't: " : "Do: ") : ""}${previewTask(s, r).label}`, req: r })), reqs.length > 1);
      return;
    }
    if (!step && this.freeButtons) this.buttons(this.free().map((r) => ({ label: previewTask(s, r).label, req: r })));
  }

  // What you could start here while you're free.
  protected free(): TaskRequest[] {
    const s = state();
    if (s.workflow) return [];
    return this.stations.flatMap((st) => availableTasks(s, st)).filter((r) => r.type !== "talk" && tabOf(r.type) === this.tab);
  }

  // In-world buttons along the bottom of the station.
  protected buttons(list: { label: string; req: TaskRequest }[], choice = false): void {
    let x = 8;
    let y = BOTTOM - 22;
    for (const { label, req } of list.slice(0, 6)) {
      const t = this.add.text(0, 0, label, { ...FONT, color: "#ffffff" }).setOrigin(0, 0.5);
      const w = Math.min(300, t.width + 12);
      if (x + w > 632) {
        x = 8;
        y -= 22;
      }
      const dont = choice && list.findIndex((l) => l.req === req) > 0;
      const bg = this.add.rectangle(0, 0, w, 18, dont ? 0x6b4a2a : 0x2f5d8a).setOrigin(0, 0.5).setStrokeStyle(1, 0x10141a).setInteractive({ useHandCursor: true });
      t.setPosition(6, 0).setCrop(0, 0, w - 10, 20);
      const c = this.add.container(x, y, [bg, t]).setDepth(45);
      bg.on("pointerdown", () => {
        squash(c);
        doTask(req);
      });
      this.temp.push(c);
      x += w + 6;
    }
  }

  // ---------- the part you're on ----------

  private setUpPart(): void {
    const p = part(ctl.doing!);
    const hint = this.add.text(320, 30, STEP[ctl.doing!.req.type].hint.replace("{finishing}", "Finish it") + this.howTo(), { ...FONT, color: "#ffffff", backgroundColor: "#1f2328cc", padding: { x: 4, y: 2 } }).setOrigin(0.5, 0).setDepth(58);
    this.temp.push(hint);
    if (p.drag) {
      const o = this.find(p.drag);
      const to = p.to === "hands" ? undefined : this.find(p.to!);
      if (!o) return;
      o.setVisible(true).setDepth(46); // on top, so it's what you grab
      if (!o.input) o.setInteractive({ useHandCursor: true });
      this.input.setDraggable(o, true);
      this.home.set(o, { x: o.x, y: o.y });
      this.pulse(to ?? null);
      this.pulse(o);
    }
    if (p.tap) {
      const n = p.n ?? 1;
      const own = this.find(p.tap);
      if (n === 1 && own && own.visible) {
        own.setData("tap", true);
        this.pulse(own);
      } else {
        const around = this.tapAround(p.tap) ?? this.cameras.main.midPoint;
        const b = "getBounds" in around ? (around as Obj).getBounds() : new Phaser.Geom.Rectangle(around.x - 40, around.y - 30, 80, 60);
        for (let i = ctl.doing!.count; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const t = sprite(this, p.tap, b.centerX + Math.cos(a) * (b.width / 2 + 14), b.centerY + Math.sin(a) * (b.height / 2 + 10)).setInteractive({ useHandCursor: true }).setDepth(40);
          t.setData("tap", true);
          this.temp.push(t);
        }
      }
    }
    if (p.hold) {
      this.holdTool = this.find(p.hold) ?? null;
      this.holdOn = (p.on ? this.find(p.on) : this.holdTool) ?? this.holdTool;
      this.holdTool?.setVisible(true);
      if (this.holdTool && !this.holdTool.input) this.holdTool.setInteractive({ useHandCursor: true });
      this.pulse(this.holdTool);
    }
    if (p.pick) for (const c of this.candidates(p.pick)) this.pulse(c.obj);
    this.showPart();
  }

  private howTo(): string {
    const p = part(ctl.doing!);
    if (p.drag) return ": drag it over";
    if (p.hold) return ": press and hold";
    if (p.tap) return (p.n ?? 1) > 1 ? `: tap each one (${(p.n ?? 1) - ctl.doing!.count})` : ": tap it";
    if (p.pick) return ": pick the right one";
    return "";
  }

  private pulse(o: Obj | null): void {
    if (!o) return;
    const b = o.getBounds();
    const r = this.add.rectangle(b.centerX, b.centerY, b.width + 6, b.height + 6).setStrokeStyle(1, 0xe0a54a).setDepth(44);
    this.tweens.add({ targets: r, alpha: 0.2, duration: 450, yoyo: true, repeat: -1 });
    this.temp.push(r);
  }

  private down(o: Obj): void {
    const d = ctl.doing;
    if (d && tabOf(d.req.type) === this.tab) {
      const p = part(d);
      if (p.tap && o.getData("tap")) {
        sound(this, "stapler");
        const last = tapped();
        if (this.temp.includes(o)) {
          this.tweens.add({ targets: o, scale: 0, alpha: 0, duration: 120, onComplete: () => o.destroy() });
          this.temp = this.temp.filter((x) => x !== o);
        } else bounce(o);
        if (last) this.done(o);
        else this.sig = ""; // (the hint's count)
        return;
      }
      if (p.hold && (o === this.holdTool || o === this.holdOn)) {
        this.holdingNow = true;
        sound(this, "tape_rip");
        return;
      }
      if (p.pick) {
        const c = this.candidates(p.pick).find((x) => x.obj === o);
        if (!c) return;
        const err = picked(c.value);
        if (err) {
          snapBack(o, o.x, o.y);
          say(this, o.x, o.y - 30, err);
          sound(this, "nope");
        } else this.done(o);
        return;
      }
      return;
    }
    // Free: tapping an object starts what it's for.
    const starts = (o.getData("starts") ?? []) as string[];
    if (!starts.length || state().workflow) return;
    const req = this.free().find((r) => starts.includes(r.type)) ?? this.stations.flatMap((st) => availableTasks(state(), st)).find((r) => starts.includes(r.type) && canStart(state(), r) === null);
    if (req) doTask(req);
    else shake(o, this);
  }

  private dropped(p: Phaser.Input.Pointer, o: Obj): void {
    o.setData("dragging", false);
    const home = this.home.get(o) ?? { x: o.x, y: o.y };
    const d = ctl.doing;
    const want = d ? part(d).to : undefined;
    const hit = (t: Obj | { x: number; y: number }, r: number) => Phaser.Math.Distance.Between(p.x, p.y, t.x, t.y) <= r;
    const target = want === "hands" ? { x: SPOT.handSlot[0], y: SPOT.handSlot[1] } : want ? this.find(want) : undefined;
    const radius = target && "getBounds" in target ? SNAP + Math.max(target.getBounds().width, target.getBounds().height) / 2 : SNAP + 10;
    const centre = target && "getBounds" in target ? { x: target.getBounds().centerX, y: target.getBounds().centerY } : target;
    if (centre && hit(centre, radius)) {
      sound(this, "drop");
      this.tweens.add({ targets: o, x: centre.x, y: centre.y, scale: 0.8, duration: 120, onComplete: () => o.setPosition(home.x, home.y).setScale(1) });
      this.done(target && "getBounds" in target ? target : o, false);
      return;
    }
    snapBack(o, home.x, home.y);
    sound(this, "nope");
    say(this, home.x, home.y - 30, `That goes ${want === "hands" ? "in your hands" : `on the ${(want ?? "").split("/").pop()?.replace(/_/g, " ")}`}.`);
  }

  // A part's done: a check mark, and on to the next (the last one does the step).
  protected done(at: Obj, alreadyAdvanced = true): void {
    const b = at.getBounds();
    sparkle(this, b.centerX, b.top);
    sound(this, "done");
    if (!alreadyAdvanced) nextPart();
    this.sig = "";
  }
}

function shake(o: Obj, scene: Phaser.Scene): void {
  scene.tweens.add({ targets: o, x: o.x + 3, duration: 40, yoyo: true, repeat: 2 });
}
