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
 *   - Source has MORE weeks than target: trailing weeks are dropped
 *     (counted in droppedExtras).
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

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    courseTitle: state.setup.courseTitle || '',
    classDays: state.setup.classDays,
    totalTeachingDays: teachingDays.length,
    slots,
    extraSlots,
    unscheduledItems,
  };
}

/**
 * Map a template onto a new semester's setup. Items get fresh IDs.
 * Returns a partial state update: { items, schedule, holidays, modules,
 * unscheduled, extraDays, droppedExtras }. The caller is responsible for
 * merging into application state.
 *
 * Placement is week+position when the template has those fields (any
 * template exported by the current code does); falls back to the old
 * teaching-day-index for legacy saved templates.
 */
export function importTemplate(template, setup) {
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
      if (slot.weekIndex > lastTargetWeek) {
        droppedExtras += 1;
        return;
      }
      const daysInTargetWeek = targetDaysByWeek[slot.weekIndex] || [];
      if (daysInTargetWeek.length === 0) {
        // The week exists in the target's calendar but has no class meetings.
        droppedExtras += 1;
        return;
      }
      // Compression: clamp to last target position so we never lose items
      // within the semester. MWF → TR sees 3rd-day items stack on Thu;
      // MWF → M sees Wed and Fri items stack on Mon.
      const targetPos = Math.min(slot.weekPosition, daysInTargetWeek.length - 1);
      date = daysInTargetWeek[targetPos];
    } else {
      // Legacy index-based fallback for templates exported pre-week-mapping.
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

  return { items, schedule, holidays, modules, unscheduled, extraDays, droppedExtras };
}
