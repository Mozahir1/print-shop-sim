// The UI scene, on top of the stations: it runs the clock, slides between stations, and keeps the HUD (hud.ts: the
// bars, notes, and modals, in the DOM) up to date. It also plays the moments that aren't any one station's: the bell
// when someone comes in while you're elsewhere, the shake when something goes wrong, and failures.
import Phaser from "phaser";
import { on } from "../sim/bus";
import { TABS, type Tab } from "../ui/view";
import { preload, create, sound } from "./assets";
import { RES } from "./config";
import { ctl, frame } from "./run";
import * as hud from "./hud";

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
  private bellUntil = 0;

  constructor() {
    super("ui");
  }

  create(): void {
    this.cameras.main.setOrigin(0, 0).setZoom(RES); // layout pixels
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
      on("failure", (e) => hud.failure(e.text)),
    ];
    this.events.once("shutdown", () => offs.forEach((f) => f()));
  }

  update(time: number, dt: number): void {
    frame(dt);
    if (ctl.sim && this.shown !== ctl.tab) this.slideTo(ctl.tab);
    hud.update(time, this.bellUntil);
  }

  // A quick slide from one station to the next.
  private slideTo(tab: Tab): void {
    const from = this.shown;
    if (from) this.scene.sleep(from);
    this.scene.wake(tab);
    const cam = this.scene.get(tab).cameras.main;
    const dir = from && TABS.findIndex((t) => t.id === tab) < TABS.findIndex((t) => t.id === from) ? -1 : 1;
    cam.setScroll(dir * 12, 0);
    this.tweens.add({ targets: cam, scrollX: 0, duration: 160, ease: "Quad.easeOut" });
    cam.fadeIn(160);
    this.shown = tab;
    if (tab === "counter") this.bellUntil = 0;
    this.scene.bringToTop();
  }
}
