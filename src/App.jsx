/**
 * ClassPlannerApp — main component and state orchestrator.
 *
 * Owns all application state (schedule, items, canvas connection, undo stack).
 * Delegates rendering to focused component modules:
 *   Header, ScheduleTable, ClassDayRow, ItemCard, UnscheduledZone,
 *   Panels (Setup, Shift, Conflict, Recurring, Empty),
 *   PublishBanner, ActivityLog.
 *
 * State shape: see CLAUDE.md § Data model.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import { T, setTheme, FONT_BODY, FONT_MONO, GROUP_COLORS } from './theme.js';
import {
  DAY_CODES, PENDING_TTL_MS, uid,
  generateClassDays, computeAllDays,
  weekNumber, addDays, fmtMonthDay,
  localDateStr, generateICal, exportTemplate, importTemplate, rewriteEmbeddedLinks, Store,
} from './utils.js';
import { CanvasAPI } from './canvas-api.js';
import {
  TOAST_DISMISS_MS, PUBLISH_BANNER_DISMISS_MS,
  DATE_PUSH_BATCH_SIZE, DATE_PUSH_SLEEP_MS,
  WIPE_DELETE_BATCH_SIZE, WIPE_DELETE_SLEEP_MS,
  CLONE_POLL_FAST_MS, CLONE_POLL_SLOW_MS, CLONE_POLL_VERY_SLOW_MS,
  CLONE_POLL_FAST_WINDOW_SEC, CLONE_POLL_SLOW_WINDOW_SEC,
  UNDO_STACK_LIMIT,
} from './config.js';
import renderScheduleHtml from './render-schedule-html.js';
import Header from './components/Header.jsx';
import ScheduleTable from './components/ScheduleTable.jsx';
import { PublishBanner, ActivityLog } from './components/PublishBanner.jsx';
import UnscheduledZone from './components/UnscheduledZone.jsx';
import { DragOverlayCard } from './components/ItemCard.jsx';
import { SetupPanel, ShiftModal, ConflictModal, RecurringModal, EmptyState } from './components/panels/index.js';
import { appStyles } from './styles.js';

// ── Initial state ────────────────────────────────────────────────

function freshState() {
  return {
    setup: { courseTitle: '', startDate: '', endDate: '', classDays: ['MO', 'WE', 'FR'] },
    canvas: { baseUrl: '', token: '', courseId: '', connected: false, courses: [], assignmentGroups: {} },
    items: {}, schedule: {}, extraDays: [], unscheduled: [],
    holidays: {}, modules: {},
    pendingCreations: [],
    publishHistory: [],
    studentView: false,
  };
}

/**
 * Extract start/end dates and title from a Canvas course object.
 * Reused by auto-reconnect, connectCanvas, and switchCourse.
 */
function applyCourseInfo(state, course) {
  if (course?.startAt && !state.setup.startDate) state.setup.startDate = course.startAt.slice(0, 10);
  if (course?.endAt && !state.setup.endDate) state.setup.endDate = course.endAt.slice(0, 10);
  if (course?.name) state.setup.courseTitle = course.name;
}

// ══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════

