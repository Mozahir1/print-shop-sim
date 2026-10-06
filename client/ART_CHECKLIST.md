# Art checklist

Generated from `src/assets/manifest.json` by `npm run art`. Don't edit by hand.

Base resolution 640x360, pixel art (nearest-neighbour, whole-number zoom). Every sprite below is drawn as a
placeholder until its file exists. To add one, save it at the path shown: a single PNG, a PNG strip of frames (left
to right, in the order the animations are listed), or an Aseprite export (PNG + JSON with the same name). Sizes are
in game pixels; the anchor is the point placed at the sprite's position (0.5, 0.5 is the center).

Layers, back to front: background, props, interactive, held, ui.

## counter

| Done | Key | File | Size | Anchor | Frames | Layer | What it is |
|---|---|---|---|---|---|---|---|
| [ ] | `counter/bg` | `src/assets/art/counter/bg.png` | 640x296 | 0, 0 | 1 | background | Counter: the shop floor seen from behind the counter, wall and window |
| [ ] | `counter/door` | `src/assets/art/counter/door.png` | 70x170 | 0, 0 | 1 | props | Front door customers walk in and out of |
| [ ] | `counter/desk` | `src/assets/art/counter/desk.png` | 640x70 | 0, 0 | 1 | props | The counter top, in front of the customer |
| [ ] | `counter/register` | `src/assets/art/counter/register.png` | 70x50 | 0.5, 0.5 | 1 | interactive | Register: shows the total, opens the keypad when ringing up |
| [ ] | `counter/reader` | `src/assets/art/counter/reader.png` | 30x24 | 0.5, 0.5 | 1 | interactive | Card reader on the counter |
| [ ] | `counter/reader_down` | `src/assets/art/counter/reader_down.png` | 30x24 | 0.5, 0.5 | 1 | interactive | Card reader showing an error |
| [ ] | `counter/bell` | `src/assets/art/counter/bell.png` | 20x16 | 0.5, 0.5 | 1 | props | Service bell |
| [ ] | `counter/copier` | `src/assets/art/counter/copier.png` | 90x110 | 0.5, 0.5 | 1 | interactive | Self-serve copier at the side of the floor |
| [ ] | `counter/copier_broken` | `src/assets/art/counter/copier_broken.png` | 90x110 | 0.5, 0.5 | 1 | interactive | Self-serve copier, broken (blinking error) |
| [ ] | `counter/sign` | `src/assets/art/counter/sign.png` | 40x30 | 0.5, 0.5 | 1 | props | Out of order sign taped on the copier |

## customer

| Done | Key | File | Size | Anchor | Frames | Layer | What it is |
|---|---|---|---|---|---|---|---|
| [ ] | `customer/body_a` | `src/assets/art/customer/body_a.png` | 70x110 | 0.5, 1 | idle: 2 @ 2 fps; walk: 4 @ 8 fps | interactive | Customer body, variant a (tinted per customer). Idle: a slow breathing loop |
| [ ] | `customer/body_b` | `src/assets/art/customer/body_b.png` | 70x110 | 0.5, 1 | idle: 2 @ 2 fps; walk: 4 @ 8 fps | interactive | Customer body, variant b (tinted per customer). Idle: a slow breathing loop |
| [ ] | `customer/body_c` | `src/assets/art/customer/body_c.png` | 70x110 | 0.5, 1 | idle: 2 @ 2 fps; walk: 4 @ 8 fps | interactive | Customer body, variant c (tinted per customer). Idle: a slow breathing loop |
| [ ] | `customer/body_business` | `src/assets/art/customer/body_business.png` | 70x110 | 0.5, 1 | idle: 2 @ 2 fps; walk: 4 @ 8 fps | interactive | Business client in a suit |
| [ ] | `customer/face_fine` | `src/assets/art/customer/face_fine.png` | 40x40 | 0.5, 0.5 | 1 | interactive | Customer face: fine |
| [ ] | `customer/face_annoyed` | `src/assets/art/customer/face_annoyed.png` | 40x40 | 0.5, 0.5 | 1 | interactive | Customer face: annoyed |
| [ ] | `customer/face_angry` | `src/assets/art/customer/face_angry.png` | 40x40 | 0.5, 0.5 | 1 | interactive | Customer face: angry |
| [ ] | `customer/bubble` | `src/assets/art/customer/bubble.png` | 70x24 | 0.5, 0.5 | 1 | ui | Impatience speech bubble ("Hello?") |

## computer

