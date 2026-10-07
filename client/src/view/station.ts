// A station scene: its objects come from the manifest layout, and the hands-on part of whatever step you're on is set
// up on them from the step data: pick something up and put it where it goes (tap it, then tap where it goes; or drag
// it there), hold a tool over something (progress shows on it, letting go pauses), tap things, or pick one by
// looking. What to do next always has a glow and a bouncing arrow with a few words on it. Steps with nothing to do by
// hand get in-world buttons, in the action strip along the bottom. Subclasses only add what that station shows (the
// stack growing, the customer walking in, ...). Everything here is in art pixels: the camera draws the scene on the
// stage region at ART times that (see layout.ts).
import Phaser from "phaser";
import { availableTasks } from "../sim/todo";
import { CHORES, currentStep } from "../sim/workflow";
import { canStart, previewTask } from "../sim/sim";
import type { Station as SimStation, TaskRequest } from "../sim/types";
import { LAYOUT, SPRITES, sound, sprite } from "./assets";
import { FONT, HOLD_MS, RES, SNAP } from "./config";
import { ACTIONS, ART, BUTTON_H, REGION, STAGE_W } from "./layout";
import { ctl, doTask, hands, hintOf, holding, nextPart, part, picked, sayNow, state, stepKey, tapped } from "./run";
import { modalRect, tooltip } from "./hud";
import { bounce, say, snapBack, sparkle, squash } from "./juice";
import { tabOf, TABS, type Tab } from "../ui/view";

export type Obj = Phaser.GameObjects.Sprite | Phaser.GameObjects.Container;
export interface Candidate {
  obj: Obj;
  value: string | number;
}

const DRAG = 6; // art pixels the pointer moves before a press counts as a drag

export abstract class Station extends Phaser.Scene {
  objs = new Map<string, Phaser.GameObjects.Sprite>();
  private temp: Phaser.GameObjects.GameObject[] = []; // what the current part or buttons put up
  private dimmed: Obj[] = []; // what you can't put the thing you're holding on
  private sig = "";
  private holdTool: Obj | null = null;
  private holdOn: Obj | null = null;
  private holdingNow = false;
  private bar!: Phaser.GameObjects.Graphics; // the hold meter: always on top, never covered (see guide())
  meter: Phaser.Geom.Rectangle | null = null; // where it is, while a hold part's up
  private tipFor: Obj | null = null; // what the tooltip is naming
  private press: { x: number; y: number; picked: boolean } | null = null; // the press in progress

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
  protected freeButtons = true; // what you could start here, as buttons in the action strip
  protected stepButtons = true; // the step you're on, as buttons in the action strip (the computer has its own)

