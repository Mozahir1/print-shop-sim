// The persistent UI scene on top of the stations: clock, manager mood, speed, Go home, Walk away, the tab bar (with
// a slide between stations), the hand slot, and short messages. It also runs the clock, and keeps the notes and the
// log beside the game up to date.
import Phaser from "phaser";
import { canGoHome, workLeft } from "../sim/sim";
import { managerMood } from "../sim/failures";
import { on } from "../sim/bus";
import { formatClock } from "../sim/time";
import { WORKFLOWS } from "../sim/workflow";
import { attention, banner, held, logList, notesHtml, TABS, type Tab } from "../ui/view";
import { devPanel } from "../ui/dev";
import { preload, create, SPOT, sound, sprite } from "./assets";
import { BOTTOM, FONT, SPEEDS } from "./config";
import { abandon, ctl, frame, goTab, home, quiet } from "./run";

type Button = { bg: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text };

function button(scene: Phaser.Scene, x: number, y: number, w: number, label: string, onPress: () => void): Button {
  const bg = scene.add.rectangle(x, y, w, 16, 0x2a2d33).setOrigin(0, 0.5).setStrokeStyle(1, 0x4a4f57).setInteractive({ useHandCursor: true });
  const text = scene.add.text(x + w / 2, y, label, { ...FONT, color: "#e6e6e3" }).setOrigin(0.5);
  bg.on("pointerdown", () => {
    scene.tweens.add({ targets: [bg, text], scaleY: 0.85, duration: 60, yoyo: true });
    onPress();
  });
  return { bg, text };
}

function style(b: Button, on: boolean, visible = true): void {
  b.bg.setFillStyle(on ? 0x7aa7d6 : 0x2a2d33).setVisible(visible);
  b.text.setColor(on ? "#10141a" : "#e6e6e3").setVisible(visible);
}

export class Boot extends Phaser.Scene {
  constructor() {
    super("boot");
  }
  preload(): void {
    preload(this);
  }
  create(): void {
    create(this);
    for (const t of TABS) this.scene.launch(t.id);
    this.scene.launch("ui");
  }
}

export class UIScene extends Phaser.Scene {
  private shown: Tab | null = null;
  private clock!: Phaser.GameObjects.Text;
  private mood!: Phaser.GameObjects.Text;
  private doing!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private toast!: Phaser.GameObjects.Text;
  private flash!: Phaser.GameObjects.Text;
  private hand!: Phaser.GameObjects.Sprite;
  private tabs: Button[] = [];
  private speeds: Button[] = [];
  private pause!: Button;
  private homeBtn!: Button;
  private walk!: Button;
  private bellUntil = 0;
  private side = { notes: "", log: "", dev: "" };

  constructor() {
    super("ui");
  }

  create(): void {
    this.add.rectangle(0, 0, 640, 20, 0x1f2328).setOrigin(0);
    this.clock = this.add.text(6, 10, "", { ...FONT, color: "#ffffff", fontStyle: "bold" }).setOrigin(0, 0.5);
    this.mood = this.add.text(160, 10, "", { ...FONT, color: "#e6e6e3" }).setOrigin(0, 0.5);
    this.doing = this.add.text(262, 10, "", { ...FONT, color: "#9a9ea6", fixedWidth: 152 }).setOrigin(0, 0.5); // (clipped before the buttons)
    this.pause = button(this, 420, 10, 34, "Pause", () => (ctl.paused = !ctl.paused));
    this.speeds = SPEEDS.map((n, i) =>
      button(this, 456 + i * 24, 10, 22, ["1x", "2x", "4x"][i], () => {
        ctl.speed = n;
        ctl.paused = false;
      }),
    );
    this.homeBtn = button(this, 532, 10, 52, "Go home", home);
    this.walk = button(this, 586, 10, 52, "Walk away", abandon);
    this.banner = this.add.text(320, 22, "", { ...FONT, color: "#ffffff", backgroundColor: "#b3261e", padding: { x: 4, y: 1 } }).setOrigin(0.5, 0).setDepth(5);
    this.flash = this.add.text(320, 40, "", { ...FONT, color: "#b3261e", backgroundColor: "#fbe5e3", padding: { x: 4, y: 2 }, wordWrap: { width: 560 } }).setOrigin(0.5, 0).setAlpha(0);
    this.toast = this.add.text(320, BOTTOM - 46, "", { ...FONT, color: "#ffffff", backgroundColor: "#1f2328e0", padding: { x: 4, y: 2 } }).setOrigin(0.5).setAlpha(0);
    // The bottom: your hands, and the stations.
    this.add.rectangle(0, BOTTOM, 640, 360 - BOTTOM, 0x1f2328).setOrigin(0);
    sprite(this, "ui/hand_slot", SPOT.handSlot[0], SPOT.handSlot[1]);
    this.hand = sprite(this, "item/bag", SPOT.handSlot[0], SPOT.handSlot[1]).setVisible(false);
    this.tabs = TABS.map((t, i) => button(this, 60 + i * 96, 338, 92, t.label, () => goTab(t.id)));
    this.tabs.forEach((b) => b.bg.setSize(92, 26).setDisplaySize(92, 26));
    ctl.tip = (msg) => {
      this.toast.setText(msg).setAlpha(1);
      this.tweens.killTweensOf(this.toast);
      this.tweens.add({ targets: this.toast, alpha: 0, delay: 1600, duration: 300 });
    };
    const offs = [
      on("customer_arrived", () => {
        if (ctl.tab === "counter") return;
        sound(this, "door_bell");
        this.bellUntil = this.time.now + 6000;
      }),
      on("event_started", () => {
        sound(this, "jam");
        this.scene.get(ctl.tab).cameras.main.shake(250, 0.006); // something just went wrong
      }),
      on("failure", (e) => {
        this.flash.setText(e.text).setAlpha(1);
        this.tweens.killTweensOf(this.flash);
        this.tweens.add({ targets: this.flash, alpha: 0, delay: 3500, duration: 500 });
      }),
    ];
    this.events.once("shutdown", () => offs.forEach((f) => f()));
  }

