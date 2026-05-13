/**
 * ClassPlannerApp — top-level component and state orchestrator.
 *
 * Owns application state via useUndoableState (items, schedule, canvas
 * connection, etc.). Delegates business logic to services and rendering
 * to focused component modules:
 *
 *   State + UX hooks
 *     hooks/use-undoable-state — state + undo/redo stacks + updateState
 *     hooks/use-toast          — auto-dismiss toast banner
 *
 *   Services (factory-bound to deps via useMemo)
 *     services/canvas-sync   — connectCanvas, switchCourse,
 *                              syncFromCanvas, refreshFromCanvas
 *     services/course-clone  — cloneCourseFrom + helpers
 *
 *   Rendering
 *     components/Header, ScheduleTable, ClassDayRow, ItemCard,
 *     UnscheduledZone, PublishBanner, RichEditor
 *     components/panels/{SetupPanel, ShiftModal, ConflictModal,
 *                        RecurringModal, EmptyState, CloneWarnings}
 *
 *   Pure utilities (split by concern under src/utils/)
 *     dates, ical, csv, template, link-rewrite, store, uid, debug
 *
 * Tunable constants live in src/config.js.
 * State shape: see CLAUDE.md § Data model.
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { flushSync } from 'react-dom';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import { T, setTheme, FONT_BODY, FONT_MONO } from './theme.js';
import {
  DAY_CODES, PENDING_TTL_MS, uid,
  generateClassDays, computeAllDays,
  weekNumber, addDays, fmtMonthDay,
  generateICal, exportTemplate, importTemplate, Store,
} from './utils.js';
import { CanvasAPI, uploadIcalFeed } from './canvas-api.js';
import { debugLog } from './utils/debug.js';
import useToast from './hooks/use-toast.js';
import useUndoableState from './hooks/use-undoable-state.js';
import { createCanvasSync, applyCourseInfo } from './services/canvas-sync.js';
import { createCourseClone } from './services/course-clone.js';
import { PUBLISH_BANNER_DISMISS_MS } from './config.js';
import renderScheduleHtml from './render-schedule-html.js';
import Header from './components/Header.jsx';
import ScheduleTable from './components/ScheduleTable.jsx';
import MonthCalendar from './components/MonthCalendar.jsx';
import UnpublishedBadge from './components/UnpublishedBadge.jsx';
import { PublishBanner, ActivityLog } from './components/PublishBanner.jsx';
import UnscheduledZone from './components/UnscheduledZone.jsx';
import ModuleSidebar from './components/ModuleSidebar.jsx';
import { DragOverlayCard } from './components/ItemCard.jsx';
import { SetupPanel, ShiftModal, ConflictModal, RecurringModal, EmptyState } from './components/panels/index.js';
import { appStyles } from './styles.js';

// ── Parent-frame course detection ───────────────────────────────
//
// When the planner is iframe-embedded in a Canvas page, the parent
// URL is e.g. https://<canvas-host>/courses/<courseId>/pages/<slug>.
// document.referrer is the parent's URL at iframe load time and is
// cross-origin-readable (subject to the parent's referrer-policy,
// but Canvas's default allows same-protocol referrers). Pull the
// courseId out so each Canvas course's iframe auto-selects itself
// — instructors paste one iframe HTML snippet everywhere without
// per-course customization.
//
// An explicit ?courseId=<n> URL parameter overrides referrer detection
// for cases where someone wants to pin the iframe to a specific course
// regardless of where it's embedded.
function detectParentCourseId() {
  try {
    const p = new URLSearchParams(window.location.search).get('courseId');
    if (p && /^\d+$/.test(p)) return p;
  } catch { /* ignore */ }
  try {
    const m = (document.referrer || '').match(/\/courses\/(\d+)(?:\/|$)/);
    if (m) return m[1];
  } catch { /* ignore */ }
  return null;
}

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

// ══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════

