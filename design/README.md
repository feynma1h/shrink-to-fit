# Shrink to Fit social card

## Overview
A single 1200 × 630 Open Graph / social preview card for `shrink-to-fit`, to ship in the repo and
be served from GitHub Pages. It is the card that renders when the site URL is pasted into Slack,
iMessage, Twitter/X, LinkedIn, Discord, and GitHub's repo social preview.

Direction chosen: **the mark as the whole idea** — the flush-fit bracket mark at large scale, the
product name, one line of copy, a hairline, and a muted footer. Deliberately generic: **no
filenames, no before/after byte counts, no target value**, so the card never goes stale and never
implies a specific result.

## The source artboard
`og-card.html` in this folder is the **editable source artboard** — a self-contained HTML file with
two 1200 × 630 artboards (light, dark). It is not application code and nothing in it needs to be
ported into a framework. Its only job is to be re-opened and re-exported when copy changes.

Only the PNG ships. The page's meta tags point at `web/og.png`, and this folder is never served.
`regenerate.mjs` writes fresh exports next to itself; check a new `og.png` against the committed
one before copying it over `web/og.png`. The card changes rarely, so nothing regenerates it in CI.

## Files
| File | What it is |
| --- | --- |
| `og-card.html` | Editable source. Two artboards: `#og-light`, `#og-dark`. No external refs. |
| `regenerate.mjs` | Re-exports `og.png`, `og@2x.png` and `og-dark.png` from the artboards. |
| `og@2x.png` | 2400 × 1260, light palette. Not linked from the page. |
| `thumbnail.png` | 4:3 project thumbnail, 1200 × 900. Not linked from the page. |
| `../web/og.png` | 1200 × 630, light palette. **The card the page links.** 51.8 KB. |

## The artboard

Fixed **1200 × 630**, `box-sizing: border-box`, `padding: 64px 68px` (≈60px platform-crop safe
margin on all sides — LinkedIn and Twitter crop slightly differently). Ground is `--bg`, with a
**1px `--border` hairline on the artboard edge itself** so the light card holds its own shape
against dark Slack/Discord chrome. Column flex, `justify-content: space-between` → the lockup sits
top-left, the footer block sits bottom.

No shadows. No gradients. No illustration. No faked browser chrome. Everything left-aligned,
matching the site's left-aligned 680px column.

### 1. Lockup (top)
`display: flex; align-items: center; gap: 56px`

**The mark** — `<svg viewBox="0 0 16 16" width="224" height="224">`, the exact geometry from
`web/index.html`, scaled only:

```html
<svg viewBox="0 0 16 16" width="224" height="224" aria-hidden="true">
  <rect x="4.9" y="5.3" width="6.2" height="5.4" fill="#2563EB" />
  <path d="M6.3 3.6 H4 V12.4 H6.3 M9.7 3.6 H12 V12.4 H9.7"
        fill="none" stroke="#1A1F26" stroke-width="1.8" />
</svg>
```

> **Load-bearing detail.** The blue block's width is exactly flush with the brackets' inner edges —
> compressed to fit, zero slack — while clearance remains above and below. Do not add padding
> between block and brackets, do not round the corners, do not redraw or re-trace it, do not
> convert it to a raster. Because it is a `viewBox` scale, the 1.8 stroke and the flush edges stay
> in proportion automatically — changing only `width`/`height` is always safe.
>
> In the source file the two colors come from `.mark rect { fill: var(--accent) }` and
> `.mark path { stroke: var(--text) }`, which is what makes the dark artboard work from the same
> markup. If you inline the SVG anywhere else, hard-code the literals for that palette.

**Text column** — `display: flex; flex-direction: column; gap: 22px`
- Product name: `Shrink to Fit` — 76px / 600 / `letter-spacing: -0.03em` / `line-height: 1` / `--text`
- Tagline: `Hit an exact file-size limit. Entirely in your browser.` — 30px / 400 /
  `line-height: 1.4` / `--muted` / `max-width: 560px` / `text-wrap: pretty`

### 2. Footer block (bottom)
`display: flex; flex-direction: column; gap: 26px`
- A `border-top: 1px solid var(--border)` rule, full content width.
- A row, `justify-content: space-between`, 20px / 400 / `--muted`:
  - left: `Files never leave your device · No analytics, no cookies · Open source`
  - right: `feynma1h.github.io/shrink-to-fit`

