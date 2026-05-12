/**
 * Canvas sync service: handlers for connecting to Canvas, switching
 * courses, and pulling assignments + assignment groups into planner
 * state.
 *
 * Exported via `createCanvasSync(deps)` factory so the handlers can
 * close over dependencies (state ref, updateState, showToast, etc.)
 * without leaking React hook calls into the service module.
 *
 * `assignmentIsQuiz` is exported as a pure helper for the rest of the
 * app — quiz detection is needed in places outside the sync flow too
 * (e.g., the course-clone import).
 */

import { CanvasAPI } from '../canvas-api.js';
import { uid } from '../utils/uid.js';
import { localDateStr, localTimeStr, generateClassDays } from '../utils/dates.js';
import { Store } from '../utils/store.js';
import { GROUP_COLORS } from '../theme.js';

/**
 * Detect whether a Canvas assignment record is actually a quiz. Canvas
 * stores both engines as assignments under the hood:
 *   - New Quiz: `is_quiz_lti_assignment: true`
 *   - Classic Quiz: `quiz_id` set
 */
export const assignmentIsQuiz = (a) =>
  Boolean(a?.is_quiz_lti_assignment || a?.quiz_id);

/**
 * Pull the local time portion of a Canvas due_at and return it as
 * `HH:MM`, but only when the time differs from our implicit 23:59
 * default. Returning `null` for the default keeps the time-input
 * unobtrusive on the typical "due end of day" assignment.
 */
function dueTimeFromCanvas(due_at) {
  if (!due_at) return null;
  const t = localTimeStr(due_at);
  return t === '23:59' ? null : t;
}

/**
 * Pull the title/start/end dates from a Canvas course object into
 * planner setup. Only fills fields the user hasn't set yet — won't
 * clobber dates the instructor entered manually.
 */
export function applyCourseInfo(state, course) {
  if (course?.startAt && !state.setup.startDate) state.setup.startDate = course.startAt.slice(0, 10);
  if (course?.endAt && !state.setup.endDate) state.setup.endDate = course.endAt.slice(0, 10);
  if (course?.name) state.setup.courseTitle = course.name;
}

/**
 * Build the four canvas-sync handlers bound to the given dependencies.
 *
 * @param {object} deps
 * @param {React.MutableRefObject} deps.stateRef - latest state via .current
 * @param {(fn, skipUndo?: boolean) => void} deps.updateState
 * @param {(state) => void} deps.setState - setter from useUndoableState
 * @param {(msg, kind?) => void} deps.showToast
 * @param {(b: boolean) => void} deps.setRefreshing
 * @param {() => object} deps.freshState - factory for an empty state shape
 */
