# Capture Studio brand and store artwork

Created for this project on 2026-10-18 with OpenAI image generation, then normalized with Chromium's native canvas. All graphics are original project artwork, with no borrowed company logos, store badges, or real user data. The artwork depicts capture corners, long pages, flattened redactions, image/PDF exports, and compression through abstract paper shapes rather than a fabricated product interface.

## Upload files

| Asset                    | File                         | Format                                 |
| ------------------------ | ---------------------------- | -------------------------------------- |
| Chrome Web Store icon    | `icon128.png`                | 128×128 PNG, RGBA, transparent padding |
| Small promotional tile   | `small-promo-440x280.png`    | 440×280 PNG, 24-bit RGB, no alpha      |
| Marquee promotional tile | `marquee-promo-1400x560.png` | 1400×560 PNG, 24-bit RGB, no alpha     |

The icon's nontransparent artwork occupies exactly x=16–111 and y=16–111: a 96×96 square with 16 transparent pixels on every side. It is front-facing, has no canvas-edge border or exterior drop shadow, and uses a strong white mark on a violet tile. `icon-context-preview.png` demonstrates the final icon on light and dark backgrounds; it is a review aid, not an upload asset.

Additional `icon16.png`, `icon48.png`, and `icon512.png` sizes use the same artwork and proportional transparent padding. The 512-pixel version is suitable for the website and high-density branding. The 128-pixel PNG is the correct store icon upload; SVG is not needed for this field.

The promotional tiles are square-cornered, full bleed, and text-free. Do not add a rating, review quote, price, download count, or browser badge over these images. Keep actual product screenshots separate from promotional illustrations.

## Palette and direction

- Primary violet: `#7956E8`.
- Deep ink purple: approximately `#241449`.
- White and pale lavender paper surfaces; darker violet redaction bars.
- Rounded precise capture geometry, restrained paper depth, no people or unrelated decorative imagery.

## Sources and reproduction

The unmodified generated masters are retained in `masters/`:

- `icon-generated.png`: transparent icon master, 1254×1254.
- `marquee-generated.png`: wide illustration master, 1983×793.
- `small-promo-generated.png`: compact illustration master, 1573×1000.

The original generation used the following art direction:

1. A saturated violet rounded square with a white four-corner capture mark surrounding two offset page sheets and a single violet redaction bar; front-facing and simple enough to recognize at small sizes, with a transparent background.
2. A text-free deep-purple banner with a tall off-white page inside white capture brackets, overlapping image/export sheets on the left and a compact compression sheet on the right; luminous violet accents and restrained paper depth.
3. The same visual identity recomposed for an 11:7 small promotional tile, with all meaningful artwork comfortably inside the canvas.

`build-assets.mjs` uses the existing Playwright/PNG dependencies, without installing anything. It crops the icon master to its meaningful alpha bounds, scales the mark to the required square artwork size, adds the prescribed transparent padding, resizes each promotional master to its target canvas, and encodes promotional PNGs as RGB with no alpha. It does not draw or creatively alter the illustrations. Run from the repository root:

```sh
node store-assets/branding/build-assets.mjs
```

`asset-validation.json` records the final dimensions, PNG color types, icon alpha bounds, and file sizes. Every delivered upload asset and the light/dark icon preview were visually inspected.

Guidelines checked against the current [Chrome Web Store image requirements](https://developer.chrome.com/docs/webstore/images) on 2026-10-18: 128×128 icon with 96×96 square artwork and 16-pixel transparent padding; 440×280 small promotion; 1400×560 marquee promotion; promotional artwork full bleed with no alpha.