export default function ClassPlannerApp() {
  // ── Core state ─────────────────────────────────────────────────
  const {
    state, setState, updateState,
    undo: undoState, redo: redoState,
    undoStack, redoStack,
  } = useUndoableState(null);
  const [loaded, setLoaded] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [toast, showToast] = useToast();
  const [draggingId, setDraggingId] = useState(null);
  const [autoEditId, setAutoEditId] = useState(null);
  const [studentEmbed, setStudentEmbed] = useState(null);
  const [lastPublishedUrl, setLastPublishedUrl] = useState(() => {
    try { return localStorage.getItem('planner-last-published-url') || null; } catch { return null; }
  });
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [conflictData, setConflictData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // 'linear' = scrollable day-row table; 'month' = read-only month grids.
  // Persisted in localStorage so it survives reload.
  const [viewMode, setViewMode] = useState(() => {
    try { return localStorage.getItem('planner-view-mode') || 'linear'; } catch { return 'linear'; }
  });
  useEffect(() => {
    try { localStorage.setItem('planner-view-mode', viewMode); } catch {}
  }, [viewMode]);

  // Force linear view before print — month grids look fine on screen but
  // the linear day-row table is what the print stylesheet is tuned for.
  // flushSync ensures the re-render commits before the print dialog opens.
  useEffect(() => {
    const handler = () => flushSync(() => setViewMode('linear'));
    window.addEventListener('beforeprint', handler);
    return () => window.removeEventListener('beforeprint', handler);
  }, []);
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
      // Prefer the courseId inferred from the parent Canvas page's URL
      // (when iframe-embedded). Falls back to whatever the user last
      // selected in this browser via meta. Either way it's the courseId
      // we use to look up per-course saved state.
      const detectedCourseId = detectParentCourseId();
      const courseId = detectedCourseId || meta?.courseId || '';
      const saved = await Store.load(courseId);
      const init = saved || freshState();
      if (!init.pendingCreations) init.pendingCreations = [];

      // Restore canvas credentials from shared meta. courseId honors
      // detection over meta so the iframe self-selects its host course
      // even when meta was last saved for a different one.
      if (meta && !init.canvas.connected && meta.baseUrl && meta.token) {
        init.canvas.baseUrl = meta.baseUrl;
        init.canvas.token = meta.token;
        init.canvas.courseId = courseId;
        init.canvas.courses = meta.courses || [];
        init.canvas.connected = meta.connected || false;
      } else if (detectedCourseId) {
        // No meta yet, but we know what course we're inside — pin it
        // so the user only needs to enter their PAT to be ready.
        init.canvas.courseId = detectedCourseId;
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
            // Prefer detected parent course over saved meta (same logic
            // as initial load — keeps the auto-reconnect path in sync).
            const targetCourseId = detectedCourseId || meta.courseId;
            if (targetCourseId) {
              s.canvas.courseId = targetCourseId;
              const course = s.canvas.courses.find((c) => String(c.id) === String(targetCourseId));
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

  // ── Service factories ──────────────────────────────────────────
  // These useMemo calls MUST run before the loading-screen early
  // return below — every hook has to fire on every render, or React
  // throws "Rendered more hooks than during the previous render."

  const syncRef = useRef(null);

  const canvasSync = useMemo(
    () => createCanvasSync({ stateRef, updateState, setState, showToast, setRefreshing, freshState }),
    [updateState, setState, showToast]
  );
  const { connectCanvas, switchCourse, syncFromCanvas, refreshFromCanvas } = canvasSync;
  syncRef.current = syncFromCanvas;

  const courseClone = useMemo(
    () => createCourseClone({ stateRef, updateState, showToast }),
    [updateState, showToast]
  );
  const { cloneCourseFrom } = courseClone;

  // ── Window focus: sync pending assignment creations ─────────────
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

    // Module pill drag (id prefix `module:<canvasId>`). Place a marker
    // on the target date; the existing string-vs-object handling in
    // `moduleTitle()` treats this as Canvas-sourced.
    if (typeof activeId === 'string' && activeId.startsWith('module:')) {
      const moduleData = active.data?.current;
      // Resolve target date from multiple shapes of `over`:
      //  - Day droppable (data: { type:'day', date })
      //  - Day droppable id `day:<date>`
      //  - Dropped on an item card → look up which day owns that item
      let targetDate = null;
      if (over.data?.current?.type === 'day') {
        targetDate = over.data.current.date;
      } else if (typeof overId === 'string' && overId.startsWith('day:')) {
        targetDate = overId.slice(4);
      } else {
        // Dropped on a sortable item — find which day contains it.
        targetDate = findItemContainer(overId);
        if (targetDate === 'unscheduled') targetDate = null;
      }
      if (!targetDate || !moduleData) return;
      setState((prev) => {
        const next = structuredClone(prev);
        if (!next.modules) next.modules = {};
        // Drop any prior placement of this same Canvas module so it
        // can only appear in one place at a time.
        Object.keys(next.modules).forEach((d) => {
          const v = next.modules[d];
          if (v && typeof v === 'object' && v.canvasModuleId === moduleData.moduleId) {
            delete next.modules[d];
          }
        });
        next.modules[targetDate] = {
          title: moduleData.moduleName,
          canvasModuleId: moduleData.moduleId,
        };
        return next;
      });
      return;
    }

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

  // Has the schedule been edited since the last publish? Drives the
  // floating UnpublishedBadge. Uses the monotonic version counter from
  // useUndoableState — no timestamp races.
  const isDirty = useMemo(() => {
    if (!state) return false;
    if (Object.keys(state.items || {}).length === 0) return false;
    const v = state.version || 0;
    const pv = state.publishedVersion;
    if (pv == null) return v > 0; // never published, but has content
    return v !== pv;
  }, [state]);

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

  // Wrap the hook's undo/redo with toast feedback. Check stack depth
  // before firing so the toast doesn't appear when there's nothing to do.
  const undo = () => {
    if (undoStack.length === 0) return;
    undoState();
    showToast('Undone');
  };
  undoRef.current = undo;

  const redo = () => {
    if (redoStack.length === 0) return;
    redoState();
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
        // Compress/expand mode already accounts for the week-count mismatch;
        // only warn when literal mode would drop trailing weeks.
        if (result.mode === 'literal' && template.totalTeachingDays > newTeachingDays.length) {
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
        const modeNote = result.mode === 'compress'
          ? ' (compressed: source teaching days mapped linearly across the shorter term)'
          : result.mode === 'expand'
            ? ' (expanded — alternating target weeks left blank)'
            : '';
        showToast(`Imported template: ${itemCount} items across ${mapped} days${extraNote}${modeNote}`);
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
    // Sync dueTime changes by re-pushing the full due_at. Skips if the
    // item has no date — Canvas only accepts due_at as a datetime, and
    // there's no useful "time but no date" semantics.
    if ('dueTime' in patch && item?.canvasId && item?.dueDate &&
        state.canvas.connected && state.canvas.courseId) {
      const due = new Date(`${item.dueDate}T${patch.dueTime || '23:59'}:00`).toISOString();
      CanvasAPI.setDueDate(
        state.canvas.baseUrl, state.canvas.token, state.canvas.courseId, item.canvasId, due
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
        const due = new Date(`${toDate}T${item.dueTime || '23:59'}:00`).toISOString();
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
      // Generate the .ics once and upload it to two places:
      //   1. The Cloudflare Worker KV (if upload secret is configured) —
      //      gives a *truly public* feed URL that calendar apps can poll
      //      for auto-updates. This is the preferred student-facing link.
      //   2. Canvas Files — fallback download/import link for when the
      //      worker isn't configured. Auth-gated, so not pollable but at
      //      least permanent.
      const icsText = generateICal(s);
      let icalUrl = null;          // presigned Canvas URL (instructor banner)
      let icalDownloadUrl = null;  // stable Canvas Files URL (fallback)
      let icalFeedUrl = null;      // public worker feed (preferred subscribe URL)
      let feedResult = null;
      try {
        feedResult = await uploadIcalFeed(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, icsText);
        if (feedResult?.ok) icalFeedUrl = feedResult.url;
      } catch (e) { feedResult = { ok: false, reason: `threw: ${e.message}` }; }
      try {
        await CanvasAPI.uploadIcal(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, icsText);
        [icalUrl, icalDownloadUrl] = await Promise.all([
          CanvasAPI.getPublicIcalUrl(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId),
          CanvasAPI.getIcalDownloadUrl(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId),
        ]);
      } catch (e) {
        // Don't fail the whole publish if iCal upload fails — the JSON
        // is the primary artifact, the iCal is a nice-to-have.
        // eslint-disable-next-line no-console
        console.warn('iCal upload failed:', e.message);
      }
      // Prefer the public feed URL when available; the auth-gated Canvas
      // link is a one-shot-import fallback only.
      const studentIcalUrl = icalFeedUrl || icalDownloadUrl;
      const publishData = {
        setup: s.setup, items: s.items, schedule: s.schedule,
        extraDays: s.extraDays, unscheduled: s.unscheduled,
        holidays: s.holidays || {}, modules: s.modules || {},
        publishHistory: [...prevHistory, historyEntry],
        publishedAt: now,
        icalUrl: studentIcalUrl,
      };
      await CanvasAPI.uploadSchedule(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, publishData);
      updateState((st) => {
        st.publishHistory = [...(st.publishHistory || []), historyEntry];
        st.loadedAt = now;
        // Snapshot the version at publish time. UnpublishedBadge compares
        // current state.version to this — different = unpublished edits.
        st.publishedVersion = st.version || 0;
        // Persist the iCal URL so the in-app planner (including student
        // view) can surface it across reloads. Worker feed wins when set.
        if (studentIcalUrl) st.icalUrl = studentIcalUrl;
        return st;
      }, true);
      const html = renderScheduleHtml({ ...s, icalUrl: studentIcalUrl }, s.setup.courseTitle);
      const slug = await CanvasAPI.publishPage(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, 'Schedule', html);
      const pageUrl = `${s.canvas.baseUrl.replace(/\/+$/, '')}/courses/${s.canvas.courseId}/pages/${slug}`;
      setStudentEmbed({ pageUrl, icalUrl });
      setLastPublishedUrl(pageUrl);
      try { localStorage.setItem('planner-last-published-url', pageUrl); } catch {}
      setTimeout(() => setStudentEmbed(null), PUBLISH_BANNER_DISMISS_MS);
      if (feedResult?.ok) {
        showToast('Published schedule + calendar feed updated');
      } else if (feedResult && !feedResult.ok) {
        // Surface the actual reason so misconfigured workers / auth
        // problems don't fail silently. The fallback Canvas link still
        // works, just without the auto-update behavior.
        // eslint-disable-next-line no-console
        console.warn('[iCal feed]', feedResult);
        showToast(`Published, but calendar feed: ${feedResult.reason}`, 'err');
      } else {
        showToast('Published schedule to Canvas');
      }
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

  // ══════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════

  const isStudent = state.studentView;
  const activeDragItem = draggingId ? state.items[draggingId] : null;
  // For module-pill drags, look up the name to render in the overlay.
  const activeDragModule = (typeof draggingId === 'string' && draggingId.startsWith('module:'))
    ? (state.canvas?.modules || []).find((m) => `module:${m.id}` === draggingId)
    : null;

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
        <PublishBanner
          url={studentEmbed.pageUrl}
          icalUrl={studentEmbed.icalUrl}
          onDismiss={() => setStudentEmbed(null)} />
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
            data-printed-on={new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            style={{ maxWidth: 1152, margin: '0 auto' }}>
        <section style={{ minWidth: 0 }}>
          {allDays.length === 0 ? (
            <EmptyState onSetup={() => setShowSetup(true)} isConnected={state.canvas.connected} />
          ) : (
            <>
              <div className="view-toggle no-print" style={{ display: 'flex', gap: 4, marginBottom: 12, fontFamily: FONT_MONO, fontSize: 11 }}>
                {['linear', 'month'].map((mode) => (
                  <button key={mode}
                    onClick={() => setViewMode(mode)}
                    aria-pressed={viewMode === mode}
                    style={{
                      padding: '4px 10px', borderRadius: 3,
                      border: `1px solid ${viewMode === mode ? T.inkBlue : T.border}`,
                      background: viewMode === mode ? T.inkBlueSoft : T.paper,
                      color: viewMode === mode ? T.inkBlue : T.muted,
                      cursor: 'pointer', textTransform: 'capitalize',
                    }}>
                    {mode === 'linear' ? 'List' : 'Month'}
                  </button>
                ))}
              </div>
              {viewMode === 'month' ? (
                <MonthCalendar
                  state={state}
                  allDays={allDays}
                  onDayClick={(date) => {
                    setViewMode('linear');
                    // Defer scroll until linear view has rendered. ID is set
                    // on each ClassDayRow's outer div.
                    setTimeout(() => {
                      document.getElementById(`day-${date}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 50);
                  }}
                />
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
            </>
          )}
        </section>

        {!isStudent && (
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {(state.canvas?.modules || []).length > 0 && (
              <ModuleSidebar
                modules={state.canvas.modules}
                placedModules={state.modules || {}}
                isStudent={isStudent}
              />
            )}
            <div>
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
            </div>
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

      {!isStudent && state.canvas.connected && state.canvas.courseId && isDirty && (
        <UnpublishedBadge publishing={publishing} onPublish={publishToCanvas} />
      )}
    </div>

    <DragOverlay dropAnimation={null}>
      {activeDragItem ? (
        <DragOverlayCard item={activeDragItem} />
      ) : activeDragModule ? (
        <div style={{
          background: T.paper, border: `1px solid ${T.border}`,
          borderLeft: `3px solid ${T.inkBlue}`, borderRadius: 3,
          padding: '4px 10px',
          fontFamily: FONT_MONO, fontSize: 11, color: T.ink,
          boxShadow: '0 8px 24px rgba(26,20,16,0.18)',
          maxWidth: 240, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{activeDragModule.name}</div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}
