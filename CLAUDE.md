# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single, self-contained interactive itinerary for a family trip to Austria (Salzburg & Tyrol, 28.06.2026–08.07.2026). The deliverable is [index.html](index.html) — mobile-first for an iPhone (max content width 500px), Google Fonts from a CDN, no runtime dependencies.

To preview: open [index.html](index.html) in a browser, or serve the folder (`python3 -m http.server`).

## index.html is GENERATED — do not hand-edit it

The trip is now built from a data file through a renderer:

```
docx  ──(manual reference)──>  trip.json  ──(node build.js)──>  index.html
                                (source of truth)    ▲ uses template.html
```

- **[trip.json](trip.json)** — the single source of truth for all trip *content* (days, sections, addresses). Edit this to change the trip.
- **[build.js](build.js)** — renders `trip.json` + `template.html` → `index.html`. Run `node build.js` after any edit. Deterministic; no npm install (uses only Node built-ins).
- **[template.html](template.html)** — the presentation shell (CSS, hero, sticky pill bar, day-switcher + **live-weather** `<script>`) with `{{TITLE}}`, `{{SUBTITLE}}`, `{{PILLS}}`, `{{RULES}}`, `{{DAYS}}`, `{{FOOTER}}` placeholders. Edit this for design/theme changes.
- **[gen-docx.js](gen-docx.js)** — regenerates `word/document.xml` inside **trip-plan.docx** from `trip.json` so the linked Word document (📄 מסמך tab, via the Office viewer) stays in sync. The `.docx` can't be hand-edited safely (Word fragments text across many runs), so re-run this after content changes: unzip the docx → `node gen-docx.js <dir>/word/document.xml` → rezip → deploy. Reuses the original package's styles/fonts.
- **[enrich.js](enrich.js)** — *occasional* build-time step that geocodes (Nominatim) and routes (OSRM) each day to add `date`, `coords`, and `driveMin` to `trip.json`. Needs network; run `node enrich.js` only when drive routes/addresses change. Runtime does **not** depend on it — once baked, drive badges work offline. Un-geocodable or restricted-road addresses (Munich Airport, Stilluptal) are pinned in its `OVERRIDES` map; it warns when a route's avg speed implies a routing artifact.
- The `.docx` is the upstream human-authored plan — reference only, not consumed by the build.

**Changing the trip = edit `trip.json`, then `node build.js`.** Editing `index.html` directly will be overwritten on the next build. The pill-bar/day-section count and all `data-day`/`id`/`data-target` wiring are derived from `trip.json` order, so they can't drift.

### Why links must be computed, not stored

`build.js` computes every Waze/Google map link from the plain address in the data — addresses are never stored pre-encoded, so each has one source. This is deliberate: the original hand-written HTML had **two day-9 nav rows whose displayed address disagreed with the link target** (text said Krimml/Zell am Ziller, links pointed to Maurach/Pertisau). Regenerating from `trip.json` fixed both. Keep link synthesis in `build.js`; don't paste literal map URLs into the data.

