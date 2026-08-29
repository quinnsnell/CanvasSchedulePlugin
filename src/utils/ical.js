/**
 * iCal (.ics) generation and parsing.
 *
 * Generation produces a minimal VCALENDAR with one VEVENT per scheduled
 * item. Parsing handles RFC 5545 line-folding, both DATE and DATE-TIME
 * DTSTART formats, and common SUMMARY/DESCRIPTION escapes.
 */

import { computeAllDays } from './dates.js';

/** Generate an .ics calendar string from schedule state. */
export function generateICal(state) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClassPlanner//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${state.setup.courseTitle || 'Course Schedule'}`,
  ];
  const allDays = computeAllDays(state.setup, state.extraDays);
  allDays.forEach((d) => {
    const items = (state.schedule[d] || [])
      .map((id) => state.items[id])
      .filter(Boolean)
      .filter((item) => item.type !== 'assign' || item.published !== false);
    if (items.length === 0) return;
    const dateStr = d.replace(/-/g, '');
    items.forEach((item, i) => {
      const summary = item.type === 'assign'
        ? `${item.title || 'Assignment'}${item.points ? ` (${item.points} pts)` : ''}`
        : (item.html || '').replace(/<[^>]*>/g, '').trim().slice(0, 120) || 'Note';
      lines.push('BEGIN:VEVENT');
      lines.push(`DTSTART;VALUE=DATE:${dateStr}`);
      lines.push(`DTEND;VALUE=DATE:${dateStr}`);
      lines.push(`SUMMARY:${summary.replace(/[,;\\]/g, ' ')}`);
      lines.push(`UID:${d}-${i}-${item.id}@classplanner`);
      lines.push('END:VEVENT');
    });
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * Parse iCal (.ics) text and extract events.
 * Returns [{ title, date: 'YYYY-MM-DD', description? }].
 * Handles both DATE and DATE-TIME DTSTART formats, and folded lines.
 */
export function parseICal(text) {
  // Unfold continuation lines (RFC 5545 §3.1: CRLF + whitespace)
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let inEvent = false;
  let cur = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      cur = {};
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      if (cur && cur.title && cur.date) {
        events.push({
          title: cur.title,
          date: cur.date,
          ...(cur.description ? { description: cur.description } : {}),
        });
      }
      inEvent = false;
      cur = null;
      continue;
    }
    if (!inEvent || !cur) continue;

    // Parse property:value, accounting for parameters (e.g. DTSTART;VALUE=DATE:20260115)
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const propPart = trimmed.slice(0, colonIdx).toUpperCase();
    const value = trimmed.slice(colonIdx + 1);
    const propName = propPart.split(';')[0];

    if (propName === 'SUMMARY') {
      cur.title = value.replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
    } else if (propName === 'DESCRIPTION') {
      cur.description = value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').trim();
    } else if (propName === 'DTSTART') {
      // DATE format: 20260115 or DATE-TIME: 20260115T120000 or 20260115T120000Z
      const digits = value.replace(/[^0-9]/g, '');
      if (digits.length >= 8) {
        const y = digits.slice(0, 4);
        const m = digits.slice(4, 6);
        const d = digits.slice(6, 8);
        cur.date = `${y}-${m}-${d}`;
      }
    }
  }
  return events;
}
