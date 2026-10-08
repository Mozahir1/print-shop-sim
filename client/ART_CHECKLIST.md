# Art checklist

Generated from `src/assets/manifest.json` by `npm run art`. Don't edit by hand.

Pixel art on a grid of 500x266 art pixels per station, drawn at 2x (nearest-neighbour) on a
1280x720 screen. Every sprite below is drawn as a placeholder (a shape in its category's color, and an icon) until
its file exists. To add one, save it at the path shown: a single PNG, a PNG strip of frames (left to right, in the
order the animations are listed), or an Aseprite export (PNG + JSON with the same name). Sizes are in art pixels;
the anchor is the point placed at the sprite's position (0.5, 0.5 is the center). Anything you can click is at
least 28 art pixels on its short side (56 on screen).

Categories (placeholder colors, so the same kind of thing looks the same everywhere): room #d9d0c0, furniture #a8865c, machine #8f9bab, paper #f4efe1, box #c08a52, bag #7fa7d9, tool #d0603a, money #4f9a5a, person #5d8bb8, status #9aa3ad, ui #2a2d33.

Layers, back to front: background, props, interactive, held, ui.

## counter

| Done | Key | Name | File | Size | Anchor | Frames | Layer | Category | What it is |
|---|---|---|---|---|---|---|---|---|---|
| [ ] | `counter/bg` | Shop floor | `src/assets/art/counter/bg.png` | 500x266 | 0, 0 | 1 | background | room | Counter: the shop floor seen from behind the counter, wall and window |
| [ ] | `counter/door` | Front door | `src/assets/art/counter/door.png` | 64x150 | 0, 0 | 1 | props | furniture | Front door customers walk in and out of |
| [ ] | `counter/desk` | Counter | `src/assets/art/counter/desk.png` | 500x70 | 0, 0 | 1 | props | furniture | The counter top, in front of the customer |
| [ ] | `counter/register` | Register | `src/assets/art/counter/register.png` | 64x44 | 0.5, 0.5 | 1 | interactive | machine | Register: shows the total, opens the keypad when ringing up |
| [ ] | `counter/reader` | Card reader | `src/assets/art/counter/reader.png` | 34x28 | 0.5, 0.5 | 1 | interactive | machine | Card reader on the counter |
| [ ] | `counter/reader_down` | Card reader (down) | `src/assets/art/counter/reader_down.png` | 34x28 | 0.5, 0.5 | 1 | interactive | machine | Card reader showing an error |
| [ ] | `counter/bell` | Bell | `src/assets/art/counter/bell.png` | 20x16 | 0.5, 0.5 | 1 | props | furniture | Service bell |
| [ ] | `counter/copier` | Self-serve copier | `src/assets/art/counter/copier.png` | 80x100 | 0.5, 0.5 | 1 | interactive | machine | Self-serve copier at the side of the floor |
| [ ] | `counter/copier_broken` | Self-serve copier (broken) | `src/assets/art/counter/copier_broken.png` | 80x100 | 0.5, 0.5 | 1 | interactive | machine | Self-serve copier, broken (blinking error) |
| [ ] | `counter/sign` | Out of order sign | `src/assets/art/counter/sign.png` | 40x30 | 0.5, 0.5 | 1 | props | tool | Out of order sign taped on the copier |
| [ ] | `counter/crew_register` | Coworker's register | `src/assets/art/counter/crew_register.png` | 56x40 | 0.5, 0.5 | 1 | props | machine | The second register, your coworker's |

## customer

| Done | Key | Name | File | Size | Anchor | Frames | Layer | Category | What it is |
|---|---|---|---|---|---|---|---|---|---|
| [ ] | `customer/body_a` | Customer | `src/assets/art/customer/body_a.png` | 70x110 | 0.5, 1 | idle: 2 @ 2 fps; walk: 4 @ 8 fps | interactive | person | Customer body, variant a (tinted per customer). Idle: a slow breathing loop |
| [ ] | `customer/body_b` | Customer | `src/assets/art/customer/body_b.png` | 70x110 | 0.5, 1 | idle: 2 @ 2 fps; walk: 4 @ 8 fps | interactive | person | Customer body, variant b (tinted per customer). Idle: a slow breathing loop |
| [ ] | `customer/body_c` | Customer | `src/assets/art/customer/body_c.png` | 70x110 | 0.5, 1 | idle: 2 @ 2 fps; walk: 4 @ 8 fps | interactive | person | Customer body, variant c (tinted per customer). Idle: a slow breathing loop |
| [ ] | `customer/body_business` | Business client | `src/assets/art/customer/body_business.png` | 70x110 | 0.5, 1 | idle: 2 @ 2 fps; walk: 4 @ 8 fps | interactive | person | Business client in a suit |
| [ ] | `customer/face_fine` | Face: fine | `src/assets/art/customer/face_fine.png` | 40x40 | 0.5, 0.5 | 1 | props | person | Customer face: fine |
| [ ] | `customer/face_annoyed` | Face: annoyed | `src/assets/art/customer/face_annoyed.png` | 40x40 | 0.5, 0.5 | 1 | props | person | Customer face: annoyed |
| [ ] | `customer/face_angry` | Face: angry | `src/assets/art/customer/face_angry.png` | 40x40 | 0.5, 0.5 | 1 | props | person | Customer face: angry |
| [ ] | `customer/bubble` | Speech bubble | `src/assets/art/customer/bubble.png` | 70x24 | 0.5, 0.5 | 1 | ui | ui | Impatience speech bubble ("Hello?") |

## computer

| Done | Key | Name | File | Size | Anchor | Frames | Layer | Category | What it is |
|---|---|---|---|---|---|---|---|---|---|
| [ ] | `computer/bg` | Back office | `src/assets/art/computer/bg.png` | 500x266 | 0, 0 | 1 | background | room | Computer: the back desk |
| [ ] | `computer/monitor` | Computer | `src/assets/art/computer/monitor.png` | 400x236 | 0, 0 | 1 | props | machine | Monitor frame; the order form, print queue, inbox and label form show inside it |
| [ ] | `computer/router` | Router | `src/assets/art/computer/router.png` | 30x40 | 0.5, 0.5 | 1 | interactive | machine | Wi-Fi router (hold the power button to restart it) |
| [ ] | `computer/reader_box` | Card reader box | `src/assets/art/computer/reader_box.png` | 30x40 | 0.5, 0.5 | 1 | interactive | machine | Card reader base station (hold reset to fix it) |

## printer

| Done | Key | Name | File | Size | Anchor | Frames | Layer | Category | What it is |
|---|---|---|---|---|---|---|---|---|---|
| [ ] | `printer/bg` | Print room | `src/assets/art/printer/bg.png` | 500x266 | 0, 0 | 1 | background | room | Printer: the production printer against the back wall |
| [ ] | `printer/body` | Printer | `src/assets/art/printer/body.png` | 220x150 | 0, 0 | 1 | props | machine | The production printer |
| [ ] | `printer/tray` | Paper tray | `src/assets/art/printer/tray.png` | 80x28 | 0.5, 0.5 | 1 | interactive | machine | Paper tray, closed |
| [ ] | `printer/tray_open` | Paper tray (open) | `src/assets/art/printer/tray_open.png` | 80x30 | 0.5, 0.5 | 1 | interactive | machine | Paper tray, pulled open to load |
| [ ] | `printer/ream` | Ream of paper | `src/assets/art/printer/ream.png` | 54x30 | 0.5, 0.5 | 1 | interactive | paper | A ream of paper (drag it into the tray) |
| [ ] | `printer/stack` | Printed stack | `src/assets/art/printer/stack.png` | 64x40 | 0.5, 1 | 1 | interactive | paper | Printed stack in the output tray (grows sheet by sheet) |
| [ ] | `printer/jam_panel` | Jam door | `src/assets/art/printer/jam_panel.png` | 64x44 | 0.5, 0.5 | 1 | interactive | machine | Side panel, closed |
| [ ] | `printer/jam_panel_open` | Jam door (open) | `src/assets/art/printer/jam_panel_open.png` | 64x44 | 0.5, 0.5 | 1 | interactive | machine | Side panel, opened to reach the jam |
| [ ] | `printer/jam_sheet` | Jammed sheet | `src/assets/art/printer/jam_sheet.png` | 34x28 | 0.5, 0.5 | 1 | interactive | paper | A crumpled jammed sheet (tap to pull it out) |
| [ ] | `printer/light_idle` | Status light | `src/assets/art/printer/light_idle.png` | 12x12 | 0.5, 0.5 | 1 | props | status | Status light: idle |
| [ ] | `printer/light_printing` | Status light | `src/assets/art/printer/light_printing.png` | 12x12 | 0.5, 0.5 | blink: 2 @ 3 fps | props | status | Status light: printing |
| [ ] | `printer/light_jammed` | Status light | `src/assets/art/printer/light_jammed.png` | 12x12 | 0.5, 0.5 | 1 | props | status | Status light: jammed |
| [ ] | `printer/light_tray_empty` | Status light | `src/assets/art/printer/light_tray_empty.png` | 12x12 | 0.5, 0.5 | 1 | props | status | Status light: tray_empty |
| [ ] | `printer/cards` | Card machine | `src/assets/art/printer/cards.png` | 100x76 | 0, 0 | 1 | props | machine | Business card machine (prints and cuts the cards by itself) |
| [ ] | `printer/cards_out` | Box of business cards | `src/assets/art/printer/cards_out.png` | 48x28 | 0.5, 1 | 1 | interactive | paper | Finished business cards in the machine's output tray |

## finishing

| Done | Key | Name | File | Size | Anchor | Frames | Layer | Category | What it is |
|---|---|---|---|---|---|---|---|---|---|
| [ ] | `finishing/bg` | Finishing room | `src/assets/art/finishing/bg.png` | 500x266 | 0, 0 | 1 | background | room | Finishing: the work table |
| [ ] | `finishing/table` | Work table | `src/assets/art/finishing/table.png` | 470x80 | 0, 0 | 1 | props | furniture | Work table |
| [ ] | `finishing/stack` | Printed stack | `src/assets/art/finishing/stack.png` | 64x40 | 0.5, 1 | 1 | interactive | paper | The collected stack on the table |
| [ ] | `finishing/set` | One set | `src/assets/art/finishing/set.png` | 30x28 | 0.5, 0.5 | 1 | interactive | paper | One set to staple (tap to punch it) |
| [ ] | `finishing/stapler` | Stapler | `src/assets/art/finishing/stapler.png` | 56x32 | 0.5, 0.5 | 1 | interactive | tool | Heavy stapler (hold over the stack for big runs) |
| [ ] | `finishing/cutter` | Paper cutter | `src/assets/art/finishing/cutter.png` | 100x44 | 0.5, 0.5 | 1 | interactive | tool | Paper cutter (hold to cut) |
| [ ] | `finishing/laminator` | Laminator | `src/assets/art/finishing/laminator.png` | 96x54 | 0.5, 0.5 | 1 | interactive | machine | Laminator (hold to feed it through) |
| [ ] | `finishing/bag` | Pickup bag | `src/assets/art/finishing/bag.png` | 50x56 | 0.5, 0.5 | 1 | interactive | bag | Paper bag for a finished order |
| [ ] | `finishing/name_label` | Name label | `src/assets/art/finishing/name_label.png` | 40x28 | 0.5, 0.5 | 1 | interactive | paper | Name label for the bag |
| [ ] | `finishing/shelf_cart` | Cart to the pickup shelf | `src/assets/art/finishing/shelf_cart.png` | 80x60 | 0.5, 0.5 | 1 | interactive | furniture | Cart to the pickup shelf (drop the bag here) |
| [ ] | `finishing/wide_printer` | Wide-format printer | `src/assets/art/finishing/wide_printer.png` | 200x64 | 0, 0 | 1 | interactive | machine | Wide-format printer: a 24x36 print comes off the roll here (tap to cut it off) |
| [ ] | `finishing/wide_sheet` | Large print | `src/assets/art/finishing/wide_sheet.png` | 110x34 | 0.5, 1 | 1 | interactive | paper | A large print on the table, before it's rolled up |
| [ ] | `finishing/rolled` | Rolled-up print | `src/assets/art/finishing/rolled.png` | 90x28 | 0.5, 1 | 1 | interactive | paper | A large print rolled up in its tube |
| [ ] | `finishing/tube` | Mailing tube | `src/assets/art/finishing/tube.png` | 80x28 | 0.5, 0.5 | 1 | interactive | box | An empty tube for a rolled-up large print |

## shipping

| Done | Key | Name | File | Size | Anchor | Frames | Layer | Category | What it is |
|---|---|---|---|---|---|---|---|---|---|
| [ ] | `shipping/bg` | Shipping room | `src/assets/art/shipping/bg.png` | 500x266 | 0, 0 | 1 | background | room | Shipping: the packing table, scale, label printer, outbound bin |
| [ ] | `shipping/table` | Packing table | `src/assets/art/shipping/table.png` | 360x80 | 0, 0 | 1 | props | furniture | Packing table |
| [ ] | `shipping/item` | Their item | `src/assets/art/shipping/item.png` | 40x34 | 0.5, 0.5 | 1 | interactive | person | The customer's item to ship |
| [ ] | `shipping/box_small` | Small box | `src/assets/art/shipping/box_small.png` | 46x40 | 0.5, 0.5 | 1 | interactive | box | Small box (open) |
| [ ] | `shipping/box_medium` | Medium box | `src/assets/art/shipping/box_medium.png` | 60x52 | 0.5, 0.5 | 1 | interactive | box | Medium box (open) |
| [ ] | `shipping/box_large` | Large box | `src/assets/art/shipping/box_large.png` | 80x66 | 0.5, 0.5 | 1 | interactive | box | Large box (open) |
| [ ] | `shipping/box_closed` | Taped box | `src/assets/art/shipping/box_closed.png` | 60x52 | 0.5, 0.5 | 1 | interactive | box | A taped box (drawn at the size of its box) |
| [ ] | `shipping/box_damaged` | Damaged box | `src/assets/art/shipping/box_damaged.png` | 60x52 | 0.5, 0.5 | 1 | props | box | A box that came back crushed (complaint scene) |
| [ ] | `shipping/paper` | Packing paper | `src/assets/art/shipping/paper.png` | 28x28 | 0.5, 0.5 | 1 | interactive | paper | Packing paper (tap to stuff it in) |
| [ ] | `shipping/tape_gun` | Tape gun | `src/assets/art/shipping/tape_gun.png` | 44x32 | 0.5, 0.5 | 1 | interactive | tool | Tape gun (hold across the flaps) |
| [ ] | `shipping/scale` | Scale | `src/assets/art/shipping/scale.png` | 90x40 | 0.5, 0.5 | 1 | interactive | machine | Shipping scale; the readout ticks up to the weight |
| [ ] | `shipping/label_printer` | Label printer | `src/assets/art/shipping/label_printer.png` | 70x44 | 0.5, 0.5 | 1 | props | machine | Label printer |
| [ ] | `shipping/label` | Shipping label | `src/assets/art/shipping/label.png` | 44x28 | 0.5, 0.5 | 1 | interactive | paper | Printed shipping label (drag it onto the box) |
| [ ] | `shipping/dropoff` | Drop-off package | `src/assets/art/shipping/dropoff.png` | 44x36 | 0.5, 0.5 | 1 | interactive | box | A prepaid drop-off package with its label |
| [ ] | `shipping/bin` | Outbound bin | `src/assets/art/shipping/bin.png` | 100x76 | 0.5, 0.5 | 1 | interactive | furniture | Outbound bin (fills up) |
| [ ] | `shipping/truck` | Pickup truck | `src/assets/art/shipping/truck.png` | 160x90 | 0.5, 0.5 | 1 | interactive | machine | Carrier truck at the back door (tap to hand off) |

## shelf

| Done | Key | Name | File | Size | Anchor | Frames | Layer | Category | What it is |
|---|---|---|---|---|---|---|---|---|---|
| [ ] | `shelf/bg` | Pickup area | `src/assets/art/shelf/bg.png` | 500x266 | 0, 0 | 1 | background | room | Pickup shelf |
| [ ] | `shelf/rack` | Pickup shelf | `src/assets/art/shelf/rack.png` | 470x220 | 0, 0 | 1 | props | furniture | Shelving: orders on the left, held packages on the right |
| [ ] | `shelf/bag` | Pickup bag | `src/assets/art/shelf/bag.png` | 44x50 | 0.5, 0.5 | 1 | interactive | bag | A bagged order with a name label |
| [ ] | `shelf/package` | Held package | `src/assets/art/shelf/package.png` | 48x40 | 0.5, 0.5 | 1 | interactive | box | A held package with a name label |

## item

| Done | Key | Name | File | Size | Anchor | Frames | Layer | Category | What it is |
|---|---|---|---|---|---|---|---|---|---|
| [ ] | `item/bag` | Bag | `src/assets/art/item/bag.png` | 28x28 | 0.5, 0.5 | 1 | held | bag | Held item icon: bag (hand slot, and on the counter when handing over) |
| [ ] | `item/paper` | Copies | `src/assets/art/item/paper.png` | 28x28 | 0.5, 0.5 | 1 | held | paper | Held item icon: paper (hand slot, and on the counter when handing over) |
| [ ] | `item/ream` | Ream of paper | `src/assets/art/item/ream.png` | 28x28 | 0.5, 0.5 | 1 | held | paper | Held item icon: ream (hand slot, and on the counter when handing over) |
| [ ] | `item/box` | Package | `src/assets/art/item/box.png` | 28x28 | 0.5, 0.5 | 1 | held | box | Held item icon: box (hand slot, and on the counter when handing over) |
| [ ] | `item/tape` | Tape gun | `src/assets/art/item/tape.png` | 28x28 | 0.5, 0.5 | 1 | held | tool | Held item icon: tape (hand slot, and on the counter when handing over) |
| [ ] | `item/label` | Label | `src/assets/art/item/label.png` | 28x28 | 0.5, 0.5 | 1 | held | paper | Held item icon: label (hand slot, and on the counter when handing over) |
| [ ] | `item/pen` | Pen | `src/assets/art/item/pen.png` | 28x28 | 0.5, 0.5 | 1 | held | tool | Held item icon: pen (hand slot, and on the counter when handing over) |
| [ ] | `item/wrench` | Wrench | `src/assets/art/item/wrench.png` | 28x28 | 0.5, 0.5 | 1 | held | tool | Held item icon: wrench (hand slot, and on the counter when handing over) |
| [ ] | `item/sign` | Sign | `src/assets/art/item/sign.png` | 28x28 | 0.5, 0.5 | 1 | held | tool | Held item icon: sign (hand slot, and on the counter when handing over) |
| [ ] | `item/card` | Card | `src/assets/art/item/card.png` | 28x28 | 0.5, 0.5 | 1 | held | money | Held item icon: card (hand slot, and on the counter when handing over) |
| [ ] | `item/cash` | Cash | `src/assets/art/item/cash.png` | 28x28 | 0.5, 0.5 | 1 | held | money | Held item icon: cash (hand slot, and on the counter when handing over) |

## ui

| Done | Key | Name | File | Size | Anchor | Frames | Layer | Category | What it is |
|---|---|---|---|---|---|---|---|---|---|
| [ ] | `ui/keypad_key` | Keypad key | `src/assets/art/ui/keypad_key.png` | 26x20 | 0.5, 0.5 | 1 | ui | ui | Keypad key |
| [ ] | `ui/button` | Button | `src/assets/art/ui/button.png` | 120x22 | 0.5, 0.5 | 1 | ui | ui | In-world action button |

## fx

| Done | Key | Name | File | Size | Anchor | Frames | Layer | Category | What it is |
|---|---|---|---|---|---|---|---|---|---|
| [ ] | `fx/sparkle` | Sparkle | `src/assets/art/fx/sparkle.png` | 16x16 | 0.5, 0.5 | pop: 4 @ 12 fps | ui | status | Sparkle when a step is done |
| [ ] | `fx/check` | Done | `src/assets/art/fx/check.png` | 18x18 | 0.5, 0.5 | 1 | ui | status | Check mark when a step is done |

## crew

| Done | Key | Name | File | Size | Anchor | Frames | Layer | Category | What it is |
|---|---|---|---|---|---|---|---|---|---|
| [ ] | `crew/body` | Coworker | `src/assets/art/crew/body.png` | 60x104 | 0.5, 1 | idle: 2 @ 2 fps; walk: 4 @ 8 fps | props | person | Your coworker (seen from behind the counter, or at a station). Idle: a slow breathing loop |

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
