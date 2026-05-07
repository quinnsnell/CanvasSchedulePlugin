/**
 * Shared constants, date math, iCal generation, and localStorage persistence.
 *
 * Pure utility module — no React dependencies, no side effects.
 */

// ── Day-of-week mappings ───────────────────────────────────────
export const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export const DAY_FULL = { SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday' };
export const DAY_SHORT = { SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat' };

/** How long a pending assignment creation stays valid before expiring. */
export const PENDING_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── ID generation ──────────────────────────────────────────────
export const uid = () => 'i_' + Math.random().toString(36).slice(2, 10);

// ── Date arithmetic ────────────────────────────────────────────

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

/** Dates available to add after a given day (up to 21 days or next existing day). */
export function getAddableDatesAfter(date, allDaysSet, semesterEnd) {
  const out = [];
  const cur = new Date(date + 'T00:00:00');
  cur.setDate(cur.getDate() + 1);
  const end = semesterEnd ? new Date(semesterEnd + 'T00:00:00') : null;
  let safety = 0;
  while (safety++ < 21) {
    const iso = cur.toISOString().slice(0, 10);
    if (end && cur > end) break;
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

// ── iCal export ────────────────────────────────────────────────

/** Generate an .ics calendar string from schedule state. */
export function generateICal(state) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ClassPlanner//EN', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${state.setup.courseTitle || 'Course Schedule'}`,
  ];
  const allDays = computeAllDays(state.setup, state.extraDays);
  allDays.forEach((d) => {
    const items = (state.schedule[d] || []).map((id) => state.items[id]).filter(Boolean);
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

// ── iCal import (parse .ics text) ──────────────────────────────

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

// ── CSV import ─────────────────────────────────────────────────

/**
 * Parse simple CSV with headers. Expects columns like "date" and "title"
 * (case-insensitive header matching). Returns [{ title, date: 'YYYY-MM-DD', description? }].
 * Handles quoted fields containing commas and newlines.
 */
export function parseCSV(text) {
  const rows = parseCSVRows(text);
  if (rows.length < 2) return [];

  // Map headers to column indices (case-insensitive)
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const dateIdx = headers.findIndex((h) => h === 'date');
  const titleIdx = headers.findIndex((h) => h === 'title' || h === 'summary' || h === 'name' || h === 'event');
  const descIdx = headers.findIndex((h) => h === 'description' || h === 'desc' || h === 'notes' || h === 'details');

  if (dateIdx < 0 || titleIdx < 0) return [];

  const events = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawDate = (row[dateIdx] || '').trim();
    const title = (row[titleIdx] || '').trim();
    if (!rawDate || !title) continue;

    const date = normalizeDate(rawDate);
    if (!date) continue;

    const ev = { title, date };
    if (descIdx >= 0 && row[descIdx]?.trim()) {
      ev.description = row[descIdx].trim();
    }
    events.push(ev);
  }
  return events;
}

/** Split CSV text into rows of fields, respecting quoted fields. */
function parseCSVRows(text) {
  const rows = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  const chars = text.replace(/\r\n/g, '\n');

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (inQuotes) {
      if (ch === '"') {
        if (chars[i + 1] === '"') {
          field += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field);
        field = '';
      } else if (ch === '\n') {
        current.push(field);
        field = '';
        if (current.some((f) => f.trim())) rows.push(current);
        current = [];
      } else {
        field += ch;
      }
    }
  }
  // Last field/row
  current.push(field);
  if (current.some((f) => f.trim())) rows.push(current);
  return rows;
}

/** Normalize various date formats to YYYY-MM-DD. */
function normalizeDate(str) {
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // YYYY/MM/DD
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) return str.replace(/\//g, '-');
  // MM/DD/YYYY or M/D/YYYY
  const mdy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`;
  }
  // Try Date.parse as fallback
  const d = new Date(str);
  if (!isNaN(d)) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
}

// ── Persistence ────────────────────────────────────────────────

const KEY_PREFIX = 'class-planner-v3';
const KEY_META = 'class-planner-meta';

// ── Semester template export/import ──────────────────────────

/**
 * Export the current schedule as a semester template.
 * Items are positioned by (teaching day index) rather than absolute date,
 * so they can be re-mapped to any semester with the same class-day pattern.
 *
 * Returns a JSON-serializable template object.
 */
export function exportTemplate(state) {
  const teachingDays = generateClassDays(state.setup.startDate, state.setup.endDate, state.setup.classDays);

  // Map each date to its teaching-day index (0-based)
  const dateToIndex = {};
  teachingDays.forEach((d, i) => { dateToIndex[d] = i; });

  // Convert schedule: date → [itemIds]  →  teachingDayIndex → [items]
  const slots = [];
  teachingDays.forEach((date, idx) => {
    const ids = state.schedule[date] || [];
    if (ids.length === 0 && !state.holidays[date] && !state.modules[date]) return;
    const items = ids.map((id) => {
      const item = state.items[id];
      if (!item) return null;
      // Strip Canvas-specific IDs — they belong to the old course
      const { canvasId, htmlUrl, dueDate, id: _id, ...rest } = item;
      return rest;
    }).filter(Boolean);
    slots.push({
      index: idx,
      dayCode: DAY_CODES[new Date(date + 'T12:00:00').getDay()],
      items,
      holiday: state.holidays[date] || null,
      module: state.modules[date] || null,
    });
  });

  // Unscheduled items (readings, notes not on any day)
  const unscheduledItems = (state.unscheduled || []).map((id) => {
    const item = state.items[id];
    if (!item) return null;
    const { canvasId, htmlUrl, dueDate, id: _id, ...rest } = item;
    return rest;
  }).filter(Boolean);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    courseTitle: state.setup.courseTitle || '',
    classDays: state.setup.classDays,
    totalTeachingDays: teachingDays.length,
    slots,
    unscheduledItems,
  };
}

/**
 * Import a semester template into the current semester.
 * Maps items by teaching-day index to the new semester's dates.
 * Returns a partial state update: { items, schedule, holidays, modules, unscheduled }.
 */
export function importTemplate(template, setup) {
  const newTeachingDays = generateClassDays(setup.startDate, setup.endDate, setup.classDays);

  const items = {};
  const schedule = {};
  const holidays = {};
  const modules = {};
  const unscheduled = [];

  // Place items by teaching-day index
  template.slots.forEach((slot) => {
    if (slot.index >= newTeachingDays.length) return; // semester too short
    const date = newTeachingDays[slot.index];

    if (slot.holiday) holidays[date] = slot.holiday;
    if (slot.module) modules[date] = slot.module;

    schedule[date] = schedule[date] || [];
    slot.items.forEach((itemData) => {
      const id = uid();
      items[id] = { ...itemData, id, dueDate: date };
      schedule[date].push(id);
    });
  });

  // Unscheduled items
  (template.unscheduledItems || []).forEach((itemData) => {
    const id = uid();
    items[id] = { ...itemData, id };
    unscheduled.push(id);
  });

  return { items, schedule, holidays, modules, unscheduled, extraDays: [] };
}

/**
 * Storage abstraction — localStorage in normal browsers,
 * window.storage in claude.ai artifact context.
 * Course data is keyed by courseId so multiple courses don't collide.
 * Meta (canvas credentials, last courseId) is shared across courses.
 */
export const Store = {
  _key(courseId) { return courseId ? `${KEY_PREFIX}-${courseId}` : KEY_PREFIX; },

  async loadMeta() {
    try {
      const v = localStorage.getItem(KEY_META);
      return v ? JSON.parse(v) : null;
    } catch { return null; }
  },

  saveMeta(meta) {
    try { localStorage.setItem(KEY_META, JSON.stringify(meta)); } catch {}
  },

  async load(courseId) {
    try {
      if (typeof window !== 'undefined' && window.storage) {
        const r = await window.storage.get(this._key(courseId));
        return r?.value ? JSON.parse(r.value) : null;
      }
      if (typeof localStorage !== 'undefined') {
        const v = localStorage.getItem(this._key(courseId));
        return v ? JSON.parse(v) : null;
      }
      return null;
    } catch { return null; }
  },

  async save(data) {
    const courseId = data?.canvas?.courseId;
    try {
      if (typeof window !== 'undefined' && window.storage) {
        await window.storage.set(this._key(courseId), JSON.stringify(data));
        return true;
      }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this._key(courseId), JSON.stringify(data));
        return true;
      }
      return false;
    } catch { return false; }
  },
};