export function createCanvasSync({ stateRef, updateState, setState, showToast, setRefreshing, freshState }) {

  /** Authenticate against Canvas, list teacher courses, populate state.canvas. */
  const connectCanvas = async (baseUrl, token) => {
    try {
      const courses = await CanvasAPI.listCourses(baseUrl, token);
      updateState((s) => {
        s.canvas.baseUrl = baseUrl;
        s.canvas.token = token;
        s.canvas.connected = true;
        s.canvas.courses = courses.map((c) => ({
          id: c.id, name: c.name,
          startAt: c.start_at || c.term?.start_at || null,
          endAt: c.end_at || c.term?.end_at || null,
        }));
        if (s.canvas.courseId) {
          const course = s.canvas.courses.find((c) => String(c.id) === String(s.canvas.courseId));
          applyCourseInfo(s, course);
        }
        return s;
      });
      showToast(`Connected — ${courses.length} courses found`);
      return { ok: true, count: courses.length };
    } catch (e) {
      showToast(`Could not connect: ${e.message}`, 'err');
      return { ok: false, error: e.message };
    }
  };

  /**
   * Switch to a different Canvas course. Saves the current planner state
   * to its per-course slot, loads the new course's saved state if any,
   * otherwise initializes from freshState + applyCourseInfo.
   */
  const switchCourse = async (newCourseId) => {
    const current = stateRef.current;
    if (current) Store.save(current);
    const saved = await Store.load(newCourseId);
    const canvas = { ...current.canvas, courseId: newCourseId };
    if (saved) {
      saved.canvas = canvas;
      setState(saved);
    } else {
      const fresh = freshState();
      fresh.canvas = canvas;
      const course = canvas.courses.find((c) => String(c.id) === String(newCourseId));
      applyCourseInfo(fresh, course);
      setState(fresh);
    }
  };

  /**
   * Light sync — fetch assignments and merge any new ones into planner
   * state. Triggered by the window-focus listener after the user comes
   * back from Canvas (e.g., having just created an assignment there).
   *
   * Matches Canvas-side new assignments to local pendingCreations by date
   * (or by FIFO when the new assignment has no due_at), pushes the
   * pending date back to Canvas in that case.
   */
  const syncFromCanvas = async () => {
    const s0 = stateRef.current;
    if (!s0?.canvas?.connected || !s0.canvas.courseId) return;
    let list;
    try {
      list = await CanvasAPI.listAssignments(s0.canvas.baseUrl, s0.canvas.token, s0.canvas.courseId);
    } catch { return; }

    const pending = [...(s0.pendingCreations || [])].sort((a, b) => a.time - b.time);
    const claimedPending = new Set();
    const patchPromises = [];

    updateState((s) => {
      let added = 0;
      const teachingNow = new Set(generateClassDays(s.setup.startDate, s.setup.endDate, s.setup.classDays));
      list.forEach((a) => {
        const existing = Object.values(s.items).find((it) => it.type === 'assign' && it.canvasId === a.id);
        if (existing) {
          existing.title = a.name;
          existing.points = a.points_possible || 0;
          existing.htmlUrl = a.html_url;
          existing.isQuiz = assignmentIsQuiz(a);
          existing.dueTime = dueTimeFromCanvas(a.due_at);
          if (a.assignment_group_id) existing.groupId = a.assignment_group_id;
          return;
        }
        const id = uid();
        let due = a.due_at ? localDateStr(a.due_at) : null;
        if (!due) {
          const pendingMatch = pending.find((p) => !claimedPending.has(p.id));
          if (pendingMatch) {
            claimedPending.add(pendingMatch.id);
            due = pendingMatch.date;
            patchPromises.push(
              CanvasAPI.setDueDate(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, a.id,
                new Date(due + 'T23:59:00').toISOString()).catch(() => null)
            );
          }
        } else {
          const match = pending.find((p) => !claimedPending.has(p.id) && p.date === due);
          if (match) claimedPending.add(match.id);
        }
        s.items[id] = { id, type: 'assign', title: a.name, points: a.points_possible || 0, canvasId: a.id, htmlUrl: a.html_url, dueDate: due, dueTime: dueTimeFromCanvas(a.due_at), groupId: a.assignment_group_id || null, isQuiz: assignmentIsQuiz(a) };
        if (due) {
          if (!teachingNow.has(due) && !s.extraDays.includes(due)) s.extraDays.push(due);
          s.schedule[due] = s.schedule[due] || [];
          s.schedule[due].push(id);
        } else {
          s.unscheduled.push(id);
        }
        added++;
      });
      s.pendingCreations = (s.pendingCreations || []).filter((p) => !claimedPending.has(p.id));
      if (added) showToast(`Added ${added} new assignment${added > 1 ? 's' : ''}`);
      return s;
    });
    await Promise.all(patchPromises);
  };

  /**
   * Full reload — download the published planner schedule (if any),
   * fetch assignments + assignment groups, merge everything in. Items
   * that match an existing canvasId have their fields refreshed and
   * (if the due date changed in Canvas) get relocated.
   *
   * Destructive when the target course has no published schedule:
   * resets items/schedule/extraDays/unscheduled to empty before walking
   * the assignment list. (Works for the "fresh course / first refresh"
   * case; would clobber unsaved local work, hence the warning.)
   */
  const refreshFromCanvas = async () => {
    const s0 = stateRef.current;
    if (!s0?.canvas?.connected || !s0.canvas.courseId) {
      showToast('Pick a course first', 'err');
      return;
    }
    setRefreshing(true);

    let published = null;
    try {
      published = await CanvasAPI.downloadSchedule(s0.canvas.baseUrl, s0.canvas.token, s0.canvas.courseId);
    } catch { /* no published schedule yet */ }

    let list = [];
    let groups = [];
    try {
      [list, groups] = await Promise.all([
        CanvasAPI.listAssignments(s0.canvas.baseUrl, s0.canvas.token, s0.canvas.courseId),
        CanvasAPI.listAssignmentGroups(s0.canvas.baseUrl, s0.canvas.token, s0.canvas.courseId).catch(() => []),
      ]);
    } catch (e) {
      if (!published) { showToast(`Refresh failed: ${e.message}`, 'err'); setRefreshing(false); return; }
    }

    const groupsMap = {};
    (Array.isArray(groups) ? groups : []).forEach((g, i) => {
      groupsMap[g.id] = { id: g.id, name: g.name, color: GROUP_COLORS[i % GROUP_COLORS.length] };
    });

    updateState((s) => {
      s.canvas.assignmentGroups = groupsMap;
      if (published) {
        s.setup = published.setup || s.setup;
        s.items = published.items || {};
        s.schedule = published.schedule || {};
        s.extraDays = published.extraDays || [];
        s.unscheduled = published.unscheduled || [];
        s.holidays = published.holidays || {};
        s.modules = published.modules || {};
        s.publishHistory = published.publishHistory || [];
      } else {
        s.items = {};
        s.schedule = {};
        s.extraDays = [];
        s.unscheduled = [];
      }
      s.pendingCreations = [];

      const teachingNow = new Set(generateClassDays(s.setup.startDate, s.setup.endDate, s.setup.classDays));
      let added = 0, updated = 0, autoAdded = 0;

      list.forEach((a) => {
        const existing = Object.values(s.items).find((it) => it.type === 'assign' && it.canvasId === a.id);
        if (existing) {
          existing.title = a.name;
          existing.points = a.points_possible || 0;
          existing.htmlUrl = a.html_url;
          existing.isQuiz = assignmentIsQuiz(a);
          existing.dueTime = dueTimeFromCanvas(a.due_at);
          if (a.assignment_group_id) existing.groupId = a.assignment_group_id;
          const newDue = a.due_at ? localDateStr(a.due_at) : null;
          if (newDue && newDue !== existing.dueDate) {
            if (existing.dueDate && s.schedule[existing.dueDate]) {
              s.schedule[existing.dueDate] = s.schedule[existing.dueDate].filter((x) => x !== existing.id);
              if (s.schedule[existing.dueDate].length === 0) delete s.schedule[existing.dueDate];
            }
            existing.dueDate = newDue;
            if (!teachingNow.has(newDue) && !s.extraDays.includes(newDue)) { s.extraDays.push(newDue); autoAdded++; }
            s.schedule[newDue] = s.schedule[newDue] || [];
            if (!s.schedule[newDue].includes(existing.id)) s.schedule[newDue].push(existing.id);
          }
          updated++;
          return;
        }
        const id = uid();
        const due = a.due_at ? localDateStr(a.due_at) : null;
        s.items[id] = { id, type: 'assign', title: a.name, points: a.points_possible || 0, canvasId: a.id, htmlUrl: a.html_url, dueDate: due, dueTime: dueTimeFromCanvas(a.due_at), groupId: a.assignment_group_id || null, isQuiz: assignmentIsQuiz(a) };
        if (due) {
          if (!teachingNow.has(due) && !s.extraDays.includes(due)) { s.extraDays.push(due); autoAdded++; }
          s.schedule[due] = s.schedule[due] || [];
          s.schedule[due].push(id);
        } else {
          s.unscheduled.push(id);
        }
        added++;
      });

      const parts = [];
      if (published) parts.push('loaded schedule');
      if (added) parts.push(`${added} new`);
      if (updated) parts.push(`${updated} updated`);
      if (autoAdded) parts.push(`+${autoAdded} dates`);
      s.loadedAt = new Date().toISOString();
      showToast(parts.length ? `Refreshed: ${parts.join(', ')}` : 'No changes');
      return s;
    });
    setRefreshing(false);
  };

  return { connectCanvas, switchCourse, syncFromCanvas, refreshFromCanvas };
}
