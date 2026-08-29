/**
 * Canvas LMS API client — handles CORS proxying, authentication, and
 * all Canvas REST calls (courses, assignments, files, pages).
 *
 * In development (Vite dev server), requests go through Vite's built-in
 * proxy to avoid CORS. In production, they route through a Cloudflare
 * Worker CORS proxy whose URL is configurable per-institution.
 */

// ── CORS proxy configuration ──────────────────────────────────
// Priority: VITE_CORS_PROXY env var > localStorage setting > hardcoded default.
// The Canvas panel UI lets instructors override via localStorage.

const IS_DEV = import.meta.env.DEV;

export const CORS_PROXY_DEFAULT = 'https://canvas-cors-proxy.qsnell.workers.dev';

export function getCorsProxy() {
  const env = import.meta.env.VITE_CORS_PROXY;
  if (env) return env.replace(/\/+$/, '');
  try {
    const v = localStorage.getItem('planner-cors-proxy');
    if (v) return v;
  } catch {}
  return CORS_PROXY_DEFAULT;
}

/** Mutable — updated when the user changes the proxy URL in settings. */
export let CORS_PROXY = getCorsProxy();

export function setCorsProxy(url) {
  CORS_PROXY = url;
}

// ── iCal subscription feed (Cloudflare Worker + KV) ───────────
// On every Publish, the planner PUTs the .ics to the worker. The worker
// validates the caller's Canvas PAT against Canvas itself (no shared
// upload secret) — each professor's own token is the credential. If the
// worker isn't deployed with /calendar/* support, the upload returns
// non-OK and the caller falls back to the auth-gated Canvas Files link.

/** Stable per-course key: <canvas-host>-<courseId>. URL-path safe. */
export function icalCourseKey(baseUrl, courseId) {
  const host = new URL(baseUrl).host;
  return `${host}-${courseId}`;
}

/** Public subscription URL students paste into Google/Apple/Outlook. */
export function icalFeedUrl(baseUrl, courseId, workerBase = CORS_PROXY) {
  return `${workerBase.replace(/\/+$/, '')}/calendar/${encodeURIComponent(icalCourseKey(baseUrl, courseId))}.ics`;
}

/**
 * Push the latest .ics to the worker, authenticated by the professor's
 * Canvas PAT. Returns a discriminated result so callers can surface
 * the actual outcome to the user instead of silently falling back.
 *
 *   { ok: true, url }                 — uploaded; subscribe URL ready
 *   { ok: false, reason, status, body }  — failed; reason is short, body is verbose
 */
export async function uploadIcalFeed(baseUrl, token, courseId, icsText) {
  if (!token) return { ok: false, reason: 'no Canvas token in planner state' };
  const url = icalFeedUrl(baseUrl, courseId);
  let resp;
  try {
    resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/calendar',
        Authorization: `Bearer ${token}`,
      },
      body: icsText,
    });
  } catch (e) {
    return { ok: false, reason: `network error: ${e.message}` };
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    return { ok: false, reason: `worker returned ${resp.status}`, status: resp.status, body };
  }
  return { ok: true, url };
}

// ── URL rewriting ──────────────────────────────────────────────

/**
 * Rewrite an absolute Canvas URL for the current environment.
 * Dev: strip the base to use Vite's proxy (/api/v1/...).
 * Prod: route through the CORS proxy worker.
 */
export function proxyUrl(absoluteUrl, baseUrl) {
  if (!absoluteUrl || !baseUrl) return absoluteUrl;
  const base = baseUrl.replace(/\/+$/, '');
  if (IS_DEV) {
    return absoluteUrl.startsWith(base) ? absoluteUrl.slice(base.length) : absoluteUrl;
  }
  const host = new URL(base).host;
  return absoluteUrl.startsWith(base)
    ? `${CORS_PROXY}/${host}${absoluteUrl.slice(base.length)}`
    : absoluteUrl;
}

// ── Low-level fetch wrapper ────────────────────────────────────

async function canvasFetch(baseUrl, token, path, opts = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  const host = new URL(base).host;
  const url = IS_DEV
    ? `/api/v1${path}`
    : `${CORS_PROXY}/${host}/api/v1${path}`;

  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
  if (opts.body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Canvas ${res.status}: ${text.slice(0, 180) || res.statusText}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

/**
 * Parse a Link header (RFC 5988) and return the URL for the given rel, or null.
 * Example header: `<https://…?page=2&per_page=100>; rel="next", <https://…>; rel="last"`
 */
function parseLinkHeader(header, rel) {
  if (!header) return null;
  const parts = header.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match && match[2] === rel) return match[1];
  }
  return null;
}