| Done | Key | File | Size | Anchor | Frames | Layer | What it is |
|---|---|---|---|---|---|---|---|
| [ ] | `computer/bg` | `src/assets/art/computer/bg.png` | 640x296 | 0, 0 | 1 | background | Computer: the back desk |
| [ ] | `computer/monitor` | `src/assets/art/computer/monitor.png` | 440x260 | 0, 0 | 1 | props | Monitor frame; the order form, print queue, inbox and label form show inside it |
| [ ] | `computer/router` | `src/assets/art/computer/router.png` | 50x30 | 0.5, 0.5 | 1 | interactive | Wi-Fi router (hold the power button to restart it) |
| [ ] | `computer/reader_box` | `src/assets/art/computer/reader_box.png` | 50x34 | 0.5, 0.5 | 1 | interactive | Card reader base station (hold reset to fix it) |

## printer

| Done | Key | File | Size | Anchor | Frames | Layer | What it is |
|---|---|---|---|---|---|---|---|
| [ ] | `printer/bg` | `src/assets/art/printer/bg.png` | 640x296 | 0, 0 | 1 | background | Printer: the production printer against the back wall |
| [ ] | `printer/body` | `src/assets/art/printer/body.png` | 220x150 | 0, 0 | 1 | props | The production printer |
| [ ] | `printer/tray` | `src/assets/art/printer/tray.png` | 80x16 | 0.5, 0.5 | 1 | interactive | Paper tray, closed |
| [ ] | `printer/tray_open` | `src/assets/art/printer/tray_open.png` | 80x30 | 0.5, 0.5 | 1 | interactive | Paper tray, pulled open to load |
| [ ] | `printer/ream` | `src/assets/art/printer/ream.png` | 54x30 | 0.5, 0.5 | 1 | interactive | A ream of paper (drag it into the tray) |
| [ ] | `printer/stack` | `src/assets/art/printer/stack.png` | 64x40 | 0.5, 1 | 1 | interactive | Printed stack in the output tray (grows sheet by sheet) |
| [ ] | `printer/jam_panel` | `src/assets/art/printer/jam_panel.png` | 64x44 | 0.5, 0.5 | 1 | interactive | Side panel, closed |
| [ ] | `printer/jam_panel_open` | `src/assets/art/printer/jam_panel_open.png` | 64x44 | 0.5, 0.5 | 1 | interactive | Side panel, opened to reach the jam |
| [ ] | `printer/jam_sheet` | `src/assets/art/printer/jam_sheet.png` | 34x22 | 0.5, 0.5 | 1 | interactive | A crumpled jammed sheet (tap to pull it out) |
| [ ] | `printer/light_idle` | `src/assets/art/printer/light_idle.png` | 12x12 | 0.5, 0.5 | 1 | props | Status light: idle |
| [ ] | `printer/light_printing` | `src/assets/art/printer/light_printing.png` | 12x12 | 0.5, 0.5 | blink: 2 @ 3 fps | props | Status light: printing |
| [ ] | `printer/light_jammed` | `src/assets/art/printer/light_jammed.png` | 12x12 | 0.5, 0.5 | 1 | props | Status light: jammed |
| [ ] | `printer/light_tray_empty` | `src/assets/art/printer/light_tray_empty.png` | 12x12 | 0.5, 0.5 | 1 | props | Status light: tray_empty |

## finishing

| Done | Key | File | Size | Anchor | Frames | Layer | What it is |
|---|---|---|---|---|---|---|---|
| [ ] | `finishing/bg` | `src/assets/art/finishing/bg.png` | 640x296 | 0, 0 | 1 | background | Finishing: the work table |
| [ ] | `finishing/table` | `src/assets/art/finishing/table.png` | 600x100 | 0, 0 | 1 | props | Work table |
| [ ] | `finishing/stack` | `src/assets/art/finishing/stack.png` | 64x40 | 0.5, 1 | 1 | interactive | The collected stack on the table |
| [ ] | `finishing/set` | `src/assets/art/finishing/set.png` | 30x20 | 0.5, 0.5 | 1 | interactive | One set to staple (tap to punch it) |
| [ ] | `finishing/stapler` | `src/assets/art/finishing/stapler.png` | 56x32 | 0.5, 0.5 | 1 | interactive | Heavy stapler (hold over the stack for big runs) |
| [ ] | `finishing/cutter` | `src/assets/art/finishing/cutter.png` | 100x44 | 0.5, 0.5 | 1 | interactive | Paper cutter (hold to cut) |
| [ ] | `finishing/laminator` | `src/assets/art/finishing/laminator.png` | 96x54 | 0.5, 0.5 | 1 | interactive | Laminator (hold to feed it through) |
| [ ] | `finishing/bag` | `src/assets/art/finishing/bag.png` | 50x56 | 0.5, 0.5 | 1 | interactive | Paper bag for a finished order |
| [ ] | `finishing/name_label` | `src/assets/art/finishing/name_label.png` | 40x16 | 0.5, 0.5 | 1 | interactive | Name label for the bag |
| [ ] | `finishing/shelf_cart` | `src/assets/art/finishing/shelf_cart.png` | 80x60 | 0.5, 0.5 | 1 | interactive | Cart to the pickup shelf (drop the bag here) |