## Copy — exact strings, do not rewrite
```
Shrink to Fit
Hit an exact file-size limit. Entirely in your browser.
Files never leave your device · No analytics, no cookies · Open source
feynma1h.github.io/shrink-to-fit
```
Separator between badge phrases is `·` (U+00B7) with a space either side.

No exclamation marks. No call to action ("Try it free", "Get started") — the app has no signup,
no pricing, and no funnel. No new marketing copy. If the tagline must change, the only sanctioned
alternates are the site's h1 (`Compress images & PDFs to hit an exact file-size limit — entirely in
your browser.`) and `Compress images & PDFs to an exact size — in your browser.`

## Typography
The site uses the plain system stack. The card renders in Inter / SF Pro as the closest faithful
stand-ins, resolved **locally only** — the source declares `@font-face` with `src: local(...)`
descriptors and falls back to the system stack, so there is **no external font reference and no
network request**, per the project's 100%-self-contained rule. Do not swap this for a Google Fonts
link or a webfont file.

```
font-family: "STF Sans", Inter, -apple-system, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif;
```

Consequence: the HTML renders slightly differently depending on the exporting machine's installed
fonts. **The committed PNG is the canonical artifact** — if you re-export on a machine without
Inter or SF Pro, compare against the committed PNG before replacing it.

## Design tokens (verbatim from `web/styles.css`)

| Token | Light | Dark | Role on the card |
| --- | --- | --- | --- |
| `--bg` | `#F6F7F9` | `#0F1319` | artboard ground |
| `--surface` | `#FFFFFF` | `#171D26` | unused in this direction |
| `--text` | `#1A1F26` | `#E8ECF1` | product name, bracket stroke |
| `--muted` | `#5C6570` | `#9AA4B1` | tagline, footer row |
| `--accent` | `#2563EB` | `#60A5FA` | the logo block |
| `--border` | `#D8DDE3` | `#2A323D` | artboard edge, footer rule |
| `--ok` | `#15803D` | `#4ADE80` | unused in this direction |

Geometry: 1px `--border` hairlines. `--radius: 10px` cards, 8px buttons/inputs, 999px pills — none
of which this direction uses, but keep the scale if anything is added.

Type scale used: 76 / 30 / 20 px. Tracking: −0.03em on the 76px name, default elsewhere.
Spacing used: 64/68 padding, 56 lockup gap, 26 footer gap, 22 text-column gap.

## Light vs dark
**Ship light as the primary** (`og.png`). The favicon is a data-URI SVG with the light literals
(`#2563EB` / `#1A1F26`) baked in, so a light card keeps the tab icon and the social card reading as
one product; and social cards sit on both light and dark chrome, so a light ground with a real
border holds up better than a dark one bleeding into a dark Slack theme. `og-dark.png`, which
`regenerate.mjs` writes but the repo does not keep, exists only for comparison. If it is ever
adopted, adopt it wholly. Never split the difference with a mid-grey.

## Constraints to honor
- **PNG well under ~500 KB.** `og.png` is 51.8 KB and `og@2x.png` 131.2 KB. An oversized social card
  on a page whose pitch is file size would be an own goal. If you re-export, check the size.
- **No external font/CDN references** anywhere in the source. No analytics, no network calls.
- **Legibility at ~360px wide** (Slack sidebar) — everything essential survives a 3× downscale;
  the 76px name and the mark are the load-bearing elements, the 20px footer is accepted-as-texture.

## How the page uses it

`web/index.html` carries these tags, along with `og:site_name`, `og:image:type` and the Twitter
title, description and image. The image URLs are absolute, because several platforms will not
resolve relative ones:

```html
<meta property="og:title" content="Shrink to Fit" />
<meta property="og:description" content="Hit an exact file-size limit. Entirely in your browser." />
<meta property="og:url" content="https://feynma1h.github.io/shrink-to-fit/" />
<meta property="og:type" content="website" />
<meta property="og:image" content="https://feynma1h.github.io/shrink-to-fit/og.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="Shrink to Fit — hit an exact file-size limit. Entirely in your browser." />
<meta name="twitter:card" content="summary_large_image" />
```

`og.png` sits at the served root, next to `index.html`. The same file works as GitHub's repository
social preview, uploaded by hand under Settings → Social preview. Slack, Twitter and LinkedIn cache
aggressively: after changing the image, flush each platform's cache or ship it under a new filename.
