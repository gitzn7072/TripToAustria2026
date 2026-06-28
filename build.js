#!/usr/bin/env node
/*
 * build.js — render trip.json + template.html → index.html
 *
 * trip.json is the single source of truth for trip CONTENT.
 * template.html holds the presentation shell (CSS, hero, sticky pill bar, day
 * switcher script) with {{PLACEHOLDER}} slots. This script fills the slots.
 *
 * All map links are COMPUTED here from plain addresses — never stored — so each
 * address has exactly one source. Two URL flavours, matching how iPhone apps
 * expect them (see CLAUDE.md → "Navigation links"):
 *   - Directions  (route-cta / walking routes): Google Maps `dir`, spaces => %20
 *   - Single dest (Waze + Google search):       spaces => +
 *
 * Usage: node build.js   (run from the project root)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const trip = JSON.parse(fs.readFileSync(path.join(ROOT, 'trip.json'), 'utf8'));
const template = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8');

/* ---------- escaping & encoding helpers ---------- */

// Escape text destined for HTML body/attribute content.
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// encodeURIComponent already produces %20 for spaces and %2C for commas — the
// exact flavour the directions URLs use.
const encPct = (s) => encodeURIComponent(s);
// Single-destination links use '+' for spaces instead of %20.
const encPlus = (s) => encodeURIComponent(s).replace(/%20/g, '+');

// `&` inside an href written into HTML must be entity-escaped.
const attr = (url) => url.replace(/&/g, '&amp;');

/* ---------- URL builders ---------- */

function directionsUrl({ origin, destination, waypoints = [] }) {
  let u = `https://www.google.com/maps/dir/?api=1&origin=${encPct(origin)}&destination=${encPct(destination)}`;
  if (waypoints.length) u += `&waypoints=${waypoints.map(encPct).join('%7C')}`;
  return u;
}

function walkUrl({ origin, destination, waypoints = [] }) {
  let u = `https://www.google.com/maps/dir/?api=1&travelmode=walking&origin=${encPlus(origin)}&destination=${encPlus(destination)}`;
  if (waypoints.length) u += `&waypoints=${waypoints.map(encPlus).join('%7C')}`;
  return u;
}

const wazeUrl = (addr) => `https://www.waze.com/ul?q=${encPlus(addr)}&navigate=yes`;
const gmapSearchUrl = (addr) => `https://www.google.com/maps/search/?api=1&query=${encPlus(addr)}`;

/* ---------- section renderers ---------- */

const li = (items, cls) => `<ul class="${cls}">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;

function sec({ icon, title, count, body, open, navClass }) {
  const cls = `sec${navClass ? ' sec-nav' : ''}`;
  const cnt = count != null ? ` <span class="cnt">${count}</span>` : '';
  const o = open ? ' open' : '';
  return `<details class="${cls}"${o}><summary><span class="sx" aria-hidden="true">${icon}</span>${esc(title)}${cnt}</summary><div class="sec-body">${body}</div></details>`;
}

// Shared daily route CTA (used by the itinerary day cards and the nav-summary view).
function routeCta(d) {
  return `<a class="route-cta" href="${attr(directionsUrl(d.drive))}" target="_blank" rel="noopener">` +
    `<span class="route-cta-ic" aria-hidden="true">🚐</span>` +
    `<span class="rc-main"><span class="rc-title">מסלול הנסיעה המלא של היום</span>${driveSub(d.driveMin)}</span>` +
    `<span class="route-cta-arr" aria-hidden="true">›</span></a>`;
}

function routeBlock(r) {
  const chips = r.meta.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  const steps = `<ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  const warns = (r.warns || []).map((w) => `<div class="warn">${esc(w)}</div>`).join('');
  const walk = r.walk
    ? `<a class="btn b-walk" href="${attr(walkUrl(r.walk))}" target="_blank" rel="noopener">🧭 מסלול הליכה במפות</a>`
    : '';
  return `<div class="route"><h4 class="route-name">${esc(r.name)}</h4><div class="meta">${chips}</div>${steps}${warns}${walk}</div>`;
}

function hoursBlock(rows) {
  return rows.map((h) => {
    const links = (h.links || []).length
      ? `<div class="linkrow">${h.links.map((l) => `<a class="btn b-link" href="${attr(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div>`
      : '';
    return `<div class="hrow"><p>${esc(h.text)}</p>${links}</div>`;
  }).join('');
}

