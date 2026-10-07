# Print Shop Sim Mobile: Spec v1

This goes in a **new repo** for the mobile version. It starts as a copy of the web client from the main repo
(`print-shop-sim`). Read this whole file first. The main repo's `CLAUDE.md` explains the game; copy it in as
`CLAUDE.md` and add a line pointing here.

Goal: the current game, playable and comfortable on a phone (landscape), first as an installable web app, then as
iOS and Android builds. No gameplay changes.

## Ground rules
- **Don't change game rules.** `src/sim/` and `src/data/` are copied as-is and stay identical to the main repo.
  Record the source commit in `UPSTREAM.md`. To update later, copy those folders over again from the main repo; never
  edit them here. All mobile work happens in the view layer, config, and build setup.
- Keep the existing tests passing; add mobile checks below.
- Player-facing text has no em dashes. Small phases; stop and summarize with screenshots after each.

## Phase 1: Repo setup and play on a phone today
- Copy `client/` from the main repo into the new repo root (no server; the game runs offline). Remove the server API
  calls or make them optional and off by default.
- Add `UPSTREAM.md` (source commit, which folders are synced).
- Make it a **PWA:** web manifest (name, icons, landscape orientation, fullscreen display), a service worker for offline
  play, and an install prompt.
- Document in the README how to test on a phone over Wi-Fi: `npm run dev -- --host`, then open the shown network URL on the phone.

## Phase 2: Phone layout
At 1280x720 scaled down to a phone, 20px text becomes about 11px. Mobile needs its own layout, not a shrunk desktop one.
- **Landscape only.** Show a "rotate your phone" screen in portrait.
- Separate mobile layout config (chosen by screen size, not user agent): a smaller logical size (about 960x540) so
  everything renders larger, while keeping the same fixed-region rule (nothing overlaps).
- **Minimum real sizes on device:** text 16 CSS px, tap targets 48 CSS px, with spacing between targets.
- **Top bar:** clock, manager mood, and the next-step line only. Current task details go behind a tap.
- **Notes:** collapse into a button with a count that opens a drawer; the active job's note stays pinned as one line.
- **Tab bar:** icons with short labels, full width, thumb-reachable at the bottom.
- **Modals and the computer:** full screen on phones, with a clear close button. Computer apps use large controls; the
  order form fits without scrolling, or scrolls inside the modal only.
- Respect safe areas (notches, home indicator) with `env(safe-area-inset-*)`.

## Phase 3: Touch and feel
- Tap to pick up, tap to place stays the main input. Drag works with a larger start threshold. Bigger snap radius.
- No hover anywhere: tooltips become long-press, or are shown inline.
- Hold actions work with a finger resting on the target; moving slightly doesn't cancel.
- Disable page scroll, pinch zoom, double-tap zoom, text selection, and the long-press callout on the game area.
- Unlock audio on the first tap.
- Pause the clock and save automatically when the app goes to the background (`visibilitychange`), resume on return.
- Optional: slightly slower default game speed on phones (config).

## Phase 4: iOS and Android builds
- Add **Capacitor** wrapping the built web app. Lock to landscape, fullscreen, keep the screen awake during a shift.
- Haptics on pick up, place, step complete, and error (Capacitor Haptics), off in settings if the player wants.
- Save data in Capacitor Preferences (fall back to localStorage on web).
- App icon and splash screen from placeholders.
- README: how to build and run on a device (Xcode for iOS, Android Studio for Android). No store publishing yet.

## Phase 5: Checks
- Playwright with mobile emulation (an iPhone and a Pixel, landscape) plays the Day 1 tutorial through the real UI.
- Same automated checks as desktop: no overlapping regions, no text under 16 CSS px, no target under 48 CSS px, nothing
  clipped, plus nothing under the safe areas. Save screenshots to `playtest/`.
- A short manual checklist in the README for testing on a real phone (rotate, background and resume, install as PWA, hold actions).

## Done when
Typecheck, tests, and build pass; the Playwright mobile run passes all checks; the game installs as a PWA and runs on a
real phone in landscape with readable text, reachable buttons, and no overlaps; Capacitor builds run on a device.
