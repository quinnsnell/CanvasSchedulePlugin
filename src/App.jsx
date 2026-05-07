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
  localDateStr, generateICal, exportTemplate, importTemplate, Store,
} from './utils.js';
import { CanvasAPI } from './canvas-api.js';
import renderScheduleHtml from './render-schedule-html.js';
import Header from './components/Header.jsx';
import ScheduleTable from './components/ScheduleTable.jsx';
import { PublishBanner, ActivityLog } from './components/PublishBanner.jsx';
import UnscheduledZone from './components/UnscheduledZone.jsx';
import { DragOverlayCard } from './components/ItemCard.jsx';
import { SetupPanel, ShiftModal, ConflictModal, RecurringModal, EmptyState } from './components/Panels.jsx';
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
  const [filterGroup, setFilterGroup] = useState(null);
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
    setTimeout(() => setToast(null), 2400);
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
    const hasGroupFilter = filterGroup !== null;
    if (!hasSearch && !hasGroupFilter) return allDays;
    const q = hasSearch ? searchQuery.trim().toLowerCase() : '';
    return allDays.filter((d) => {
      const ids = state.schedule[d] || [];
      if (hasGroupFilter && !hasSearch) {
        return ids.some((id) => {
          const item = state.items[id];
          if (!item) return false;
          if (item.type !== 'assign') return true;
          return item.groupId === filterGroup;
        });
      }
      return ids.some((id) => {
        const item = state.items[id];
        if (!item) return false;
        if (hasGroupFilter && item.type === 'assign' && item.groupId !== filterGroup) return false;
        if (hasSearch) {
          if (item.title && item.title.toLowerCase().includes(q)) return true;
          if (item.html && item.html.replace(/<[^>]*>/g, '').toLowerCase().includes(q)) return true;
          return false;
        }
        return true;
      });
    });
  }, [allDays, searchQuery, filterGroup, state]);

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
        setUndoStack((stack) => [...stack.slice(-29), structuredClone(s)]);
        setRedoStack([]);
      }
      return fn(structuredClone(s));
    });
  };

  const undo = () => {
    if (undoStack.length === 0) return;
    setState((current) => {
      setRedoStack((rStack) => [...rStack.slice(-29), structuredClone(current)]);
      return undoStack[undoStack.length - 1];
    });
    setUndoStack((stack) => stack.slice(0, -1));
    showToast('Undone');
  };
  undoRef.current = undo;

  const redo = () => {
    if (redoStack.length === 0) return;
    setState((current) => {
      setUndoStack((uStack) => [...uStack.slice(-29), structuredClone(current)]);
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

  // ── Day management ─────────────────────────────────────────────

  const addExtraDay = (date) => {
    updateState((s) => {
      if (!s.extraDays.includes(date)) s.extraDays.push(date);
      return s;
    });
    showToast(`Added ${fmtMonthDay(date)} to schedule`);
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
          return s;
        });
        const itemCount = Object.keys(result.items).length;
        showToast(`Imported template: ${itemCount} items across ${mapped} days`);
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

  const deleteItem = (id) => {
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
      const html = renderScheduleHtml(s);
      const slug = await CanvasAPI.publishPage(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, 'Schedule', html);
      const pageUrl = `${s.canvas.baseUrl.replace(/\/+$/, '')}/courses/${s.canvas.courseId}/pages/${slug}`;
      setStudentEmbed(pageUrl);
      setLastPublishedUrl(pageUrl);
      try { localStorage.setItem('planner-last-published-url', pageUrl); } catch {}
      setTimeout(() => setStudentEmbed(null), 12000);
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
        s.items[id] = { id, type: 'assign', title: a.name, points: a.points_possible || 0, canvasId: a.id, htmlUrl: a.html_url, dueDate: due, groupId: a.assignment_group_id || null };
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
        s.items[id] = { id, type: 'assign', title: a.name, points: a.points_possible || 0, canvasId: a.id, htmlUrl: a.html_url, dueDate: due, groupId: a.assignment_group_id || null };
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
        filterGroup={filterGroup} onFilterGroupChange={setFilterGroup}
        assignmentGroups={state.canvas.assignmentGroups || {}}
        darkMode={darkMode} undoStack={undoStack} redoStack={redoStack}
        onToggleDark={() => setDarkMode((d) => !d)}
        onToggleStudent={() => updateState((s) => { s.studentView = !s.studentView; return s; })}
        onUndo={undo} onRedo={redo} onExportICal={exportICal}
        onShowShiftModal={() => setShowShiftModal(true)}
        onShowRecurringModal={() => setShowRecurringModal(true)}
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
          onSwitchCourse={switchCourse}
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
              onAddExtraDay={addExtraDay} onRemoveExtraDay={removeExtraDay}
              onToggleHoliday={toggleHoliday} onAddModule={addModuleHeader}
              onRemoveModule={removeModuleHeader}
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
