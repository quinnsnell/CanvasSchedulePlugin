/**
 * ClassPlannerApp — main component and state orchestrator.
 *
 * Owns all application state (schedule, items, canvas connection, undo stack).
 * Delegates rendering to focused component modules:
 *   ClassDayRow, ItemCard, UnscheduledZone, Panels (Setup, Canvas, Shift, Empty).
 *
 * State shape:
 *   setup:    { courseTitle, startDate, endDate, classDays }
 *   canvas:   { baseUrl, token, courseId, connected, courses }
 *   items:    { [id]: { id, type, title?, points?, canvasId?, html?, ... } }
 *   schedule: { 'YYYY-MM-DD': [itemId, ...] }
 *   extraDays, unscheduled, holidays, modules, pendingCreations, studentView
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
} from '@dnd-kit/core';
import {
  X, Eye, EyeOff, Settings, RefreshCw,
  Cloud, CloudOff, Upload, Calendar, History, Link2, Check,
  Undo2, Redo2, ChevronRight, Printer, CalendarDays, Sun, Moon, Search, Repeat,
} from 'lucide-react';
import { T, LIGHT, DARK, setTheme, FONT_DISPLAY, FONT_BODY, FONT_MONO, GROUP_COLORS } from './theme.js';
import {
  DAY_CODES, DAY_FULL, PENDING_TTL_MS, uid,
  generateClassDays, computeAllDays, getAddableDatesAfter,
  weekKey, weekNumber, addDays, fmtMonthDay, fmtFull,
  localDateStr, generateICal, parseICal, parseCSV, Store,
} from './utils.js';
import { CanvasAPI } from './canvas-api.js';
import { IconButton, ToggleButton, inputStyle } from './components/ui.jsx';
import ClassDayRow from './components/ClassDayRow.jsx';
import UnscheduledZone from './components/UnscheduledZone.jsx';
import { DragOverlayCard } from './components/ItemCard.jsx';
import { SetupPanel, CanvasPanel, ShiftModal, ConflictModal, RecurringModal, EmptyState } from './components/Panels.jsx';

// ── Initial state (blank — no demo data) ───────────────────────

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

// ════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════

export default function ClassPlannerApp() {
  // ── Core state ───────────────────────────────────────────────
  const [state, setState] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);
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

  // ── dnd-kit sensors (pointer + touch + keyboard) ────────────
  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 5 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { distance: 5 } });
  const keyboardSensor = useSensor(KeyboardSensor);
  const sensors = useSensors(pointerSensor, touchSensor, keyboardSensor);

  // Apply theme palette before rendering
  setTheme(darkMode);
  useEffect(() => {
    try { localStorage.setItem('planner-dark-mode', darkMode); } catch {}
  }, [darkMode]);

  // ── Initialization ───────────────────────────────────────────
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
          // Token expired — user will need to re-enter credentials
          setState((prev) => ({ ...structuredClone(prev), canvas: { ...prev.canvas, connected: false } }));
        }
      }
    })();
  }, []);

  // ── Auto-save on every state change ──────────────────────────
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

  // ── Toast notifications ──────────────────────────────────────
  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2400);
  };

  // ── Derived data ─────────────────────────────────────────────
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

  // ── Search filter: only show days whose items match the query ──
  const filteredDays = useMemo(() => {
    const hasSearch = searchQuery.trim().length > 0;
    const hasGroupFilter = filterGroup !== null;
    if (!hasSearch && !hasGroupFilter) return allDays;
    const q = hasSearch ? searchQuery.trim().toLowerCase() : '';
    return allDays.filter((d) => {
      const ids = state.schedule[d] || [];
      // When group filtering, show days that have at least one item matching the group
      // (or any non-assign items — we don't hide rich notes when filtering by group)
      if (hasGroupFilter && !hasSearch) {
        return ids.some((id) => {
          const item = state.items[id];
          if (!item) return false;
          if (item.type !== 'assign') return true; // keep rich notes visible
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

  // ── Keyboard: Ctrl/Cmd+Z for undo, Ctrl/Cmd+Shift+Z for redo ──
  // Uses refs so the effect doesn't capture stale closures
  const undoRef = useRef(null);
  const redoRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.contentEditable === 'true') return;
      e.preventDefault();
      if (e.shiftKey) {
        redoRef.current?.();
      } else {
        undoRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Window focus: sync pending assignment creations ──────────
  const syncRef = useRef(null);
  useEffect(() => {
    const onFocus = () => {
      const s = stateRef.current;
      if (!s) return;
      // Expire old pending creations
      const now = Date.now();
      const fresh = (s.pendingCreations || []).filter((p) => now - p.time < PENDING_TTL_MS);
      if (fresh.length !== (s.pendingCreations || []).length) {
        setState((prev) => ({ ...prev, pendingCreations: fresh }));
      }
      // If pending creations exist, trigger a Canvas sync
      if (fresh.length > 0 && s.canvas.connected && s.canvas.courseId) {
        syncRef.current();
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // ── dnd-kit: find which day (or 'unscheduled') an item lives on ──
  const findItemContainer = useCallback((itemId) => {
    const s = stateRef.current;
    if (!s) return null;
    if (s.unscheduled.includes(itemId)) return 'unscheduled';
    for (const [date, ids] of Object.entries(s.schedule)) {
      if (ids.includes(itemId)) return date;
    }
    return null;
  }, []);

  // ── dnd-kit event handlers ──────────────────────────────────
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

    if (sourceContainer === targetContainer && sourceContainer !== 'unscheduled') {
      const arr = s.schedule[sourceContainer] || [];
      const oldIndex = arr.indexOf(activeId);
      const newIndex = arr.indexOf(overId);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        // Inline reorder to avoid dependency on reorderOnDay
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
      // Remove from source
      if (sourceContainer === 'unscheduled') {
        next.unscheduled = next.unscheduled.filter((id) => id !== activeId);
      } else if (next.schedule[sourceContainer]) {
        next.schedule[sourceContainer] = next.schedule[sourceContainer].filter((id) => id !== activeId);
        if (next.schedule[sourceContainer].length === 0) delete next.schedule[sourceContainer];
      }
      // Add to target
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

  // ── Loading screen ───────────────────────────────────────────
  if (!loaded || !state) {
    return (
      <div style={{ minHeight: '100vh', background: T.cream, fontFamily: FONT_BODY, color: T.muted }}
           className="flex items-center justify-center">
        <div className="text-sm">Loading planner…</div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // STATE MUTATION HELPERS (defined after early return)
  // ════════════════════════════════════════════════════════════

  /** Update state with undo snapshot. Pass skipUndo=true for non-undoable changes. */
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

  // ── Item creation ────────────────────────────────────────────

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
    const matching = teachingDays.filter((d) => {
      const dow = new Date(d + 'T12:00:00').getDay();
      const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
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
      setShowCanvas(true);
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

  // ── Day management ───────────────────────────────────────────

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

  // ── Reorder, duplicate, holidays, modules ────────────────────

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

  // ── Bulk date shift ──────────────────────────────────────────

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
        // Holiday-aware shift: move items to the Nth non-holiday teaching day
        const allDaysArr = computeAllDays(s.setup, s.extraDays);
        const holidaySet = new Set(Object.keys(s.holidays || {}));

        // Build ordered list of eligible (non-holiday) days
        const eligible = allDaysArr.filter((d) => !holidaySet.has(d));

        const shiftDate = (date) => {
          const idx = eligible.indexOf(date);
          if (idx === -1) {
            // Date not in eligible list; fall back to calendar-day shift
            return addDays(date, days);
          }
          const target = idx + days;
          if (target < 0) return eligible[0];
          if (target >= eligible.length) return eligible[eligible.length - 1];
          return eligible[target];
        };

        // Remap schedule dates — holidays and semester bounds stay fixed
        const newSchedule = {};
        Object.keys(s.schedule).forEach((d) => {
          newSchedule[shiftDate(d)] = s.schedule[d];
        });
        s.schedule = newSchedule;

        if (s.modules) {
          const newModules = {};
          Object.keys(s.modules).forEach((d) => {
            newModules[shiftDate(d)] = s.modules[d];
          });
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

  // ── iCal export ──────────────────────────────────────────────

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

  // ── Import schedule from iCal/CSV ───────────────────────────

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

  // ── Course switching ─────────────────────────────────────────

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

  // ── Item edits ───────────────────────────────────────────────

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
    // Sync title renames to Canvas in the background
    const item = state.items[id];
    if (patch.title && item?.canvasId && state.canvas.connected && state.canvas.courseId) {
      CanvasAPI.renameAssignment(
        state.canvas.baseUrl, state.canvas.token, state.canvas.courseId, item.canvasId, patch.title
      ).catch(() => {});
    }
  };

  // ── Move item between days ───────────────────────────────────

  const moveItem = async (id, toDate, position) => {
    let canvasError = null;
    let didCanvasSync = false;
    const willAutoAddDay = toDate && !allDaysSet.has(toDate);

    updateState((s) => {
      // Remove from current location
      s.unscheduled = s.unscheduled.filter((x) => x !== id);
      Object.keys(s.schedule).forEach((d) => {
        s.schedule[d] = s.schedule[d].filter((x) => x !== id);
        if (s.schedule[d].length === 0) delete s.schedule[d];
      });
      // Place at new location
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

    // Sync due date to Canvas if applicable
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

  // ── Publish to Canvas ────────────────────────────────────────

  /** Inner publish: performs the actual upload without conflict checking. */
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

  /** Outer publish: checks for conflicts first, then delegates to doPublish. */
  const publishToCanvas = async () => {
    const s = stateRef.current;
    if (!s?.canvas?.connected || !s.canvas.courseId) {
      showToast('Connect to Canvas and pick a course first', 'err');
      return;
    }
    setPublishing(true);
    try {
      // Conflict detection: check if another instructor published since our last load
      const remote = await CanvasAPI.downloadSchedule(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId).catch(() => null);
      if (remote?.publishedAt && s.loadedAt && remote.publishedAt > s.loadedAt) {
        // Show conflict resolution modal instead of blocking confirm dialog
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

  // ── Conflict resolution handlers ──────────────────────────────

  const handleConflictOverwrite = () => {
    setConflictData(null);
    doPublish();
  };

  const handleConflictLoadRemote = () => {
    const remote = conflictData?.remote;
    setConflictData(null);
    if (!remote) return;
    // Merge remote schedule data into current state, preserving canvas connection
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

  /** Copy the published Canvas page URL to clipboard, or prompt to publish first. */
  const copyShareLink = async () => {
    const url = lastPublishedUrl;
    if (!url) {
      showToast('Publish the schedule to Canvas first to get a shareable link', 'err');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied — share with TAs and students');
    } catch {
      // Fallback for older browsers or permission issues
      showToast('Could not copy — try copying from the address bar', 'err');
    }
  };

  // ── Canvas connect / sync / refresh ──────────────────────────

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
   * Light sync — merge new Canvas assignments into state without clearing.
   * Triggered by window focus when pending assignment creations exist.
   */
  const syncFromCanvas = async () => {
    const s0 = stateRef.current;
    if (!s0?.canvas?.connected || !s0.canvas.courseId) return;
    let list;
    try {
      list = await CanvasAPI.listAssignments(s0.canvas.baseUrl, s0.canvas.token, s0.canvas.courseId);
    } catch { return; }

    // Match new Canvas assignments to pending creations (FIFO)
    const pending = [...(s0.pendingCreations || [])].sort((a, b) => a.time - b.time);
    const claimedPending = new Set();
    const patchPromises = [];

    updateState((s) => {
      let added = 0;
      const teachingNow = new Set(generateClassDays(s.setup.startDate, s.setup.endDate, s.setup.classDays));

      list.forEach((a) => {
        // Skip assignments we already have
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

        // If no due date, try to claim a pending creation and assign its date
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

  /**
   * Full reload — download published schedule from Canvas files,
   * then merge current Canvas assignments on top.
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

    // Build assignment groups map with cycling colors
    const groupsMap = {};
    (Array.isArray(groups) ? groups : []).forEach((g, i) => {
      groupsMap[g.id] = { id: g.id, name: g.name, color: GROUP_COLORS[i % GROUP_COLORS.length] };
    });

    updateState((s) => {
      s.canvas.assignmentGroups = groupsMap;
      // Start from published schedule if available
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

      // Merge Canvas assignments on top of the published schedule
      list.forEach((a) => {
        const existing = Object.values(s.items).find((it) => it.type === 'assign' && it.canvasId === a.id);
        if (existing) {
          existing.title = a.name;
          existing.points = a.points_possible || 0;
          existing.htmlUrl = a.html_url;
          if (a.assignment_group_id) existing.groupId = a.assignment_group_id;
          // Relocate if Canvas due date changed since last sync
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

        // Brand-new assignment from Canvas
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

  // ════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════

  const isStudent = state.studentView;

  // Active drag item for overlay
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
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Geist:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        .planner-card a { color: ${T.inkBlue}; text-decoration: underline; text-underline-offset: 2px; }
        .planner-rich p { margin: 0 0 0.4rem 0; }
        .planner-rich p:last-child { margin-bottom: 0; }
        .planner-rich ul, .planner-rich ol { margin: 0.2rem 0 0.4rem 1.2rem; }
        .planner-rich [contenteditable="true"]:focus { outline: 2px solid ${T.inkBlue}; outline-offset: 2px; border-radius: 3px; }
        .drop-target-active { background: ${T.inkBlueSoft} !important; }
        .item-dragging { opacity: 0.4; }

        /* Responsive layouts */
        .planner-shell { padding: 16px; }
        .planner-main { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
        @media (min-width: 640px)  { .planner-shell { padding: 24px; } }
        @media (min-width: 1024px) { .planner-main.with-sidebar { grid-template-columns: 1fr 280px; } }

        .day-row { display: grid; grid-template-columns: 92px 1fr; }
        @media (min-width: 640px) { .day-row { grid-template-columns: 170px 1fr; } }

        .date-col { padding: 10px 10px 12px; border-right: 1px solid ${T.border}; position: relative; }
        @media (min-width: 640px) { .date-col { padding: 14px 16px; } }

        .date-num { font-family: ${FONT_DISPLAY}; font-weight: 500; color: ${T.ink}; letter-spacing: -0.01em; line-height: 1.1; font-size: 16px; }
        @media (min-width: 640px) { .date-num { font-size: 20px; } }

        .date-day { font-family: ${FONT_MONO}; font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: ${T.muted}; margin-top: 2px; }
        @media (min-width: 640px) { .date-day { font-size: 10px; } }

        .planner-title { font-family: ${FONT_DISPLAY}; font-weight: 600; letter-spacing: -0.01em; line-height: 1.1; font-size: 22px; }
        @media (min-width: 640px) { .planner-title { font-size: 32px; } }

        .planner-header { padding: 14px 16px; }
        @media (min-width: 640px) { .planner-header { padding: 20px 24px; } }

        .planner-header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

        .col-header { padding: 10px 12px; font-family: ${FONT_MONO}; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: ${T.muted}; }
        @media (min-width: 640px) { .col-header { padding: 10px 16px; font-size: 10px; letter-spacing: 0.2em; } }

        .day-tools { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

        .holiday-row { position: relative; }
        .holiday-row::after {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background: repeating-linear-gradient(135deg, transparent, transparent 8px, rgba(128,128,128,0.06) 8px, rgba(128,128,128,0.06) 16px);
          pointer-events: none;
        }

        .module-header {
          padding: 10px 16px;
          font-family: ${FONT_DISPLAY}; font-size: 16px; font-weight: 600; color: ${T.ink};
          background: ${T.subtle}; border-bottom: 1px solid ${T.border};
          display: flex; align-items: center; justify-content: space-between;
        }

        /* Accessibility */
        button:focus-visible, a:focus-visible, select:focus-visible, input:focus-visible {
          outline: 2px solid ${T.focusRing}; outline-offset: 2px; border-radius: 2px;
        }
        .skip-link {
          position: absolute; top: -40px; left: 0;
          background: ${T.inkBlue}; color: #fff;
          padding: 8px 16px; z-index: 100;
          font-family: ${FONT_BODY}; font-size: 14px;
          text-decoration: none; border-radius: 0 0 4px 0;
        }
        .skip-link:focus { top: 0; }
        .kb-move-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 24px; height: 24px; padding: 0;
          background: ${T.paper}; border: 1px solid ${T.border};
          border-radius: 2px; cursor: pointer; color: ${T.muted};
        }
        .kb-move-btn:hover { background: ${T.subtle}; }

        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            transition-duration: 0.01ms !important;
            animation-duration: 0.01ms !important;
          }
        }

        @media print {
          @page { margin: 0.5in 0.4in; }

          /* Global resets */
          * { color: #000 !important; background: white !important; }
          body { background: white !important; color: #000 !important; font-size: 11pt; }

          /* Hide non-content UI */
          .planner-header-row nav,
          .planner-header-row button,
          footer, aside,
          .skip-link { display: none !important; }
          .day-tools { display: none !important; }
          [title="Drag to move"], .kb-move-btn { display: none !important; }
          .planner-card .flex.flex-col { display: none !important; }
          [role="status"][aria-live="polite"] { display: none !important; }
          [role="dialog"] { display: none !important; }
          .module-header button { display: none !important; }

          /* Keep course title and date range visible */
          header[role="banner"] {
            border-bottom: 2px solid #000 !important;
            padding: 0 0 8px 0 !important;
            margin-bottom: 8px !important;
          }
          .planner-header { padding: 0 !important; }
          .planner-header-row { display: block !important; }
          .planner-title {
            font-size: 16pt !important;
            color: #000 !important;
            margin: 0 0 2px 0 !important;
          }

          /* Full-width layout (no sidebar grid) */
          .planner-shell { padding: 0 !important; max-width: 100% !important; }
          .planner-main { display: block !important; max-width: 100% !important; }
          .planner-main > section { width: 100% !important; }

          /* Schedule table */
          .planner-main > section > div {
            border: 1px solid #000 !important;
            border-radius: 0 !important;
            overflow: visible !important;
          }

          /* Row and card page-break handling */
          .day-row {
            break-inside: avoid;
            page-break-inside: avoid;
            border-bottom: 1px solid #999 !important;
            background: white !important;
          }
          .planner-card {
            break-inside: avoid;
            page-break-inside: avoid;
            box-shadow: none !important;
            border: 1px solid #000 !important;
            border-left: 1px solid #000 !important;
            border-radius: 0 !important;
            background: white !important;
            padding: 6px 8px !important;
            margin-bottom: 4px !important;
            cursor: default !important;
          }
          .module-header {
            break-inside: avoid;
            page-break-inside: avoid;
            border-bottom: 2px solid #000 !important;
            font-size: 12pt !important;
            padding: 6px 8px !important;
          }

          /* Column headers */
          .col-header {
            background: #eee !important;
            color: #000 !important;
            border-bottom: 1px solid #000 !important;
            padding: 4px 8px !important;
          }

          /* Date column */
          .date-col {
            border-right: 1px solid #999 !important;
            padding: 6px 8px !important;
          }
          .date-num { color: #000 !important; font-size: 12pt !important; }
          .date-day { color: #333 !important; }

          /* Content column: tighter spacing */
          .day-row > div:last-child { padding: 6px 8px !important; }

          /* Card content readability */
          .planner-card a { color: #000 !important; text-decoration: underline !important; }
          .planner-rich { overflow: visible !important; max-height: none !important; }
          .planner-rich * { overflow: visible !important; }
          .item-dragging { opacity: 1 !important; }

          /* Holiday rows: remove diagonal stripes */
          .holiday-row::after { display: none !important; }

          /* Drop target highlights off */
          .drop-target-active { background: white !important; }
        }
      `}</style>

      <a href="#schedule-content" className="skip-link">Skip to schedule</a>

      {/* ── Header ── */}
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
        onToggleCanvas={() => setShowCanvas((v) => !v)}
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

      {/* Publish success banner */}
      {studentEmbed && !isStudent && (
        <PublishBanner url={studentEmbed} onDismiss={() => setStudentEmbed(null)} />
      )}

      {/* Activity log */}
      {!isStudent && showActivityLog && (
        <ActivityLog publishHistory={state.publishHistory} onClose={() => setShowActivityLog(false)} />
      )}

      {!isStudent && showSetup && (
        <SetupPanel state={state} updateState={updateState} onImport={importSchedule} onClose={() => setShowSetup(false)} />
      )}
      {!isStudent && showCanvas && (
        <CanvasPanel
          state={state} updateState={updateState}
          onConnect={connectCanvas} onRefresh={refreshFromCanvas} refreshing={refreshing}
          onSwitchCourse={switchCourse}
          onClose={() => setShowCanvas(false)}
        />
      )}

      {/* ── Main schedule grid ── */}
      <main id="schedule-content" role="main" aria-label="Course schedule"
            className={`planner-shell planner-main ${!isStudent ? 'with-sidebar' : ''}`}
            style={{ maxWidth: 1152, margin: '0 auto' }}>
        <section style={{ minWidth: 0 }}>
          {allDays.length === 0 ? (
            <EmptyState
              onSetup={() => setShowSetup(true)}
              onConnect={() => setShowCanvas(true)}
              isConnected={state.canvas.connected}
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

// ════════════════════════════════════════════════════════════════
// SUB-COMPONENTS (internal to App — not worth separate files)
// ════════════════════════════════════════════════════════════════

/** App header with title, metadata, search bar, and toolbar buttons. */
function Header({
  state, isStudent, hashStudent, allDays, filteredDays,
  searchQuery, onSearchChange,
  filterGroup, onFilterGroupChange, assignmentGroups,
  darkMode, undoStack, redoStack,
  onToggleDark, onToggleStudent, onUndo, onRedo, onExportICal,
  onShowShiftModal, onShowRecurringModal, onPublish, publishing, onShareLink, lastPublishedUrl, onToggleCanvas, onToggleSetup,
  onToggleActivityLog,
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const isFiltering = searchQuery.trim().length > 0 || filterGroup !== null;
  const groupList = Object.values(assignmentGroups || {});
  const hasGroups = groupList.length > 0;

  const toggleSearch = () => {
    if (searchOpen) {
      onSearchChange('');
      setSearchOpen(false);
    } else {
      setSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  };

  return (
    <header role="banner" style={{ borderBottom: `1px solid ${T.border}`, background: T.paper }}>
      <div className="planner-header" style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div className="planner-header-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 className="planner-title" style={{ fontSize: '18px', margin: 0 }}>
              {state.setup.courseTitle || 'Course Schedule'}
            </h1>
            <div style={{ fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.18em', color: T.muted, textTransform: 'uppercase', marginTop: 4 }}>
              {isFiltering
                ? `Showing ${filteredDays.length} of ${allDays.length} days`
                : `${allDays.length} meetings`}
            </div>
            {state.setup.startDate && state.setup.endDate && (
              <div style={{ fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.12em', color: T.muted, marginTop: 2 }}>
                {fmtFull(state.setup.startDate)} → {fmtFull(state.setup.endDate)}
              </div>
            )}
            {state.setup.classDays?.length > 0 && (
              <div style={{ fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.12em', color: T.muted, marginTop: 2 }}>
                {state.setup.classDays.map((c) => DAY_FULL[c]).join(', ')}
              </div>
            )}
            {!isStudent && (
              <div style={{ fontFamily: FONT_MONO, fontSize: '10px', color: T.muted, marginTop: 4 }}>
                Build {new Date(__BUILD_TIME__).toLocaleString()}
                {state.lastSaved && <> · Saved {new Date(state.lastSaved).toLocaleString()}</>}
              </div>
            )}
          </div>

          {/* ── Search bar (collapsible) ── */}
          {searchOpen && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: 220 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') toggleSearch(); }}
                  placeholder="Filter schedule..."
                  aria-label="Search schedule"
                  style={{
                    ...inputStyle(),
                    width: '100%',
                    padding: '5px 28px 5px 8px',
                    fontSize: '12px',
                  }}
                />
                {searchQuery && (
                  <button
                    onClick={() => { onSearchChange(''); searchInputRef.current?.focus(); }}
                    aria-label="Clear search"
                    style={{
                      position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      color: T.muted, padding: 2, display: 'flex', alignItems: 'center',
                    }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          )}

          <nav aria-label="Schedule tools" className="flex items-center gap-2 flex-wrap">
            <IconButton onClick={toggleSearch} aria-label={searchOpen ? 'Close search' : 'Search schedule'}>
              <Search size={16} color={isFiltering ? T.inkBlue : T.ink} />
            </IconButton>
            {hasGroups && (
              <select
                value={filterGroup ?? ''}
                onChange={(e) => onFilterGroupChange(e.target.value ? Number(e.target.value) : null)}
                aria-label="Filter by assignment group"
                style={{
                  ...inputStyle(),
                  fontSize: '11px',
                  padding: '4px 6px',
                  maxWidth: 150,
                  fontFamily: FONT_MONO,
                  color: filterGroup !== null ? T.inkBlue : T.muted,
                }}
              >
                <option value="">All groups</option>
                {groupList.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            )}
            {!hashStudent && (
              <ToggleButton active={isStudent} onClick={onToggleStudent}
                aria-label={isStudent ? 'Switch to editor view' : 'Switch to student view'}>
                {isStudent ? <Eye size={14} /> : <EyeOff size={14} />}
                {isStudent ? 'Student' : 'Editor'}
              </ToggleButton>
            )}
            <IconButton onClick={onToggleDark} aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
              {darkMode ? <Sun size={16} /> : <Moon size={16} />}
            </IconButton>
            <IconButton onClick={onExportICal} aria-label="Download iCal calendar file">
              <CalendarDays size={16} />
            </IconButton>
            <IconButton onClick={() => window.print()} aria-label="Print schedule">
              <Printer size={16} />
            </IconButton>
            {!isStudent && (
              <>
                <IconButton onClick={onUndo} aria-label="Undo last action" disabled={undoStack.length === 0}>
                  <Undo2 size={16} color={undoStack.length === 0 ? T.faint : T.ink} />
                </IconButton>
                <IconButton onClick={onRedo} aria-label="Redo last action" disabled={redoStack.length === 0}>
                  <Redo2 size={16} color={redoStack.length === 0 ? T.faint : T.ink} />
                </IconButton>
                <IconButton onClick={onShowShiftModal} aria-label="Shift all dates forward or backward">
                  <ChevronRight size={16} />
                </IconButton>
                <IconButton onClick={onShowRecurringModal} aria-label="Create recurring note">
                  <Repeat size={16} />
                </IconButton>
                {state.canvas.connected && state.canvas.courseId && (<>
                  <IconButton onClick={onPublish} aria-label="Publish schedule to Canvas" disabled={publishing}>
                    {publishing ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                  </IconButton>
                  <IconButton onClick={onShareLink} aria-label={lastPublishedUrl ? 'Copy shareable link' : 'Publish first to get a shareable link'}>
                    <Link2 size={16} color={lastPublishedUrl ? T.inkBlue : T.muted} />
                  </IconButton>
                </>)}
                <IconButton onClick={onToggleCanvas} aria-label="Canvas connection settings">
                  {state.canvas.connected ? <Cloud size={16} color={T.forest} /> : <CloudOff size={16} color={T.muted} />}
                </IconButton>
                <IconButton onClick={onToggleActivityLog} aria-label="Toggle publish history">
                  <History size={16} />
                </IconButton>
                <IconButton onClick={onToggleSetup} aria-label="Course setup">
                  <Settings size={16} />
                </IconButton>
              </>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

/** Banner shown after a successful publish to Canvas, with copy-link sharing. */
function PublishBanner({ url, onDismiss }) {
  const [copied, setCopied] = useState(false);
  const copyUrl = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };
  return (
    <div style={{ background: T.successBg, borderBottom: `1px solid ${T.successBorder}`, padding: '12px 24px' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div className="flex items-center justify-between mb-2">
          <span style={{ fontFamily: FONT_MONO, fontSize: '11px', fontWeight: 600, color: T.forest }}>
            <Check size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />Published to Canvas
          </span>
          <IconButton onClick={onDismiss} aria-label="Dismiss publish notification"><X size={14} /></IconButton>
        </div>
        <p style={{ fontFamily: FONT_MONO, fontSize: '11px', color: T.muted, marginBottom: 8 }}>
          Schedule published as a Canvas Page. Share this link with TAs and students. Re-publish after changes.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: FONT_MONO, fontSize: '12px', color: T.inkBlue, wordBreak: 'break-all' }}>{url}</a>
          <button onClick={copyUrl} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 3, fontFamily: FONT_MONO, fontSize: '11px', border: `1px solid ${copied ? T.successBorder : T.border}`, background: copied ? T.successBg : T.paper, color: copied ? T.forest : T.ink, cursor: 'pointer', whiteSpace: 'nowrap' }}>{copied ? <><Check size={12} /> Copied</> : <><Link2 size={12} /> Copy link</>}</button>
        </div>
      </div>
    </div>
  );
}

/** Collapsible activity log showing recent publish events. */
function ActivityLog({ publishHistory, onClose }) {
  const entries = (publishHistory || []).slice().reverse();
  return (
    <div style={{ background: T.subtle, borderBottom: `1px solid ${T.border}`, padding: '12px 24px' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: '11px', fontWeight: 600, color: T.ink, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Publish History
          </span>
          <IconButton onClick={onClose} aria-label="Close activity log"><X size={14} /></IconButton>
        </div>
        {entries.length === 0 ? (
          <p style={{ fontFamily: FONT_MONO, fontSize: '11px', color: T.muted }}>No publish history</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {entries.map((e, i) => (
              <li key={i} style={{
                fontFamily: FONT_MONO, fontSize: '11px', color: T.ink,
                padding: '4px 0', borderBottom: i < entries.length - 1 ? `1px solid ${T.border}` : 'none',
                display: 'flex', gap: 12, alignItems: 'baseline',
              }}>
                <span style={{ color: T.muted, minWidth: 150 }}>
                  {new Date(e.timestamp).toLocaleString()}
                </span>
                <span>{e.itemCount} item{e.itemCount !== 1 ? 's' : ''}</span>
                <span style={{ color: T.muted }}>&middot;</span>
                <span>{e.dayCount} day{e.dayCount !== 1 ? 's' : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** The schedule grid table — column headers + day rows with module headers. */
function ScheduleTable({
  allDays, state, isStudent, teachingSet, pendingByDate,
  draggingId, autoEditId, clearAutoEdit,
  onMoveItem, onUpdateItem, onDeleteItem, onDuplicate, onReorder,
  onAddNote, onAddAssignment, onAddExtraDay, onRemoveExtraDay,
  onToggleHoliday, onAddModule, onRemoveModule,
  allDaysSet, assignmentGroups,
}) {
  const iconBtnStyleVal = { color: T.muted, padding: 2, background: 'transparent', border: 'none', cursor: 'pointer' };
  let prevKey = null;

  // Compute how many teaching days each module spans.
  // A module spans from its start date to the day before the next module starts (or end of semester).
  const moduleDates = Object.keys(state.modules || {}).filter((d) => allDays.includes(d)).sort();
  const moduleDayCounts = {};
  moduleDates.forEach((mDate, mi) => {
    const startIdx = allDays.indexOf(mDate);
    const endIdx = mi < moduleDates.length - 1 ? allDays.indexOf(moduleDates[mi + 1]) : allDays.length;
    let count = 0;
    for (let i = startIdx; i < endIdx; i++) {
      if (!state.holidays?.[allDays[i]]) count++;
    }
    moduleDayCounts[mDate] = count;
  });

  return (
    <div style={{ background: T.paper, border: `1px solid ${T.border}`, borderRadius: 6, overflow: 'hidden' }}>
      <div className="day-row" style={{ background: T.subtle, borderBottom: `1px solid ${T.border}` }}>
        <div className="col-header" style={{ borderRight: `1px solid ${T.border}` }}>Class meeting</div>
        <div className="col-header">Readings · Assignments · Materials</div>
      </div>
      {allDays.map((d, idx) => {
        const isExtra = !teachingSet.has(d);
        const items = (state.schedule[d] || []).map((id) => state.items[id]).filter(Boolean);
        const k = weekKey(d);
        const weekIdx = weekNumber(d);
        const isWeekStart = idx > 0 && k !== prevKey;
        prevKey = k;
        const moduleTitle = state.modules?.[d];
        const holidayLabel = state.holidays?.[d];

        return (
          <React.Fragment key={d}>
            {moduleTitle && (
              <div className="module-header">
                <span>
                  {moduleTitle}
                  {moduleDayCounts[d] != null && (
                    <span style={{
                      fontFamily: FONT_MONO, fontSize: '11px', fontWeight: 400,
                      color: T.muted, marginLeft: 10, letterSpacing: '0.02em',
                    }}>
                      ({moduleDayCounts[d]} {moduleDayCounts[d] === 1 ? 'day' : 'days'})
                    </span>
                  )}
                </span>
                {!isStudent && (
                  <button onClick={() => onRemoveModule(d)} style={iconBtnStyleVal} title="Remove module header">
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
            <ClassDayRow
              date={d} index={idx} isExtra={isExtra}
              weekIdx={weekIdx} isWeekStart={isWeekStart}
              items={items} isStudent={isStudent}
              canvas={state.canvas}
              canvasReady={state.canvas.connected && !!state.canvas.courseId}
              pendingCount={pendingByDate[d] || 0}
              holidayLabel={holidayLabel}
              onMoveItem={onMoveItem} onUpdateItem={onUpdateItem} onDeleteItem={onDeleteItem}
              onDuplicate={(id) => onDuplicate(id, d)}
              onAddNote={() => onAddNote(d)}
              onAddAssignment={() => onAddAssignment(d)}
              onAddExtraDay={onAddExtraDay}
              onRemoveExtraDay={() => onRemoveExtraDay(d)}
              onToggleHoliday={() => onToggleHoliday(d)}
              onAddModule={() => onAddModule(d)}
              onReorder={(from, to) => onReorder(d, from, to)}
              addableDates={getAddableDatesAfter(d, allDaysSet, state.setup.endDate)}
              draggingId={draggingId}
              autoEditId={autoEditId} clearAutoEdit={clearAutoEdit}
              assignmentGroups={assignmentGroups}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Schedule HTML renderer (for Canvas Page publish) ───────────
// Uses CSS custom properties with light-theme fallbacks in every var() call.
// The <style> block only defines dark-mode overrides via prefers-color-scheme.
// If Canvas strips the <style> tag, the light theme still renders correctly
// because every var(--x, fallback) falls back to the hardcoded light value.

function renderScheduleHtml(s) {
  const L = LIGHT;
  const D = DARK;

  // Helper: var(--name, lightFallback) — works even if <style> is stripped
  const v = (name, light) => `var(--s-${name}, ${light})`;

  // Dark-mode-only style block (light values come from inline fallbacks)
  const darkStyleBlock = `
    <style>
      @media (prefers-color-scheme: dark) {
        .schedule-wrap {
          --s-paper: ${D.paper}; --s-subtle: ${D.subtle};
          --s-ink: ${D.ink}; --s-ink-mid: ${D.inkMid}; --s-muted: ${D.muted};
          --s-border: ${D.border}; --s-border-strong: ${D.borderStrong};
          --s-ink-blue: ${D.inkBlue}; --s-ink-blue-soft: ${D.inkBlueSoft};
          --s-sienna: ${D.sienna}; --s-ox: ${D.ox};
          --s-amber-soft: ${D.amberSoft};
          --s-week-shade: ${D.weekShade}; --s-holiday-bg: ${D.holidayBg};
        }
        .schedule-wrap a { color: ${D.inkBlue}; }
      }
    </style>`;

  const days = computeAllDays(s.setup, s.extraDays);
  const teaching = new Set(generateClassDays(s.setup.startDate, s.setup.endDate, s.setup.classDays));
  let prevWk = null;
  let rows = '';

  // Compute module day counts for published HTML
  const pubModuleDates = Object.keys(s.modules || {}).filter((d) => days.includes(d)).sort();
  const pubModuleDayCounts = {};
  pubModuleDates.forEach((mDate, mi) => {
    const startIdx = days.indexOf(mDate);
    const endIdx = mi < pubModuleDates.length - 1 ? days.indexOf(pubModuleDates[mi + 1]) : days.length;
    let count = 0;
    for (let i = startIdx; i < endIdx; i++) {
      if (!s.holidays?.[days[i]]) count++;
    }
    pubModuleDayCounts[mDate] = count;
  });

  days.forEach((d) => {
    const dt = new Date(d + 'T00:00:00');
    const dayName = dt.toLocaleDateString('en-US', { weekday: 'long' });
    const dateNum = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const wk = weekKey(d);
    const isNewWeek = wk !== prevWk;
    prevWk = wk;
    const isExtra = !teaching.has(d);
    const items = (s.schedule[d] || []).map((id) => s.items[id]).filter(Boolean);
    const shadedWeek = weekNumber(d) % 2 === 1;
    const holidayLabel = s.holidays?.[d];

    // Background: use var() with light fallback for each case
    let bgColor;
    if (holidayLabel) bgColor = v('holiday-bg', L.holidayBg);
    else if (isExtra) bgColor = v('amber-soft', L.amberSoft);
    else if (shadedWeek) bgColor = v('week-shade', L.weekShade);
    else bgColor = v('paper', L.paper);

    // Module header row
    const moduleTitle = s.modules?.[d];
    if (moduleTitle) {
      const dayCount = pubModuleDayCounts[d];
      const dayCountHtml = dayCount != null ? ` <span style="font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 400; color: ${v('muted', L.muted)}; margin-left: 10px; letter-spacing: 0.02em;">(${dayCount} ${dayCount === 1 ? 'day' : 'days'})</span>` : '';
      rows += `<tr><td colspan="2" style="padding: 10px 16px; font-family: Georgia, serif; font-size: 16px; font-weight: 600; color: ${v('ink', L.ink)}; background: ${v('subtle', L.subtle)}; border-bottom: 1px solid ${v('border', L.border)};">${moduleTitle}${dayCountHtml}</td></tr>`;
    }

    if (isNewWeek) {
      rows += `<tr><td colspan="2" style="padding: 0;"><div style="border-top: 2px solid ${v('border-strong', L.borderStrong)};"></div></td></tr>`;
    }

    let content = '';
    items.forEach((item) => {
      if (item.type === 'assign') {
        const titleHtml = item.htmlUrl
          ? `<a href="${item.htmlUrl}" style="color: ${v('ink-blue', L.inkBlue)}; text-decoration: underline; text-underline-offset: 2px;">${item.title || 'Untitled'}</a>`
          : (item.title || 'Untitled');
        content += `<div style="margin: 0 0 8px 0; background: ${v('paper', L.paper)}; border: 1px solid ${v('border', L.border)}; border-left: 3px solid ${v('ink-blue', L.inkBlue)}; border-radius: 3px; padding: 10px 12px;">
          <div style="margin-bottom: 4px;">
            <span style="font-family: ui-monospace, monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: ${v('ink-blue', L.inkBlue)}; background: ${v('ink-blue-soft', L.inkBlueSoft)}; padding: 2px 6px; border-radius: 2px;">Assignment</span>
            ${item.points ? `<span style="font-family: ui-monospace, monospace; font-size: 10px; color: ${v('muted', L.muted)}; margin-left: 6px;">${item.points} pts</span>` : ''}
          </div>
          <div style="font-family: Georgia, serif; font-size: 15px; font-weight: 500; color: ${v('ink', L.ink)}; line-height: 1.3;">${titleHtml}</div>
        </div>`;
      } else if (item.type === 'rich') {
        content += `<div style="margin: 0 0 8px 0; background: ${v('paper', L.paper)}; border: 1px solid ${v('border', L.border)}; border-left: 3px solid ${v('sienna', L.sienna)}; border-radius: 3px; padding: 10px 12px;">
          <div style="font-size: 13px; color: ${v('ink', L.ink)}; line-height: 1.5;">${item.html || ''}</div>
        </div>`;
      }
    });

    if (holidayLabel) {
      content = `<div style="padding: 4px 0; font-family: ui-monospace, monospace; font-size: 11px; color: ${v('ox', L.ox)}; text-transform: uppercase; letter-spacing: 0.1em;">${holidayLabel}</div>`;
    } else if (!content) {
      content = `<div style="padding: 4px 0;">&nbsp;</div>`;
    }

    const rowShadow = shadedWeek ? 'inset 0 1px 0 rgba(255,255,255,0.7)' : 'inset 0 1px 0 rgba(0,0,0,0.04)';
    const rowOpacity = holidayLabel ? 'opacity: 0.7;' : '';
    rows += `<tr style="background: ${bgColor}; border-bottom: 1px solid ${v('border', L.border)}; box-shadow: ${rowShadow}; ${rowOpacity}">
      <td style="padding: 14px 16px; border-right: 1px solid ${v('border', L.border)}; vertical-align: top; width: 170px;">
        <div style="font-family: Georgia, serif; font-weight: 500; color: ${v('ink', L.ink)}; font-size: 20px; line-height: 1.1; letter-spacing: -0.01em;">${dateNum}</div>
        <div style="font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: ${v('muted', L.muted)}; margin-top: 2px;">${dayName}</div>
      </td>
      <td style="padding: 14px 16px; vertical-align: top;">${content}</td>
    </tr>`;
  });

  return `${darkStyleBlock}
  <div class="schedule-wrap" style="max-width: 1152px; margin: 0 auto;">
    <table style="width: 100%; border-collapse: collapse; border: 1px solid ${v('border', L.border)}; border-radius: 6px; overflow: hidden; font-family: -apple-system, system-ui, sans-serif; color: ${v('ink', L.ink)};">
      <thead><tr style="background: ${v('subtle', L.subtle)}; border-bottom: 1px solid ${v('border', L.border)};">
        <th style="padding: 10px 16px; text-align: left; font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: ${v('muted', L.muted)}; border-right: 1px solid ${v('border', L.border)};">Class meeting</th>
        <th style="padding: 10px 16px; text-align: left; font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: ${v('muted', L.muted)};">Readings · Assignments · Materials</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
