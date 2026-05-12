/**
 * Course-clone service: orchestrates copying a Canvas course's content
 * into the currently-selected target course, plus optionally importing
 * the source's planner schedule (notes, modules, holidays, etc.) into
 * planner state with date-remapping.
 *
 * Top-level entry point is `cloneCourseFrom(sourceCourseId, onProgress,
 * shouldStop, overwrite)` returned from `createCourseClone(deps)`. The
 * factory binds the handlers to a stable set of dependencies so the
 * function identities don't churn across renders.
 *
 * The flow:
 *   1. Validate input (target connected, source !== target, dates set).
 *   2. Pre-load source planner state from localStorage or source's
 *      Canvas Files. Use it to compute Canvas date_shift_options.
 *   3. (overwrite mode) Try Canvas Course Reset; on 403 fall back to
 *      per-item DELETEs via manuallyWipeCourse. Clear local state.
 *   4. Trigger the Canvas content_migrations course-copy.
 *   5. Poll progress with adaptive backoff until completed/failed.
 *   6. finishWithSchedule:
 *      - Try the post-migration target-files lookup if no source state
 *        was found earlier (the source's schedule-planner.json may
 *        have ridden along in the migration).
 *      - importScheduleFromSource: remap notes/modules onto target dates,
 *        relink assignments by title, rewrite embedded links, throttled
 *        push of planner-authoritative dates back to Canvas.
 *      - Pull target's assignments + assignment groups (non-destructively
 *        merge into planner state).
 *
 * Helpers exported individually so they can be tested in isolation:
 *   manuallyWipeCourse, loadSourcePlannerState, buildLinkRemap.
 */

import { CanvasAPI } from '../canvas-api.js';
import { Store } from '../utils/store.js';
import { uid } from '../utils/uid.js';
import { localDateStr, generateClassDays } from '../utils/dates.js';
import { exportTemplate, importTemplate } from '../utils/template.js';
import { rewriteEmbeddedLinks } from '../utils/link-rewrite.js';
import { debugLog } from '../utils/debug.js';
import { GROUP_COLORS } from '../theme.js';
import { assignmentIsQuiz } from './canvas-sync.js';
import {
  DATE_PUSH_BATCH_SIZE, DATE_PUSH_SLEEP_MS,
  WIPE_DELETE_BATCH_SIZE, WIPE_DELETE_SLEEP_MS,
  CLONE_POLL_FAST_MS, CLONE_POLL_SLOW_MS, CLONE_POLL_VERY_SLOW_MS,
  CLONE_POLL_FAST_WINDOW_SEC, CLONE_POLL_SLOW_WINDOW_SEC,
} from '../config.js';

/**
 * Per-item delete fallback for courses where the user's token lacks
 * Canvas Course Reset permission. Enumerates content per type and
 * deletes via the standard edit endpoints (which most instructor tokens
 * DO have). Slower than `reset_content` (hundreds of round trips on a
 * populated course), but works for everyone with normal content-edit
 * permissions.
 *
 * Throttled — see WIPE_DELETE_BATCH_SIZE / WIPE_DELETE_SLEEP_MS in
 * config.js. 404 errors are treated as already-deleted (Canvas
 * cascades, e.g. quiz deletes can race with assignment deletes that
 * share a backing record).
 *
 * Returns `{ total, deleted, failures }`.
 */
export async function manuallyWipeCourse(baseUrl, token, courseId, onProgress) {
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
}

/**
 * Find the source course's saved planner state, trying localStorage
 * first then the source's Canvas Files (`schedule-planner.json`).
 * Returns null if neither is available.
 *
 * Populates `diag.localStorage` and `diag.sourceCanvasFiles` (if `diag`
 * is provided) with what each lookup returned, for the panel to show.
 */
export async function loadSourcePlannerState(sourceCourseId, baseUrl, token, diag) {
  try {
    const local = await Store.load(sourceCourseId);
    if (diag) diag.localStorage = local && local.items
      ? `found (${Object.keys(local.items).length} items)`
      : 'not found';
    if (local && local.items && local.setup) {
      debugLog('[CanvasSchedulePlugin] Source planner state found in localStorage');
      return local;
    }
  } catch (e) { if (diag) diag.localStorage = `error: ${e.message}`; }
  try {
    const remote = await CanvasAPI.downloadSchedule(baseUrl, token, sourceCourseId);
    if (diag) diag.sourceCanvasFiles = remote && remote.items
      ? `found (${Object.keys(remote.items).length} items)`
      : 'no schedule-planner.json found';
    if (remote && remote.items && remote.setup) {
      debugLog('[CanvasSchedulePlugin] Source planner state found in source\'s Canvas Files');
      return remote;
    }
  } catch (e) { if (diag) diag.sourceCanvasFiles = `error: ${e.message}`; }
  return null;
}

