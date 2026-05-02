import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Plus, X, FileText, GripVertical, Eye, EyeOff, Settings, RefreshCw,
  Trash2, AlertCircle, Check, BookOpen, Pencil, Bold, Italic,
  Link as LinkIcon, ExternalLink, Calendar, Info, Cloud, CloudOff,
  ListPlus, CalendarPlus, MinusCircle, Hourglass, Upload, Download
} from 'lucide-react';

// ============================================================
// THEME
// ============================================================
const T = {
  cream: '#F7F3EA', paper: '#FFFFFF', subtle: '#EFE9DB',
  ink: '#1A1410', inkMid: '#3D362E', muted: '#756B5C', faint: '#B5AC9A',
  border: '#E5DFD0', borderStrong: '#C7BFA8',
  inkBlue: '#1F3A60', inkBlueSoft: '#E8EDF4',
  sienna: '#A04A2A', siennaSoft: '#F5E9DF',
  forest: '#2F6B3A', ox: '#8B2E1F',
  amber: '#B47A1F', amberSoft: '#F6ECDA',
};
const FONT_DISPLAY = "'Fraunces', 'Iowan Old Style', Georgia, serif";
const FONT_BODY = "'Geist', -apple-system, system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

// ============================================================
// HELPERS
// ============================================================
const DAY_CODES = ['SU','MO','TU','WE','TH','FR','SA'];
const DAY_FULL = { SU:'Sunday', MO:'Monday', TU:'Tuesday', WE:'Wednesday', TH:'Thursday', FR:'Friday', SA:'Saturday' };
const DAY_SHORT = { SU:'Sun', MO:'Mon', TU:'Tue', WE:'Wed', TH:'Thu', FR:'Fri', SA:'Sat' };
const PENDING_TTL_MS = 60 * 60 * 1000; // 1h

const uid = () => 'i_' + Math.random().toString(36).slice(2, 10);

function generateClassDays(startStr, endStr, dayCodes) {
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

function computeAllDays(setup, extraDays) {
  const teaching = generateClassDays(setup.startDate, setup.endDate, setup.classDays);
  const set = new Set([...teaching, ...(extraDays || [])]);
  return Array.from(set).sort();
}

function getAddableDatesAfter(date, allDaysSet, semesterEnd) {
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

// Returns ISO date of the Monday of the week containing `iso`
function weekKey(iso) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDay(); // 0=Sun ... 6=Sat
  const offset = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// ISO week number — gives a stable even/odd for shading regardless of gaps
function weekNumber(iso) {
  const d = new Date(iso + 'T00:00:00');
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d - jan1) / 86400000);
  return Math.floor((days + jan1.getDay()) / 7);
}