export default function ClassPlannerApp() {
  // ── Core state ─────────────────────────────────────────────────
  const [state, setState] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [toast, setToast] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [autoEditId, setAutoEditId] = useState(null);
  const [studentEmbed, setStudentEmbed] = useState(null);
  const [lastPublishedUrl, setLastPublishedUrl] = useState(() => {
    try { return localStorage.getItem('planner-last-published-url') || null; } catch { return null; }
  });
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [conflictData, setConflictData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const v = localStorage.getItem('planner-dark-mode');
      return v ? v === 'true' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch { return false; }
  });

  const stateRef = useRef(null);
  const hashStudent = window.location.hash === '#student';

  // ── dnd-kit sensors ────────────────────────────────────────────
  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 5 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { distance: 5 } });
  const keyboardSensor = useSensor(KeyboardSensor);
  const sensors = useSensors(pointerSensor, touchSensor, keyboardSensor);

  // Apply theme palette before rendering
  setTheme(darkMode);
  useEffect(() => {
    try { localStorage.setItem('planner-dark-mode', darkMode); } catch {}
  }, [darkMode]);

  // ── Initialization ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const meta = await Store.loadMeta();
      const courseId = meta?.courseId || '';
      const saved = await Store.load(courseId);
      const init = saved || freshState();
      if (!init.pendingCreations) init.pendingCreations = [];

      // Restore canvas credentials from shared meta
      if (meta && !init.canvas.connected && meta.baseUrl && meta.token) {
        init.canvas.baseUrl = meta.baseUrl;
        init.canvas.token = meta.token;
        init.canvas.courseId = meta.courseId || '';
        init.canvas.courses = meta.courses || [];
        init.canvas.connected = meta.connected || false;
      }

      // Student embed: load schedule from ?src= URL parameter
      if (hashStudent) {
        init.studentView = true;
        const src = new URLSearchParams(window.location.search).get('src');
        if (src) {
          try {
            const res = await fetch(src);
            if (res.ok) {
              const data = await res.json();
              Object.assign(init, {
                setup: data.setup, items: data.items, schedule: data.schedule,
                extraDays: data.extraDays, unscheduled: data.unscheduled || [],
              });
            }
          } catch { /* fall back to local data */ }
        }
      }

      setState(init);
      setLoaded(true);

      // Auto-reconnect: verify saved credentials on page load
      if (!hashStudent && meta?.baseUrl && meta?.token) {
        try {
          const courses = await CanvasAPI.listCourses(meta.baseUrl, meta.token);
          setState((prev) => {
            const s = structuredClone(prev);
            s.canvas.baseUrl = meta.baseUrl;
            s.canvas.token = meta.token;
            s.canvas.connected = true;
            s.canvas.courses = courses.map((c) => ({
              id: c.id, name: c.name,
              startAt: c.start_at || c.term?.start_at || null,
              endAt: c.end_at || c.term?.end_at || null,
            }));
            if (meta.courseId) {
              s.canvas.courseId = meta.courseId;
              const course = s.canvas.courses.find((c) => String(c.id) === String(meta.courseId));
              applyCourseInfo(s, course);
            }
            return s;
          });
        } catch {
          setState((prev) => ({ ...structuredClone(prev), canvas: { ...prev.canvas, connected: false } }));
        }
      }
    })();
  }, []);

  // ── Auto-save on every state change ────────────────────────────
  useEffect(() => {
    stateRef.current = state;
    if (!loaded || !state) return;
    state.lastSaved = new Date().toISOString();
    Store.save(state);
    Store.saveMeta({
      baseUrl: state.canvas.baseUrl,
      token: state.canvas.token,
      courseId: state.canvas.courseId,
      courses: state.canvas.courses,
      connected: state.canvas.connected,
    });
  }, [state, loaded]);

  // ── Toast notifications ────────────────────────────────────────
  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), TOAST_DISMISS_MS);
  };

  // ── Derived data ───────────────────────────────────────────────
  const allDays = useMemo(() => state ? computeAllDays(state.setup, state.extraDays) : [], [state]);
  const allDaysSet = useMemo(() => new Set(allDays), [allDays]);
  const teachingSet = useMemo(() =>
    state ? new Set(generateClassDays(state.setup.startDate, state.setup.endDate, state.setup.classDays)) : new Set(),
    [state]
  );
  const pendingByDate = useMemo(() => {
    const m = {};
    (state?.pendingCreations || []).forEach((p) => { m[p.date] = (m[p.date] || 0) + 1; });
    return m;
  }, [state]);

  // ── Search filter ──────────────────────────────────────────────
  const filteredDays = useMemo(() => {
    const hasSearch = searchQuery.trim().length > 0;
    if (!hasSearch) return allDays;
    const q = searchQuery.trim().toLowerCase();
    return allDays.filter((d) => {
      const ids = state.schedule[d] || [];
      return ids.some((id) => {
        const item = state.items[id];
        if (!item) return false;
        if (item.title && item.title.toLowerCase().includes(q)) return true;
        if (item.html && item.html.replace(/<[^>]*>/g, '').toLowerCase().includes(q)) return true;
        return false;
      });
    });
  }, [allDays, searchQuery, state]);

  // ── Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo ──────────
  const undoRef = useRef(null);
  const redoRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.contentEditable === 'true') return;
      e.preventDefault();
      if (e.shiftKey) { redoRef.current?.(); } else { undoRef.current?.(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Window focus: sync pending assignment creations ─────────────
  const syncRef = useRef(null);
  useEffect(() => {
    const onFocus = () => {
      const s = stateRef.current;
      if (!s) return;
      const now = Date.now();
      const fresh = (s.pendingCreations || []).filter((p) => now - p.time < PENDING_TTL_MS);
      if (fresh.length !== (s.pendingCreations || []).length) {
        setState((prev) => ({ ...prev, pendingCreations: fresh }));
      }
      if (fresh.length > 0 && s.canvas.connected && s.canvas.courseId) {
        syncRef.current();
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // ── dnd-kit: find which container an item lives in ─────────────
  const findItemContainer = useCallback((itemId) => {
    const s = stateRef.current;
    if (!s) return null;
    if (s.unscheduled.includes(itemId)) return 'unscheduled';
    for (const [date, ids] of Object.entries(s.schedule)) {
      if (ids.includes(itemId)) return date;
    }
    return null;
  }, []);

  const handleDragStart = useCallback((event) => {
    setDraggingId(event.active.id);
  }, []);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    setDraggingId(null);
    if (!over || !active) return;
    const s = stateRef.current;
    if (!s || s.studentView) return;

    const activeId = active.id;
    const overId = over.id;
    const sourceContainer = findItemContainer(activeId);
    if (sourceContainer === null) return;

    // Determine target container from the drop target
    let targetContainer = null;
    if (over.data?.current?.type === 'day') {
      targetContainer = over.data.current.date;
    } else if (over.data?.current?.type === 'unscheduled' || overId === 'unscheduled') {
      targetContainer = 'unscheduled';
    } else if (typeof overId === 'string' && overId.startsWith('day:')) {
      targetContainer = overId.slice(4);
    } else {
      targetContainer = findItemContainer(overId);
    }
    if (targetContainer === null) return;

    // Same container: reorder within day
    if (sourceContainer === targetContainer && sourceContainer !== 'unscheduled') {
      const arr = s.schedule[sourceContainer] || [];
      const oldIndex = arr.indexOf(activeId);
      const newIndex = arr.indexOf(overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        setState((prev) => {
          const next = structuredClone(prev);
          const list = next.schedule[sourceContainer] || [];
          const [removed] = list.splice(oldIndex, 1);
          list.splice(newIndex, 0, removed);
          next.schedule[sourceContainer] = list;
          return next;
        });
      }
      return;
    }

    // Different container: move item
    setState((prev) => {
      const next = structuredClone(prev);
      if (sourceContainer === 'unscheduled') {
        next.unscheduled = next.unscheduled.filter((id) => id !== activeId);
      } else if (next.schedule[sourceContainer]) {
        next.schedule[sourceContainer] = next.schedule[sourceContainer].filter((id) => id !== activeId);
        if (next.schedule[sourceContainer].length === 0) delete next.schedule[sourceContainer];
      }
      if (targetContainer === 'unscheduled') {
        next.unscheduled.push(activeId);
        if (next.items[activeId]) next.items[activeId].dueDate = null;
      } else {
        next.schedule[targetContainer] = next.schedule[targetContainer] || [];
        const overIndex = next.schedule[targetContainer].indexOf(overId);
        if (overIndex !== -1) {
          next.schedule[targetContainer].splice(overIndex, 0, activeId);
        } else {
          next.schedule[targetContainer].push(activeId);
        }
        if (next.items[activeId]) next.items[activeId].dueDate = targetContainer;
      }
      return next;
    });
  }, [findItemContainer]);

  const handleDragCancel = useCallback(() => {
    setDraggingId(null);
  }, []);

  // ── Loading screen ─────────────────────────────────────────────
  if (!loaded || !state) {
    return (
      <div style={{ minHeight: '100vh', background: T.cream, fontFamily: FONT_BODY, color: T.muted }}
           className="flex items-center justify-center">
        <div className="text-sm">Loading planner…</div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════
  // STATE MUTATION HELPERS
  // ══════════════════════════════════════════════════════════════

  /** Update state with undo snapshot. Pass skipUndo=true for bookkeeping changes. */
  const updateState = (fn, skipUndo) => {
    setState((s) => {
      if (!skipUndo) {
        setUndoStack((stack) => [...stack.slice(-(UNDO_STACK_LIMIT - 1)), structuredClone(s)]);
        setRedoStack([]);
      }
      return fn(structuredClone(s));
    });
  };

  const undo = () => {
    if (undoStack.length === 0) return;
    setState((current) => {
      setRedoStack((rStack) => [...rStack.slice(-(UNDO_STACK_LIMIT - 1)), structuredClone(current)]);
      return undoStack[undoStack.length - 1];
    });
    setUndoStack((stack) => stack.slice(0, -1));
    showToast('Undone');
  };
  undoRef.current = undo;

  const redo = () => {
    if (redoStack.length === 0) return;
    setState((current) => {
      setUndoStack((uStack) => [...uStack.slice(-(UNDO_STACK_LIMIT - 1)), structuredClone(current)]);
      return redoStack[redoStack.length - 1];
    });
    setRedoStack((stack) => stack.slice(0, -1));
    showToast('Redone');
  };
  redoRef.current = redo;

  // ── Item creation ──────────────────────────────────────────────

  const addNoteOnDay = (date) => {
    const id = uid();
    updateState((s) => {
      s.items[id] = { id, type: 'rich', html: '<p></p>' };
      s.schedule[date] = s.schedule[date] || [];
      s.schedule[date].push(id);
      return s;
    });
    setAutoEditId(id);
    showToast('Note added — start typing');
  };

  const addRecurringNotes = (title, daysCodes, html) => {
    const teachingDays = generateClassDays(state.setup.startDate, state.setup.endDate, state.setup.classDays);
    const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const matching = teachingDays.filter((d) => {
      const dow = new Date(d + 'T12:00:00').getDay();
      return daysCodes.some((c) => dayMap[c] === dow);
    });
    if (matching.length === 0) { showToast('No matching days found', 'err'); return; }
    updateState((s) => {
      matching.forEach((date) => {
        const id = uid();
        const content = html
          ? `<p><strong>${title}</strong></p>${html}`
          : `<p><strong>${title}</strong></p>`;
        s.items[id] = { id, type: 'rich', html: content };
        s.schedule[date] = s.schedule[date] || [];
        s.schedule[date].push(id);
      });
      return s;
    });
    showToast(`Created ${matching.length} recurring notes`);
    setShowRecurringModal(false);
  };

  const startAssignmentCreation = (date) => {
    const { connected, baseUrl, courseId } = state.canvas;
    if (!connected || !courseId) {
      showToast('Connect Canvas and pick a course first', 'err');
      setShowSetup(true);
      return;
    }
    const dueAt = encodeURIComponent(`${date}T23:59:00`);
    const url = `${baseUrl.replace(/\/+$/, '')}/courses/${courseId}/assignments/new?due_at=${dueAt}`;
    const win = window.open(url, '_blank', 'noopener');
    updateState((s) => {
      s.pendingCreations = s.pendingCreations || [];
      s.pendingCreations.push({ id: uid(), date, time: Date.now() });
      return s;
    });
    if (!win) {
      showToast('Pop-up blocked — allow pop-ups for Canvas', 'err');
    } else {
      showToast('Opening Canvas… come back when you save the assignment');
    }
  };

  /**
   * New Quiz (Quiz LTI) creation. Canvas exposes a magic URL parameter
   * `?quiz_lti` on the assignments/new form that flips it into Quiz LTI
   * mode — the same path Canvas's own "+ Quiz → New" button uses
   * internally. Reuses the pendingCreations reconciliation flow from
   * startAssignmentCreation: when the user saves, the resulting assignment
   * record appears in the next refresh and gets adopted onto the clicked
   * date.
   */
  const startQuizCreation = (date) => {
    const { connected, baseUrl, courseId } = state.canvas;
    if (!connected || !courseId) {
      showToast('Connect Canvas and pick a course first', 'err');
      setShowSetup(true);
      return;
    }
    const dueAt = encodeURIComponent(`${date}T23:59:00`);
    const url = `${baseUrl.replace(/\/+$/, '')}/courses/${courseId}/assignments/new?quiz_lti&due_at=${dueAt}`;
    const win = window.open(url, '_blank', 'noopener');
    updateState((s) => {
      s.pendingCreations = s.pendingCreations || [];
      s.pendingCreations.push({ id: uid(), date, time: Date.now() });
      return s;
    });
    if (!win) {
      showToast('Pop-up blocked — allow pop-ups for Canvas', 'err');
    } else {
      showToast('Opening Canvas… come back when you save the quiz');
    }
  };

  // ── Day management ─────────────────────────────────────────────

  const addExtraDay = (date) => {
    let extendedTo = null;
    updateState((s) => {
      if (!s.extraDays.includes(date)) s.extraDays.push(date);
      // If the new day lands past the declared semester end, push the end
      // date forward so the date row sits inside a valid semester window
      // and downstream logic (template export, date_shift_options, the
      // shift-all-dates modal) keeps working.
      if (s.setup.endDate && date > s.setup.endDate) {
        s.setup.endDate = date;
        extendedTo = date;
      }
      return s;
    });
    showToast(extendedTo
      ? `Added ${fmtMonthDay(date)} — semester end extended to match`
      : `Added ${fmtMonthDay(date)} to schedule`);
  };

  const removeExtraDay = (date) => {
    if ((state.schedule[date] || []).length > 0) {
      showToast('Move the items off this day first', 'err');
      return;
    }
    updateState((s) => {
      s.extraDays = s.extraDays.filter((d) => d !== date);
      delete s.schedule[date];
      return s;
    });
  };

  const reorderOnDay = (date, fromIdx, toIdx) => {
    updateState((s) => {
      const arr = s.schedule[date];
      if (!arr || fromIdx < 0 || toIdx < 0 || fromIdx >= arr.length || toIdx >= arr.length) return s;
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return s;
    });
  };

  const duplicateItem = (id, date) => {
    const orig = state.items[id];
    if (!orig) return;
    const newId = uid();
    updateState((s) => {
      s.items[newId] = { ...structuredClone(orig), id: newId, canvasId: null, isDemo: false };
      if (date && s.schedule[date]) {
        const idx = s.schedule[date].indexOf(id);
        s.schedule[date].splice(idx + 1, 0, newId);
      } else if (date) {
        s.schedule[date] = s.schedule[date] || [];
        s.schedule[date].push(newId);
      } else {
        s.unscheduled.push(newId);
      }
      return s;
    });
    showToast('Item duplicated');
  };

  const toggleHoliday = (date) => {
    updateState((s) => {
      if (!s.holidays) s.holidays = {};
      if (s.holidays[date]) {
        delete s.holidays[date];
      } else {
        const label = window.prompt('Holiday label (e.g., "Labor Day"):', 'No Class');
        s.holidays[date] = label || 'No Class';
      }
      return s;
    });
  };

  const addModuleHeader = (beforeDate) => {
    const title = window.prompt('Module / unit title:');
    if (!title) return;
    updateState((s) => {
      if (!s.modules) s.modules = {};
      s.modules[beforeDate] = title;
      return s;
    });
  };

  const removeModuleHeader = (date) => {
    updateState((s) => {
      if (s.modules) delete s.modules[date];
      return s;
    });
  };

  // ── Bulk date shift ────────────────────────────────────────────

  const bulkShift = (days, skipHolidays) => {
    updateState((s) => {
      if (!skipHolidays) {
        // Simple calendar-day shift: move everything uniformly
        if (s.setup.startDate) s.setup.startDate = addDays(s.setup.startDate, days);
        if (s.setup.endDate) s.setup.endDate = addDays(s.setup.endDate, days);
        s.extraDays = s.extraDays.map((d) => addDays(d, days));
        const remap = (obj) => {
          const out = {};
          Object.keys(obj).forEach((d) => { out[addDays(d, days)] = obj[d]; });
          return out;
        };
        s.schedule = remap(s.schedule);
        if (s.holidays) s.holidays = remap(s.holidays);
        if (s.modules) s.modules = remap(s.modules);
        Object.values(s.items).forEach((item) => {
          if (item.dueDate) item.dueDate = addDays(item.dueDate, days);
        });
      } else {
        // Holiday-aware shift: items land on the Nth non-holiday teaching day
        const allDaysArr = computeAllDays(s.setup, s.extraDays);
        const holidaySet = new Set(Object.keys(s.holidays || {}));
        const eligible = allDaysArr.filter((d) => !holidaySet.has(d));
        const shiftDate = (date) => {
          const idx = eligible.indexOf(date);
          if (idx === -1) return addDays(date, days);
          const target = idx + days;
          if (target < 0) return eligible[0];
          if (target >= eligible.length) return eligible[eligible.length - 1];
          return eligible[target];
        };
        const newSchedule = {};
        Object.keys(s.schedule).forEach((d) => { newSchedule[shiftDate(d)] = s.schedule[d]; });
        s.schedule = newSchedule;
        if (s.modules) {
          const newModules = {};
          Object.keys(s.modules).forEach((d) => { newModules[shiftDate(d)] = s.modules[d]; });
          s.modules = newModules;
        }
        Object.values(s.items).forEach((item) => {
          if (item.dueDate) item.dueDate = shiftDate(item.dueDate);
        });
      }
      return s;
    });
    const label = skipHolidays ? 'teaching days' : `day${Math.abs(days) !== 1 ? 's' : ''}`;
    showToast(`Shifted schedule by ${days > 0 ? '+' : ''}${days} ${label}`);
    setShowShiftModal(false);
  };

  // ── Export / import ────────────────────────────────────────────

  const exportICal = () => {
    const ics = generateICal(state);
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(state.setup.courseTitle || 'schedule').replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Calendar file downloaded');
  };

  const exportSemesterTemplate = () => {
    if (!state.setup.startDate || !state.setup.endDate) {
      showToast('Set up semester dates first', 'err');
      return;
    }
    const template = exportTemplate(state);
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(state.setup.courseTitle || 'schedule').replace(/[^a-zA-Z0-9]/g, '_')}_template.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Template exported — ${template.totalTeachingDays} days, ${template.slots.length} slots`);
  };

  const importSemesterTemplate = (file) => {
    if (!state.setup.startDate || !state.setup.endDate) {
      showToast('Set up semester dates first, then import a template', 'err');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const template = JSON.parse(e.target.result);
        if (!template.slots || !Array.isArray(template.slots)) {
          showToast('Invalid template file', 'err');
          return;
        }
        const result = importTemplate(template, state.setup);
        const newTeachingDays = generateClassDays(state.setup.startDate, state.setup.endDate, state.setup.classDays);
        const mapped = Math.min(template.totalTeachingDays, newTeachingDays.length);
        if (template.totalTeachingDays > newTeachingDays.length) {
          showToast(`Template has ${template.totalTeachingDays} days but new semester has ${newTeachingDays.length} — some items may be lost`, 'err');
        }
        updateState((s) => {
          s.items = { ...s.items, ...result.items };
          Object.entries(result.schedule).forEach(([date, ids]) => {
            s.schedule[date] = [...(s.schedule[date] || []), ...ids];
          });
          s.holidays = { ...s.holidays, ...result.holidays };
          s.modules = { ...s.modules, ...result.modules };
          s.unscheduled = [...s.unscheduled, ...result.unscheduled];
          const existingExtras = new Set(s.extraDays || []);
          (result.extraDays || []).forEach((d) => existingExtras.add(d));
          s.extraDays = [...existingExtras];
          return s;
        });
        const itemCount = Object.keys(result.items).length;
        const extraNote = result.extraDays?.length ? `, +${result.extraDays.length} extra day${result.extraDays.length === 1 ? '' : 's'}` : '';
        showToast(`Imported template: ${itemCount} items across ${mapped} days${extraNote}`);
      } catch (err) {
        showToast(`Failed to import template: ${err.message}`, 'err');
      }
    };
    reader.readAsText(file);
  };

  const importSchedule = (events) => {
    if (!events || events.length === 0) {
      showToast('No events found in file', 'err');
      return;
    }
    const teachingDays = new Set(
      generateClassDays(state.setup.startDate, state.setup.endDate, state.setup.classDays)
    );
    const currentAllDays = new Set(allDays);
    updateState((s) => {
      for (const ev of events) {
        const id = uid();
        const isAssign = /\b(assignment|quiz|exam|midterm|final|homework|hw\d*|project|lab)\b/i.test(ev.title);
        if (isAssign) {
          s.items[id] = { id, type: 'assign', title: ev.title };
        } else {
          const html = ev.description
            ? `<p><strong>${ev.title}</strong></p><p>${ev.description.replace(/\n/g, '<br>')}</p>`
            : `<p>${ev.title}</p>`;
          s.items[id] = { id, type: 'rich', html };
        }
        s.schedule[ev.date] = s.schedule[ev.date] || [];
        s.schedule[ev.date].push(id);
        if (!teachingDays.has(ev.date) && !currentAllDays.has(ev.date)) {
          s.extraDays = s.extraDays || [];
          if (!s.extraDays.includes(ev.date)) {
            s.extraDays.push(ev.date);
            currentAllDays.add(ev.date);
          }
        }
      }
      return s;
    });
    showToast(`Imported ${events.length} event${events.length !== 1 ? 's' : ''}`);
  };

  // ── Course switching ───────────────────────────────────────────

  const switchCourse = async (newCourseId) => {
    if (state) Store.save(state);
    const saved = await Store.load(newCourseId);
    const canvas = { ...state.canvas, courseId: newCourseId };
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

  // ── Item edits ─────────────────────────────────────────────────

  const deleteItem = async (id) => {
    const item = state.items[id];
    const canvasId = item?.canvasId;
    const { connected, baseUrl, token, courseId } = state.canvas;

    // For Canvas-linked items, confirm and delete on the Canvas side too.
    // Otherwise dragging stays out of sync — the next refresh re-imports the
    // assignment from Canvas and the user wonders why their delete "didn't work".
    if (canvasId && connected && courseId) {
      const title = item.title || 'this item';
      const ok = window.confirm(
        `Delete "${title}" from Canvas too?\n\n` +
        `OK  = also delete in Canvas (irreversible)\n` +
        `Cancel = remove from schedule only (it will reappear on next refresh)`
      );
      if (ok) {
        try {
          await CanvasAPI.deleteAssignment(baseUrl, token, courseId, canvasId);
          showToast('Deleted from Canvas');
        } catch (e) {
          showToast(`Canvas delete failed: ${e.message}`, 'err');
          return; // keep the planner item so the user can retry
        }
      }
    }

    updateState((s) => {
      delete s.items[id];
      s.unscheduled = s.unscheduled.filter((x) => x !== id);
      Object.keys(s.schedule).forEach((d) => {
        s.schedule[d] = s.schedule[d].filter((x) => x !== id);
        if (s.schedule[d].length === 0) delete s.schedule[d];
      });
      return s;
    });
  };

  const updateItem = (id, patch) => {
    updateState((s) => {
      if (!s.items[id]) return s;
      s.items[id] = { ...s.items[id], ...patch };
      return s;
    });
    // Sync title renames to Canvas
    const item = state.items[id];
    if (patch.title && item?.canvasId && state.canvas.connected && state.canvas.courseId) {
      CanvasAPI.renameAssignment(
        state.canvas.baseUrl, state.canvas.token, state.canvas.courseId, item.canvasId, patch.title
      ).catch(() => {});
    }
  };

  // ── Move item between days ─────────────────────────────────────

  const moveItem = async (id, toDate, position) => {
    let canvasError = null;
    let didCanvasSync = false;
    const willAutoAddDay = toDate && !allDaysSet.has(toDate);

    updateState((s) => {
      s.unscheduled = s.unscheduled.filter((x) => x !== id);
      Object.keys(s.schedule).forEach((d) => {
        s.schedule[d] = s.schedule[d].filter((x) => x !== id);
        if (s.schedule[d].length === 0) delete s.schedule[d];
      });
      if (toDate === null) {
        s.unscheduled.unshift(id);
      } else {
        if (willAutoAddDay && !s.extraDays.includes(toDate)) s.extraDays.push(toDate);
        s.schedule[toDate] = s.schedule[toDate] || [];
        if (position != null && position >= 0) {
          s.schedule[toDate].splice(position, 0, id);
        } else {
          s.schedule[toDate].push(id);
        }
        if (s.items[id]?.type === 'assign') s.items[id].dueDate = toDate;
      }
      return s;
    });

    const item = state.items[id];
    if (toDate && item?.type === 'assign' && item.canvasId &&
        state.canvas.connected && state.canvas.token && state.canvas.baseUrl && state.canvas.courseId) {
      try {
        const due = new Date(toDate + 'T23:59:00').toISOString();
        await CanvasAPI.setDueDate(state.canvas.baseUrl, state.canvas.token, state.canvas.courseId, item.canvasId, due);
        didCanvasSync = true;
      } catch (e) { canvasError = e.message; }
    }
    if (didCanvasSync) showToast('Synced to Canvas');
    else if (canvasError) showToast(`Canvas sync failed: ${canvasError}`, 'err');
  };

  // ── Publish to Canvas ──────────────────────────────────────────

  const doPublish = async () => {
    const s = stateRef.current;
    setPublishing(true);
    try {
      const now = new Date().toISOString();
      const itemCount = Object.keys(s.items).length;
      const dayCount = Object.keys(s.schedule).filter((d) => (s.schedule[d] || []).length > 0).length;
      const historyEntry = { timestamp: now, itemCount, dayCount };
      const prevHistory = s.publishHistory || [];
      const publishData = {
        setup: s.setup, items: s.items, schedule: s.schedule,
        extraDays: s.extraDays, unscheduled: s.unscheduled,
        holidays: s.holidays || {}, modules: s.modules || {},
        publishHistory: [...prevHistory, historyEntry],
        publishedAt: now,
      };
      await CanvasAPI.uploadSchedule(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, publishData);
      updateState((st) => { st.publishHistory = [...(st.publishHistory || []), historyEntry]; st.loadedAt = now; return st; }, true);
      const html = renderScheduleHtml(s, s.setup.courseTitle);
      const slug = await CanvasAPI.publishPage(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, 'Schedule', html);
      const pageUrl = `${s.canvas.baseUrl.replace(/\/+$/, '')}/courses/${s.canvas.courseId}/pages/${slug}`;
      setStudentEmbed(pageUrl);
      setLastPublishedUrl(pageUrl);
      try { localStorage.setItem('planner-last-published-url', pageUrl); } catch {}
      setTimeout(() => setStudentEmbed(null), PUBLISH_BANNER_DISMISS_MS);
      showToast('Published schedule to Canvas');
    } catch (e) {
      showToast(`Publish failed: ${e.message}`, 'err');
    } finally {
      setPublishing(false);
    }
  };

  const publishToCanvas = async () => {
    const s = stateRef.current;
    if (!s?.canvas?.connected || !s.canvas.courseId) {
      showToast('Connect to Canvas and pick a course first', 'err');
      return;
    }
    setPublishing(true);
    try {
      const remote = await CanvasAPI.downloadSchedule(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId).catch(() => null);
      if (remote?.publishedAt && s.loadedAt && remote.publishedAt > s.loadedAt) {
        setConflictData({ local: s, remote });
        setPublishing(false);
        return;
      }
    } catch (e) {
      showToast(`Publish failed: ${e.message}`, 'err');
      setPublishing(false);
      return;
    }
    await doPublish();
  };

  // ── Conflict resolution ────────────────────────────────────────

  const handleConflictOverwrite = () => {
    setConflictData(null);
    doPublish();
  };

  const handleConflictLoadRemote = () => {
    const remote = conflictData?.remote;
    setConflictData(null);
    if (!remote) return;
    updateState((s) => {
      if (remote.setup) s.setup = remote.setup;
      if (remote.items) s.items = remote.items;
      if (remote.schedule) s.schedule = remote.schedule;
      if (remote.extraDays) s.extraDays = remote.extraDays;
      if (remote.unscheduled) s.unscheduled = remote.unscheduled;
      if (remote.holidays) s.holidays = remote.holidays;
      if (remote.modules) s.modules = remote.modules;
      s.loadedAt = new Date().toISOString();
      return s;
    });
    showToast('Loaded remote version — review and publish when ready');
  };

  const handleConflictCancel = () => {
    setConflictData(null);
    showToast('Publish cancelled', 'err');
  };

  const copyShareLink = async () => {
    if (!lastPublishedUrl) {
      showToast('Publish the schedule to Canvas first to get a shareable link', 'err');
      return;
    }
    try {
      await navigator.clipboard.writeText(lastPublishedUrl);
      showToast('Link copied — share with TAs and students');
    } catch {
      showToast('Could not copy — try copying from the address bar', 'err');
    }
  };

  // ── Canvas connect / sync / refresh ────────────────────────────

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
   * Detect whether a Canvas assignment record is actually a quiz. Canvas
   * stores both New Quizzes (Quiz LTI) and Classic Quizzes as assignments:
   *   - New Quiz: `is_quiz_lti_assignment: true`
   *   - Classic Quiz: `quiz_id: <number>` set
   */
  const assignmentIsQuiz = (a) =>
    Boolean(a?.is_quiz_lti_assignment || a?.quiz_id);

  /** Light sync — merge new Canvas assignments (triggered by window focus). */
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
        s.items[id] = { id, type: 'assign', title: a.name, points: a.points_possible || 0, canvasId: a.id, htmlUrl: a.html_url, dueDate: due, groupId: a.assignment_group_id || null, isQuiz: assignmentIsQuiz(a) };
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
  syncRef.current = syncFromCanvas;

  /** Full reload — download published schedule, then merge current Canvas assignments. */
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
        s.items[id] = { id, type: 'assign', title: a.name, points: a.points_possible || 0, canvasId: a.id, htmlUrl: a.html_url, dueDate: due, groupId: a.assignment_group_id || null, isQuiz: assignmentIsQuiz(a) };
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

  /**
   * Fallback for courses where the user's token lacks Canvas Course Reset
   * permission. Enumerates content per type and deletes each item via the
   * standard edit endpoints (which most instructor tokens DO have). Slower
   * than `reset_content` (hundreds of round trips on a populated course),
   * but works for everyone with normal content-edit permissions.
   *
   * Throttled: 5 parallel deletes, 1.5s sleep between batches — matches the
   * date-push throttle to stay well under Canvas's per-token rate limit.
   * 404 errors are treated as already-deleted (Canvas cascades, e.g., quiz
   * deletes can race with assignment deletes that share a backing record).
   *
   * Returns `{ total, deleted, failures }`.
   */
  const manuallyWipeCourse = async (baseUrl, token, courseId, onProgress) => {
    const failures = [];
    // Delete order matters slightly: tear down modules before the assignments
    // they reference; tear down pages before the files they embed; files last.
    const types = [
      {
        key: 'modules',
        list: () => CanvasAPI.listModules(baseUrl, token, courseId),
        deleteOne: (m) => CanvasAPI.deleteModule(baseUrl, token, courseId, m.id),
        label: (m) => m.name || `module#${m.id}`,
      },
      {
        key: 'pages',
        list: () => CanvasAPI.listAllPages(baseUrl, token, courseId),
        deleteOne: (p) => CanvasAPI.deletePage(baseUrl, token, courseId, p.url),
        label: (p) => p.title || p.url,
      },
      {
        key: 'assignments',
        list: () => CanvasAPI.listAssignments(baseUrl, token, courseId),
        deleteOne: (a) => CanvasAPI.deleteAssignment(baseUrl, token, courseId, a.id),
        label: (a) => a.name || `assignment#${a.id}`,
      },
      {
        key: 'quizzes',
        list: () => CanvasAPI.listQuizzes(baseUrl, token, courseId),
        deleteOne: (q) => CanvasAPI.deleteQuiz(baseUrl, token, courseId, q.id),
        label: (q) => q.title || `quiz#${q.id}`,
      },
      {
        key: 'discussions',
        list: () => CanvasAPI.listDiscussionTopics(baseUrl, token, courseId),
        deleteOne: (d) => CanvasAPI.deleteDiscussionTopic(baseUrl, token, courseId, d.id),
        label: (d) => d.title || `discussion#${d.id}`,
      },
      {
        key: 'files',
        list: () => CanvasAPI.listFiles(baseUrl, token, courseId),
        deleteOne: (f) => CanvasAPI.deleteFile(baseUrl, token, f.id),
        label: (f) => f.display_name || f.filename || `file#${f.id}`,
      },
    ];

    // Enumerate every type up front so we can show a total to the user.
    const lists = await Promise.all(types.map(async (t) => {
      try { return { ...t, items: await t.list() }; }
      catch (e) { return { ...t, items: [], listError: e.message }; }
    }));
    const total = lists.reduce((sum, l) => sum + l.items.length, 0);
    onProgress?.({ done: 0, total });
    if (total === 0) return { total: 0, deleted: 0, failures };

    let done = 0;
    for (const lt of lists) {
      if (lt.listError) {
        failures.push({ type: lt.key, name: '(list error)', error: lt.listError });
        continue;
      }
      for (let i = 0; i < lt.items.length; i += WIPE_DELETE_BATCH_SIZE) {
        const batch = lt.items.slice(i, i + WIPE_DELETE_BATCH_SIZE);
        await Promise.all(batch.map(async (item) => {
          try {
            await lt.deleteOne(item);
          } catch (e) {
            // 404 = already deleted (Canvas cascades). Treat as success.
            if (!/\b404\b/.test(e.message)) {
              failures.push({ type: lt.key, name: lt.label(item), error: e.message });
            }
          }
          done += 1;
          onProgress?.({ done, total });
        }));
        if (i + WIPE_DELETE_BATCH_SIZE < lt.items.length) {
          await new Promise((r) => setTimeout(r, WIPE_DELETE_SLEEP_MS));
        }
      }
    }

    return { total, deleted: done - failures.length, failures };
  };

  /**
   * Load a course's planner state from local storage if present, otherwise
   * try to download the schedule JSON the instructor previously published
   * to that course's Canvas Files. Returns null if neither is available.
   */
  const loadSourcePlannerState = async (sourceCourseId, baseUrl, token, diag) => {
    try {
      const local = await Store.load(sourceCourseId);
      if (diag) diag.localStorage = local && local.items
        ? `found (${Object.keys(local.items).length} items)`
        : 'not found';
      if (local && local.items && local.setup) {
        // eslint-disable-next-line no-console
        console.log('[CanvasSchedulePlugin] Source planner state found in localStorage');
        return local;
      }
    } catch (e) { if (diag) diag.localStorage = `error: ${e.message}`; }
    try {
      const remote = await CanvasAPI.downloadSchedule(baseUrl, token, sourceCourseId);
      if (diag) diag.sourceCanvasFiles = remote && remote.items
        ? `found (${Object.keys(remote.items).length} items)`
        : 'no schedule-planner.json found';
      if (remote && remote.items && remote.setup) {
        // eslint-disable-next-line no-console
        console.log('[CanvasSchedulePlugin] Source planner state found in source\'s Canvas Files');
        return remote;
      }
    } catch (e) { if (diag) diag.sourceCanvasFiles = `error: ${e.message}`; }
    return null;
  };

  /**
   * Build oldId → newId maps for each Canvas content type by listing both
   * the source and target courses and matching items by name. Pages match
   * by URL slug (which Canvas's course copy preserves).
   *
   * Files use a refined matching scheme: first try (display_name, size),
   * fall back to display_name alone. If multiple target files match a
   * single source file, pick the first but record an ambiguity warning —
   * Canvas may have renamed the copied file due to a name conflict in
   * the target's files area.
   *
   * Returns `{ remap, ambiguousFiles }` where ambiguousFiles is an array
   * of `{ filename, candidates }` for the panel to surface.
   *
   * Any single fetch that fails returns an empty map for that type rather
   * than aborting — rewriteEmbeddedLinks preserves unmapped inner IDs.
   */
  const buildLinkRemap = async (baseUrl, token, sourceId, targetId) => {
    const types = [
      { key: 'assignments',       api: 'listAssignments',       nameField: 'name',  idField: 'id' },
      { key: 'quizzes',           api: 'listQuizzes',           nameField: 'title', idField: 'id' },
      { key: 'pages',             api: 'listAllPages',          nameField: 'url',   idField: 'url' },
      { key: 'modules',           api: 'listModules',           nameField: 'name',  idField: 'id' },
      { key: 'discussion_topics', api: 'listDiscussionTopics',  nameField: 'title', idField: 'id' },
    ];
    const remap = {};
    const ambiguousFiles = [];
    // Source-side ID → friendly name (display_name for files, name/title for
    // others). Used to label unmatched-link warnings with the actual filename
    // instead of an opaque numeric ID.
    const sourceNames = {};

    await Promise.all([
      // Standard name-based matching for non-file types.
      ...types.map(async (t) => {
        let src = []; let tgt = [];
        try { src = await CanvasAPI[t.api](baseUrl, token, sourceId); } catch {}
        try { tgt = await CanvasAPI[t.api](baseUrl, token, targetId); } catch {}
        const tgtByName = {};
        tgt.forEach((it) => {
          if (it[t.nameField]) tgtByName[it[t.nameField]] = String(it[t.idField]);
        });
        const map = {};
        const namesForType = {};
        src.forEach((it) => {
          const name = it[t.nameField];
          const oldId = String(it[t.idField]);
          if (name) namesForType[oldId] = name;
          const newId = name ? tgtByName[name] : null;
          if (newId) map[oldId] = newId;
        });
        remap[t.key] = map;
        sourceNames[t.key] = namesForType;
      }),

      // Files: (display_name, size) match first, then display_name only.
      // Records ambiguous matches so the user can verify links by hand.
      (async () => {
        let src = []; let tgt = [];
        try { src = await CanvasAPI.listFiles(baseUrl, token, sourceId); } catch {}
        try { tgt = await CanvasAPI.listFiles(baseUrl, token, targetId); } catch {}

        const tgtBySizedName = {};
        const tgtByName = {};
        tgt.forEach((f) => {
          const sized = `${f.display_name}|${f.size}`;
          if (!tgtBySizedName[sized]) tgtBySizedName[sized] = [];
          tgtBySizedName[sized].push(f);
          if (!tgtByName[f.display_name]) tgtByName[f.display_name] = [];
          tgtByName[f.display_name].push(f);
        });

        const map = {};
        const namesForFiles = {};
        src.forEach((f) => {
          const oldId = String(f.id);
          const display = f.display_name || f.filename || `file#${oldId}`;
          namesForFiles[oldId] = display;
          const sized = `${f.display_name}|${f.size}`;
          let candidates = tgtBySizedName[sized] || tgtByName[f.display_name] || [];
          if (candidates.length === 1) {
            map[oldId] = String(candidates[0].id);
          } else if (candidates.length > 1) {
            // Multiple matches — pick first deterministically and warn.
            map[oldId] = String(candidates[0].id);
            ambiguousFiles.push({ filename: f.display_name, candidates: candidates.length });
          }
          // else: no match — leave unmapped; rewriteEmbeddedLinks will count it.
        });
        remap.files = map;
        sourceNames.files = namesForFiles;
      })(),
    ]);

    return { remap, ambiguousFiles, sourceNames };
  };

  /**
   * After a Canvas course copy finishes, pull the source course's planner
   * state (notes, modules, holidays, item placement, extra days) and re-map
   * it onto the current semester's dates via exportTemplate/importTemplate.
   * Re-links assignment items to the new Canvas IDs by title, rewrites
   * /courses/<src>/<type>/<id> links inside rich-note HTML, and pushes the
   * planner's authoritative dates back to Canvas (overriding Canvas's own
   * date-shift output).
   *
   * Collects per-issue warnings: unmatched assignments, unmatched embedded
   * links (per type), source-side title collisions, date-push failures.
   *
   * Returns `{ hadSource, itemCount, relinked, rewrittenNotes, extraDays,
   * mappedDays, sourceTotalDays, droppedExtras, datePushed,
   * datePushFailed, warnings }`. `warnings` is an array of
   * `{ kind, ...details }` objects.
   */
  const importScheduleFromSource = async (sourceCourseId, sourceState, onProgress) => {
    const s = stateRef.current;
    if (!sourceState) return { hadSource: false };

    // Convert source state to relative-position template, then map onto
    // the current setup's dates.
    const template = exportTemplate(sourceState);
    const result = importTemplate(template, s.setup);
    const warnings = [];

    // Diagnostic so we can see what setups + dates each side is using.
    // If notes land on unexpected dates, this tells us whether the source
    // state's setup or the target setup is the bad input.
    // eslint-disable-next-line no-console
    console.log('[CanvasSchedulePlugin] Schedule remap diagnostic', {
      sourceSetup: sourceState.setup,
      targetSetup: s.setup,
      template: {
        totalTeachingDays: template.totalTeachingDays,
        slotCount: template.slots.length,
        extraSlotCount: (template.extraSlots || []).length,
        sampleSlot: template.slots[0],
        sampleExtraSlot: (template.extraSlots || [])[0],
      },
      result: {
        scheduleDates: Object.keys(result.schedule).slice(0, 8),
        extraDays: result.extraDays,
        droppedExtras: result.droppedExtras,
        itemCount: Object.keys(result.items).length,
      },
    });

    // Build the embedded-link remap and the target's assignment list in
    // parallel.
    const [remapResult, assignmentList] = await Promise.all([
      buildLinkRemap(s.canvas.baseUrl, s.canvas.token, sourceCourseId, s.canvas.courseId),
      CanvasAPI.listAssignments(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId).catch(() => []),
    ]);
    const linkRemap = remapResult.remap;
    const sourceNames = remapResult.sourceNames || {};
    (remapResult.ambiguousFiles || []).forEach((f) => {
      warnings.push({ kind: 'ambiguous-file', filename: f.filename, candidates: f.candidates });
    });

    // Detect title collisions in the *source* assignment list — they make
    // relink ambiguous because we match by title.
    const sourceAssignmentList = await CanvasAPI.listAssignments(
      s.canvas.baseUrl, s.canvas.token, sourceCourseId
    ).catch(() => []);
    const sourceTitleCount = {};
    sourceAssignmentList.forEach((a) => {
      sourceTitleCount[a.name] = (sourceTitleCount[a.name] || 0) + 1;
    });
    Object.entries(sourceTitleCount).forEach(([title, n]) => {
      if (n > 1) warnings.push({ kind: 'title-collision', title, count: n });
    });

    // Relink assignment cards by title (Canvas's course copy preserves names,
    // including for New Quizzes which appear in the assignments list).
    const titleToNew = {};
    assignmentList.forEach((a) => {
      titleToNew[a.name] = { id: a.id, htmlUrl: a.html_url, groupId: a.assignment_group_id };
    });

    let relinked = 0;
    let rewrittenNotes = 0;
    const unmatchedLinks = []; // [{ type, sourceId, sourceName, noteSnippet }]
    Object.values(result.items).forEach((item) => {
      if (item.type === 'assign' && item.title) {
        const match = titleToNew[item.title];
        if (match) {
          item.canvasId = match.id;
          item.htmlUrl = match.htmlUrl;
          if (match.groupId) item.groupId = match.groupId;
          relinked++;
        } else {
          warnings.push({ kind: 'unmatched-assignment', title: item.title });
        }
      }
      if (item.html) {
        const noteSnippet = item.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
        const rewritten = rewriteEmbeddedLinks(
          item.html, sourceCourseId, s.canvas.courseId, linkRemap,
          ({ type, id }) => {
            // Pages keep their slug across course copy, so an unmapped
            // page slug usually still resolves — don't warn about those.
            if (type === 'pages') return;
            unmatchedLinks.push({
              type,
              sourceId: id,
              sourceName: sourceNames[type]?.[id] || null,
              noteSnippet,
            });
          },
        );
        if (rewritten !== item.html) {
          item.html = rewritten;
          rewrittenNotes++;
        }
      }
    });
    unmatchedLinks.forEach((u) => warnings.push({ kind: 'unmatched-link', ...u }));

    // Merge into current state (additive — same pattern as importSemesterTemplate).
    updateState((cur) => {
      cur.items = { ...cur.items, ...result.items };
      Object.entries(result.schedule).forEach(([date, ids]) => {
        cur.schedule[date] = [...(cur.schedule[date] || []), ...ids];
      });
      cur.holidays = { ...cur.holidays, ...result.holidays };
      cur.modules = { ...cur.modules, ...result.modules };
      cur.unscheduled = [...cur.unscheduled, ...result.unscheduled];
      const existingExtras = new Set(cur.extraDays || []);
      (result.extraDays || []).forEach((d) => existingExtras.add(d));
      cur.extraDays = [...existingExtras];
      return cur;
    });

    // Push planner-authoritative due dates back to Canvas for relinked
    // assignments. The planner uses teaching-day-index mapping which lands
    // items on actual class meeting days — more precise than Canvas's
    // proportional date_shift_options output.
    //
    // Throttled: bounded parallelism (small batch) plus a sleep between
    // batches, since a single course copy can produce 20-50 setDueDate
    // calls and Canvas's per-token rate limit is shared across requests.
    // See config.js for the actual numbers.
    const toPush = Object.values(result.items).filter(
      (it) => it.type === 'assign' && it.canvasId && it.dueDate
    );
    let datePushed = 0;
    const datePushFailures = [];
    for (let i = 0; i < toPush.length; i += DATE_PUSH_BATCH_SIZE) {
      const batch = toPush.slice(i, i + DATE_PUSH_BATCH_SIZE);
      await Promise.all(batch.map(async (it) => {
        try {
          const due = new Date(it.dueDate + 'T23:59:00').toISOString();
          await CanvasAPI.setDueDate(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, it.canvasId, due);
          datePushed++;
        } catch (e) {
          datePushFailures.push({ title: it.title, error: e.message });
        }
      }));
      onProgress?.({
        state: 'pushing-dates',
        done: Math.min(i + DATE_PUSH_BATCH_SIZE, toPush.length),
        total: toPush.length,
      });
      if (i + DATE_PUSH_BATCH_SIZE < toPush.length) {
        await new Promise((r) => setTimeout(r, DATE_PUSH_SLEEP_MS));
      }
    }
    datePushFailures.forEach((f) => warnings.push({ kind: 'date-push-failed', ...f }));

    const newTeachingDays = generateClassDays(s.setup.startDate, s.setup.endDate, s.setup.classDays);
    return {
      hadSource: true,
      itemCount: Object.keys(result.items).length,
      relinked,
      rewrittenNotes,
      extraDays: (result.extraDays || []).length,
      mappedDays: Math.min(template.totalTeachingDays, newTeachingDays.length),
      sourceTotalDays: template.totalTeachingDays,
      droppedExtras: result.droppedExtras || 0,
      datePushed,
      datePushFailed: datePushFailures.length,
      warnings,
    };
  };

  /**
   * Trigger a Canvas server-side course copy from sourceCourseId into the
   * currently selected course. Polls progress indefinitely (with backoff)
   * until the migration reports completed/failed. Reports progress via
   * `onProgress({ state, completion, elapsedSec })`.
   *
   * `shouldStop()` is checked between polls — if it returns true the loop
   * exits with `ok: false, stopped: true`. The migration itself continues
   * server-side regardless; this only stops our polling.
   *
   * On success, also pulls the source course's schedule (notes, modules,
   * placement) and re-maps it onto the current semester. Returns the
   * import summary in `result.schedule`.
   */
  const cloneCourseFrom = async (sourceCourseId, onProgress, shouldStop, overwrite = false) => {
    const s = stateRef.current;
    if (!s.canvas.connected || !s.canvas.courseId) {
      return { ok: false, error: 'Pick a target course first' };
    }
    if (!sourceCourseId || String(sourceCourseId) === String(s.canvas.courseId)) {
      return { ok: false, error: 'Source must differ from current course' };
    }
    if (!s.setup.startDate || !s.setup.endDate) {
      return { ok: false, error: 'Set the target semester start/end dates first' };
    }

    // Load source planner state up front so we can compute date_shift_options
    // and have it ready for import once the migration completes. Falls back
    // to Canvas's course.start_at/end_at if the source course has no saved
    // planner state. The diag object accumulates what each lookup path
    // returned so the panel can surface it without DevTools.
    const sourceDiag = {
      localStorage: 'not checked',
      sourceCanvasFiles: 'not checked',
      targetCanvasFiles: 'not checked (only consulted after migration)',
    };
    const sourceState = await loadSourcePlannerState(sourceCourseId, s.canvas.baseUrl, s.canvas.token, sourceDiag);
    const sourceCourseMeta = s.canvas.courses.find((c) => String(c.id) === String(sourceCourseId));
    const sourceStart = sourceState?.setup?.startDate || sourceCourseMeta?.startAt?.slice(0, 10);
    const sourceEnd = sourceState?.setup?.endDate || sourceCourseMeta?.endAt?.slice(0, 10);
    const dateShiftOptions = (sourceStart && sourceEnd) ? {
      shift_dates: true,
      old_start_date: sourceStart,
      old_end_date: sourceEnd,
      new_start_date: s.setup.startDate,
      new_end_date: s.setup.endDate,
    } : null;

    // Start the elapsed-time clock here so it covers both the optional
    // overwrite step and the subsequent migration polling.
    const startedAt = Date.now();

    // Destructive pre-step: wipe the target course before copying.
    //
    // Two-tier strategy:
    //   1. Try Canvas Course Reset (`POST /reset_content`) — one API call,
    //      Canvas archives all content server-side. Requires the token to
    //      have the `manage_courses_reset` permission, which most
    //      institutions restrict to admins.
    //   2. On 403 fall back to per-item DELETEs (manuallyWipeCourse) using
    //      ordinary content-edit permissions. Slower (hundreds of calls)
    //      but works for the typical instructor token.
    //
    // Either way we also clear local planner state so old cards with stale
    // canvasIds don't linger after Canvas-side content is gone.
    if (overwrite) {
      onProgress?.({ state: 'resetting', elapsedSec: 0 });
      let resetOk = false;
      try {
        await CanvasAPI.resetCourseContent(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId);
        resetOk = true;
      } catch (e) {
        if (!/\b403\b/.test(e.message)) {
          return { ok: false, error: `Reset failed: ${e.message}` };
        }
        showToast('Canvas Course Reset denied — falling back to per-item deletion (slower)');
      }

      if (!resetOk) {
        try {
          const wipeResult = await manuallyWipeCourse(
            s.canvas.baseUrl, s.canvas.token, s.canvas.courseId,
            (p) => onProgress?.({
              state: 'deleting',
              done: p.done, total: p.total,
              elapsedSec: Math.floor((Date.now() - startedAt) / 1000),
            }),
          );
          if (wipeResult.failures.length > 0) {
            const sample = wipeResult.failures.slice(0, 3).map((f) => `${f.type}:${f.name}`).join(', ');
            showToast(
              `Deleted ${wipeResult.deleted}/${wipeResult.total}; ${wipeResult.failures.length} failed (${sample}…). ` +
              `Continuing with copy.`,
              'err'
            );
          }
        } catch (e2) {
          return { ok: false, error: `Manual wipe failed: ${e2.message}` };
        }
      }

      updateState((st) => {
        st.items = {};
        st.schedule = {};
        st.holidays = {};
        st.modules = {};
        st.unscheduled = [];
        st.extraDays = [];
        st.pendingCreations = [];
        st.publishHistory = [];
        return st;
      });
    }

    let migration;
    try {
      migration = await CanvasAPI.cloneCourseContent(
        s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, sourceCourseId, dateShiftOptions
      );
    } catch (e) {
      return { ok: false, error: e.message };
    }

    // Adaptive polling: every 3s for the first 2 min, then 10s up to 10 min,
    // then 30s after that. No hard timeout — Canvas may take a while on
    // large courses, especially if there are many files.
    const pickInterval = (elapsedSec) => {
      if (elapsedSec < CLONE_POLL_FAST_WINDOW_SEC) return CLONE_POLL_FAST_MS;
      if (elapsedSec < CLONE_POLL_SLOW_WINDOW_SEC) return CLONE_POLL_SLOW_MS;
      return CLONE_POLL_VERY_SLOW_MS;
    };

    const finishWithSchedule = async () => {
      let schedule = { hadSource: false };

      // Post-migration fallback for source planner state: Canvas's migration
      // copies source's files to the target, so if source had ever published
      // `schedule-planner.json` to its Canvas Files, it now lives in the
      // target's Files too. Populates sourceDiag.targetCanvasFiles with
      // user-facing info shown in the panel.
      let effectiveSourceState = sourceState;
      if (!effectiveSourceState) {
        try {
          const files = await CanvasAPI.listFiles(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId);
          // eslint-disable-next-line no-console
          console.log('[CanvasSchedulePlugin] Post-migration files in target:',
            files.map((f) => ({ id: f.id, name: f.display_name || f.filename, size: f.size })));
          const match = files.find((f) => {
            const name = (f.display_name || f.filename || '').toLowerCase();
            return name === 'schedule-planner.json';
          });
          if (match) {
            const fromTarget = await CanvasAPI.downloadSchedule(
              s.canvas.baseUrl, s.canvas.token, s.canvas.courseId
            );
            if (fromTarget && fromTarget.items && fromTarget.setup) {
              effectiveSourceState = fromTarget;
              sourceDiag.targetCanvasFiles = `found (${Object.keys(fromTarget.items).length} items)`;
            } else {
              sourceDiag.targetCanvasFiles = 'found file but content malformed';
            }
          } else {
            const sampleNames = files.slice(0, 8).map((f) => f.display_name || f.filename).filter(Boolean).join(', ');
            sourceDiag.targetCanvasFiles =
              files.length === 0
                ? 'no files in target — migration may not have copied source files'
                : `no schedule-planner.json among ${files.length} files (sample: ${sampleNames || '(unnamed)'})`;
          }
        } catch (e) {
          sourceDiag.targetCanvasFiles = `error: ${e.message}`;
        }
      } else {
        sourceDiag.targetCanvasFiles = 'skipped (already found before migration)';
      }

      // Step 1: import the source course's planner state if available
      try {
        if (effectiveSourceState) {
          onProgress?.({
            state: 'syncing',
            completion: 100,
            elapsedSec: Math.floor((Date.now() - startedAt) / 1000),
          });
          schedule = await importScheduleFromSource(
            sourceCourseId, effectiveSourceState,
            (p) => onProgress?.({
              ...p,
              elapsedSec: Math.floor((Date.now() - startedAt) / 1000),
            }),
          );
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[CanvasSchedulePlugin] importScheduleFromSource threw:', e);
        schedule = { hadSource: false, error: e.message, errorStack: e.stack };
      }

      // Step 2: pull the *target* course's assignments + assignment groups
      // into planner state. Runs whether or not the source-state import
      // happened. Non-destructive — existing items matched by canvasId just
      // get field refreshes (no date moves). New Canvas items (those not
      // already placed by Step 1) get added fresh.
      //
      // This is what makes the post-clone schedule actually populate: the
      // user's target course is typically brand-new with no published
      // schedule, so without this step the planner stays empty even though
      // Canvas has all the copied assignments.
      onProgress?.({
        state: 'loading-canvas',
        elapsedSec: Math.floor((Date.now() - startedAt) / 1000),
      });
      try {
        const cur = stateRef.current;
        const [list, groups] = await Promise.all([
          CanvasAPI.listAssignments(cur.canvas.baseUrl, cur.canvas.token, cur.canvas.courseId),
          CanvasAPI.listAssignmentGroups(cur.canvas.baseUrl, cur.canvas.token, cur.canvas.courseId).catch(() => []),
        ]);
        let canvasAdded = 0;
        updateState((st) => {
          const groupsMap = {};
          (Array.isArray(groups) ? groups : []).forEach((g, i) => {
            groupsMap[g.id] = { id: g.id, name: g.name, color: GROUP_COLORS[i % GROUP_COLORS.length] };
          });
          st.canvas.assignmentGroups = groupsMap;

          const teachingNow = new Set(generateClassDays(st.setup.startDate, st.setup.endDate, st.setup.classDays));
          list.forEach((a) => {
            const existing = Object.values(st.items).find((it) => it.type === 'assign' && it.canvasId === a.id);
            if (existing) {
              existing.title = a.name;
              existing.points = a.points_possible || 0;
              existing.htmlUrl = a.html_url;
              existing.isQuiz = assignmentIsQuiz(a);
              if (a.assignment_group_id) existing.groupId = a.assignment_group_id;
              return;
            }
            const id = uid();
            const due = a.due_at ? localDateStr(a.due_at) : null;
            st.items[id] = {
              id, type: 'assign', title: a.name, points: a.points_possible || 0,
              canvasId: a.id, htmlUrl: a.html_url, dueDate: due,
              groupId: a.assignment_group_id || null, isQuiz: assignmentIsQuiz(a),
            };
            if (due) {
              if (!teachingNow.has(due) && !st.extraDays.includes(due)) st.extraDays.push(due);
              st.schedule[due] = st.schedule[due] || [];
              st.schedule[due].push(id);
            } else {
              st.unscheduled.push(id);
            }
            canvasAdded++;
          });
          st.loadedAt = new Date().toISOString();
          return st;
        });
        schedule.canvasAdded = canvasAdded;
      } catch (e) {
        schedule.canvasLoadError = e.message;
      }

      // Attach diag info so the panel can show what we tried.
      schedule.sourceDiag = sourceDiag;

      // Step 3: toast
      const parts = [];
      if (schedule.hadSource) {
        parts.push(`${schedule.itemCount} planner items imported (${schedule.relinked} re-linked)`);
      }
      if (schedule.canvasAdded) {
        parts.push(`${schedule.canvasAdded} Canvas item${schedule.canvasAdded === 1 ? '' : 's'} loaded`);
      }
      const msg = parts.length
        ? `Course copied — ${parts.join(', ')}`
        : (schedule.canvasLoadError
            ? `Migration done but couldn't load assignments: ${schedule.canvasLoadError}`
            : 'Course content copied');
      showToast(msg);
      return { ok: true, schedule };
    };

    if (!migration?.progress_url) return finishWithSchedule();

    while (true) {
      if (shouldStop?.()) return { ok: false, stopped: true };
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      await new Promise((r) => setTimeout(r, pickInterval(elapsedSec)));
      if (shouldStop?.()) return { ok: false, stopped: true };

      let p;
      try {
        p = await CanvasAPI.getProgress(s.canvas.baseUrl, s.canvas.token, migration.progress_url);
      } catch (e) {
        return { ok: false, error: e.message };
      }
      const updatedElapsed = Math.floor((Date.now() - startedAt) / 1000);
      onProgress?.({
        state: p.workflow_state,
        completion: p.completion ?? 0,
        elapsedSec: updatedElapsed,
      });
      if (p.workflow_state === 'completed') {
        return finishWithSchedule();
      }
      if (p.workflow_state === 'failed') {
        return { ok: false, error: p.message || 'Copy failed' };
      }
    }
  };

  // ══════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════

  const isStudent = state.studentView;
  const activeDragItem = draggingId ? state.items[draggingId] : null;

  return (
    <DndContext
      sensors={isStudent ? undefined : sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
    <div style={{ minHeight: '100vh', background: T.cream, color: T.ink, fontFamily: FONT_BODY }}>
      <style>{appStyles()}</style>

      <a href="#schedule-content" className="skip-link">Skip to schedule</a>

      <Header
        state={state} isStudent={isStudent} hashStudent={hashStudent}
        allDays={allDays} filteredDays={filteredDays}
        searchQuery={searchQuery} onSearchChange={setSearchQuery}
        darkMode={darkMode} undoStack={undoStack} redoStack={redoStack}
        onToggleDark={() => setDarkMode((d) => !d)}
        onToggleStudent={() => updateState((s) => { s.studentView = !s.studentView; return s; })}
        onUndo={undo} onRedo={redo} onExportICal={exportICal}
        onShowShiftModal={() => setShowShiftModal(true)}
        onPublish={publishToCanvas} publishing={publishing}
        onShareLink={copyShareLink} lastPublishedUrl={lastPublishedUrl}
        onToggleSetup={() => setShowSetup((v) => !v)}
        onToggleActivityLog={() => setShowActivityLog((v) => !v)}
      />

      {showShiftModal && <ShiftModal onShift={bulkShift} onClose={() => setShowShiftModal(false)} hasHolidays={Object.keys(state.holidays || {}).length > 0} />}
      {showRecurringModal && <RecurringModal classDays={state.setup.classDays || []} onCreate={addRecurringNotes} onClose={() => setShowRecurringModal(false)} />}

      {conflictData && (
        <ConflictModal
          localState={conflictData.local}
          remoteState={conflictData.remote}
          onOverwrite={handleConflictOverwrite}
          onLoadRemote={handleConflictLoadRemote}
          onCancel={handleConflictCancel}
        />
      )}

      {studentEmbed && !isStudent && (
        <PublishBanner url={studentEmbed} onDismiss={() => setStudentEmbed(null)} />
      )}

      {!isStudent && showActivityLog && (
        <ActivityLog publishHistory={state.publishHistory} onClose={() => setShowActivityLog(false)} />
      )}

      {!isStudent && showSetup && (
        <SetupPanel state={state} updateState={updateState} onImport={importSchedule}
          onExportTemplate={exportSemesterTemplate} onImportTemplate={importSemesterTemplate}
          onConnect={connectCanvas} onRefresh={refreshFromCanvas} refreshing={refreshing}
          onSwitchCourse={switchCourse} onCloneCourse={cloneCourseFrom}
          onClose={() => setShowSetup(false)} />
      )}

      {/* Main schedule grid */}
      <main id="schedule-content" role="main" aria-label="Course schedule"
            className={`planner-shell planner-main ${!isStudent ? 'with-sidebar' : ''}`}
            style={{ maxWidth: 1152, margin: '0 auto' }}>
        <section style={{ minWidth: 0 }}>
          {allDays.length === 0 ? (
            <EmptyState onSetup={() => setShowSetup(true)} isConnected={state.canvas.connected} />
          ) : (
            <ScheduleTable
              allDays={filteredDays} state={state} isStudent={isStudent}
              teachingSet={teachingSet} pendingByDate={pendingByDate}
              draggingId={draggingId}
              autoEditId={autoEditId} clearAutoEdit={() => setAutoEditId(null)}
              onMoveItem={moveItem} onUpdateItem={updateItem} onDeleteItem={deleteItem}
              onDuplicate={duplicateItem} onReorder={reorderOnDay}
              onAddNote={addNoteOnDay} onAddAssignment={startAssignmentCreation}
              onAddQuiz={startQuizCreation}
              onAddExtraDay={addExtraDay} onRemoveExtraDay={removeExtraDay}
              onToggleHoliday={toggleHoliday} onAddModule={addModuleHeader}
              onRemoveModule={removeModuleHeader}
              onShowRecurringModal={() => setShowRecurringModal(true)}
              allDaysSet={allDaysSet}
              assignmentGroups={state.canvas.assignmentGroups || {}}
            />
          )}
        </section>

        {!isStudent && (
          <aside>
            <div style={{ fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted, marginBottom: 8 }}>
              Unscheduled
            </div>
            <UnscheduledZone
              items={state.unscheduled.map((id) => state.items[id]).filter(Boolean)}
              canvas={state.canvas}
              assignmentGroups={state.canvas.assignmentGroups || {}}
              onMoveItem={moveItem} onUpdateItem={updateItem} onDeleteItem={deleteItem}
              draggingId={draggingId}
              autoEditId={autoEditId} clearAutoEdit={() => setAutoEditId(null)}
            />
          </aside>
        )}
      </main>

      {/* Toast */}
      <div role="status" aria-live="polite" aria-atomic="true"
        style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: toast ? (toast.kind === 'err' ? T.ox : T.ink) : 'transparent',
          color: '#fff',
          padding: toast ? '10px 18px' : 0, borderRadius: 4, fontSize: '13px',
          fontFamily: FONT_BODY, boxShadow: toast ? '0 6px 24px rgba(26,20,16,0.18)' : 'none',
          zIndex: 50, maxWidth: 'calc(100vw - 32px)', textAlign: 'center',
          pointerEvents: toast ? 'auto' : 'none',
          opacity: toast ? 1 : 0, transition: 'opacity 200ms',
        }}>
        {toast?.msg || ''}
      </div>

      <footer style={{
        maxWidth: 1152, margin: '0 auto', padding: '24px 16px', textAlign: 'center',
        color: T.faint, fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.1em',
      }}>
        Saved locally · {Object.keys(state.items).length} items · {state.extraDays.length} added dates
        {state.pendingCreations.length > 0 && ` · ${state.pendingCreations.length} pending`}
      </footer>
    </div>

    <DragOverlay dropAnimation={null}>
      {activeDragItem ? <DragOverlayCard item={activeDragItem} /> : null}
    </DragOverlay>
    </DndContext>
  );
}
