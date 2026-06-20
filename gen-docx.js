#!/usr/bin/env node
/*
 * gen-docx.js — regenerate word/document.xml for trip-plan.docx FROM trip.json,
 * so the Word document stays in sync with the app (the single source of truth).
 *
 * Hand-editing the .docx is unsafe: Word fragments text across many runs. Instead
 * we rebuild the document body and drop it into the original .docx package (keeping
 * its styles/fonts/settings), then repackage. Usage (see the npm-less wrapper):
 *   node gen-docx.js <path-to-unzipped>/word/document.xml
 */
'use strict';
const fs = require('fs');
const path = require('path');
const trip = JSON.parse(fs.readFileSync(path.join(__dirname, 'trip.json'), 'utf8'));
const outPath = process.argv[2];
if (!outPath) { console.error('usage: node gen-docx.js <document.xml output path>'); process.exit(1); }

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// One run (Arial, RTL base so mixed Hebrew/Latin renders correctly).
function run(text, { sz = 22, bold = false } = {}) {
  return `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${bold ? '<w:b/><w:bCs/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:rtl w:val="1"/></w:rPr><w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
}
// One paragraph.
function p(text, { sz = 22, bold = false, indent = 0, after = 60, bullet = false } = {}) {
  const t = bullet ? `•  ${text}` : text;
  const ind = indent ? `<w:ind w:left="${indent}"/>` : '';
  return `<w:p><w:pPr><w:bidi w:val="1"/>${ind}<w:spacing w:after="${after}"/></w:pPr>${run(t, { sz, bold })}</w:p>`;
}
const spacer = () => '<w:p><w:pPr><w:bidi w:val="1"/><w:spacing w:after="40"/></w:pPr></w:p>';

const out = [];
const H1 = { sz: 36, bold: true, after: 80 };
const H2 = { sz: 28, bold: true, after: 100 };
const H3 = { sz: 24, bold: true, after: 60 };
const BODY = { sz: 22 };
const BULLET = { sz: 22, indent: 360, after: 40, bullet: true };
const SUB = { sz: 22, indent: 360, bold: true, after: 40 };

// Title block
out.push(p(trip.title, H1));
out.push(p(trip.subtitle, { sz: 24, after: 40 }));
const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
out.push(p(`עודכן לאחרונה: ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`, { sz: 20, after: 160 }));

const sec = (title) => out.push(p(title, H3));

for (const day of trip.days) {
  out.push(p(day.kicker, { sz: 22, bold: true, after: 20 }));
  out.push(p(day.title, H2));

  if (day.summary) { sec('🧭 תקציר'); out.push(p(day.summary, BODY)); }
  if (day.timeline && day.timeline.length) { sec('🕒 לוח זמנים'); day.timeline.forEach((t) => out.push(p(t, BULLET))); }
  if (day.weather && day.weather.length) { sec('🌦️ מזג אוויר'); day.weather.forEach((t) => out.push(p(t, BULLET))); }
  if (day.routes && day.routes.length) {
    sec('🥾 מסלולים');
    day.routes.forEach((r) => {
      out.push(p(r.name, SUB));
      if (r.meta && r.meta.length) out.push(p(r.meta.join('  |  '), { sz: 20, indent: 360, after: 40 }));
      (r.steps || []).forEach((s) => out.push(p(s, BULLET)));
      (r.warns || []).forEach((w) => out.push(p(w, { sz: 22, indent: 360, after: 40 })));
    });
  }
  if (day.hours && day.hours.length) {
    sec('🎟️ שעות ובדיקות לפני הגעה');
    day.hours.forEach((h) => {
      out.push(p(h.text, BULLET));
      (h.links || []).forEach((l) => out.push(p(`${l.label}: ${l.url}`, { sz: 20, indent: 720, after: 40 })));
    });
  }
  if (day.shopping && day.shopping.length) { sec('🛍️ אפשרויות קניות'); day.shopping.forEach((t) => out.push(p(t, BULLET))); }
  if (day.tips && day.tips.length) { sec('💡 טיפים ודגשים'); day.tips.forEach((t) => out.push(p(t, BULLET))); }
  if (day.nav && day.nav.length) {
    sec('📍 ניווט מהיר ליעדי היום');
    day.nav.forEach((n) => out.push(p(`${n.dest} — ${n.addr}${n.ll ? ` (${n.ll})` : ''}`, BULLET)));
  }
  if (day.shoppingNav && day.shoppingNav.length) {
    sec('📍 ניווט – קניות');
    day.shoppingNav.forEach((n) => out.push(p(n.dest, BULLET)));
  }
  out.push(spacer());
}

// Emergency
if (trip.emergency) {
  out.push(p('🆘 חירום ופרטים חשובים', H2));
  if (trip.emergency.note) out.push(p(trip.emergency.note, BODY));
  trip.emergency.groups.forEach((g) => {
    out.push(p(g.title, SUB));
    g.contacts.forEach((c) => {
      const bits = [c.label, c.sub, c.tel, c.wa ? `WhatsApp ${c.wa}` : '', c.web].filter(Boolean);
      out.push(p(bits.join(' — '), BULLET));
    });
  });
}

const sectPr = '<w:sectPr><w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/><w:pgMar w:top="765" w:right="709" w:bottom="709" w:left="709" w:header="720" w:footer="720"/><w:bidi/></w:sectPr>';
const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<w:body>${out.join('')}${sectPr}</w:body></w:document>`;

fs.writeFileSync(outPath, doc);
console.log(`✓ document.xml written (${out.length} paragraphs, ${doc.length} bytes)`);
