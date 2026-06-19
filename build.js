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
  return `<details class="${cls}"${o}><summary><span class="sx">${icon}</span>${esc(title)}${cnt}</summary><div class="sec-body">${body}</div></details>`;
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

// Standard nav rows: destination name + address on its own line.
function navRows(rows) {
  return rows.map((n) => (
    `<div class="navrow"><div class="nav-info"><div class="nav-dest">${esc(n.dest)}</div><div class="nav-addr">${esc(n.addr)}</div></div>` +
    `<div class="nav-btns"><a class="btn b-waze" href="${attr(wazeUrl(n.addr))}" target="_blank" rel="noopener">🚗 Waze</a>` +
    `<a class="btn b-gmap" href="${attr(gmapSearchUrl(n.addr))}" target="_blank" rel="noopener">🗺️ Google</a></div></div>`
  )).join('');
}

// Shopping nav rows (day 11): dest+address combined on one line, no .nav-addr.
function shoppingNavRows(rows) {
  return rows.map((n) => (
    `<div class="navrow"><div class="nav-dest">${esc(n.dest)}</div>` +
    `<div class="nav-btns"><a class="btn b-gmap" href="${attr(gmapSearchUrl(n.addr))}" target="_blank" rel="noopener">🗺️ מפה</a>` +
    `<a class="btn b-waze" href="${attr(wazeUrl(n.addr))}" target="_blank" rel="noopener">🚗 Waze</a></div></div>`
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
  return `<span class="rc-sub"><span class="dt-dot">${dot}</span>סה״כ נסיעה משוערת: ${t}</span>`;
}

/* ---------- day renderer ---------- */

function renderDay(d) {
  const parts = [];
  // data-lat/lon/date drive the live weather lookup (see template.html script).
  const geo = d.coords ? ` data-lat="${d.coords.lat}" data-lon="${d.coords.lon}"` : '';
  const date = d.date ? ` data-date="${d.date}"` : '';
  parts.push(`<section class="day" id="day${d.n}" data-day="${d.n}"${geo}${date}>`);
  parts.push('<header class="day-head">');
  parts.push(`<div class="day-kicker">${esc(d.kicker)}</div>`);
  parts.push(`<h2 class="day-title">${esc(d.title)}</h2>`);
  // Drive time is merged INTO the route button (a two-line CTA), not a separate badge.
  parts.push(
    `<a class="route-cta" href="${attr(directionsUrl(d.drive))}" target="_blank" rel="noopener">` +
    `<span class="route-cta-ic">🚐</span>` +
    `<span class="rc-main"><span class="rc-title">מסלול הנסיעה המלא של היום</span>${driveSub(d.driveMin)}</span>` +
    `<span class="route-cta-arr">›</span></a>`
  );
  parts.push('</header>');

  parts.push(sec({ icon: '🧭', title: 'תקציר היום', open: true, body: `<p class="prose">${esc(d.summary)}</p>` }));
  parts.push(sec({ icon: '🕒', title: 'לוח זמנים', body: li(d.timeline, 'timeline') }));
  // Weather: the summary shows the LIVE condition icon + condition + temp range (filled
  // by JS, replacing the static 🌦️). Expanding reveals the live how-to-dress explanation.
  // The static notes (data-wx-static) are the rollback — shown only when no live data loads.
  parts.push(
    `<details class="sec sec-wx"><summary><span class="sx" data-wx-icon>🌦️</span>מזג אוויר<span class="wx-sum" data-wx-sum></span></summary>` +
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

  parts.push('</section>');
  return parts.join('\n');
}

/* ---------- navigation summary view (one block per day) ---------- */
function navSummary() {
  return trip.days.map((d) => (
    `<div class="navday">` +
    `<div class="navday-head"><span class="navday-n">${d.n}</span><span class="navday-title">${esc(d.kicker)}</span></div>` +
    `<a class="route-cta" href="${attr(directionsUrl(d.drive))}" target="_blank" rel="noopener">` +
    `<span class="route-cta-ic">🚐</span>` +
    `<span class="rc-main"><span class="rc-title">מסלול הנסיעה המלא של היום</span>${driveSub(d.driveMin)}</span>` +
    `<span class="route-cta-arr">›</span></a>` +
    `<div class="navday-rows">${navRows(d.nav)}</div>` +
    `</div>`
  )).join('\n');
}

/* ---------- emergency view ---------- */
const telHref = (s) => 'tel:' + s.replace(/[^\d+]/g, '');
const waHref = (s) => 'https://wa.me/' + s.replace(/[^\d]/g, '');

function emergencyView() {
  const e = trip.emergency;
  const note = e.note ? `<div class="ec-note">⚠️ ${esc(e.note)}</div>` : '';
  const groups = e.groups.map((g) => {
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
      return `<div class="ec-card${isPh ? ' ec-ph' : ''}"><div class="ec-ic">${c.icon || '•'}</div><div class="ec-info"><div class="ec-label">${esc(c.label)}</div>${sub}</div>${btnRow}</div>`;
    }).join('');
    return `<div class="ec-group"><h3 class="ec-gtitle">${esc(g.title)}</h3>${cards}</div>`;
  }).join('\n');
  return note + groups;
}

/* ---------- footer ---------- */
// Re-bold the subtitle inside the footer (it renders bold in the shell).
function renderFooter() {
  const [l1, l2] = trip.footerLines;
  const boldLine = esc(l1).replace(esc(trip.subtitle), `<b>${esc(trip.subtitle)}</b>`);
  return `${boldLine}<br>${esc(l2)}`;
}

/* ---------- assemble ---------- */

const pills = trip.days.map((d) => `<button class="pill" data-target="${d.n}">${d.n}</button>`).join('');
const rules = trip.rules.map((r) => `<li>${esc(r)}</li>`).join('');
const days = trip.days.map(renderDay).join('\n');

const html = template
  .replace('{{TITLE}}', esc(trip.title))
  .replace('{{SUBTITLE}}', esc(trip.subtitle))
  .replace('{{PILLS}}', pills)
  .replace('{{RULES}}', rules)
  .replace('{{DAYS}}', days)
  .replace('{{NAV_SUMMARY}}', navSummary())
  .replace('{{EMERGENCY}}', emergencyView())
  .replace('{{FOOTER}}', renderFooter());

fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log(`✓ index.html written (${trip.days.length} days, ${html.length} bytes)`);
