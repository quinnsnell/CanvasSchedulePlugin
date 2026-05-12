/**
 * Semester template export/import.
 *
 * The template encodes items by their (teaching-day index) or (offset
 * from semester start) rather than absolute date, so the same schedule
 * can be re-mapped to any semester with the same class-day pattern.
 *
 * Used by the Course Setup panel's "Export/Import template" buttons and
 * by the course-clone import path (services/course-clone.js).
 */

import { DAY_CODES, generateClassDays, addDays } from './dates.js';
import { uid } from './uid.js';

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

  // Convert schedule date → [itemIds] into teachingDayIndex → [items].
  const slots = [];
  teachingDays.forEach((date, idx) => {
    const ids = schedule[date] || [];
    if (ids.length === 0 && !holidays[date] && !modules[date]) return;
    const slotItems = ids.map(stripItem).filter(Boolean);
    slots.push({
      index: idx,
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
 */
export function importTemplate(template, setup) {
  const newTeachingDays = generateClassDays(setup.startDate, setup.endDate, setup.classDays);
  const teachingSet = new Set(newTeachingDays);
  const lastTeachingDate = newTeachingDays[newTeachingDays.length - 1];
  const semesterEndStr = setup.endDate || lastTeachingDate;

  const items = {};
  const schedule = {};
  const holidays = {};
  const modules = {};
  const unscheduled = [];
  const extraDays = [];
  let droppedExtras = 0;

  // Place items by teaching-day index.
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