  update(time: number, dt: number): void {
    frame(dt);
    if (!ctl.sim) return;
    const s = ctl.sim.state;
    if (this.shown !== ctl.tab) this.slideTo(ctl.tab);
    this.clock.setText(`Day ${s.day}  ${formatClock(s.time)}${s.time >= s.closeAt ? " (closed)" : ""}`);
    this.mood.setText(`Manager: ${managerMood(s.manager.heat)}`);
    const wf = s.workflow;
    this.doing.setText(wf ? WORKFLOWS[wf.kind].label : quiet(s) ? "Quiet. Time flies." : "Hands free.");
    style(this.pause, ctl.paused);
    this.pause.text.setText(ctl.paused ? "Paused" : "Pause");
    this.speeds.forEach((b, i) => style(b, !ctl.paused && ctl.speed === SPEEDS[i]));
    const left = workLeft(s).length;
    style(this.homeBtn, canGoHome(s) === null && !left, canGoHome(s) === null);
    style(this.walk, ctl.confirming?.key === "abandon", !!wf);
    const b = banner(s);
    this.banner.setText(b ?? "").setVisible(!!b);
    const pulse = attention(s);
    if (time < this.bellUntil) pulse.add("counter");
    TABS.forEach((t, i) => {
      style(this.tabs[i], t.id === ctl.tab);
      if (t.id !== ctl.tab && pulse.has(t.id)) this.tabs[i].bg.setStrokeStyle(2, 0xe0a54a, 0.5 + 0.5 * Math.sin(time / 180));
      else this.tabs[i].bg.setStrokeStyle(1, 0x4a4f57);
    });
    const h = held(s);
    this.hand.setVisible(!!h);
    if (h) this.hand.setTexture(`item/${h}`);
    this.sidePanels();
  }

  // A quick slide from one station to the next.
  private slideTo(tab: Tab): void {
    const from = this.shown;
    if (from) this.scene.sleep(from);
    this.scene.wake(tab);
    const cam = this.scene.get(tab).cameras.main;
    const dir = from && TABS.findIndex((t) => t.id === tab) < TABS.findIndex((t) => t.id === from) ? -1 : 1;
    cam.setScroll(dir * 24, 0);
    this.tweens.add({ targets: cam, scrollX: 0, duration: 160, ease: "Quad.easeOut" });
    cam.fadeIn(160);
    this.shown = tab;
    if (tab === "counter") this.bellUntil = 0;
    this.scene.bringToTop();
  }

  // The notes and the log, beside the game (and the dev drawer, when it's open). Each redraws only when it changes.
  private sidePanels(): void {
    const s = ctl.sim!.state;
    const put = (id: keyof typeof this.side, html: string) => {
      if (this.side[id] === html) return;
      this.side[id] = html;
      document.getElementById(id)!.innerHTML = html;
    };
    put("notes", notesHtml(s));
    put("log", `<h2>What happened</h2><ol>${logList(s)}</ol>`);
    if (!document.getElementById("dev")!.hidden) put("dev", devPanel(ctl.sim!, ctl.game!, ctl.bot?.style ?? null));
  }
}