// Brand icons as inline SVG (self-contained, no external requests).
// Waze: the app icon — cyan rounded square with a white smiling face.
const WAZE_ICON = '<svg class="bic" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5.5" fill="#33ccff"/><circle cx="12" cy="11" r="6.4" fill="#fff"/><circle cx="9.9" cy="10" r="1.05" fill="#173b4d"/><circle cx="14.1" cy="10" r="1.05" fill="#173b4d"/><path d="M9.2 12.4c.7 1 1.7 1.5 2.8 1.5s2.1-.5 2.8-1.5" fill="none" stroke="#173b4d" stroke-width="1.25" stroke-linecap="round"/></svg>';
// Google Maps: the red location pin with white center, on a white button.
const GMAP_ICON = '<svg class="bic" viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 2C8.1 2 5 5.1 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.9-3.1-7-7-7z"/><circle cx="12" cy="9" r="2.6" fill="#fff"/></svg>';
const wazeBtn = (href, label) => `<a class="btn b-waze" href="${attr(href)}" target="_blank" rel="noopener">${WAZE_ICON} ${label}</a>`;
const gmapBtn = (href, label) => `<a class="btn b-gmap" href="${attr(href)}" target="_blank" rel="noopener">${GMAP_ICON} ${label}</a>`;
// A nav point can be an address (n.addr) or an exact coordinate (n.ll = "lat,lon").
// Coordinates use Waze's ll= param (not q=); both map to a precise pin.
const wazeTarget = (n) => n.ll ? `https://www.waze.com/ul?ll=${encodeURIComponent(n.ll)}&navigate=yes` : wazeUrl(n.addr);
const gmapTarget = (n) => gmapSearchUrl(n.ll || n.addr);

// Standard nav rows: destination name + address on its own line.
function navRows(rows) {
  return rows.map((n) => (
    `<div class="navrow"><div class="nav-info"><div class="nav-dest">${esc(n.dest)}</div><div class="nav-addr">${esc(n.addr)}</div></div>` +
    `<div class="nav-btns">${wazeBtn(wazeTarget(n), 'Waze')}${gmapBtn(gmapTarget(n), 'Google')}</div></div>`
  )).join('');
}

// Shopping nav rows (day 11): dest+address combined on one line, no .nav-addr.
function shoppingNavRows(rows) {
  return rows.map((n) => (
    `<div class="navrow"><div class="nav-dest">${esc(n.dest)}</div>` +
    `<div class="nav-btns">${gmapBtn(gmapTarget(n), 'מפה')}${wazeBtn(wazeTarget(n), 'Waze')}</div></div>`
  )).join('');
}

