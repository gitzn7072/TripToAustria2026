# 🌍 טיול לאוסטריה 2026 · Austria 2026 Trip App

A single-file, mobile-first **interactive trip itinerary** (Hebrew, RTL) for a family road trip through Germany 🇩🇪, Austria 🇦🇹 — *Salzburg & Tyrol, 28.06.2026–08.07.2026*. Built as a self-contained `index.html` with no runtime dependencies, designed to be saved to an iPhone home screen.

## Features

- **App-style bottom tab bar** — three views: 🛣️ מסלול (itinerary) · 🧭 ניווט (navigation summary) · 🆘 חירום (emergency).
- **11 day cards** with summary, schedule, weather, hikes/routes, tips, and quick navigation — one day shown at a time via a sticky pill bar.
- **Live weather + sunrise/sunset + how-to-dress advice** per day, fetched from [Open-Meteo](https://open-meteo.com) (free, no API key). Falls back to static notes when offline or beyond the forecast window.
- **One-tap navigation** — every destination has Waze + Google Maps links; each day has a full-route Google Maps directions button with an **estimated drive time** (color-coded 🟢🟡🟠🔴).
- **Emergency view** — tap-to-call and WhatsApp links for local emergency services, the Israeli embassy/MFA, and the traveler's car rental, insurance, and credit-card contacts.

## How it works

`index.html` is **generated** — don't edit it by hand. Content lives in data; presentation lives in a template:

```
trip.json  ──(node build.js)──>  index.html
  (content)        ▲
template.html ──────┘ (CSS, shell, scripts)
```

| File | Role |
|------|------|
| **`trip.json`** | Single source of truth — all itinerary content, plus the `emergency` contacts. **Edit this to change the trip.** |
| **`build.js`** | Renders `trip.json` + `template.html` → `index.html`. Pure Node, no `npm install`. |
| **`template.html`** | Presentation shell: CSS, hero, tab bar, day-switcher + live-weather scripts, with `{{PLACEHOLDER}}` slots. Edit for design changes. |
| **`enrich.js`** | *Occasional* build step that geocodes (Nominatim) + routes (OSRM) each day to add `date`, `coords`, and `driveMin` to `trip.json`. Needs network; re-run only when drive routes change. |
| **`index.html`** | The generated, deployable app. |

All map links are **computed from plain addresses** at build time, so each address has exactly one source of truth.

## Usage

```bash
# rebuild after editing trip.json
node build.js

# preview locally
python3 -m http.server   # then open http://localhost:8000
# (or just open index.html directly in a browser)

# re-geocode / re-estimate drive times (only when routes change)
node enrich.js && node build.js
```

No build tooling or dependencies — just Node.js for the generator.

## Editing emergency contacts

Under `trip.json` → `emergency.groups[].contacts[]`. Each contact supports `tel`, `wa` (WhatsApp digits, country code, no `+`), and `web`. Leaving `tel`/`wa` empty renders a "fill me" placeholder. **Phone numbers are safety-critical — verify before adding.**

---

*Built with [Claude Code](https://claude.com/claude-code). See [CLAUDE.md](CLAUDE.md) for deeper architecture notes.*
