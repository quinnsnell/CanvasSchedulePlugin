/**
 * Semester template export/import.
 *
 * The template encodes items by their (week index, position-within-week)
 * — and an `index` fallback for backwards compat — rather than absolute
 * date, so the same schedule can be re-mapped to any semester regardless
 * of class-day pattern.
 *
 * Mapping rules in importTemplate:
 *   - Same week count, same days/week (e.g., TR → TR): identical placement.
 *   - Same week count, target has MORE days/week (TR → MWF): items land
 *     on the matching n-th class day; extra target days stay empty.
 *   - Same week count, target has FEWER days/week (MWF → TR, MW → M):
 *     items past the target week's last position stack onto the LAST
 *     teaching day of that week. Nothing within the semester is dropped.
 *   - Source has ~2x the weeks of target (semester → term): each pair
 *     of source weeks collapses onto one target week. Day-position is
 *     preserved within each target week, so two source Mondays stack
 *     on one target Monday, etc. ("compress" mode)
 *   - Source has ~half the weeks of target (term → semester): each
 *     source week maps to the first of a pair of target weeks; the
 *     second week of each pair is left blank for the instructor to
 *     fill in. ("expand" mode)
 *   - Otherwise, source weeks past the target's last week are dropped
 *     (counted in droppedExtras). ("literal" mode)
 *
 * Used by the Course Setup panel's "Export/Import template" buttons and
 * by the course-clone import path (services/course-clone.js).
 */

import { DAY_CODES, generateClassDays, addDays, weekKey } from './dates.js';
import { uid } from './uid.js';

/**
 * Zero-based week index of `date` relative to the calendar week
 * containing `startDate`. Anchors on the Monday-of-week-of-startDate
 * so semesters that begin on different weekdays still align — week 0
 * is "the calendar week the semester opens in", regardless of which
 * weekday the first class meets.
 */
function weekIndexOf(date, startDate) {
  const dateMs = new Date(weekKey(date) + 'T00:00:00').getTime();
  const startMs = new Date(weekKey(startDate) + 'T00:00:00').getTime();
  return Math.round((dateMs - startMs) / (7 * 86400000));
}

/**
 * Convert the current schedule state into a JSON-serializable template.
 * Items are positioned by teaching-day index (regular slots) or by
 * day-offset from semester start (extra-day slots). Canvas-specific IDs
 * are stripped — they belong to the source course.
 */