/**
 * Build oldId → newId maps for each Canvas content type by listing
 * source + target courses and matching items by name. Pages match by
 * URL slug (which Canvas's course copy preserves).
 *
 * Files use a refined matching scheme: first try (display_name, size),
 * fall back to display_name alone. If multiple target files match a
 * single source file, pick the first but record an ambiguity warning —
 * Canvas may have renamed the copied file due to a name conflict.
 *
 * Returns `{ remap, ambiguousFiles, sourceNames }`. `sourceNames` is
 * `{ [type]: { [oldId]: friendlyName } }` so unmatched-link warnings
 * can show actual filenames instead of opaque numeric IDs.
 *
 * Any single fetch failure returns an empty map for that type rather
 * than aborting — rewriteEmbeddedLinks preserves unmapped inner IDs.
 */
export async function buildLinkRemap(baseUrl, token, sourceId, targetId) {
  const types = [
    { key: 'assignments',       api: 'listAssignments',       nameField: 'name',  idField: 'id' },
    { key: 'quizzes',           api: 'listQuizzes',           nameField: 'title', idField: 'id' },
    { key: 'pages',             api: 'listAllPages',          nameField: 'url',   idField: 'url' },
    { key: 'modules',           api: 'listModules',           nameField: 'name',  idField: 'id' },
    { key: 'discussion_topics', api: 'listDiscussionTopics',  nameField: 'title', idField: 'id' },
  ];
  const remap = {};
  const ambiguousFiles = [];
  const sourceNames = {};

  await Promise.all([
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
          map[oldId] = String(candidates[0].id);
          ambiguousFiles.push({ filename: f.display_name, candidates: candidates.length });
        }
      });
      remap.files = map;
      sourceNames.files = namesForFiles;
    })(),
  ]);

  return { remap, ambiguousFiles, sourceNames };
}

/**
 * Build the cloneCourseFrom handler bound to the given dependencies.
 *
 * @param {object} deps
 * @param {React.MutableRefObject} deps.stateRef
 * @param {(fn, skipUndo?: boolean) => void} deps.updateState
 * @param {(msg, kind?) => void} deps.showToast
 */
export function createCourseClone({ stateRef, updateState, showToast }) {

  /**
   * Pull the source course's planner state and re-map it onto the
   * current target's semester. See file-top docstring for the full
   * pipeline. Returns a summary object that the panel renders.
   */
  const importScheduleFromSource = async (sourceCourseId, sourceState, onProgress) => {
    const s = stateRef.current;
    if (!sourceState) return { hadSource: false };

    const template = exportTemplate(sourceState);
    const result = importTemplate(template, s.setup);
    const warnings = [];

    debugLog('[CanvasSchedulePlugin] Schedule remap diagnostic', {
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

    // Build the embedded-link remap and the target's assignment list in parallel.
    const [remapResult, assignmentList] = await Promise.all([
      buildLinkRemap(s.canvas.baseUrl, s.canvas.token, sourceCourseId, s.canvas.courseId),
      CanvasAPI.listAssignments(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId).catch(() => []),
    ]);
    const linkRemap = remapResult.remap;
    const sourceNames = remapResult.sourceNames || {};
    (remapResult.ambiguousFiles || []).forEach((f) => {
      warnings.push({ kind: 'ambiguous-file', filename: f.filename, candidates: f.candidates });
    });

    // Detect title collisions in the source assignment list — they make
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
            // Pages keep their slug across course copy — don't warn on those.
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
    // assignments. Throttled — see DATE_PUSH_* in config.js.
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

    // Pre-load source planner state so we can compute date_shift_options
    // and have it ready for import once the migration completes.
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

    // Destructive pre-step: wipe the target course before copying. Try
    // Canvas Course Reset first; on 403 fall back to per-item DELETEs.
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

      // Clear local planner state so old cards with stale canvasIds don't
      // linger after Canvas-side content is gone.
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

    // Adaptive polling: faster at the start, slower after it's clearly
    // taking a while. No hard timeout — Canvas can be slow on big courses.
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
      // target's Files too.
      let effectiveSourceState = sourceState;
      if (!effectiveSourceState) {
        try {
          const files = await CanvasAPI.listFiles(s.canvas.baseUrl, s.canvas.token, s.canvas.courseId);
          debugLog('[CanvasSchedulePlugin] Post-migration files in target:',
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

      // Step 1: import the source course's planner state if available.
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

      // Step 2: pull the target course's assignments + assignment groups
      // into planner state. Non-destructive: existing items matched by
      // canvasId just get field refreshes; new Canvas items get added
      // fresh. Without this step the planner would stay empty even when
      // Canvas has all the copied assignments (the typical "fresh
      // target, no source planner state" case).
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

      // Toast.
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

  return { cloneCourseFrom };
}