/**
 * Fetch all pages of a paginated Canvas API endpoint.
 * Follows `rel="next"` Link headers until exhausted, concatenating all
 * result arrays into a single array. Designed for GET list endpoints.
 */
async function canvasFetchAll(baseUrl, token, path) {
  const base = baseUrl.replace(/\/+$/, '');
  const host = new URL(base).host;
  let url = IS_DEV
    ? `/api/v1${path}`
    : `${CORS_PROXY}/${host}/api/v1${path}`;

  const allResults = [];

  while (url) {
    const headers = { Authorization: `Bearer ${token}` };
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Canvas ${res.status}: ${text.slice(0, 180) || res.statusText}`);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : [];
    if (Array.isArray(data)) {
      allResults.push(...data);
    } else {
      // Unexpected non-array response; return it directly for safety
      return data;
    }

    // Follow the next page link if present
    const linkHeader = res.headers.get('Link');
    const nextUrl = parseLinkHeader(linkHeader, 'next');
    if (nextUrl) {
      // The Link header URL is absolute (pointing at Canvas). Rewrite it
      // through the CORS proxy / dev proxy just like the initial request.
      url = proxyUrl(nextUrl, base);
    } else {
      url = null;
    }
  }

  return allResults;
}

// ── Canvas API methods ─────────────────────────────────────────

const SCHEDULE_FILENAME = 'schedule-planner.json';
const ICAL_FILENAME = 'schedule.ics';

/**
 * Upload a single file to a course's Files area via Canvas's 3-step
 * upload flow. Deletes any existing file with the same display_name
 * first so the URL stays stable across re-publishes (subscribers don't
 * see a 404).
 */
/**
 * Get a Canvas-issued public URL for a course file by display_name.
 * Returns null if the file doesn't exist. The URL is presigned and
 * stable across re-publishes (Canvas reuses the same file id).
 */
async function getPublicFileUrl(baseUrl, token, courseId, filename) {
  const files = await canvasFetch(baseUrl, token,
    `/courses/${courseId}/files?search_term=${filename}&per_page=10`);
  const file = files.find((f) => f.display_name === filename || f.filename === filename);
  if (!file) return null;
  const meta = await canvasFetch(baseUrl, token, `/files/${file.id}/public_url`);
  return meta.public_url;
}

async function uploadCourseFile(baseUrl, token, courseId, filename, contentType, blob, options = {}) {
  const { onDuplicate = 'overwrite', parentFolderPath = '/', preDelete = true } = options;

  // For internal well-known files (schedule JSON, iCal) we pre-delete so a
  // failed overwrite doesn't leave two copies with the same display_name.
  // For user uploads (onDuplicate: 'rename') we skip this — Canvas handles
  // collisions by suffixing "-1", "-2", etc., and we never want to delete
  // an instructor's other course files.
  if (preDelete) {
    try {
      const files = await canvasFetch(baseUrl, token,
        `/courses/${courseId}/files?search_term=${filename}&per_page=10`);
      const existing = files.find((f) => f.display_name === filename || f.filename === filename);
      if (existing) {
        await canvasFetch(baseUrl, token, `/files/${existing.id}`, { method: 'DELETE' });
      }
    } catch { /* ok if delete fails */ }
  }

  // Step 1: Request an upload URL from Canvas
  const step1 = await canvasFetch(baseUrl, token, `/courses/${courseId}/files`, {
    method: 'POST',
    body: JSON.stringify({
      name: filename,
      content_type: contentType,
      size: blob.size,
      on_duplicate: onDuplicate,
      parent_folder_path: parentFolderPath,
    }),
  });

  // Step 2: POST the file to the upload URL (may be S3 or same-domain)
  const form = new FormData();
  Object.entries(step1.upload_params).forEach(([k, v]) => form.append(k, v));
  form.append('file', blob, filename);
  const uploadUrl = proxyUrl(step1.upload_url, baseUrl);
  const step2 = await fetch(uploadUrl, { method: 'POST', body: form, redirect: 'follow' });

  if (step2.status >= 400) {
    throw new Error(`File upload failed: ${step2.status}`);
  }
  // Step 3: If Canvas returned a redirect, follow it to confirm the upload.
  // The confirmation response is the created file's metadata (id, display_name,
  // url, etc.) — we return it so callers that need to link to the file can.
  if (step2.status >= 300) {
    const confirmUrl = step2.headers.get('Location');
    if (confirmUrl) {
      const confirmRes = await fetch(proxyUrl(confirmUrl, baseUrl), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (confirmRes.ok) {
        const text = await confirmRes.text().catch(() => '');
        try { return text ? JSON.parse(text) : true; } catch { return true; }
      }
    }
  }
  // With redirect: 'follow' the finalization response may already be here.
  // Try to parse it — if it's Canvas's file metadata, hand it back.
  try {
    const text = await step2.text();
    if (text) {
      const meta = JSON.parse(text);
      if (meta && meta.id) return meta;
    }
  } catch { /* not JSON — caller can look up by name */ }
  return true;
}

/**
 * Find a course file by display_name. Returns the newest match (Canvas
 * appends "-1", "-2", ... on rename, so exact match may not exist).
 * Used as a fallback for `uploadUserFile` when the upload flow doesn't
 * return the created file's metadata (S3→Canvas redirect CORS-blocked, etc.).
 */
async function findRecentCourseFile(baseUrl, token, courseId, filename) {
  const files = await canvasFetch(baseUrl, token,
    `/courses/${courseId}/files?search_term=${encodeURIComponent(filename)}&per_page=25&sort=created_at&order=desc`);
  if (!Array.isArray(files) || files.length === 0) return null;
  const exact = files.find((f) => f.display_name === filename || f.filename === filename);
  if (exact) return exact;
  // Fallback: pick the newest file whose display_name starts with the
  // filename's basename (Canvas may have appended "-1", "-2", ...).
  const base = filename.replace(/\.[^.]+$/, '');
  const matches = files.filter((f) => (f.display_name || '').startsWith(base));
  if (matches.length === 0) return null;
  matches.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return matches[0];
}

export const CanvasAPI = {
  /** List courses where the user is a teacher (paginated). */
  listCourses: (b, t) =>
    canvasFetchAll(b, t, '/courses?enrollment_type=teacher&state[]=available&state[]=unpublished&state[]=created&include[]=term&per_page=100'),

  /** Fetch a single course, including its term (for start/end dates). */
  getCourse: (b, t, c) =>
    canvasFetch(b, t, `/courses/${c}?include[]=term`),

  /** List all assignments in a course (paginated). */
  listAssignments: (b, t, c) =>
    canvasFetchAll(b, t, `/courses/${c}/assignments?per_page=100`),

  /** List assignment groups in a course (paginated). */
  listAssignmentGroups: (b, t, c) =>
    canvasFetchAll(b, t, `/courses/${c}/assignment_groups?per_page=100`),

  /** List files in a course (paginated, for the rich editor's file picker). */
  listFiles: (b, t, c) =>
    canvasFetchAll(b, t, `/courses/${c}/files?per_page=100&sort=name`),

  /** List published pages in a course (paginated, for the rich editor's page picker). */
  listPages: (b, t, c) =>
    canvasFetchAll(b, t, `/courses/${c}/pages?per_page=100&sort=title&published=true`),

  /** List all pages including drafts (for course-copy link remap). */
  listAllPages: (b, t, c) =>
    canvasFetchAll(b, t, `/courses/${c}/pages?per_page=100&sort=title`),

  /** List quizzes (Classic Quiz engine). New Quizzes use a separate API. */
  listQuizzes: (b, t, c) =>
    canvasFetchAll(b, t, `/courses/${c}/quizzes?per_page=100`),

  /** List modules in a course. */
  listModules: (b, t, c) =>
    canvasFetchAll(b, t, `/courses/${c}/modules?per_page=100`),

  /** List discussion topics in a course. */
  listDiscussionTopics: (b, t, c) =>
    canvasFetchAll(b, t, `/courses/${c}/discussion_topics?per_page=100`),

  /** Update an assignment's due date. */
  setDueDate: (b, t, c, a, dueAtISO) =>
    canvasFetch(b, t, `/courses/${c}/assignments/${a}`, {
      method: 'PUT',
      body: JSON.stringify({ assignment: { due_at: dueAtISO } }),
    }),

  /** Rename an assignment. */
  renameAssignment: (b, t, c, a, name) =>
    canvasFetch(b, t, `/courses/${c}/assignments/${a}`, {
      method: 'PUT',
      body: JSON.stringify({ assignment: { name } }),
    }),

  /** Publish or unpublish an assignment (works for classic quizzes too). */
  setPublished: (b, t, c, a, published) =>
    canvasFetch(b, t, `/courses/${c}/assignments/${a}`, {
      method: 'PUT',
      body: JSON.stringify({ assignment: { published: !!published } }),
    }),

  /** Delete an assignment in Canvas (also removes the backing quiz, if any). */
  deleteAssignment: (b, t, c, a) =>
    canvasFetch(b, t, `/courses/${c}/assignments/${a}`, { method: 'DELETE' }),

  /** Delete a Classic Quiz by ID. */
  deleteQuiz: (b, t, c, q) =>
    canvasFetch(b, t, `/courses/${c}/quizzes/${q}`, { method: 'DELETE' }),

  /** Delete a wiki page by URL slug. */
  deletePage: (b, t, c, urlSlug) =>
    canvasFetch(b, t, `/courses/${c}/pages/${encodeURIComponent(urlSlug)}`, { method: 'DELETE' }),

  /** Delete a module by ID. */
  deleteModule: (b, t, c, m) =>
    canvasFetch(b, t, `/courses/${c}/modules/${m}`, { method: 'DELETE' }),

  /** Delete a discussion topic (includes announcements). */
  deleteDiscussionTopic: (b, t, c, d) =>
    canvasFetch(b, t, `/courses/${c}/discussion_topics/${d}`, { method: 'DELETE' }),

  /** Delete a file by ID (not scoped to course — Canvas's files API is global). */
  deleteFile: (b, t, fileId) =>
    canvasFetch(b, t, `/files/${fileId}`, { method: 'DELETE' }),

  /**
   * Reset a course to a blank state: Canvas archives all current content and
   * creates a fresh course with the same ID. Use ONLY for destructive
   * "overwrite everything" flows. Requires the user's token to have the
   * Course Reset permission. Returns the new course record.
   */
  resetCourseContent: (b, t, c) =>
    canvasFetch(b, t, `/courses/${c}/reset_content`, { method: 'POST' }),

  /**
   * Upload schedule JSON to Canvas course files. Used by the Publish flow
   * for cross-device persistence and for the student-view embed.
   */
  uploadSchedule(baseUrl, token, courseId, data) {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    return uploadCourseFile(baseUrl, token, courseId, SCHEDULE_FILENAME, 'application/json', blob);
  },

  /**
   * Upload an iCal (.ics) export to Canvas course files. Students can
   * subscribe to the resulting public URL from Google/Apple Calendar
   * and get auto-updates whenever the instructor re-publishes.
   */
  uploadIcal(baseUrl, token, courseId, icsText) {
    const blob = new Blob([icsText], { type: 'text/calendar' });
    return uploadCourseFile(baseUrl, token, courseId, ICAL_FILENAME, 'text/calendar', blob);
  },

  /**
   * Upload an arbitrary user-chosen file (slides, PDF, etc.) into the
   * course's Files root. Canvas renames on collision (never overwrites
   * pre-existing files). Returns Canvas's file record — includes `id` and
   * `display_name`, which the caller uses to build a stable download link.
   *
   * If the upload flow doesn't return metadata directly (S3→Canvas
   * confirmation gets CORS-blocked in the browser), falls back to looking
   * the file up by name.
   */
  async uploadUserFile(baseUrl, token, courseId, file) {
    const meta = await uploadCourseFile(
      baseUrl, token, courseId,
      file.name, file.type || 'application/octet-stream', file,
      { onDuplicate: 'rename', preDelete: false },
    );
    if (meta && typeof meta === 'object' && meta.id) return meta;
    const found = await findRecentCourseFile(baseUrl, token, courseId, file.name);
    if (found) return found;
    throw new Error('Uploaded but could not locate the file in Canvas');
  },

  /** Download the published schedule JSON from Canvas course files. */
  async downloadSchedule(baseUrl, token, courseId) {
    const files = await canvasFetch(baseUrl, token,
      `/courses/${courseId}/files?search_term=${SCHEDULE_FILENAME}&per_page=10`);
    const target = SCHEDULE_FILENAME.toLowerCase();
    // Always pick the NEWEST match. uploadCourseFile tries to delete the
    // old file before uploading, but if delete fails silently (PAT lacks
    // delete permission, transient network) Canvas ends up with multiple
    // schedule-planner.json files and a naïve find() will return whichever
    // Canvas listed first — frequently the stale one.
    const matches = files.filter((f) => {
      const dn = (f.display_name || '').toLowerCase();
      const fn = (f.filename || '').toLowerCase();
      return dn === target || fn === target;
    });
    if (matches.length === 0) return null;
    matches.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    if (matches.length > 1) {
      // eslint-disable-next-line no-console
      console.warn(
        `[schedule] ${matches.length} duplicate ${SCHEDULE_FILENAME} files on Canvas — picking newest (id=${matches[0].id}, created=${matches[0].created_at}). ` +
        `Older copies (likely orphans from failed deletes) should be removed from Canvas Files.`
      );
    }
    const file = matches[0];

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

    const text = await res.text();
    try {
      const json = JSON.parse(text);
      // Canvas may return file metadata instead of content — follow the url field
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

  /** Get a public URL for the schedule JSON file (for student iframes). */
  async getPublicUrl(baseUrl, token, courseId) {
    return getPublicFileUrl(baseUrl, token, courseId, SCHEDULE_FILENAME);
  },

  /**
   * Get a public URL for the iCal subscription file. Subscribers paste
   * this into Google Calendar / Apple Calendar / Outlook to follow
   * schedule updates automatically.
   */
  async getPublicIcalUrl(baseUrl, token, courseId) {
    return getPublicFileUrl(baseUrl, token, courseId, ICAL_FILENAME);
  },

  /**
   * Permanent (auth-gated) download URL for the iCal file in this course's
   * Files. Stable across re-publishes since Canvas reuses the file id.
   * Returns null if the file isn't there.
   */
  async getIcalDownloadUrl(baseUrl, token, courseId) {
    const files = await canvasFetch(baseUrl, token,
      `/courses/${courseId}/files?search_term=${ICAL_FILENAME}&per_page=10`);
    const file = files.find((f) => f.display_name === ICAL_FILENAME || f.filename === ICAL_FILENAME);
    if (!file) return null;
    return `${baseUrl.replace(/\/+$/, '')}/courses/${courseId}/files/${file.id}/download?download_frd=1`;
  },

  /**
   * Trigger a server-side Canvas course copy. Canvas copies assignments,
   * quizzes, files, modules, pages, discussions, and rubrics from
   * sourceCourseId into targetCourseId, rewriting internal IDs and
   * embedded links. Returns the migration record (includes progress_url).
   *
   * The copy is additive — existing content in the target is preserved.
   *
   * `dateShiftOptions` (optional): when provided, Canvas redistributes due
   * dates from the source semester window into the target window. Shape:
   *   { shift_dates: true, old_start_date, old_end_date,
   *     new_start_date, new_end_date }
   * Without it, copied items keep their original (source-semester) dates.
   */
  cloneCourseContent: (baseUrl, token, targetCourseId, sourceCourseId, dateShiftOptions = null) => {
    const body = {
      migration_type: 'course_copy_importer',
      settings: { source_course_id: sourceCourseId },
    };
    if (dateShiftOptions) body.date_shift_options = dateShiftOptions;
    return canvasFetch(baseUrl, token, `/courses/${targetCourseId}/content_migrations`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /**
   * Poll a Canvas progress URL (absolute URL returned by content_migrations).
   * Returns `{ workflow_state: 'queued'|'running'|'completed'|'failed', completion: 0..100, message? }`.
   */
  async getProgress(baseUrl, token, progressUrl) {
    const url = proxyUrl(progressUrl, baseUrl);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Progress ${res.status}: ${text.slice(0, 180) || res.statusText}`);
    }
    return res.json();
  },

  /** Create or update a Canvas Page with the given title and HTML body. */
  async publishPage(baseUrl, token, courseId, title, html) {
    try {
      const pages = await canvasFetch(baseUrl, token,
        `/courses/${courseId}/pages?search_term=${encodeURIComponent(title)}&per_page=10`);
      const existing = pages.find((p) => p.title === title);
      if (existing) {
        await canvasFetch(baseUrl, token, `/courses/${courseId}/pages/${existing.url}`, {
          method: 'PUT',
          body: JSON.stringify({ wiki_page: { body: html, published: true } }),
        });
        return existing.url;
      }
    } catch { /* page not found — create below */ }

    const result = await canvasFetch(baseUrl, token, `/courses/${courseId}/pages`, {
      method: 'POST',
      body: JSON.stringify({ wiki_page: { title, body: html, published: true } }),
    });
    return result.url;
  },
};