export function exportTemplate(state) {
  const teachingDays = generateClassDays(state.setup.startDate, state.setup.endDate, state.setup.classDays);
  const teachingSet = new Set(teachingDays);

  // Defensive: older saved states might be missing fields added later.
  // Normalize so accessors don't blow up reading from undefined.
  const items = state.items || {};
  const schedule = state.schedule || {};
  const holidays = state.holidays || {};
  const modules = state.modules || {};
  const extraDaysArr = state.extraDays || [];
  const unscheduledArr = state.unscheduled || [];

  const stripItem = (id) => {
    const item = items[id];
    if (!item) return null;
    const { canvasId, htmlUrl, dueDate, id: _id, ...rest } = item;
    return rest;
  };

  // Group source teaching days by week, so we can compute each day's
  // position within its week (0-based: first class meeting of the week,
  // second class meeting, etc.).
  const sourceDaysByWeek = {};
  teachingDays.forEach((date) => {
    const wk = weekIndexOf(date, state.setup.startDate);
    sourceDaysByWeek[wk] = sourceDaysByWeek[wk] || [];
    sourceDaysByWeek[wk].push(date);
  });

  // Convert schedule date → [itemIds] into slots tagged with
  // (weekIndex, weekPosition). `index` is also kept for backwards-compat
  // fallback if the new fields go missing somehow.
  const slots = [];
  teachingDays.forEach((date, idx) => {
    const ids = schedule[date] || [];
    if (ids.length === 0 && !holidays[date] && !modules[date]) return;
    const slotItems = ids.map(stripItem).filter(Boolean);
    const wk = weekIndexOf(date, state.setup.startDate);
    const weekPosition = sourceDaysByWeek[wk].indexOf(date);
    slots.push({
      index: idx,
      weekIndex: wk,
      weekPosition,
      dayCode: DAY_CODES[new Date(date + 'T12:00:00').getDay()],
      items: slotItems,
      holiday: holidays[date] || null,
      module: modules[date] || null,
    });
  });

  // Extra days (manually added non-teaching days — make-ups, guest lectures, etc.).
  // Encoded by their offset in days from the semester start so they re-map to
  // the same relative position in any new semester.
  const startStr = state.setup.startDate;
  const dayOffset = (date) => {
    const ms = new Date(date + 'T00:00:00').getTime() - new Date(startStr + 'T00:00:00').getTime();
    return Math.round(ms / 86400000);
  };
  const extraSlots = [];
  extraDaysArr.forEach((date) => {
    if (teachingSet.has(date)) return; // already in slots
    const ids = schedule[date] || [];
    if (ids.length === 0 && !holidays[date] && !modules[date]) return;
    const slotItems = ids.map(stripItem).filter(Boolean);
    extraSlots.push({
      daysFromStart: dayOffset(date),
      dayCode: DAY_CODES[new Date(date + 'T12:00:00').getDay()],
      items: slotItems,
      holiday: holidays[date] || null,
      module: modules[date] || null,
    });
  });

  const unscheduledItems = unscheduledArr.map(stripItem).filter(Boolean);

  // Total source weeks — needed by importTemplate to choose between
  // literal/compress/expand modes. Derived from the slots' max weekIndex
  // rather than (endDate - startDate)/7 so it matches the weeks actually
  // populated with content.
  const maxWeek = slots.reduce((m, s) => Math.max(m, s.weekIndex ?? -1), -1);
  const totalWeeks = maxWeek + 1;

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    courseTitle: state.setup.courseTitle || '',
    classDays: state.setup.classDays,
    totalTeachingDays: teachingDays.length,
    totalWeeks,
    slots,
    extraSlots,
    unscheduledItems,
  };
}

/**
 * Pick a mapping mode based on the target/source week ratio:
 *   - ratio ≈ 0.5 (e.g., 14-week semester → 7-week term): "compress"
 *   - ratio ≈ 2.0 (term → semester): "expand"
 *   - otherwise: "literal" (existing 1:1 mapping)
 *
 * Tolerant bands so 13/7 and 15/7 still count as compression and the
 * usual ±1 week of variance in semester length doesn't trip us up.
 */
function pickMode(sourceWeeks, targetWeeks) {
  if (!sourceWeeks || !targetWeeks) return 'literal';
  const ratio = targetWeeks / sourceWeeks;
  if (ratio >= 0.4 && ratio <= 0.65) return 'compress';
  if (ratio >= 1.7 && ratio <= 2.5) return 'expand';
  return 'literal';
}

/**
 * Map a template onto a new semester's setup. Items get fresh IDs.
 * Returns a partial state update: { items, schedule, holidays, modules,
 * unscheduled, extraDays, droppedExtras, mode }. The caller is responsible
 * for merging into application state; `mode` is informational (so UI can
 * tell the instructor "compressed two weeks per week", etc.).
 *
 * `options.mode` overrides auto-detection. Useful for tests and for a
 * future "force literal" UI option.
 */
