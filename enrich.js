#!/usr/bin/env node
/*
 * enrich.js — one-time / occasional build-time enrichment of trip.json.
 *
 * Adds to each day, IN PLACE:
 *   - date:     ISO date parsed from the kicker (DD.MM.YYYY)
 *   - coords:   {lat, lon} weather anchor for the day (geocoded WEATHER_PLACE)
 *   - driveMin: estimated driving minutes for the day's drive, via OSRM over the
 *               geocoded origin → waypoints → destination chain (null if unroutable)
 *
 * Uses only free, key-less services (Nominatim geocoding + OSRM routing).
 * Nominatim asks for <=1 req/sec + a real User-Agent — we cache and throttle.
 * This needs network. Runtime (build.js / index.html) does NOT depend on it;
 * once baked, the drive badges work fully offline.
 *
 * Usage: node enrich.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TRIP = path.join(ROOT, 'trip.json');
const trip = JSON.parse(fs.readFileSync(TRIP, 'utf8'));

// Per-day weather anchor = the place the family actually spends the day,
// which is not always the night's lodging (the drive destination).
const WEATHER_PLACE = {
  1: 'Bad Reichenhall, Germany',
  2: 'Salzburg, Austria',
  3: 'Zell am See, Austria',
  4: 'Hallstatt, Austria',
  5: 'Sankt Johann im Pongau, Austria',
  6: 'Flachau, Austria',
  7: 'Kitzbühel, Austria',
  8: 'Mayrhofen, Austria',
  9: 'Krimml, Austria',
  10: 'Mayrhofen, Austria',
  11: 'Innsbruck, Austria',
};

// Addresses Nominatim can't resolve (airport internal roads) or that resolve up
// restricted alpine roads OSRM detours around — pin them to sane public coords.
const OVERRIDES = {
  'Terminalstraße Mitte, 85356 München-Flughafen, Germany': { lat: 48.3537, lon: 11.7861 }, // Munich Airport
  'Mietwagenzentrum, Munich Airport, Germany': { lat: 48.3416, lon: 11.7665 },               // rental return
  'Walchensee, B11, Germany': { lat: 47.5876, lon: 11.3275 },
  'Stillup 945, 6290 Mayrhofen, Austria': { lat: 47.1556, lon: 11.8726 }, // Stilluptal public parking (road beyond is closed to cars)
  'Thermenplatz 1, 5541 Altenmarkt im Pongau, Austria': { lat: 47.3815, lon: 13.4079 }, // Therme Amadé
};

// Alps bounding box — reject geocodes that land outside it (they'd distort routes).
const inRegion = (g) => g && g.lat > 46 && g.lat < 49 && g.lon > 10 && g.lon < 14;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const geocodeCache = new Map();

async function geocode(query) {
  if (OVERRIDES[query]) return OVERRIDES[query];
  if (geocodeCache.has(query)) return geocodeCache.get(query);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  await sleep(1100); // be polite to Nominatim
  let result = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'TripToAustria2026-builder/1.0 (personal itinerary)' } });
    const arr = await res.json();
    if (arr && arr[0]) {
      const g = { lat: +arr[0].lat, lon: +arr[0].lon };
      if (inRegion(g)) result = g;
      else console.warn(`  ! geocode out of region, dropped: ${query} -> ${g.lat},${g.lon}`);
    }
  } catch (e) {
    console.warn(`  ! geocode failed: ${query} (${e.message})`);
  }
  geocodeCache.set(query, result);
  return result;
}

async function routeStats(points) {
  // points: [{lat,lon}, ...] in order. OSRM wants lon,lat;lon,lat
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code === 'Ok' && data.routes[0]) {
      const r = data.routes[0];
      return { min: Math.round(r.duration / 60), km: Math.round(r.distance / 1000) };
    }
  } catch (e) {
    console.warn(`  ! route failed (${e.message})`);
  }
  return null;
}

function isoFromKicker(kicker) {
  // kicker like "יום 1 · ראשון · 28.06.2026"
  const m = kicker.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

(async () => {
  for (const day of trip.days) {
    day.date = isoFromKicker(day.kicker);
    process.stdout.write(`Day ${day.n} (${day.date}): `);

    // weather anchor
    day.coords = await geocode(WEATHER_PLACE[day.n]);
    process.stdout.write(day.coords ? 'coords✓ ' : 'coords✗ ');

    // drive chain: origin → waypoints → destination
    const chain = [day.drive.origin, ...(day.drive.waypoints || []), day.drive.destination];
    const pts = [];
    for (const addr of chain) {
      const g = await geocode(addr);
      if (g) pts.push(g);
    }
    const stats = pts.length >= 2 ? await routeStats(pts) : null;
    day.driveMin = stats ? stats.min : null;
    if (stats) {
      const kmh = stats.km / (stats.min / 60);
      const flag = kmh < 25 ? `  ⚠️ avg ${kmh.toFixed(0)}km/h — likely restricted-road artifact, review` : '';
      console.log(`drive=${stats.min}min (${stats.km}km)${flag}`);
    } else {
      console.log('drive=null ✗');
    }
  }

  fs.writeFileSync(TRIP, JSON.stringify(trip, null, 2) + '\n');
  console.log('\n✓ trip.json enriched (date, coords, driveMin added per day)');
})();