/* ---------- drive-time sub-line (lives inside the route CTA button) ---------- */
// Color buckets: 🟢 low ≤1h · 🟡 1–2h · 🟠 2–3h · 🔴 very long >3h.
function driveSub(min) {
  if (min == null) return '';
  const dot = min <= 60 ? '🟢' : min <= 120 ? '🟡' : min <= 180 ? '🟠' : '🔴';
  const t = min < 60
    ? `${min} דק׳`
    : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} שע׳`;
  return `<span class="rc-sub"><span class="dt-dot" aria-hidden="true">${dot}</span>סה״כ נסיעה משוערת: ${t}</span>`;
}

/* ---------- per-day weather backup line (top of the day card) ---------- */
// A slim callout under the day header: what to do if the weather doesn't fit
// the day's activity. If it names a swap day, the strip is a button that jumps
// to that day (handled by the day-switcher script in template.html).
function wxBackup(d) {
  const b = trip.weatherBackup && trip.weatherBackup[d.n];
  if (!b || !b.text) return '';
  const inner = `<span class="wxalt-ic" aria-hidden="true">☔</span><span class="wxalt-txt">${esc(b.text)}</span>`;
  if (b.swap) {
    return `<button class="wxalt" type="button" data-target="${b.swap}" aria-label="גיבוי למזג אוויר — מעבר ליום ${b.swap}">${inner}<span class="wxalt-arr" aria-hidden="true">↩︎</span></button>`;
  }
  return `<div class="wxalt wxalt-static">${inner}</div>`;
}

/* ---------- day renderer ---------- */

function renderDay(d) {
  const parts = [];
  // data-lat/lon/date drive the live weather lookup (see template.html script).
  const geo = d.coords ? ` data-lat="${d.coords.lat}" data-lon="${d.coords.lon}"` : '';
  const date = d.date ? ` data-date="${d.date}"` : '';
  parts.push(`<article class="day" id="day${d.n}" data-day="${d.n}"${geo}${date} aria-labelledby="day${d.n}-title">`);
  parts.push('<header class="day-head">');
  parts.push(`<p class="day-kicker">${esc(d.kicker)}</p>`);
  parts.push(`<h2 class="day-title" id="day${d.n}-title">${esc(d.title)}</h2>`);
  // Drive time is merged INTO the route button (a two-line CTA), not a separate badge.
  parts.push(routeCta(d));
  parts.push('</header>');

  parts.push(wxBackup(d));
  parts.push(`<button class="rainback" type="button" data-target="${d.n}" data-mode="sun">☀️ חזרה לתוכנית המקורית</button>`);
  parts.push(sec({ icon: '🧭', title: 'תקציר היום', open: true, body: `<p class="prose">${esc(d.summary)}</p>` }));
  parts.push(sec({ icon: '🕒', title: 'לוח זמנים', body: li(d.timeline, 'timeline') }));
  // Weather: the summary shows the LIVE condition icon + condition + temp range (filled
  // by JS, replacing the static 🌦️). Expanding reveals the live how-to-dress explanation.
  // The static notes (data-wx-static) are the rollback — shown only when no live data loads.
  parts.push(
    `<details class="sec sec-wx"><summary><span class="sx" data-wx-icon aria-hidden="true">🌦️</span>מזג אוויר<span class="wx-sum" data-wx-sum></span></summary>` +
    `<div class="sec-body"><div class="live-weather" data-lw hidden></div>` +
    `<div data-wx-static>${li(d.weather, 'dots')}</div></div></details>`
  );
  parts.push(sec({ icon: '🥾', title: 'מסלולים', count: d.routes.length, body: d.routes.map(routeBlock).join('') }));
  if (d.hours && d.hours.length) {
    parts.push(sec({ icon: '🎟️', title: 'שעות ובדיקות לפני הגעה', body: hoursBlock(d.hours) }));
  }
  // Day-11 shopping extras sit between hours and tips, mirroring the source order.
  if (d.shopping && d.shopping.length) {
    parts.push(sec({ icon: '🛍️', title: 'אפשרויות קניות', body: li(d.shopping, 'dots') }));
  }
  if (d.shoppingNav && d.shoppingNav.length) {
    parts.push(sec({ icon: '📍', title: 'ניווט – קניות', body: shoppingNavRows(d.shoppingNav) }));
  }
  parts.push(sec({ icon: '💡', title: 'טיפים ודגשים', body: li(d.tips, 'tips') }));
  parts.push(sec({ icon: '📍', title: 'ניווט מהיר ליעדי היום', open: true, navClass: true, body: navRows(d.nav) }));

  parts.push('</article>');
  return parts.join('\n');
}

/* ---------- navigation summary view (one block per day) ---------- */
function navSummary() {
  return trip.days.map((d) => (
    `<section class="navday" aria-labelledby="navday${d.n}-title">` +
    `<div class="navday-head"><span class="navday-n" aria-hidden="true">${d.n}</span><h3 class="navday-title" id="navday${d.n}-title">${esc(d.kicker)}</h3></div>` +
    routeCta(d) +
    `<div class="navday-rows">${navRows(d.nav)}</div>` +
    `</section>`
  )).join('\n');
}

/* ---------- emergency view ---------- */
const telHref = (s) => 'tel:' + s.replace(/[^\d+]/g, '');
const waHref = (s) => 'https://wa.me/' + s.replace(/[^\d]/g, '');

function emergencyView() {
  const e = trip.emergency;
  const note = e.note ? `<div class="ec-note">⚠️ ${esc(e.note)}</div>` : '';
  const groups = e.groups.map((g, gi) => {
    const cards = g.contacts.map((c) => {
      const hasTel = c.tel && c.tel.trim();
      const hasWa = c.wa && c.wa.trim();
      const isPh = ('tel' in c || 'wa' in c) && !hasTel && !hasWa;
      const sub = c.sub ? `<div class="ec-sub">${esc(c.sub)}</div>` : '';
      const btns = [];
      if (hasTel) btns.push(`<a class="btn ec-call" href="${telHref(c.tel)}">📞 ${esc(c.tel)}</a>`);
      if (hasWa) btns.push(`<a class="btn ec-wa" href="${attr(waHref(c.wa))}" target="_blank" rel="noopener">💬 WhatsApp</a>`);
      if (c.web) btns.push(`<a class="btn b-link" href="${attr(c.web)}" target="_blank" rel="noopener">🔗 אתר</a>`);
      const btnRow = btns.length ? `<div class="ec-btns">${btns.join('')}</div>` : (isPh ? `<div class="ec-btns"><span class="ec-fill">להשלמה</span></div>` : '');
      return `<div class="ec-card${isPh ? ' ec-ph' : ''}"><div class="ec-ic" aria-hidden="true">${c.icon || '•'}</div><div class="ec-info"><div class="ec-label">${esc(c.label)}</div>${sub}</div>${btnRow}</div>`;
    }).join('');
    return `<section class="ec-group" aria-labelledby="ecg-${gi}"><h3 class="ec-gtitle" id="ecg-${gi}">${esc(g.title)}</h3>${cards}</section>`;
  }).join('\n');
  return note + groups;
}

/* ---------- footer: version + last-updated ---------- */
// Version is derived from git (build number = commit count, plus short hash);
// "last updated" is stamped at build/deploy time. On Netlify, COMMIT_REF is the
// deployed commit. All lookups degrade gracefully if git/env are unavailable.
function buildMeta() {
  const cp = require('child_process');
  const sh = (c) => { try { return cp.execSync(c, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return ''; } };
  const hash = (process.env.COMMIT_REF || '').slice(0, 7) || sh('git rev-parse --short HEAD');
  const count = sh('git rev-list --count HEAD');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return { hash, count, date: `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}` };
}

function renderFooter() {
  const m = buildMeta();
  const ver = [m.count ? `v${m.count}` : '', m.hash].filter(Boolean).join(' · ');
  const verLine = ver ? `<br><span class="ver">גרסה ${esc(ver)}</span>` : '';
  return `עודכן לאחרונה: ${esc(m.date)}${verLine}`;
}

/* ---------- assemble ---------- */

// Two stacked pill rows: the genuine plan (1..N in date order) and, below it, the
// weather-alternative order (altOrder[i] = which day's activity to do on date-slot i+1
// if weather doesn't fit). Both rows are plain .pill[data-target] → reuse the existing
// day-switcher (tapping any pill shows that activity's article). Swapped slots stand out.
// Days bar as a table: one column per day — number title, ☀️ button (original
// plan) and ☔ button (rainy / alternative plan). Both carry data-target + data-mode;
// the day-switcher in template.html shows the day in sun or rain mode.
const dayCols = trip.days.map((d) => {
  const sun = `<button class="dt-btn dt-sun" type="button" data-target="${d.n}" data-mode="sun" aria-label="תוכנית מקורית — יום ${d.n}" aria-controls="day${d.n}">☀️</button>`;
  const hasRain = trip.weatherBackup && trip.weatherBackup[d.n];
  const rain = hasRain
    ? `<button class="dt-btn dt-rain" type="button" data-target="${d.n}" data-mode="rain" aria-label="גיבוי לגשם — יום ${d.n}" aria-controls="day${d.n}">☔</button>`
    : `<span class="dt-btn dt-empty" aria-hidden="true"></span>`;
  return `<div class="dt-col" data-day="${d.n}"><div class="dt-num">${d.n}</div>${sun}${rain}</div>`;
}).join('');
const pills = `<div class="dt-grid">${dayCols}</div>`;
// legend lives OUTSIDE the sticky bar so it scrolls away (keeps the sticky header short)
const pillsLegend = `<div class="dt-legend"><span>☀️ <b>תוכנית מקורית</b></span><span>☔ <b>גיבוי לגשם / החלפה</b></span><span><span class="lg-dot" aria-hidden="true"></span> <b>= גשם בתחזית</b></span></div>`;
const days = trip.days.map(renderDay).join('\n');
// Optional full-plan document — rendered as an extra item in the bottom tab bar.
// It's an external link (no data-view), so the view-switcher JS ignores it.
const docTab = trip.docUrl
  ? `<a class="tab" href="${attr(trip.docUrl)}" target="_blank" rel="noopener"><span class="tab-ic" aria-hidden="true">📄</span><span class="tab-lbl">מסמך</span></a>`
  : '';

const html = template
  .replace('{{TITLE}}', esc(trip.title))
  .replace('{{SUBTITLE}}', esc(trip.subtitle))
  .replace('{{PILLS}}', pills)
  .replace('{{PILLS_LEGEND}}', pillsLegend)
  .replace('{{DOC_TAB}}', docTab)
  .replace('{{DAYS}}', days)
  .replace('{{NAV_SUMMARY}}', navSummary())
  .replace('{{EMERGENCY}}', emergencyView())
  .replace('{{FOOTER}}', renderFooter());

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log(`✓ index.html written (${trip.days.length} days, ${html.length} bytes)`);