  create(): void {
    const st = REGION.stage;
    this.cameras.main.setViewport(st.x * RES, st.y * RES, st.w * RES, st.h * RES).setOrigin(0, 0).setZoom(ART * RES);
    for (const o of LAYOUT[this.tab]) {
      const s = sprite(this, o.key, o.x, o.y);
      this.objs.set(o.key, s);
      if (SPRITES[o.key].layer === "interactive") s.setInteractive({ useHandCursor: true });
      s.setData("starts", o.starts ?? []);
    }
    this.bar = this.add.graphics().setDepth(80);
    this.build();
    // Order matters: an object's press comes first (picking something up), then the scene's (putting it down).
    this.input.on("gameobjectdown", (_p: Phaser.Input.Pointer, o: Obj) => this.down(o));
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.pressed(p));
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => this.released(p));
    // Names show on hover, at a readable size (placeholders have no text on them).
    this.input.on("gameobjectover", (_p: Phaser.Input.Pointer, o: Obj) => {
      const name = (o.getData("tip") as string | undefined) ?? SPRITES[o.name]?.label;
      const b = o.getBounds();
      if (!name || ctl.carry) return;
      this.tipFor = o;
      tooltip(name, b.centerX * ART, Math.max(12, b.top * ART - 4));
    });
    this.input.on("gameobjectout", () => {
      this.tipFor = null;
      tooltip(null);
    });
    this.events.on("sleep", () => tooltip(null));
    this.events.on("wake", () => (this.sig = ""));
    if (ctl.tab !== this.tab) this.scene.sleep(); // (the UI scene wakes the one you're looking at)
  }

  update(_t: number, dt: number): void {
    if (!ctl.sim) return;
    if (this.tipFor && (!this.tipFor.visible || !this.tipFor.active || ctl.carry)) {
      this.tipFor = null;
      tooltip(null); // (it went away under the pointer)
    }
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
      const m = (this.meter = meterFor(this.holdOn));
      this.bar.fillStyle(0x1f2328, 0.85).fillRect(m.x, m.y, m.width, m.height);
      this.bar.fillStyle(0x2e7d4f, 1).fillRect(m.x + 1, m.y + 1, (m.width - 2) * frac, m.height - 2);
    }
  }

  // What the interaction was built for; when it changes, it's built again.
  private signature(): string {
    const s = state();
    const d = ctl.doing;
    const free = this.free().map(stepKey).join(",");
    if (d) return `d:${d.key}:${d.i}:${d.count}:${tabOf(d.req.type) === this.tab}:${ctl.carry?.ref ?? ""}:${free}`;
    const step = currentStep(s);
    if (step) return `s:${stepKey(step.req)}:${!!s.employee.task}:${step.alts.length}:${free}`;
    return `f:${free}`;
  }

  protected find(name: string): Obj | undefined {
    return this.special(name) ?? this.objs.get(name);
  }

  private clearTemp(): void {
    this.temp.forEach((o) => o.destroy());
    this.temp = [];
    this.dimmed.forEach((o) => o.setAlpha(1));
    this.dimmed = [];
    this.holdTool = this.holdOn = null;
    this.meter = null;
    // Whatever you were carrying from here is back (or put where it went): the scene shows it as it should be.
    for (const o of [...this.objs.values(), ...this.specials()]) if (o.getData("dragging") && ctl.carry?.tab !== this.tab) o.setData("dragging", false).setVisible(true);
  }

  protected specials(): Obj[] {
    return ["box", "held", "customer"].map((n) => this.special(n)).filter((o): o is Obj => !!o);
  }

  private rebuild(): void {
    this.clearTemp();
    const s = state();
    const d = ctl.doing;
    // (A quick chore here you could put the job down for glows too: see free().)
    if (d) {
      if (tabOf(d.req.type) === this.tab) {
        this.setUpPart();
        this.showFree(false, false);
      } else this.showFree(true, true);
      return;
    }
    const step = currentStep(s);
    if (step && !s.employee.task) {
      if (tabOf(step.type) !== this.tab || step.type === "respond" || step.type === "talk") return this.showFree(true, true);
      if (hands(step.req) && !step.alts.length) return; // (it's started for you: see follow() in run.ts)
      if (this.stepButtons) {
        const reqs = [step.req, ...step.alts];
        const first = this.buttons(reqs.map((r, i) => ({ label: `${reqs.length > 1 ? (i ? "Don't: " : "Do: ") : ""}${previewTask(s, r).label}`, req: r })), reqs.length > 1);
        if (first) this.guide(first, hintOf(step.req));
      }
      return this.showFree(false, false);
    }
    if (step) return;
    this.showFree(true, true);
  }

  // Whatever you could start here glows (tap it to start; as buttons too, when there's room), and the first gets the
  // arrow. Free, that's anything here; in the middle of a job, a quick chore you could put it down for.
  private showFree(buttons: boolean, arrow: boolean): void {
    const s = state();
    if (ctl.carry) return; // (your hands are full)
    const free = this.free();
    if (buttons && this.freeButtons) this.buttons(free.map((r) => ({ label: previewTask(s, r).label, req: r })));
    let first = arrow;
    for (const o of this.objs.values()) {
      const starts = (o.getData("starts") ?? []) as string[];
      const req = free.find((r) => starts.includes(r.type));
      if (!req || !o.visible) continue;
      this.pulse(o);
      if (first) this.guide(o, previewTask(s, req).label);
      first = false;
    }
  }

  // What you could start here: anything while you're free; in the middle of a job, a quick chore (the truck, a jam,
  // an empty tray, a reset) if what you're doing can be put down for one.
  protected free(): TaskRequest[] {
    const s = state();
    const here = this.stations.flatMap((st) => availableTasks(s, st)).filter((r) => r.type !== "talk" && tabOf(r.type) === this.tab);
    return s.workflow ? here.filter((r) => CHORES.has(r.type) && canStart(s, r) === null) : here;
  }

  // In-world buttons in the action strip, one row. Labels never get cut off: if they don't all fit, the later ones
  // wait (there are rarely more than two). Returns the first one.
  protected buttons(list: { label: string; req: TaskRequest }[], choice = false): Obj | null {
    let x = ACTIONS.x + 3;
    const y = ACTIONS.y + ACTIONS.h / 2;
    let first: Obj | null = null;
    for (const { label, req } of list.slice(0, 6)) {
      const t = this.add.text(0, 0, label, { ...FONT, color: "#ffffff" }).setOrigin(0, 0.5);
      const w = t.width + 16;
      if (x + w > STAGE_W - 3) {
        t.destroy();
        break;
      }
      const dont = choice && list.findIndex((l) => l.req === req) > 0;
      const bg = this.add.rectangle(0, 0, w, BUTTON_H, dont ? 0x6b4a2a : 0x2f5d8a).setOrigin(0, 0.5).setStrokeStyle(1, 0x10141a).setInteractive({ useHandCursor: true });
      bg.setData("button", true);
      t.setPosition(8, 0);
      const c = this.add.container(x, y, [bg, t]).setDepth(45).setSize(w, BUTTON_H);
      bg.on("pointerdown", () => {
        squash(c);
        doTask(req);
      });
      this.temp.push(c);
      first ??= c;
      x += w + 4;
    }
    return first;
  }

  // ---------- the part you're on ----------

  private setUpPart(): void {
    const d = ctl.doing!;
    const p = part(d);
    const text = sayNow(d);
    if (p.drag) {
      const o = this.find(p.drag);
      const to = p.to === "hands" ? undefined : this.find(p.to!);
      if (!o) return;
      if (!o.input) o.setInteractive({ useHandCursor: true });
      if (ctl.carry?.ref === p.drag) {
        // You're holding it: it's off the table, where it goes glows, and nothing else does.
        o.setData("dragging", true).setVisible(false);
        this.dimAllBut(to ?? null);
        this.pulse(to ?? null);
        if (to) this.guide(to, text);
      } else {
        o.setVisible(true).setDepth(46); // on top, so it's what you pick up
        this.pulse(o);
        this.guide(o, text);
      }
    }
    if (p.tap) {
      const n = p.n ?? 1;
      const own = this.find(p.tap);
      if (n === 1 && own && own.visible) {
        own.setData("tap", true);
        this.pulse(own);
        this.guide(own, text);
      } else {
        const around = this.tapAround(p.tap) ?? this.cameras.main.midPoint;
        const b = "getBounds" in around ? (around as Obj).getBounds() : new Phaser.Geom.Rectangle(around.x - 40, around.y - 30, 80, 60);
        const ring: Obj[] = [];
        for (let i = d.count; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const t = sprite(this, p.tap, b.centerX + Math.cos(a) * (b.width / 2 + 14), b.centerY + Math.sin(a) * (b.height / 2 + 10)).setInteractive({ useHandCursor: true }).setDepth(40);
          t.setData("tap", true);
          this.temp.push(t);
          ring.push(t);
          this.pulse(t);
        }
        if (ring.length) this.guide(ring.map((o) => o.getBounds()).reduce((a, b) => Phaser.Geom.Rectangle.Union(a, b)), text); // (above them all)
      }
    }
    if (p.hold) {
      this.holdTool = this.find(p.hold) ?? null;
      this.holdOn = (p.on ? this.find(p.on) : this.holdTool) ?? this.holdTool;
      this.holdTool?.setVisible(true);
      if (this.holdTool && !this.holdTool.input) this.holdTool.setInteractive({ useHandCursor: true });
      this.pulse(this.holdTool);
      if (this.holdOn) this.meter = meterFor(this.holdOn); // (so the arrow keeps clear of it)
      if (this.holdTool) this.guide(this.holdTool, text);
    }
    if (p.pick) {
      const cs = this.candidates(p.pick);
      for (const c of cs) this.pulse(c.obj);
      // (Which one is up to you: the arrow points at the lot.)
      if (cs.length) this.guide(cs.map((c) => c.obj.getBounds()).reduce((a, b) => Phaser.Geom.Rectangle.Union(a, b)), text);
    }
    this.showPart();
  }

  // A glow around something you should click.
  private pulse(o: Obj | null): void {
    if (!o) return;
    const b = o.getBounds();
    const glow = this.add.rectangle(b.centerX, b.centerY, b.width + 8, b.height + 8, 0xffd27a, 0.18).setStrokeStyle(3, 0xf2b441).setDepth(44).setData("glow", true);
    this.tweens.add({ targets: glow, alpha: 0.35, duration: 450, yoyo: true, repeat: -1 });
    this.temp.push(glow);
  }

  // A bouncing arrow at something, with what to do there. It goes above it, or below, or beside: the first place
  // that's on the stage and covers nothing that glows and not the hold meter (bounce included).
  private guide(at: Obj | Phaser.Geom.Rectangle, text: string): void {
    const b = at instanceof Phaser.Geom.Rectangle ? at : at.getBounds();
    const label = this.add.text(0, 0, text, { ...FONT, color: "#ffffff", backgroundColor: "#10141aee", padding: { x: 4, y: 2 }, fontStyle: "bold" });
    const lw = label.width;
    const lh = label.height;
    const m = modalRect(); // (a popup over the stage covers what's under it)
    const popup = m && new Phaser.Geom.Rectangle(m.x / ART, m.y / ART, m.w / ART, m.h / ART);
    const keepClear = [...this.glows(), ...(this.meter ? [this.meter] : [])].filter((r) => !Phaser.Geom.Rectangle.Overlaps(r, b) || r === this.meter);
    if (popup) keepClear.push(popup);
    const spots: { tip: [number, number]; dir: [number, number]; box: Phaser.Geom.Rectangle }[] = [];
    const clampX = (x: number) => Phaser.Math.Clamp(x, 2, STAGE_W - lw - 2);
    // Above, below: the arrow points down (or up) at its middle, the label past it, kept on the stage.
    for (const d of [1, -1]) {
      const y = d > 0 ? b.top - 4 : b.bottom + 4;
      const ly = d > 0 ? y - 12 - lh : y + 12;
      spots.push({ tip: [b.centerX, y], dir: [0, d], box: new Phaser.Geom.Rectangle(Math.min(clampX(b.centerX - lw / 2), b.centerX - 7), Math.min(ly, y) - 4, Math.max(lw, 14), lh + 16) });
    }
    // Right, left: the arrow points sideways at its middle.
    for (const d of [1, -1]) {
      const x = d > 0 ? b.right + 4 : b.left - 4;
      const lx = d > 0 ? x + 12 : x - 12 - lw;
      spots.push({ tip: [x, b.centerY], dir: [d, 0], box: new Phaser.Geom.Rectangle(Math.min(lx, x) - 4, b.centerY - lh / 2, lw + 16, lh) });
    }
    const stage = new Phaser.Geom.Rectangle(0, 0, STAGE_W, ACTIONS.y + ACTIONS.h);
    const fits = (r: Phaser.Geom.Rectangle) => r.x >= 0 && r.y >= 0 && r.right <= stage.right && r.bottom <= stage.bottom && !keepClear.some((k) => Phaser.Geom.Rectangle.Overlaps(k, r));
    // Nowhere for the words: just the arrow (the top bar says what to do).
    const arrowOnly = (s: (typeof spots)[number]) => new Phaser.Geom.Rectangle(s.tip[0] - 8 - s.dir[0] * 12, s.tip[1] - 8 - s.dir[1] * 12, 16, 16);
    const spot = spots.find((s) => fits(s.box)) ?? spots.find((s) => fits(arrowOnly(s))) ?? spots[0];
    const wordless = !fits(spot.box);
    const [tx, ty] = spot.tip;
    const [dx, dy] = spot.dir;
    const g = this.add.graphics();
    g.fillStyle(0xf2b441).lineStyle(1, 0x10141a);
    // A triangle pointing at the tip, from 10 back along the way it points.
    const back = (n: number) => [-dx * 10 + -dy * n, -dy * 10 + dx * n] as const;
    const [ax, ay] = back(7);
    const [bx, by] = back(-7);
    g.fillTriangle(ax, ay, bx, by, 0, 0).strokeTriangle(ax, ay, bx, by, 0, 0);
    if (dy !== 0) label.setPosition(clampX(tx - lw / 2) - tx, dy > 0 ? -12 - lh : 12);
    else label.setPosition(dx > 0 ? 12 : -12 - lw, -lh / 2);
    if (wordless) label.setVisible(false);
    const arrow = this.add.container(tx, ty, [g, label]).setDepth(70).setData("guide", !wordless);
    this.tweens.add({ targets: arrow, x: tx - dx * 4, y: ty - dy * 4, duration: 380, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.temp.push(arrow);
  }

  private glows(): Phaser.Geom.Rectangle[] {
    return this.temp.filter((o) => o.getData("glow")).map((o) => (o as Phaser.GameObjects.Rectangle).getBounds());
  }

  // While you're holding something, everything you can't put it on fades back.
  private dimAllBut(keep: Obj | null): void {
    for (const o of [...this.objs.values(), ...this.specials()]) {
      if (o === keep || !o.input || !o.visible || o.alpha < 1) continue;
      o.setAlpha(0.35);
      this.dimmed.push(o);
    }
  }

  private worldOf(p: Phaser.Input.Pointer): Phaser.Math.Vector2 {
    return this.cameras.main.getWorldPoint(p.x, p.y);
  }

  private label(o: Obj): string {
    const name = (o.getData("tip") as string | undefined) ?? SPRITES[o.name]?.label ?? "that";
    return name === "that" ? "That's not it" : `That's the ${name.toLowerCase()}`;
  }

  // Pressing on an object: pick it up, tap it, start holding it, pick it, or start what it's for.
  private down(o: Obj): void {
    if (o.getData("button")) return; // (buttons do their own thing)
    const d = ctl.doing;
    if (d && tabOf(d.req.type) === this.tab) {
      const p = part(d);
      if (p.drag && !ctl.carry && o === this.find(p.drag)) return this.pickUp(o, p.to === "hands");
      if (ctl.carry) return; // (putting it down: see pressed())
      if (p.tap && o.getData("tap")) {
        sound(this, "stapler");
        const last = tapped();
        if (this.temp.includes(o)) {
          o.disableInteractive(); // (done with; it shrinks away)
          this.tweens.add({ targets: o, scale: 0, alpha: 0, duration: 120, onComplete: () => o.destroy() });
          this.temp = this.temp.filter((x) => x !== o);
        } else bounce(o);
        if (last) this.done(o);
        return;
      }
      if (p.hold && (o === this.holdTool || o === this.holdOn)) {
        this.holdingNow = true;
        sound(this, "tape_rip");
        return;
      }
      if (p.pick) {
        const c = this.candidates(p.pick).find((x) => x.obj === o);
        if (c) {
          const err = picked(c.value);
          if (err) {
            snapBack(o, o.x, o.y);
            say(this, o.x, o.y - 30, err);
            sound(this, "nope");
          } else this.done(o);
          return;
        }
      }
      const chore = !ctl.carry && this.free().find((r) => ((o.getData("starts") ?? []) as string[]).includes(r.type));
      if (chore) return doTask(chore); // (put this down for a quick chore)
      return this.wrong(o.x, o.getBounds().top - 6, `${this.label(o)}. ${sayNow(d)}.`);
    }
    if (ctl.carry) return;
    // Tapping an object starts what it's for (in the middle of a job: if it's a quick chore you can put it down for).
    const starts = (o.getData("starts") ?? []) as string[];
    if (!starts.length) return;
    const s = state();
    const req = this.free().find((r) => starts.includes(r.type)) ?? (s.workflow ? undefined : this.stations.flatMap((st) => availableTasks(s, st)).find((r) => starts.includes(r.type) && canStart(s, r) === null));
    if (req) return doTask(req);
    const why = s.workflow ? this.stations.flatMap((st) => availableTasks(s, st)).find((r) => starts.includes(r.type)) : undefined;
    this.wrong(o.x, o.getBounds().top - 6, s.workflow ? (why && canStart(s, why)) || "Finish what you're doing first." : `Nothing to do with the ${(SPRITES[o.name]?.label ?? "that").toLowerCase()} right now.`);
  }

  private pickUp(o: Obj, isTheWholePart: boolean): void {
    sound(this, "pick_up");
    squash(o);
    if (isTheWholePart) return this.done(o, false); // (collecting: picking it up is all there is to it)
    ctl.carry = { ref: part(ctl.doing!).drag!, texture: o instanceof Phaser.GameObjects.Sprite ? o.texture.key : "item/box", tab: this.tab };
    this.press = { ...this.worldOf(this.input.activePointer), picked: true };
    this.sig = "";
  }

  // A press anywhere on the stage. While you're holding something, it's where you're putting it.
  private pressed(p: Phaser.Input.Pointer): void {
    this.tipFor = null;
    tooltip(null);
    if (this.press?.picked) return; // (this press just picked it up)
    const at = this.worldOf(p);
    this.press = { x: at.x, y: at.y, picked: false };
    if (ctl.carry && ctl.carry.tab !== this.tab) return this.wrong(at.x, at.y - 12, `Take it back to ${TABS.find((t) => t.id === ctl.carry!.tab)!.label}.`);
    if (ctl.carry) this.putDown(p);
  }

  // Letting go: of a tool you were holding, or of something you dragged (over where it goes, it's put there).
  private released(p: Phaser.Input.Pointer): void {
    this.holdingNow = false;
    const press = this.press;
    this.press = null;
    if (!press?.picked || !ctl.carry) return;
    const at = this.worldOf(p);
    if (Phaser.Math.Distance.Between(press.x, press.y, at.x, at.y) >= DRAG) this.putDown(p); // (a drag, not a tap)
  }

  private putDown(p: Phaser.Input.Pointer): void {
    const d = ctl.doing;
    if (!d || !ctl.carry) return;
    const want = part(d).to;
    const target = want ? this.find(want) : undefined;
    const at = this.worldOf(p);
    if (target) {
      const b = target.getBounds();
      const reach = SNAP + Math.max(b.width, b.height) / 2; // (forgiving)
      if (Phaser.Math.Distance.Between(at.x, at.y, b.centerX, b.centerY) <= reach) {
        sound(this, "drop");
        this.done(target, false);
        return;
      }
    }
    const hit = (this.input.hitTestPointer(p) as Obj[]).find((o) => o.visible && !o.getData("button"));
    this.wrong(at.x, at.y - 12, `${hit ? `${this.label(hit)}. ` : ""}${sayNow(d)}.`);
  }

  // Not that: a few words where you clicked, and what to do instead.
  private wrong(x: number, y: number, text: string): void {
    sound(this, "nope");
    say(this, x, y, text, "#b3261e", 1600);
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

// Where a hold's progress meter goes: just above what you're holding the tool on, and always on the stage.
function meterFor(on: Obj): Phaser.Geom.Rectangle {
  const b = on.getBounds();
  return new Phaser.Geom.Rectangle(Phaser.Math.Clamp(b.centerX - 26, 2, STAGE_W - 54), Math.max(2, b.top - 10), 52, 6);
}