## shipping

| Done | Key | File | Size | Anchor | Frames | Layer | What it is |
|---|---|---|---|---|---|---|---|
| [ ] | `shipping/bg` | `src/assets/art/shipping/bg.png` | 640x296 | 0, 0 | 1 | background | Shipping: the packing table, scale, label printer, outbound bin |
| [ ] | `shipping/table` | `src/assets/art/shipping/table.png` | 470x100 | 0, 0 | 1 | props | Packing table |
| [ ] | `shipping/item` | `src/assets/art/shipping/item.png` | 40x34 | 0.5, 0.5 | 1 | interactive | The customer's item to ship |
| [ ] | `shipping/box_small` | `src/assets/art/shipping/box_small.png` | 46x40 | 0.5, 0.5 | 1 | interactive | Small box (open) |
| [ ] | `shipping/box_medium` | `src/assets/art/shipping/box_medium.png` | 60x52 | 0.5, 0.5 | 1 | interactive | Medium box (open) |
| [ ] | `shipping/box_large` | `src/assets/art/shipping/box_large.png` | 80x66 | 0.5, 0.5 | 1 | interactive | Large box (open) |
| [ ] | `shipping/box_closed` | `src/assets/art/shipping/box_closed.png` | 60x52 | 0.5, 0.5 | 1 | interactive | A taped box (drawn at the size of its box) |
| [ ] | `shipping/box_damaged` | `src/assets/art/shipping/box_damaged.png` | 60x52 | 0.5, 0.5 | 1 | props | A box that came back crushed (complaint scene) |
| [ ] | `shipping/paper` | `src/assets/art/shipping/paper.png` | 22x22 | 0.5, 0.5 | 1 | interactive | Packing paper (tap to stuff it in) |
| [ ] | `shipping/tape_gun` | `src/assets/art/shipping/tape_gun.png` | 44x32 | 0.5, 0.5 | 1 | interactive | Tape gun (hold across the flaps) |
| [ ] | `shipping/scale` | `src/assets/art/shipping/scale.png` | 90x40 | 0.5, 0.5 | 1 | interactive | Shipping scale; the readout ticks up to the weight |
| [ ] | `shipping/label_printer` | `src/assets/art/shipping/label_printer.png` | 70x44 | 0.5, 0.5 | 1 | props | Label printer |
| [ ] | `shipping/label` | `src/assets/art/shipping/label.png` | 44x26 | 0.5, 0.5 | 1 | interactive | Printed shipping label (drag it onto the box) |
| [ ] | `shipping/dropoff` | `src/assets/art/shipping/dropoff.png` | 44x36 | 0.5, 0.5 | 1 | interactive | A prepaid drop-off package with its label |
| [ ] | `shipping/bin` | `src/assets/art/shipping/bin.png` | 120x90 | 0.5, 0.5 | 1 | interactive | Outbound bin (fills up) |
| [ ] | `shipping/truck` | `src/assets/art/shipping/truck.png` | 170x90 | 0.5, 0.5 | 1 | interactive | Carrier truck at the back door (tap to hand off) |

## shelf

| Done | Key | File | Size | Anchor | Frames | Layer | What it is |
|---|---|---|---|---|---|---|---|
| [ ] | `shelf/bg` | `src/assets/art/shelf/bg.png` | 640x296 | 0, 0 | 1 | background | Pickup shelf |
| [ ] | `shelf/rack` | `src/assets/art/shelf/rack.png` | 600x240 | 0, 0 | 1 | props | Shelving: orders on the left, held packages on the right |
| [ ] | `shelf/bag` | `src/assets/art/shelf/bag.png` | 44x50 | 0.5, 0.5 | 1 | interactive | A bagged order with a name label |
| [ ] | `shelf/package` | `src/assets/art/shelf/package.png` | 48x40 | 0.5, 0.5 | 1 | interactive | A held package with a name label |