If you change the renderer or schema, re-verify against intent: compare element counts and decoded link-destination multisets between old and new `index.html` (that's how the current output was validated — all structural counts match, only the 2 buggy links changed).

## Language & direction

The entire document is **Hebrew, RTL** (`<html lang="he" dir="rtl">`). All user-facing copy is Hebrew. Preserve RTL behavior and Hebrew text when editing. Physical addresses and dates are intentionally kept LTR (`direction:ltr`) so navigation links and date ranges render correctly — keep that.

## trip.json schema

Top level: `title`, `subtitle`, `rules[]` (the "iron rules" intro), `footerLines[]`, and `days[]`. Each day object:

- `n`, `kicker` (e.g. `יום 1 · ראשון · 28.06.2026`), `title`
- `drive` — `{origin, destination, waypoints[]}`, plain addresses → renders the full-day Google Maps directions CTA
- `summary` (string), `timeline[]`, `weather[]`, `tips[]` (arrays of Hebrew strings)
- `routes[]` — each `{name, meta[] (chip strings), steps[], warns[], walk}`, where `walk` is `{origin, destination, waypoints[]}` or `null`
- `hours[]` — optional (9 of 11 days); each `{text, links[]}` where links are `{label, url}` (external official sites, stored verbatim). `[]` = section omitted
- `nav[]` — `{dest, addr}`; the address is the single source for both map links
- `shopping[]` and `shoppingNav[]` — day 11 only; omit on other days
- `date`, `coords` `{lat,lon}`, `driveMin` — **added by `enrich.js`**, not by hand. `coords`+`date` drive the live weather lookup; `driveMin` drives the colored drive-time badge

Top level also has **`emergency`**: `{note, groups[]}`, each group `{title, contacts[]}`. A contact is `{icon, label, sub?, tel?, wa?, web?}`. `tel`/`wa`/`web` are optional and each renders its own button (`tel:` call, `https://wa.me/<digits>` WhatsApp, link). A contact that has a `tel`/`wa` key but leaves it **empty** renders as a dashed "להשלמה" placeholder — that's intentional for the user-specific numbers (Sixt reservation, Migdal policy, credit card). Fill the digits to turn the placeholder into live call/WhatsApp buttons. Phone numbers here are safety-critical: verify before adding, don't guess.

## App shell: three views + bottom tab bar

The page is a single-file app with a fixed bottom tab bar (`.tabbar`) switching three top-level `<section class="view" data-view>`s — only one is `.view-active` at a time (toggled by the tab-bar IIFE in `template.html`):
- **itinerary** — the hero + day pill bar + day sections + footer (the original content; the day switcher works *within* this view).
- **nav** — `navSummary()` in `build.js`: one block per day with the full-day route CTA + that day's nav rows, so every destination is reachable in one scroll.
- **emergency** — `emergencyView()` in `build.js` from `trip.emergency`.

The hero stays above all views as the persistent app header. Adding a view = new `<section class="view" data-view="…">` + a `.tab` button with matching `data-go` + a generator + placeholder in `build.js`. View visibility is driven by the `hidden` attribute (toggled in JS = real a11y state); `.view-active` only triggers the fade animation.

## Best-practice / accessibility conventions

Keep these when editing markup so the generated HTML stays standards-compliant:
- **Landmarks**: `<header class="hero">`, `<main id="main-content">` wrapping the views, each day is an `<article aria-labelledby="dayN-title">`, nav/emergency blocks are `<section aria-labelledby>`. There's a skip-link to `#main-content`.
- **Switchers**: pill and tab `<button type="button">`s carry `aria-label`; the active one gets `aria-current` set in JS (not hardcoded). The two `<nav>`s have `aria-label`s.
- **Decorative emoji** (section icons, route 🚐/›, drive dot, flags, weather glyph, emergency icons) are `aria-hidden="true"` — the adjacent text carries the meaning.
- **Motion/focus**: `:focus-visible` rings are defined; `prefers-reduced-motion` disables animations and the JS smooth-scroll falls back to `auto`.
- **Head**: `<meta description/theme-color>`, Apple/mobile web-app tags (home-screen), and an inline emoji SVG favicon.
- Emoji used as element text content must be HTML-safe; `esc()` handles user data, but literal emoji in templates are fine.

## Live features (runtime, in template.html)

- **Live weather, sun & how-to-dress** — on load the script fetches [Open-Meteo](https://open-meteo.com) (free, no key, CORS) per day from `data-lat/lon/date`. On success it (1) swaps the weather section's static 🌦️ summary icon for the **live condition icon** and appends the Hebrew condition + temp range, (2) fills the expandable body with a **detailed stats grid** (feels-like high/low, rain probability, precipitation mm, wind + max gust, UV index with a Hebrew level), **dressing advice derived from the forecast** (`dress()` rule-maps temp/rain/wind/UV to Hebrew advice — there is no standalone free clothing API), and 🌅/🌇 sun times, and (3) hides the static notes (`data-wx-static`). Add a metric by extending the `daily=` param list and adding a `row()` in `apply()`. **Fallback is the whole point:** on offline, 7s timeout, or a date beyond Open-Meteo's ~16-day window (no `daily` in response), nothing changes and the static Hebrew notes remain. Far-future days show static now and flip to live as the trip nears — expected, not a bug.
- **Drive time** — merged *into* the route CTA as a second line (`driveSub()` in `build.js`), with a Hebrew total-duration label and a color dot from `driveMin`: 🟢 ≤1h · 🟡 1–2h · 🟠 2–3h · 🔴 >3h. Static (baked), always works offline.

`build.js` maps these to collapsible `<details class="sec">` cards in a fixed order (summary → timeline → weather → routes → hours → [shopping] → tips → nav), each with an emoji icon and Hebrew heading. The CSS classes (`.timeline`, `.dots`, `.tips`, `.route`, `.navrow`, `.chip`, `.warn`, `.hrow`) live in `template.html` — add new section types in `build.js` + `template.html`, not by hand in `index.html`.

### Link formats (computed in build.js)

Two shapes, both required for correct iPhone behavior. Directions use `%20` for spaces; single-destination search/Waze links use `+`:

- **Directions** (`drive`, `routes[].walk`): `https://www.google.com/maps/dir/?api=1&origin=…&destination=…[&waypoints=…%7C…]`
- **Single destination** (`nav`, `shoppingNav`): Waze `https://www.waze.com/ul?q=<addr>&navigate=yes` + Google `https://www.google.com/maps/search/?api=1&query=<addr>`

The "iron rules" intro states this convention: Waze links are built from physical addresses so they work on iPhone.

## Theming

All colors are CSS custom properties on `:root` (alpine palette: `--pine`, `--moss`, `--sky`, `--paper`, `--gold`, `--rust`, plus brand colors `--waze`/`--gmap`). Change the theme there, not inline. Fonts: Frank Ruhl Libre (headings) and Assistant (body), both from Google Fonts.
