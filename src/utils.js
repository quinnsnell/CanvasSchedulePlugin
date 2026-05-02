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

// ── Persistence ────────────────────────────────────────────────

const KEY_PREFIX = 'class-planner-v3';
const KEY_META = 'class-planner-meta';

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
