/**
 * Date math, day-of-week mappings, and date-display helpers.
 *
 * All ISO date strings are 'YYYY-MM-DD' interpreted as local-calendar
 * dates (no time/timezone). UTC ISO timestamps are normalized via
 * localDateStr when crossing back into local-date space.
 */

import { ADDABLE_DAYS_MAX } from '../config.js';

export const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export const DAY_FULL = { SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday' };
export const DAY_SHORT = { SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat' };

/** Shift an ISO date string by `n` days. */
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** All teaching days between start and end that fall on the given day codes. */
export function generateClassDays(startStr, endStr, dayCodes) {
  if (!startStr || !endStr || !dayCodes?.length) return [];
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  if (isNaN(start) || isNaN(end) || start > end) return [];
  const out = [];
  const cur = new Date(start);
  let safety = 0;
  while (cur <= end && safety++ < 1000) {
    if (dayCodes.includes(DAY_CODES[cur.getDay()])) {
      out.push(cur.toISOString().slice(0, 10));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Sorted union of teaching days and manually-added extra days. */
export function computeAllDays(setup, extraDays) {
  const teaching = generateClassDays(setup.startDate, setup.endDate, setup.classDays);
  const set = new Set([...teaching, ...(extraDays || [])]);
  return Array.from(set).sort();
}

/**
 * Dates available to add after a given day. Returns up to 21 calendar days
 * following `date`, stopping at the first date already in `allDaysSet`.
 * The semester end is no longer a hard cap — picking a date past the end
 * signals the caller to extend the semester (see App.addExtraDay).
 */
// eslint-disable-next-line no-unused-vars
export function getAddableDatesAfter(date, allDaysSet, _semesterEnd) {
  const out = [];
  const cur = new Date(date + 'T00:00:00');
  cur.setDate(cur.getDate() + 1);
  let safety = 0;
  while (safety++ < ADDABLE_DAYS_MAX) {
    const iso = cur.toISOString().slice(0, 10);
    if (allDaysSet.has(iso)) break;
    out.push(iso);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** ISO date of the Monday that starts the week containing `iso`. */
export function weekKey(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay(); // 0=Sun ... 6=Sat
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** ISO week number — gives stable even/odd for alternating row shading. */
export function weekNumber(iso) {
  const d = new Date(iso + 'T00:00:00');
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d - jan1) / 86400000);
  return Math.floor((days + jan1.getDay()) / 7);
}

/** Convert a UTC ISO timestamp to a local YYYY-MM-DD string. */
export function localDateStr(isoUtc) {
  const d = new Date(isoUtc);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Format "Jan 15" */
export function fmtMonthDay(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format "Tuesday, January 15, 2026" */
export function fmtFull(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