// Convert a UTC ISO timestamp to a local YYYY-MM-DD string
function localDateStr(isoUtc) {
  const d = new Date(isoUtc);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const fmtMonthDay = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const fmtFull = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

// ============================================================
// STORAGE
// ============================================================
const KEY_PREFIX = 'class-planner-v3';
const KEY_META = 'class-planner-meta'; // stores canvas connection + last courseId
const Store = {
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
      // claude.ai artifact context
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

// ============================================================
// CANVAS API
// ============================================================
const IS_DEV = import.meta.env.DEV;
// Cloudflare Worker CORS proxy URL — set this after deploying with `npx wrangler deploy`
const CORS_PROXY = 'https://canvas-cors-proxy.qsnell.workers.dev';

// Rewrite Canvas URLs: dev → Vite proxy, prod → Cloudflare Worker proxy
function proxyUrl(absoluteUrl, baseUrl) {
  if (!absoluteUrl || !baseUrl) return absoluteUrl;
  const base = baseUrl.replace(/\/+$/, '');
  if (IS_DEV) {
    if (absoluteUrl.startsWith(base)) return absoluteUrl.slice(base.length);
    return absoluteUrl;
  }
  // Production: route through CORS proxy
  const host = new URL(base).host;
  if (absoluteUrl.startsWith(base)) {
    return `${CORS_PROXY}/${host}${absoluteUrl.slice(base.length)}`;
  }
  return absoluteUrl;
}

async function canvasFetch(baseUrl, token, path, opts = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  const host = new URL(base).host;
  const url = IS_DEV
    ? `/api/v1${path}`
    : `${CORS_PROXY}/${host}/api/v1${path}`;
  const headers = {
    ...(opts.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  if (opts.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Canvas ${res.status}: ${text.slice(0, 180) || res.statusText}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}
const SCHEDULE_FILENAME = 'schedule-planner.json';
const SCHEDULE_HTML_FILENAME = 'schedule.html';

const CanvasAPI = {
  listCourses: (b, t) =>
    canvasFetch(b, t, '/courses?enrollment_type=teacher&state[]=available&state[]=unpublished&state[]=created&include[]=term&per_page=100'),
  listAssignments: (b, t, c) =>
    canvasFetch(b, t, `/courses/${c}/assignments?per_page=100`),
  listFiles: (b, t, c) =>
    canvasFetch(b, t, `/courses/${c}/files?per_page=100&sort=name`),
  listPages: (b, t, c) =>
    canvasFetch(b, t, `/courses/${c}/pages?per_page=100&sort=title&published=true`),
  setDueDate: (b, t, c, a, dueAtISO) =>
    canvasFetch(b, t, `/courses/${c}/assignments/${a}`, {
      method: 'PUT',
      body: JSON.stringify({ assignment: { due_at: dueAtISO } }),
    }),

  // Upload schedule JSON to Canvas course files (3-step process)
  async uploadSchedule(baseUrl, token, courseId, data) {
    const jsonStr = JSON.stringify(data);
    const blob = new Blob([jsonStr], { type: 'application/json' });

    // Delete existing file first to avoid versioning
    try {
      const files = await canvasFetch(baseUrl, token,
        `/courses/${courseId}/files?search_term=${SCHEDULE_FILENAME}&per_page=10`);
      const existing = files.find((f) => f.display_name === SCHEDULE_FILENAME || f.filename === SCHEDULE_FILENAME);
      if (existing) {
        await canvasFetch(baseUrl, token, `/files/${existing.id}`, { method: 'DELETE' });
      }
    } catch { /* ok if delete fails */ }

    // Step 1: Request upload URL
    const step1 = await canvasFetch(baseUrl, token, `/courses/${courseId}/files`, {
      method: 'POST',
      body: JSON.stringify({
        name: SCHEDULE_FILENAME,
        content_type: 'application/json',
        size: blob.size,
        on_duplicate: 'overwrite',
        parent_folder_path: '/',
      }),
    });

    // Step 2: Upload file to the provided URL
    // Canvas may return a same-domain URL or an S3 URL
    const form = new FormData();
    Object.entries(step1.upload_params).forEach(([k, v]) => form.append(k, v));
    form.append('file', blob, SCHEDULE_FILENAME);
    const uploadUrl = proxyUrl(step1.upload_url, baseUrl);
    const step2 = await fetch(uploadUrl, { method: 'POST', body: form, redirect: 'follow' });
    // Step 2 may return 2xx (success) or 3xx (needs confirmation)
    if (step2.status >= 400) {
      throw new Error(`File upload failed: ${step2.status}`);
    }
    // If we got a 3xx, follow the Location header to confirm
    if (step2.status >= 300) {
      const confirmUrl = step2.headers.get('Location');
      if (confirmUrl) {
        await fetch(proxyUrl(confirmUrl, baseUrl), { headers: { Authorization: `Bearer ${token}` } });
      }
    }
    return true;
  },

  // Download schedule JSON from Canvas course files
  async downloadSchedule(baseUrl, token, courseId) {
    const files = await canvasFetch(baseUrl, token,
      `/courses/${courseId}/files?search_term=${SCHEDULE_FILENAME}&per_page=10`);
    const file = files.find((f) => f.display_name === SCHEDULE_FILENAME || f.filename === SCHEDULE_FILENAME);
    if (!file) return null;
    // GET /files/:id with Authorization redirects to the file content
    const base = baseUrl.replace(/\/+$/, '');
    const host = new URL(base).host;
    const url = IS_DEV
      ? `/api/v1/files/${file.id}`
      : `${CORS_PROXY}/${host}/api/v1/files/${file.id}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    // Response may be the file metadata (JSON with url field) or the file content
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      // If we got metadata instead of file content, fetch the actual file
      if (json.url && json.id && !json.items) {
        const contentRes = await fetch(json.url);
        if (!contentRes.ok) throw new Error(`Download failed: ${contentRes.status}`);
        return contentRes.json();
      }
      return json;
    } catch {
      throw new Error('Failed to parse schedule file');
    }
  },

  // Get public URL for a course file (for student access)
  async getPublicUrl(baseUrl, token, courseId) {
    const files = await canvasFetch(baseUrl, token,
      `/courses/${courseId}/files?search_term=${SCHEDULE_FILENAME}&per_page=10`);
    const file = files.find((f) => f.display_name === SCHEDULE_FILENAME || f.filename === SCHEDULE_FILENAME);
    if (!file) return null;
    const meta = await canvasFetch(baseUrl, token, `/files/${file.id}/public_url`);
    return meta.public_url;
  },

  // Create or update a Canvas Page with schedule HTML
  async publishPage(baseUrl, token, courseId, title, html) {
    // Search for existing page by title
    try {
      const pages = await canvasFetch(baseUrl, token,
        `/courses/${courseId}/pages?search_term=${encodeURIComponent(title)}&per_page=10`);
      const existing = pages.find((p) => p.title === title);
      if (existing) {
        // Update existing page in place
        await canvasFetch(baseUrl, token, `/courses/${courseId}/pages/${existing.url}`, {
          method: 'PUT',
          body: JSON.stringify({ wiki_page: { body: html, published: true } }),
        });
        return existing.url;
      }
    } catch { /* page not found, create below */ }
    // Create new page
    const result = await canvasFetch(baseUrl, token, `/courses/${courseId}/pages`, {
      method: 'POST',
      body: JSON.stringify({ wiki_page: { title, body: html, published: true } }),
    });
    return result.url;
  },
};

// ============================================================
// DEMO DATA
// ============================================================
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

function freshDemoState() {
  const start = today();
  const end = addDays(start, 70);
  const items = {};
  const schedule = {};
  const extraDays = [];
  const teaching = generateClassDays(start, end, ['MO','WE','FR']);

  const seed = [
    { type: 'rich', html: '<p><b>Read:</b> Cormen Ch. 1 (Foundations)</p><p><a href="#">📎 Lecture 1 slides</a></p>', dayIdx: 0 },
    { type: 'assign', title: 'Problem Set 1', points: 50, dayIdx: 2 },
    { type: 'rich', html: '<p><b>Read:</b> Cormen §2.1–2.3</p><p>Bring a laptop; we&rsquo;ll trace insertion sort.</p>', dayIdx: 1 },
    { type: 'assign', title: 'Quiz 1: Asymptotics', points: 20, dayIdx: 4 },
    { type: 'rich', html: '<p><b>Read:</b> Cormen §4.3–4.5 (Recurrences)</p>', dayIdx: 3 },
    { type: 'assign', title: 'Problem Set 2', points: 60, dayIdx: 6 },
  ];
  // demo: assignment due on a non-teaching day → auto-added day
  const offDay = teaching[3] ? addDays(teaching[3], 1) : null;
  if (offDay) {
    extraDays.push(offDay);
    const id = uid();
    items[id] = { id, type: 'assign', title: 'Take-home midterm draft', points: 40, canvasId: null, dueDate: offDay, isDemo: true };
    schedule[offDay] = [id];
  }
  seed.forEach((s) => {
    const id = uid();
    if (s.type === 'rich') items[id] = { id, type: 'rich', html: s.html };
    else items[id] = { id, type: 'assign', title: s.title, points: s.points, canvasId: null, isDemo: true };
    const date = teaching[Math.min(s.dayIdx, teaching.length - 1)];
    if (!date) return;
    schedule[date] = schedule[date] || [];
    schedule[date].push(id);
    if (s.type === 'assign') items[id].dueDate = date;
  });
  return {
    setup: { courseTitle: 'CS 301 — Algorithms', startDate: start, endDate: end, classDays: ['MO','WE','FR'] },
    canvas: { baseUrl: '', token: '', courseId: '', connected: false, courses: [] },
    items, schedule, extraDays, unscheduled: [],
    pendingCreations: [],
    studentView: false,
  };
}

// ============================================================
// MAIN
// ============================================================
export default function ClassPlannerApp() {
  const [state, setState] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showCanvas, setShowCanvas] = useState(false);
  const [toast, setToast] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [autoEditId, setAutoEditId] = useState(null);
  const [studentEmbed, setStudentEmbed] = useState(null);
  const stateRef = useRef(null);
  const hashStudent = window.location.hash === '#student';

  useEffect(() => {
    (async () => {
      // Load meta (canvas connection info + last courseId)
      const meta = await Store.loadMeta();
      const courseId = meta?.courseId || '';
      const saved = await Store.load(courseId);
      const init = saved || freshDemoState();
      if (!init.pendingCreations) init.pendingCreations = [];
      // Restore canvas connection from meta
      if (meta && !init.canvas.connected && meta.baseUrl && meta.token) {
        init.canvas.baseUrl = meta.baseUrl;
        init.canvas.token = meta.token;
        init.canvas.courseId = meta.courseId || '';
        init.canvas.courses = meta.courses || [];
        init.canvas.connected = meta.connected || false;
      }
      if (hashStudent) {
        init.studentView = true;
        const params = new URLSearchParams(window.location.search);
        const src = params.get('src');
        if (src) {
          try {
            const res = await fetch(src);
            if (res.ok) {
              const data = await res.json();
              init.setup = data.setup;
              init.items = data.items;
              init.schedule = data.schedule;
              init.extraDays = data.extraDays;
              init.unscheduled = data.unscheduled || [];
            }
          } catch { /* fall back to local data */ }
        }
      }
      setState(init);
      setLoaded(true);

      // Auto-reconnect: if we have saved credentials, verify them and refresh course list
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
              if (course?.startAt && !s.setup.startDate) s.setup.startDate = course.startAt.slice(0, 10);
              if (course?.endAt && !s.setup.endDate) s.setup.endDate = course.endAt.slice(0, 10);
              if (course?.name) s.setup.courseTitle = course.name;
            }
            return s;
          });
        } catch {
          // Token expired or invalid — clear connected state, user will need to re-enter
          setState((prev) => {
            const s = structuredClone(prev);
            s.canvas.connected = false;
            return s;
          });
        }
      }
    })();
  }, []);

  useEffect(() => {
    stateRef.current = state;
    if (!loaded || !state) return;
    state.lastSaved = new Date().toISOString();
    Store.save(state);
    // Save canvas connection info to meta (shared across courses)
    Store.saveMeta({
      baseUrl: state.canvas.baseUrl,
      token: state.canvas.token,
      courseId: state.canvas.courseId,
      courses: state.canvas.courses,
      connected: state.canvas.connected,
    });
  }, [state, loaded]);

  const showToast = (msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 2400);
  };

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

  // Window focus → if pending creations exist & connected, sync from Canvas
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

  if (!loaded || !state) {
    return (
      <div style={{ minHeight: '100vh', background: T.cream, fontFamily: FONT_BODY, color: T.muted }}
           className="flex items-center justify-center">
        <div className="text-sm">Loading planner…</div>
      </div>
    );
  }

  const updateState = (fn) => setState((s) => fn(structuredClone(s)));

  // ------ Item creation ------
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

  // ------ Day management ------
  const addExtraDay = (date) => {
    updateState((s) => {
      if (!s.extraDays.includes(date)) s.extraDays.push(date);
      return s;
    });
    showToast(`Added ${fmtMonthDay(date)} to schedule`);
  };
  const removeExtraDay = (date) => {
    const items = state.schedule[date] || [];
    if (items.length > 0) {
      showToast('Move the items off this day first', 'err');
      return;
    }
    updateState((s) => {
      s.extraDays = s.extraDays.filter((d) => d !== date);
      delete s.schedule[date];
      return s;
    });
  };

  // ------ Course switching ------
  const switchCourse = async (newCourseId) => {
    // Save current state first
    if (state) Store.save(state);
    // Load saved state for the new course, or start fresh
    const saved = await Store.load(newCourseId);
    const canvas = { ...state.canvas, courseId: newCourseId };
    if (saved) {
      saved.canvas = canvas;
      setState(saved);
    } else {
      const fresh = {
        setup: { courseTitle: '', startDate: '', endDate: '', classDays: ['MO', 'WE', 'FR'] },
        canvas,
        items: {}, schedule: {}, extraDays: [], unscheduled: [],
        pendingCreations: [], studentView: false,
      };
      // Set dates from course info
      const course = canvas.courses.find((c) => String(c.id) === String(newCourseId));
      if (course?.startAt) fresh.setup.startDate = course.startAt.slice(0, 10);
      if (course?.endAt) fresh.setup.endDate = course.endAt.slice(0, 10);
      if (course?.name) fresh.setup.courseTitle = course.name;
      setState(fresh);
    }
  };

  // ------ Item edits ------
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
    // Sync title changes to Canvas
    const item = state.items[id];
    if (patch.title && item?.canvasId && state.canvas.connected && state.canvas.courseId) {
      canvasFetch(state.canvas.baseUrl, state.canvas.token,
        `/courses/${state.canvas.courseId}/assignments/${item.canvasId}`, {
          method: 'PUT',
          body: JSON.stringify({ assignment: { name: patch.title } }),
        }).catch(() => {});
    }
  };

  // ------ Move item between days ------
  const moveItem = async (id, toDate) => {
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
        s.schedule[toDate].push(id);
        if (s.items[id]?.type === 'assign') s.items[id].dueDate = toDate;
      }
      return s;
    });

    const item = state.items[id];
    if (
      toDate && item?.type === 'assign' && item.canvasId &&
      state.canvas.connected && state.canvas.token && state.canvas.baseUrl && state.canvas.courseId
    ) {
      try {
        const due = new Date(toDate + 'T23:59:00').toISOString();
        await CanvasAPI.setDueDate(
          state.canvas.baseUrl, state.canvas.token, state.canvas.courseId, item.canvasId, due
        );
        didCanvasSync = true;
      } catch (e) { canvasError = e.message; }
    }
    if (didCanvasSync) showToast('Synced to Canvas ✓');
    else if (canvasError) showToast(`Canvas sync failed: ${canvasError}`, 'err');
  };

  // ------ Publish schedule to Canvas ------
  const renderScheduleHtml = (s) => {
    const days = computeAllDays(s.setup, s.extraDays);
    const teaching = new Set(generateClassDays(s.setup.startDate, s.setup.endDate, s.setup.classDays));
    let prevWk = null;
    let rows = '';
    days.forEach((d) => {
      const dt = new Date(d + 'T00:00:00');
      const dayName = dt.toLocaleDateString('en-US', { weekday: 'long' });
      const dateNum = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const wk = weekKey(d);
      const isNewWeek = wk !== prevWk;
      prevWk = wk;
      const isExtra = !teaching.has(d);
      const items = (s.schedule[d] || []).map((id) => s.items[id]).filter(Boolean);
      const bgColor = isExtra ? T.amberSoft : (weekNumber(d) % 2 === 1 ? '#F2EBDA' : T.paper);

      // Week label row
      if (isNewWeek) {
        const weekStart = new Date(wk + 'T00:00:00');
        const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
        const weekLabel = `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        rows += `<tr><td colspan="2" style="padding: 0;"><div style="border-top: 2px solid ${T.borderStrong};"></div></td></tr>`;
        // The week label is shown inside the date cell of the first row
      }

      let content = '';
      items.forEach((item) => {
        if (item.type === 'assign') {
          const titleHtml = item.htmlUrl
            ? `<a href="${item.htmlUrl}" style="color: ${T.inkBlue}; text-decoration: underline; text-underline-offset: 2px;">${item.title || 'Untitled'}</a>`
            : (item.title || 'Untitled');
          content += `<div style="margin: 0 0 8px 0; background: ${T.paper}; border: 1px solid ${T.border}; border-left: 3px solid ${T.inkBlue}; border-radius: 3px; padding: 10px 12px;">
            <div style="margin-bottom: 4px;">
              <span style="font-family: ui-monospace, monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: ${T.inkBlue}; background: ${T.inkBlueSoft}; padding: 2px 6px; border-radius: 2px;">Assignment</span>
              ${item.points ? `<span style="font-family: ui-monospace, monospace; font-size: 10px; color: ${T.muted}; margin-left: 6px;">${item.points} pts</span>` : ''}
            </div>
            <div style="font-family: Georgia, serif; font-size: 15px; font-weight: 500; color: ${T.ink}; line-height: 1.3;">${titleHtml}</div>
          </div>`;
        } else if (item.type === 'rich') {
          content += `<div style="margin: 0 0 8px 0; background: ${T.paper}; border: 1px solid ${T.border}; border-left: 3px solid ${T.sienna}; border-radius: 3px; padding: 10px 12px;">
            <div style="font-size: 13px; color: ${T.ink}; line-height: 1.5;">${item.html || ''}</div>
          </div>`;
        }
      });
      if (!content) content = `<div style="padding: 4px 0;">&nbsp;</div>`;

      rows += `<tr style="background: ${bgColor};">
        <td style="padding: 14px 16px; border-right: 1px solid ${T.border}; vertical-align: top; width: 170px;">
          <div style="font-family: Georgia, serif; font-weight: 500; color: ${T.ink}; font-size: 20px; line-height: 1.1; letter-spacing: -0.01em;">${dateNum}</div>
          <div style="font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: ${T.muted}; margin-top: 2px;">${dayName}</div>
        </td>
        <td style="padding: 14px 16px; vertical-align: top;">${content}</td>
      </tr>`;
    });

    return `<div style="max-width: 1152px; margin: 0 auto;">
      <table style="width: 100%; border-collapse: collapse; border: 1px solid ${T.border}; border-radius: 6px; overflow: hidden; font-family: -apple-system, system-ui, sans-serif;">
        <thead><tr style="background: ${T.subtle}; border-bottom: 1px solid ${T.border};">
          <th style="padding: 10px 16px; text-align: left; font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: ${T.muted}; border-right: 1px solid ${T.border};">Class meeting</th>
          <th style="padding: 10px 16px; text-align: left; font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: ${T.muted};">Readings · Assignments · Materials</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  };

  const publishToCanvas = async () => {
    const s = stateRef.current;
    if (!s?.canvas?.connected || !s.canvas.courseId) {
      showToast('Connect to Canvas and pick a course first', 'err');
      return;
    }
    try {
      // Save JSON to course files
      const publishData = {
        setup: s.setup,
        items: s.items,
        schedule: s.schedule,
        extraDays: s.extraDays,
        unscheduled: s.unscheduled,
        publishedAt: new Date().toISOString(),
      };
      await CanvasAPI.uploadSchedule(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, publishData);

      // Publish schedule as a Canvas Page (updates existing page if found)
      const html = renderScheduleHtml(s);
      const slug = await CanvasAPI.publishPage(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, 'Schedule', html);
      const pageUrl = `${s.canvas.baseUrl.replace(/\/+$/, '')}/courses/${s.canvas.courseId}/pages/${slug}`;
      setStudentEmbed(pageUrl);
      setTimeout(() => setStudentEmbed(null), 8000);

      showToast('Published schedule to Canvas');
    } catch (e) {
      showToast(`Publish failed: ${e.message}`, 'err');
    }
  };

  const loadFromCanvas = async () => {
    const s = stateRef.current;
    if (!s?.canvas?.connected || !s.canvas.courseId) {
      showToast('Connect to Canvas and pick a course first', 'err');
      return;
    }
    try {
      const data = await CanvasAPI.downloadSchedule(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId);
      if (!data) { showToast('No published schedule found', 'err'); return; }
      updateState((s) => {
        s.setup = data.setup;
        s.items = data.items;
        s.schedule = data.schedule;
        s.extraDays = data.extraDays;
        s.unscheduled = data.unscheduled || [];
        return s;
      });
      showToast('Loaded schedule from Canvas');
    } catch (e) {
      showToast(`Load failed: ${e.message}`, 'err');
    }
  };

  // ------ Canvas connect / import / refresh ------
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
        // If a course is already selected, update dates from the fresh data
        if (s.canvas.courseId) {
          const course = s.canvas.courses.find((c) => String(c.id) === String(s.canvas.courseId));
          if (course?.startAt) s.setup.startDate = course.startAt.slice(0, 10);
          if (course?.endAt) s.setup.endDate = course.endAt.slice(0, 10);
          if (course?.name) s.setup.courseTitle = course.name;
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

  // Light sync: merge new/updated Canvas assignments into existing state (used by focus handler)
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
          return;
        }

        const id = uid();
        let due = a.due_at ? localDateStr(a.due_at) : null;

        if (!due) {
          const pendingMatch = pending.find((p) => !claimedPending.has(p.id));
          if (pendingMatch) {
            claimedPending.add(pendingMatch.id);
            due = pendingMatch.date;
            const dueISO = new Date(due + 'T23:59:00').toISOString();
            patchPromises.push(
              CanvasAPI.setDueDate(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId, a.id, dueISO).catch(() => null)
            );
          }
        } else {
          const match = pending.find((p) => !claimedPending.has(p.id) && p.date === due);
          if (match) claimedPending.add(match.id);
        }

        s.items[id] = { id, type: 'assign', title: a.name, points: a.points_possible || 0, canvasId: a.id, htmlUrl: a.html_url, dueDate: due };
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

  // Full reload: try published schedule from course files, then import assignments from Canvas.
  // Clears everything first.
  const refreshFromCanvas = async () => {
    const s0 = stateRef.current;
    if (!s0?.canvas?.connected || !s0.canvas.courseId) {
      showToast('Pick a course first', 'err');
      return;
    }

    // Load published schedule from course files (includes notes)
    let published = null;
    try {
      published = await CanvasAPI.downloadSchedule(s0.canvas.baseUrl, s0.canvas.token, s0.canvas.courseId);
    } catch { /* no published schedule */ }

    // Fetch current assignments from Canvas
    let list = [];
    try {
      list = await CanvasAPI.listAssignments(s0.canvas.baseUrl, s0.canvas.token, s0.canvas.courseId);
    } catch (e) {
      if (!published) { showToast(`Refresh failed: ${e.message}`, 'err'); return; }
    }

    updateState((s) => {
      // Start from published schedule if available, otherwise blank
      if (published) {
        s.setup = published.setup || s.setup;
        s.items = published.items || {};
        s.schedule = published.schedule || {};
        s.extraDays = published.extraDays || [];
        s.unscheduled = published.unscheduled || [];
      } else {
        s.items = {};
        s.schedule = {};
        s.extraDays = [];
        s.unscheduled = [];
      }
      s.pendingCreations = [];

      const teachingNow = new Set(generateClassDays(s.setup.startDate, s.setup.endDate, s.setup.classDays));
      let added = 0, updated = 0, autoAdded = 0;

      // Merge Canvas assignments on top
      list.forEach((a) => {
        const existing = Object.values(s.items).find((it) => it.type === 'assign' && it.canvasId === a.id);
        if (existing) {
          existing.title = a.name;
          existing.points = a.points_possible || 0;
          existing.htmlUrl = a.html_url;
          // Relocate if Canvas due date changed
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

        // New assignment from Canvas
        const id = uid();
        const due = a.due_at ? localDateStr(a.due_at) : null;
        s.items[id] = { id, type: 'assign', title: a.name, points: a.points_possible || 0, canvasId: a.id, htmlUrl: a.html_url, dueDate: due };
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
      showToast(parts.length ? `Refreshed: ${parts.join(', ')}` : 'No changes');
      return s;
    });
  };

  const isStudent = state.studentView;

  return (
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

        /* ---------- Responsive layouts ---------- */
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
      `}</style>

      {/* HEADER */}
      <header style={{ borderBottom: `1px solid ${T.border}`, background: T.paper }}>
        <div className="planner-header" style={{ maxWidth: 1152, margin: '0 auto' }}>
          <div className="planner-header-row">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.18em', color: T.muted, textTransform: 'uppercase' }}>
                Course schedule · {allDays.length} meetings
                {state.setup.startDate && state.setup.endDate && (
                  <> · {fmtFull(state.setup.startDate)} → {fmtFull(state.setup.endDate)} · {state.setup.classDays.map((c) => DAY_SHORT[c]).join(' · ')}</>
                )}
              </div>
              {!isStudent && (
                <div style={{ fontFamily: FONT_MONO, fontSize: '10px', color: T.muted, marginTop: 2 }}>
                  Build {new Date(__BUILD_TIME__).toLocaleString()}
                  {state.lastSaved && <> · Saved {new Date(state.lastSaved).toLocaleString()}</>}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {!hashStudent && (
                <ToggleButton active={isStudent} onClick={() => updateState((s) => { s.studentView = !s.studentView; return s; })}>
                  {isStudent ? <Eye size={14} /> : <EyeOff size={14} />}
                  {isStudent ? 'Student' : 'Editor'}
                </ToggleButton>
              )}
              {!isStudent && (
                <>
                  {state.canvas.connected && state.canvas.courseId && (
                    <>
                      <IconButton onClick={publishToCanvas} title="Publish schedule to Canvas course files">
                        <Upload size={16} />
                      </IconButton>
                      <IconButton onClick={loadFromCanvas} title="Load schedule from Canvas course files">
                        <Download size={16} />
                      </IconButton>
                    </>
                  )}
                  <IconButton onClick={() => setShowCanvas((v) => !v)} title="Canvas connection">
                    {state.canvas.connected ? <Cloud size={16} color={T.forest} /> : <CloudOff size={16} color={T.muted} />}
                  </IconButton>
                  <IconButton onClick={() => setShowSetup((v) => !v)} title="Course setup">
                    <Settings size={16} />
                  </IconButton>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {studentEmbed && !isStudent && (
        <div style={{ background: T.subtle, borderBottom: `1px solid ${T.border}`, padding: '12px 24px' }}>
          <div style={{ maxWidth: 1152, margin: '0 auto' }}>
            <div className="flex items-center justify-between mb-2">
              <span style={{ fontFamily: FONT_MONO, fontSize: '11px', fontWeight: 600, color: T.ink }}>
                Published to Canvas
              </span>
              <IconButton onClick={() => setStudentEmbed(null)}><X size={14} /></IconButton>
            </div>
            <p style={{ fontFamily: FONT_MONO, fontSize: '11px', color: T.muted, marginBottom: 8 }}>
              Schedule published as a Canvas Page. Students can view it directly. Re-publish after changes.
            </p>
            <a href={studentEmbed} target="_blank" rel="noopener noreferrer"
              style={{ fontFamily: FONT_MONO, fontSize: '12px', color: T.inkBlue, wordBreak: 'break-all' }}>
              {studentEmbed}
            </a>
          </div>
        </div>
      )}
      {!isStudent && showSetup && (
        <SetupPanel state={state} updateState={updateState} onClose={() => setShowSetup(false)} />
      )}
      {!isStudent && showCanvas && (
        <CanvasPanel
          state={state} updateState={updateState}
          onConnect={connectCanvas} onRefresh={refreshFromCanvas}
          onSwitchCourse={switchCourse}
          onClose={() => setShowCanvas(false)}
        />
      )}

      {/* MAIN */}
      <main className={`planner-shell planner-main ${!isStudent ? 'with-sidebar' : ''}`}
            style={{ maxWidth: 1152, margin: '0 auto' }}>
        <section style={{ minWidth: 0 }}>
          {!isStudent && (
            <div className="flex items-start gap-2 mb-4" style={{ color: T.muted, fontFamily: FONT_MONO, fontSize: '11px', lineHeight: 1.4 }}>
              <Info size={12} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                Assignments come from Canvas (cloud icon → Connect & Refresh). Drag cards between days.
                Date column has <CalendarPlus size={11} style={{ display: 'inline', verticalAlign: '-2px' }} /> to add a non-teaching date.
                Content column has <FileText size={11} style={{ display: 'inline', verticalAlign: '-2px' }} /> Note and <BookOpen size={11} style={{ display: 'inline', verticalAlign: '-2px' }} /> Assignment.
              </span>
            </div>
          )}

          {allDays.length === 0 ? (
            <EmptyState onSetup={() => setShowSetup(true)} />
          ) : (
            <div style={{ background: T.paper, border: `1px solid ${T.border}`, borderRadius: 6, overflow: 'hidden' }}>
              <div className="day-row" style={{ background: T.subtle, borderBottom: `1px solid ${T.border}` }}>
                <div className="col-header" style={{ borderRight: `1px solid ${T.border}` }}>Class meeting</div>
                <div className="col-header">Readings · Assignments · Materials</div>
              </div>
              {(() => {
                let prevKey = null;
                return allDays.map((d, idx) => {
                  const isExtra = !teachingSet.has(d);
                  const items = (state.schedule[d] || []).map((id) => state.items[id]).filter(Boolean);
                  const k = weekKey(d);
                  const weekIdx = weekNumber(d);
                  const isWeekStart = idx > 0 && k !== prevKey;
                  prevKey = k;
                  return (
                  <ClassDayRow
                    key={d}
                    date={d} index={idx} isExtra={isExtra}
                    weekIdx={weekIdx} isWeekStart={isWeekStart}
                    items={items}
                    isStudent={isStudent}
                    canvas={state.canvas}
                    canvasReady={state.canvas.connected && !!state.canvas.courseId}
                    pendingCount={pendingByDate[d] || 0}
                    onMoveItem={moveItem}
                    onUpdateItem={updateItem}
                    onDeleteItem={deleteItem}
                    onAddNote={() => addNoteOnDay(d)}
                    onAddAssignment={() => startAssignmentCreation(d)}
                    onAddExtraDay={addExtraDay}
                    onRemoveExtraDay={() => removeExtraDay(d)}
                    addableDates={getAddableDatesAfter(d, allDaysSet, state.setup.endDate)}
                    draggingId={draggingId}
                    setDraggingId={setDraggingId}
                    autoEditId={autoEditId}
                    clearAutoEdit={() => setAutoEditId(null)}
                  />
                );
              });
              })()}
            </div>
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
              onMoveItem={moveItem}
              onUpdateItem={updateItem}
              onDeleteItem={deleteItem}
              draggingId={draggingId}
              setDraggingId={setDraggingId}
              autoEditId={autoEditId}
              clearAutoEdit={() => setAutoEditId(null)}
            />
          </aside>
        )}
      </main>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: toast.kind === 'err' ? T.ox : T.ink, color: '#fff',
          padding: '10px 18px', borderRadius: 4, fontSize: '13px',
          fontFamily: FONT_BODY, boxShadow: '0 6px 24px rgba(26,20,16,0.18)', zIndex: 50,
          maxWidth: 'calc(100vw - 32px)', textAlign: 'center',
        }}>
          {toast.msg}
        </div>
      )}

      <footer style={{ maxWidth: 1152, margin: '0 auto', padding: '24px 16px', textAlign: 'center', color: T.faint, fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.1em' }}>
        Saved locally · {Object.keys(state.items).length} items · {state.extraDays.length} added dates
        {state.pendingCreations.length > 0 && ` · ${state.pendingCreations.length} pending`}
      </footer>
    </div>
  );
}

// ============================================================
// CLASS DAY ROW
// ============================================================
function ClassDayRow({
  date, index, isExtra, items, isStudent, canvas, canvasReady, pendingCount,
  weekIdx, isWeekStart,
  onMoveItem, onUpdateItem, onDeleteItem,
  onAddNote, onAddAssignment, onAddExtraDay, onRemoveExtraDay,
  addableDates, draggingId, setDraggingId,
  autoEditId, clearAutoEdit,
}) {
  const [hovering, setHovering] = useState(false);
  const [showAddDay, setShowAddDay] = useState(false);
  const d = new Date(date + 'T00:00:00');
  // alternate background by *week* (not row) so a whole week reads as one band
  const weekShade = (weekIdx ?? 0) % 2 === 1;
  const rowBg = isExtra ? T.amberSoft : (weekShade ? '#F2EBDA' : T.paper);
  const dayLabel = DAY_FULL[DAY_CODES[d.getDay()]];

  return (
    <div className="day-row" style={{
      borderBottom: `1px solid ${T.border}`,
      borderTop: isWeekStart ? `2px solid ${T.borderStrong}` : 'none',
      background: rowBg,
    }}>
      {/* DATE COLUMN */}
      <div className="date-col">
        {isWeekStart && (
          <div style={{
            fontFamily: FONT_MONO, fontSize: '9px', letterSpacing: '0.2em',
            textTransform: 'uppercase', color: T.muted, marginBottom: 4,
          }}>
            Week {(weekIdx ?? 0) + 1}
          </div>
        )}
        <div className="date-num">{fmtMonthDay(date)}</div>
        <div className="date-day">{dayLabel}</div>
        {isExtra && (
          <div style={{
            display: 'inline-block', marginTop: 6,
            fontFamily: FONT_MONO, fontSize: '8px', letterSpacing: '0.18em', textTransform: 'uppercase',
            color: T.amber, background: '#fff', border: `1px solid ${T.amber}66`,
            padding: '1px 5px', borderRadius: 2,
          }}>Added</div>
        )}
        {pendingCount > 0 && (
          <div title="Waiting for new Canvas assignment to appear" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, marginLeft: isExtra ? 4 : 0,
            fontFamily: FONT_MONO, fontSize: '8px', letterSpacing: '0.16em', textTransform: 'uppercase',
            color: T.inkBlue, background: T.inkBlueSoft, border: `1px solid ${T.inkBlue}33`,
            padding: '1px 5px', borderRadius: 2,
          }}>
            <Hourglass size={9} /> Pending
          </div>
        )}

        {!isStudent && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <DayToolBtn
                onClick={() => setShowAddDay((v) => !v)}
                title="Add a non-teaching date after this one"
                disabled={addableDates.length === 0}
              >
                <CalendarPlus size={11} /> Day
              </DayToolBtn>
              {showAddDay && (
                <AddDayPopover
                  dates={addableDates}
                  onPick={(dt) => { onAddExtraDay(dt); setShowAddDay(false); }}
                  onClose={() => setShowAddDay(false)}
                />
              )}
            </div>
            {isExtra && items.length === 0 && (
              <DayToolBtn onClick={onRemoveExtraDay} title="Remove this date">
                <MinusCircle size={11} />
              </DayToolBtn>
            )}
          </div>
        )}
      </div>

      {/* CONTENT COLUMN */}
      <div
        onDragOver={(e) => { if (!isStudent) { e.preventDefault(); setHovering(true); } }}
        onDragLeave={() => setHovering(false)}
        onDrop={(e) => {
          if (isStudent) return;
          e.preventDefault();
          setHovering(false);
          setDraggingId(null);
          const id = e.dataTransfer.getData('text/plain');
          if (id) onMoveItem(id, date);
        }}
        className={hovering ? 'drop-target-active' : ''}
        style={{
          padding: '12px',
          minHeight: 60,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          transition: 'background 120ms',
          minWidth: 0,
        }}
      >
        {items.length === 0 && !isStudent && (
          <div style={{ color: T.faint, fontSize: '12px', fontStyle: 'italic', padding: '4px 4px' }}>
            Drop items here, or use the buttons below.
          </div>
        )}
        {items.map((item) => (
          <ItemCard
            key={item.id} item={item} isStudent={isStudent} canvas={canvas}
            onUpdate={onUpdateItem} onDelete={onDeleteItem}
            draggingId={draggingId} setDraggingId={setDraggingId}
            autoEdit={autoEditId === item.id}
            onAutoEditConsumed={clearAutoEdit}
          />
        ))}

        {!isStudent && (
          <div className="day-tools" style={{ marginTop: 'auto', paddingTop: 6 }}>
            <DayToolBtn onClick={onAddNote} title="Add a reading / note on this day">
              <FileText size={11} /> Note
            </DayToolBtn>
            <DayToolBtn
              onClick={onAddAssignment}
              title={canvasReady ? 'Open Canvas to create an assignment for this day' : 'Connect Canvas to add assignments'}
              disabled={!canvasReady}
            >
              <BookOpen size={11} /> Assignment <ExternalLink size={9} />
            </DayToolBtn>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ADD-DAY POPOVER
// ============================================================
function AddDayPopover({ dates, onPick, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  if (dates.length === 0) return null;
  return (
    <div ref={ref} style={{
      position: 'absolute', top: 'calc(100% + 4px)', left: 0,
      background: T.paper, border: `1px solid ${T.borderStrong}`, borderRadius: 4,
      boxShadow: '0 6px 20px rgba(26,20,16,0.12)', zIndex: 30,
      minWidth: 200, padding: 4,
    }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted, padding: '6px 10px 4px' }}>
        Add a date
      </div>
      {dates.map((dt) => {
        const d = new Date(dt + 'T00:00:00');
        return (
          <button key={dt} onClick={() => onPick(dt)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              width: '100%', padding: '6px 10px', textAlign: 'left',
              fontFamily: FONT_BODY, fontSize: '13px', color: T.ink,
              background: 'transparent', border: 'none', borderRadius: 2, cursor: 'pointer',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = T.inkBlueSoft)}
            onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}>
            <span>{d.toLocaleDateString('en-US', { weekday: 'long' })}</span>
            <span style={{ fontFamily: FONT_MONO, fontSize: '11px', color: T.muted }}>
              {fmtMonthDay(dt)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// UNSCHEDULED ZONE
// ============================================================
function UnscheduledZone({ items, canvas, onMoveItem, onUpdateItem, onDeleteItem, draggingId, setDraggingId, autoEditId, clearAutoEdit }) {
  const [hovering, setHovering] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setHovering(true); }}
      onDragLeave={() => setHovering(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHovering(false);
        setDraggingId(null);
        const id = e.dataTransfer.getData('text/plain');
        if (id) onMoveItem(id, null);
      }}
      style={{
        background: hovering ? T.inkBlueSoft : T.subtle,
        border: `1px dashed ${T.borderStrong}`,
        borderRadius: 4, padding: 12, minHeight: 120,
        display: 'flex', flexDirection: 'column', gap: 8,
        transition: 'background 120ms',
      }}
    >
      {items.length === 0 && (
        <div style={{ color: T.muted, fontSize: '12px', textAlign: 'center', padding: '20px 8px', fontStyle: 'italic' }}>
          Drag items here to remove from the schedule.
          Imported assignments without a due date land here too.
        </div>
      )}
      {items.map((item) => (
        <ItemCard
          key={item.id} item={item} isStudent={false} canvas={canvas}
          onUpdate={onUpdateItem} onDelete={onDeleteItem}
          draggingId={draggingId} setDraggingId={setDraggingId}
          autoEdit={autoEditId === item.id}
          onAutoEditConsumed={clearAutoEdit}
        />
      ))}
    </div>
  );
}

// ============================================================
// ITEM CARD
// ============================================================
function ItemCard({ item, isStudent, canvas, onUpdate, onDelete, draggingId, setDraggingId, autoEdit, onAutoEditConsumed }) {
  const isAssign = item.type === 'assign';
  const isRich = item.type === 'rich';
  const [editing, setEditing] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);

  useEffect(() => {
    if (autoEdit && isRich && !isStudent) {
      setEditing(true);
      onAutoEditConsumed?.();
    }
  }, [autoEdit, isRich, isStudent, onAutoEditConsumed]);

  const handleDragStart = (e) => {
    if (isStudent) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.effectAllowed = 'move';
    setDraggingId(item.id);
  };
  const handleDragEnd = () => setDraggingId(null);

  const accent = isAssign ? T.inkBlue : T.sienna;
  const accentSoft = isAssign ? T.inkBlueSoft : T.siennaSoft;
  const isDragging = draggingId === item.id;

  return (
    <div
      draggable={!isStudent && !editing && !titleEditing}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`planner-card ${isDragging ? 'item-dragging' : ''}`}
      style={{
        background: T.paper,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 3,
        padding: '10px 12px',
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        cursor: !isStudent && !editing && !titleEditing ? 'grab' : 'default',
        transition: 'opacity 120ms',
        minWidth: 0,
      }}
    >
      {!isStudent && (
        <div style={{ color: T.faint, paddingTop: 2, flexShrink: 0 }} title="Drag to move">
          <GripVertical size={14} />
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {isAssign && (
          <>
            <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 4 }}>
              <span style={pillStyle(accent, accentSoft)}>Assignment</span>
              {item.canvasId ? (
                <span style={{ fontFamily: FONT_MONO, fontSize: '10px', color: T.muted }}>
                  Canvas #{item.canvasId}
                </span>
              ) : item.isDemo ? (
                <span style={{ fontFamily: FONT_MONO, fontSize: '9px', color: T.muted, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
                  demo
                </span>
              ) : null}
              {item.htmlUrl && (
                <a href={item.htmlUrl} target="_blank" rel="noreferrer" style={{ color: T.muted }} title="Open in Canvas">
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
            {titleEditing && !isStudent ? (
              <input
                defaultValue={item.title} autoFocus
                onBlur={(e) => { onUpdate(item.id, { title: e.target.value || 'Untitled' }); setTitleEditing(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                style={{
                  fontFamily: FONT_DISPLAY, fontSize: '15px', fontWeight: 500, width: '100%',
                  border: `1px solid ${T.borderStrong}`, padding: '2px 4px', borderRadius: 2,
                  background: T.cream, color: T.ink,
                }}
              />
            ) : (
              <div
                onDoubleClick={() => !isStudent && setTitleEditing(true)}
                style={{ fontFamily: FONT_DISPLAY, fontSize: '15px', fontWeight: 500, color: T.ink, lineHeight: 1.3, wordBreak: 'break-word' }}
                title={!isStudent ? 'Double-click to rename' : undefined}
              >
                {item.title}
              </div>
            )}
            <div style={{ marginTop: 4, fontFamily: FONT_MONO, fontSize: '11px', color: T.muted }}>
              {item.points ? `${item.points} pts` : 'no points'}
              {item.dueDate && <> · due {fmtMonthDay(item.dueDate)}</>}
            </div>
          </>
        )}

        {isRich && (
          <>
            {editing && !isStudent ? (
              <RichEditor
                initialHtml={item.html}
                canvas={canvas}
                onSave={(html) => { onUpdate(item.id, { html }); setEditing(false); }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <div
                className="planner-rich"
                onDoubleClick={() => !isStudent && setEditing(true)}
                style={{ fontFamily: FONT_BODY, fontSize: '14px', color: T.inkMid, lineHeight: 1.5, cursor: !isStudent ? 'text' : 'default', wordBreak: 'break-word' }}
                dangerouslySetInnerHTML={{ __html: item.html || '<p style="color:#B5AC9A;font-style:italic">Empty note — click pencil to edit</p>' }}
              />
            )}
          </>
        )}
      </div>

      {!isStudent && !editing && !titleEditing && (
        <div className="flex flex-col gap-1" style={{ opacity: 0.6, flexShrink: 0 }}>
          {isRich && (
            <button onClick={() => setEditing(true)} title="Edit" style={iconBtnStyle}>
              <Pencil size={13} />
            </button>
          )}
          {isAssign && (
            <button onClick={() => setTitleEditing(true)} title="Rename" style={iconBtnStyle}>
              <Pencil size={13} />
            </button>
          )}
          <button onClick={() => onDelete(item.id)} title="Delete" style={iconBtnStyle}>
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// RICH EDITOR
// ============================================================
function RichEditor({ initialHtml, canvas, onSave, onCancel }) {
  const ref = useRef(null);
  const [canvasPicker, setCanvasPicker] = useState(null); // { type: 'files'|'pages', items: [] }
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = initialHtml || '<p></p>';
      ref.current.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);
  const exec = (cmd, val = null) => { document.execCommand(cmd, false, val); ref.current?.focus(); };
  const insertLink = () => {
    const url = window.prompt('Link URL:');
    if (!url) return;
    const sel = window.getSelection();
    const hasSelection = sel && sel.toString().trim().length > 0;
    if (hasSelection) {
      exec('createLink', url);
    } else {
      const text = window.prompt('Link text:', url);
      const anchor = `<a href="${url}">${text || url}</a>`;
      exec('insertHTML', anchor);
    }
  };
  const canvasReady = canvas?.connected && canvas?.courseId;
  const openCanvasPicker = async (type) => {
    if (!canvasReady) return;
    try {
      const items = type === 'files'
        ? await CanvasAPI.listFiles(canvas.baseUrl, canvas.token, canvas.courseId)
        : await CanvasAPI.listPages(canvas.baseUrl, canvas.token, canvas.courseId);
      setCanvasPicker({ type, items });
    } catch { setCanvasPicker({ type, items: [], error: true }); }
  };
  const pickCanvasItem = (item) => {
    const url = canvasPicker.type === 'files'
      ? `${canvas.baseUrl.replace(/\/+$/, '')}/courses/${canvas.courseId}/files/${item.id}/download`
      : `${canvas.baseUrl.replace(/\/+$/, '')}/courses/${canvas.courseId}/pages/${item.url}`;
    const name = canvasPicker.type === 'files' ? item.display_name : item.title;
    exec('insertHTML', `<a href="${url}">${name}</a>`);
    setCanvasPicker(null);
  };
  return (
    <div>
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <ToolbarBtn onClick={() => exec('bold')}><Bold size={12} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec('italic')}><Italic size={12} /></ToolbarBtn>
        <ToolbarBtn onClick={() => exec('insertUnorderedList')}>•</ToolbarBtn>
        <ToolbarBtn onClick={insertLink}><LinkIcon size={12} /></ToolbarBtn>
        {canvasReady && (
          <>
            <ToolbarBtn onClick={() => openCanvasPicker('files')} title="Insert Canvas file link">
              <FileText size={12} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => openCanvasPicker('pages')} title="Insert Canvas page link">
              <BookOpen size={12} />
            </ToolbarBtn>
          </>
        )}
        <div className="ml-auto flex gap-1">
          <button onClick={onCancel} style={{ fontFamily: FONT_MONO, fontSize: '10px', padding: '4px 8px', color: T.muted, border: `1px solid ${T.border}`, borderRadius: 2, background: T.paper }}>
            Cancel
          </button>
          <button onClick={() => onSave(ref.current?.innerHTML || '')} style={{ fontFamily: FONT_MONO, fontSize: '10px', padding: '4px 8px', color: '#fff', border: 'none', borderRadius: 2, background: T.inkBlue }}>
            Save
          </button>
        </div>
      </div>
      {canvasPicker && (
        <div style={{
          border: `1px solid ${T.border}`, borderRadius: 3, background: T.paper,
          maxHeight: 180, overflowY: 'auto', marginBottom: 6, fontSize: '12px',
        }}>
          <div className="flex items-center justify-between" style={{ padding: '6px 8px', borderBottom: `1px solid ${T.border}`, background: T.subtle }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: T.muted }}>
              {canvasPicker.type === 'files' ? 'Course files' : 'Course pages'}
            </span>
            <button onClick={() => setCanvasPicker(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.muted, padding: 0 }}>
              <X size={12} />
            </button>
          </div>
          {canvasPicker.error ? (
            <div style={{ padding: 8, color: T.ox }}>Failed to load</div>
          ) : canvasPicker.items.length === 0 ? (
            <div style={{ padding: 8, color: T.muted }}>No {canvasPicker.type} found</div>
          ) : (
            canvasPicker.items.map((item) => (
              <button
                key={item.id || item.url}
                onClick={() => pickCanvasItem(item)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px',
                  background: 'none', border: 'none', borderBottom: `1px solid ${T.subtle}`,
                  cursor: 'pointer', fontSize: '12px', color: T.ink, fontFamily: FONT_BODY,
                }}
                onMouseEnter={(e) => { e.target.style.background = T.inkBlueSoft; }}
                onMouseLeave={(e) => { e.target.style.background = 'none'; }}
              >
                {canvasPicker.type === 'files' ? item.display_name : item.title}
              </button>
            ))
          )}
        </div>
      )}
      <div
        ref={ref}
        className="planner-rich"
        contentEditable
        suppressContentEditableWarning
        style={{
          fontFamily: FONT_BODY, fontSize: '14px', color: T.inkMid, lineHeight: 1.5,
          minHeight: 60, padding: 8, border: `1px solid ${T.borderStrong}`,
          borderRadius: 3, background: T.cream,
        }}
      />
    </div>
  );
}

// ============================================================
// SETUP PANEL
// ============================================================
function SetupPanel({ state, updateState, onClose }) {
  const [title, setTitle] = useState(state.setup.courseTitle);
  const [start, setStart] = useState(state.setup.startDate);
  const [end, setEnd] = useState(state.setup.endDate);
  const [days, setDays] = useState(state.setup.classDays);
  const toggleDay = (c) =>
    setDays((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  const apply = () => {
    updateState((s) => {
      s.setup = { courseTitle: title, startDate: start, endDate: end, classDays: days };
      return s;
    });
    onClose();
  };
  return (
    <div style={{ background: T.paper, borderBottom: `1px solid ${T.border}` }}>
      <div className="planner-header" style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: '18px', fontWeight: 600 }}>Course setup</h2>
          <IconButton onClick={onClose}><X size={16} /></IconButton>
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field label="Course title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Semester start">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Semester end">
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Class meeting days">
            <div className="flex gap-2 flex-wrap">
              {DAY_CODES.map((c) => (
                <button key={c} onClick={() => toggleDay(c)}
                  style={{
                    padding: '6px 12px', borderRadius: 2,
                    fontFamily: FONT_MONO, fontSize: '11px', letterSpacing: '0.1em',
                    border: `1px solid ${days.includes(c) ? T.inkBlue : T.border}`,
                    background: days.includes(c) ? T.inkBlue : T.paper,
                    color: days.includes(c) ? '#fff' : T.muted,
                  }}>
                  {DAY_SHORT[c]}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <ActionButton onClick={apply} primary>Apply</ActionButton>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CANVAS PANEL
// ============================================================
function CanvasPanel({ state, updateState, onConnect, onRefresh, onSwitchCourse, onClose }) {
  const [baseUrl, setBaseUrl] = useState(state.canvas.baseUrl || '');
  const [token, setToken] = useState(state.canvas.token || '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const doConnect = async () => {
    setBusy(true);
    setStatus(null);
    const result = await onConnect(baseUrl.trim(), token.trim());
    if (result.ok) {
      setStatus({ msg: `Connected — ${result.count} courses found`, kind: 'ok' });
    } else {
      setStatus({ msg: result.error, kind: 'err' });
    }
    setBusy(false);
  };
  return (
    <div style={{ background: T.paper, borderBottom: `1px solid ${T.border}` }}>
      <div className="planner-header" style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: '18px', fontWeight: 600 }}>Canvas connection</h2>
          <IconButton onClick={onClose}><X size={16} /></IconButton>
        </div>
        <p style={{ color: T.muted, fontSize: '13px', marginBottom: 16, maxWidth: 760 }}>
          Generate a Personal Access Token in Canvas (Account → Settings → "+ New Access Token").
          Refresh imports every Canvas assignment as a draggable card on its due date.
          Off-day due dates are added to the schedule automatically.
        </p>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <Field label="Canvas base URL">
            <input placeholder="https://canvas.youruniversity.edu"
              value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Personal Access Token">
            <input type="password" placeholder="paste token…"
              value={token} onChange={(e) => setToken(e.target.value)} style={inputStyle} />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <ActionButton onClick={doConnect} primary>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Cloud size={14} />}
            {state.canvas.connected ? 'Reconnect' : 'Connect'}
          </ActionButton>
          {state.canvas.connected && (
            <>
              <span style={{ color: T.forest, fontSize: '12px', fontFamily: FONT_MONO }}>
                <Check size={12} style={{ display: 'inline', marginRight: 4 }} />
                Connected
              </span>
              <select
                value={state.canvas.courseId || ''}
                onChange={(e) => onSwitchCourse(e.target.value)}
                style={{ ...inputStyle, width: 'auto', minWidth: 220 }}>
                <option value="">— pick a course —</option>
                {state.canvas.courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ActionButton onClick={onRefresh}>
                <RefreshCw size={14} /> Refresh
              </ActionButton>
            </>
          )}
        </div>
        {status && (
          <div style={{
            marginTop: 14, padding: 10, borderRadius: 3, fontSize: '12px', display: 'flex', gap: 8,
            background: status.kind === 'ok' ? '#e8f5e9' : '#fbe9e7',
            border: `1px solid ${status.kind === 'ok' ? '#a5d6a7' : '#ef9a9a'}`,
            color: status.kind === 'ok' ? T.forest : T.ox,
          }}>
            {status.kind === 'ok' ? <Check size={14} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />}
            <span>{status.msg}</span>
          </div>
        )}
        {!state.canvas.connected && !status && (
          <div style={{ marginTop: 14, padding: 10, background: T.subtle, border: `1px solid ${T.border}`, borderRadius: 3, fontSize: '12px', color: T.muted, display: 'flex', gap: 8 }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              If connecting fails, your browser may be blocking cross-origin requests (CORS).
              Try a CORS-unblock extension or deploy a small CORS proxy.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SMALL UI PIECES
// ============================================================
const inputStyle = {
  width: '100%', padding: '7px 10px', border: `1px solid ${T.border}`, borderRadius: 3,
  fontFamily: FONT_BODY, fontSize: '13px', color: T.ink, background: T.paper,
};
const iconBtnStyle = { color: T.muted, padding: 2, background: 'transparent', border: 'none', cursor: 'pointer' };
const pillStyle = (color, bg) => ({
  fontFamily: FONT_MONO, fontSize: '9px', letterSpacing: '0.18em',
  textTransform: 'uppercase', color, background: bg,
  padding: '2px 6px', borderRadius: 2,
});

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.16em', textTransform: 'uppercase', color: T.muted, marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </label>
  );
}
function IconButton({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title}
      style={{ padding: 8, border: `1px solid ${T.border}`, borderRadius: 3, background: T.paper, color: T.ink, cursor: 'pointer' }}>
      {children}
    </button>
  );
}
function ToggleButton({ active, children, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 12px', borderRadius: 3,
        fontFamily: FONT_MONO, fontSize: '11px', letterSpacing: '0.08em',
        border: `1px solid ${active ? T.inkBlue : T.border}`,
        background: active ? T.inkBlue : T.paper,
        color: active ? '#fff' : T.ink,
        cursor: 'pointer', textTransform: 'uppercase',
      }}>
      {children}
    </button>
  );
}
function ActionButton({ children, onClick, primary }) {
  return (
    <button onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 3,
        fontFamily: FONT_BODY, fontSize: '13px', fontWeight: 500,
        border: `1px solid ${primary ? T.inkBlue : T.border}`,
        background: primary ? T.inkBlue : T.paper,
        color: primary ? '#fff' : T.ink,
        cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}
function ToolbarBtn({ children, onClick }) {
  return (
    <button onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      style={{
        padding: '4px 8px', border: `1px solid ${T.border}`, background: T.paper,
        color: T.muted, borderRadius: 2, fontFamily: FONT_MONO, fontSize: '11px',
        minWidth: 24, cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}
function DayToolBtn({ children, onClick, title, disabled }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '4px 8px', border: `1px solid ${T.border}`, background: T.paper,
        color: disabled ? T.faint : T.muted, borderRadius: 2,
        fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.06em',
        textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}>
      {children}
    </button>
  );
}
function EmptyState({ onSetup }) {
  return (
    <div style={{
      background: T.paper, border: `1px dashed ${T.borderStrong}`, borderRadius: 4,
      padding: 48, textAlign: 'center',
    }}>
      <Calendar size={28} color={T.muted} style={{ margin: '0 auto 12px' }} />
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: '20px', color: T.ink, marginBottom: 6 }}>
        Set semester dates to begin
      </div>
      <div style={{ fontSize: '13px', color: T.muted, marginBottom: 18 }}>
        Pick your start and end dates and which weekdays you teach.
      </div>
      <ActionButton onClick={onSetup} primary><Settings size={14} /> Open setup</ActionButton>
    </div>
  );
}