## item

| Done | Key | File | Size | Anchor | Frames | Layer | What it is |
|---|---|---|---|---|---|---|---|
| [ ] | `item/bag` | `src/assets/art/item/bag.png` | 28x28 | 0.5, 0.5 | 1 | held | Held item icon: bag (hand slot, and on the counter when handing over) |
| [ ] | `item/paper` | `src/assets/art/item/paper.png` | 28x28 | 0.5, 0.5 | 1 | held | Held item icon: paper (hand slot, and on the counter when handing over) |
| [ ] | `item/ream` | `src/assets/art/item/ream.png` | 28x28 | 0.5, 0.5 | 1 | held | Held item icon: ream (hand slot, and on the counter when handing over) |
| [ ] | `item/box` | `src/assets/art/item/box.png` | 28x28 | 0.5, 0.5 | 1 | held | Held item icon: box (hand slot, and on the counter when handing over) |
| [ ] | `item/tape` | `src/assets/art/item/tape.png` | 28x28 | 0.5, 0.5 | 1 | held | Held item icon: tape (hand slot, and on the counter when handing over) |
| [ ] | `item/label` | `src/assets/art/item/label.png` | 28x28 | 0.5, 0.5 | 1 | held | Held item icon: label (hand slot, and on the counter when handing over) |
| [ ] | `item/pen` | `src/assets/art/item/pen.png` | 28x28 | 0.5, 0.5 | 1 | held | Held item icon: pen (hand slot, and on the counter when handing over) |
| [ ] | `item/wrench` | `src/assets/art/item/wrench.png` | 28x28 | 0.5, 0.5 | 1 | held | Held item icon: wrench (hand slot, and on the counter when handing over) |
| [ ] | `item/sign` | `src/assets/art/item/sign.png` | 28x28 | 0.5, 0.5 | 1 | held | Held item icon: sign (hand slot, and on the counter when handing over) |
| [ ] | `item/card` | `src/assets/art/item/card.png` | 28x28 | 0.5, 0.5 | 1 | held | Held item icon: card (hand slot, and on the counter when handing over) |
| [ ] | `item/cash` | `src/assets/art/item/cash.png` | 28x28 | 0.5, 0.5 | 1 | held | Held item icon: cash (hand slot, and on the counter when handing over) |

## ui

| Done | Key | File | Size | Anchor | Frames | Layer | What it is |
|---|---|---|---|---|---|---|---|
| [ ] | `ui/hand_slot` | `src/assets/art/ui/hand_slot.png` | 44x44 | 0.5, 0.5 | 1 | ui | Hand slot frame |
| [ ] | `ui/keypad_key` | `src/assets/art/ui/keypad_key.png` | 26x20 | 0.5, 0.5 | 1 | ui | Keypad key |
| [ ] | `ui/button` | `src/assets/art/ui/button.png` | 120x22 | 0.5, 0.5 | 1 | ui | In-world action button |

## fx

| Done | Key | File | Size | Anchor | Frames | Layer | What it is |
|---|---|---|---|---|---|---|---|
| [ ] | `fx/sparkle` | `src/assets/art/fx/sparkle.png` | 16x16 | 0.5, 0.5 | pop: 4 @ 12 fps | ui | Sparkle when a step is done |
| [ ] | `fx/check` | `src/assets/art/fx/check.png` | 18x18 | 0.5, 0.5 | 1 | ui | Check mark when a step is done |

## Sounds

Optional: each plays `src/assets/sounds/<key>.ogg` (or .mp3, .wav) if it exists, and a short tone otherwise.

| Done | Key | Stand-in tone |
|---|---|---|
| [ ] | `door_bell` | 1320 Hz, 600 ms |
| [ ] | `thunk` | 180 Hz, 90 ms |
| [ ] | `tape_rip` | 520 Hz, 220 ms |
| [ ] | `printer_hum` | 110 Hz, 250 ms |
| [ ] | `stapler` | 260 Hz, 60 ms |
| [ ] | `register_ding` | 1560 Hz, 350 ms |
| [ ] | `pick_up` | 660 Hz, 60 ms |
| [ ] | `drop` | 330 Hz, 80 ms |
| [ ] | `nope` | 150 Hz, 160 ms |
| [ ] | `done` | 990 Hz, 140 ms |
| [ ] | `jam` | 90 Hz, 300 ms |