export function importTemplate(template, setup, options = {}) {
  const newTeachingDays = generateClassDays(setup.startDate, setup.endDate, setup.classDays);
  const teachingSet = new Set(newTeachingDays);
  const lastTeachingDate = newTeachingDays[newTeachingDays.length - 1];
  const semesterEndStr = setup.endDate || lastTeachingDate;

  // Group target teaching days by week — used to look up "the n-th
  // class meeting in week W" for week+position placement.
  const targetDaysByWeek = {};
  newTeachingDays.forEach((date) => {
    const wk = weekIndexOf(date, setup.startDate);
    targetDaysByWeek[wk] = targetDaysByWeek[wk] || [];
    targetDaysByWeek[wk].push(date);
  });
  const lastTargetWeek = Object.keys(targetDaysByWeek).reduce(
    (max, k) => Math.max(max, Number(k)), -1
  );
  const targetWeeks = lastTargetWeek + 1;
  const sourceWeeks =
    template.totalWeeks ??
    template.slots.reduce((m, s) => Math.max(m, (s.weekIndex ?? -1)), -1) + 1;

  const mode = options.mode || pickMode(sourceWeeks, targetWeeks);

  // Re-map a source weekIndex into the target's week space according to
  // the selected mode. Returns null if the mapping has nowhere to land
  // (e.g., a source week past the end of the target after expansion).
  const mapWeek = (srcWeek) => {
    if (srcWeek == null) return null;
    if (mode === 'compress') return Math.floor(srcWeek / 2);
    if (mode === 'expand') return srcWeek * 2;
    return srcWeek;
  };

  const items = {};
  const schedule = {};
  const holidays = {};
  const modules = {};
  const unscheduled = [];
  const extraDays = [];
  let droppedExtras = 0;

  template.slots.forEach((slot) => {
    let date;
    if (slot.weekIndex != null && slot.weekPosition != null) {
      // Week+position mapping (current default).
      const mappedWeek = mapWeek(slot.weekIndex);
      if (mappedWeek > lastTargetWeek) {
        droppedExtras += 1;
        return;
      }
      const daysInTargetWeek = targetDaysByWeek[mappedWeek] || [];
      if (daysInTargetWeek.length === 0) {
        // The week exists in the target's calendar but has no class meetings.
        droppedExtras += 1;
        return;
      }
      // Compression: clamp to last target position so we never lose items
      // within the semester. MWF → TR sees 3rd-day items stack on Thu;
      // MWF → M sees Wed and Fri items stack on Mon. Same clamp applies
      // in compress/expand modes — it operates within a single target
      // week regardless of how source weeks got there.
      const targetPos = Math.min(slot.weekPosition, daysInTargetWeek.length - 1);
      date = daysInTargetWeek[targetPos];
    } else {
      // Legacy index-based fallback for templates exported pre-week-mapping.
      // Compression/expansion don't apply to the legacy fallback — those
      // require weekIndex/weekPosition to be meaningful.
      if (slot.index >= newTeachingDays.length) {
        droppedExtras += 1;
        return;
      }
      date = newTeachingDays[slot.index];
    }

    if (slot.holiday) holidays[date] = slot.holiday;
    if (slot.module) modules[date] = slot.module;

    schedule[date] = schedule[date] || [];
    slot.items.forEach((itemData) => {
      const id = uid();
      items[id] = { ...itemData, id, dueDate: date };
      schedule[date].push(id);
    });
  });

  // Extra (non-teaching) days, mapped by relative offset from semester start.
  // Items land on the resulting calendar date even if it isn't a teaching day —
  // that's the whole point of an extra day. Skip if the offset lands outside
  // the new semester window.
  //
  // Note: when compressing/expanding we keep the raw day-offset rather than
  // halving/doubling it. Extra days are typically tied to a real calendar
  // event (guest lecture on a specific Friday, etc.), and a remapping that
  // moves them to a different real date is more confusing than helpful.
  // The window check below will quietly drop ones that fall outside the
  // shorter target term — counted in droppedExtras.
  (template.extraSlots || []).forEach((slot) => {
    const date = addDays(setup.startDate, slot.daysFromStart);
    if (date < setup.startDate || date > semesterEndStr) {
      droppedExtras += 1;
      return;
    }
    if (!teachingSet.has(date) && !extraDays.includes(date)) {
      extraDays.push(date);
    }
    if (slot.holiday) holidays[date] = slot.holiday;
    if (slot.module) modules[date] = slot.module;

    schedule[date] = schedule[date] || [];
    slot.items.forEach((itemData) => {
      const id = uid();
      items[id] = { ...itemData, id, dueDate: date };
      schedule[date].push(id);
    });
  });

  (template.unscheduledItems || []).forEach((itemData) => {
    const id = uid();
    items[id] = { ...itemData, id };
    unscheduled.push(id);
  });

  return { items, schedule, holidays, modules, unscheduled, extraDays, droppedExtras, mode };
}
