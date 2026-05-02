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

// ── Canvas API methods ─────────────────────────────────────────

const SCHEDULE_FILENAME = 'schedule-planner.json';

export const CanvasAPI = {
  /** List courses where the user is a teacher. */
  listCourses: (b, t) =>
    canvasFetch(b, t, '/courses?enrollment_type=teacher&state[]=available&state[]=unpublished&state[]=created&include[]=term&per_page=100'),

  /** List all assignments in a course. */
  listAssignments: (b, t, c) =>
    canvasFetch(b, t, `/courses/${c}/assignments?per_page=100`),

  /** List files in a course (for the rich editor's file picker). */
  listFiles: (b, t, c) =>
    canvasFetch(b, t, `/courses/${c}/files?per_page=100&sort=name`),

  /** List published pages in a course (for the rich editor's page picker). */
  listPages: (b, t, c) =>
    canvasFetch(b, t, `/courses/${c}/pages?per_page=100&sort=title&published=true`),

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

  /**
   * Upload schedule JSON to Canvas course files.
   * Uses Canvas's 3-step file upload flow: request URL, POST file, confirm.
   */
  async uploadSchedule(baseUrl, token, courseId, data) {
    const jsonStr = JSON.stringify(data);
    const blob = new Blob([jsonStr], { type: 'application/json' });

    // Delete existing file first to avoid accumulating versions
    try {
      const files = await canvasFetch(baseUrl, token,
        `/courses/${courseId}/files?search_term=${SCHEDULE_FILENAME}&per_page=10`);
      const existing = files.find((f) => f.display_name === SCHEDULE_FILENAME || f.filename === SCHEDULE_FILENAME);
      if (existing) {
        await canvasFetch(baseUrl, token, `/files/${existing.id}`, { method: 'DELETE' });
      }
    } catch { /* ok if delete fails */ }

    // Step 1: Request an upload URL from Canvas
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

    // Step 2: POST the file to the upload URL (may be S3 or same-domain)
    const form = new FormData();
    Object.entries(step1.upload_params).forEach(([k, v]) => form.append(k, v));
    form.append('file', blob, SCHEDULE_FILENAME);
    const uploadUrl = proxyUrl(step1.upload_url, baseUrl);
    const step2 = await fetch(uploadUrl, { method: 'POST', body: form, redirect: 'follow' });

    if (step2.status >= 400) {
      throw new Error(`File upload failed: ${step2.status}`);
    }
    // Step 3: If Canvas returned a redirect, follow it to confirm the upload
    if (step2.status >= 300) {
      const confirmUrl = step2.headers.get('Location');
      if (confirmUrl) {
        await fetch(proxyUrl(confirmUrl, baseUrl), { headers: { Authorization: `Bearer ${token}` } });
      }
    }
    return true;
  },

  /** Download the published schedule JSON from Canvas course files. */
  async downloadSchedule(baseUrl, token, courseId) {
    const files = await canvasFetch(baseUrl, token,
      `/courses/${courseId}/files?search_term=${SCHEDULE_FILENAME}&per_page=10`);
    const file = files.find((f) => f.display_name === SCHEDULE_FILENAME || f.filename === SCHEDULE_FILENAME);
    if (!file) return null;

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

  /** Get a public URL for the schedule file (for student iframes). */
  async getPublicUrl(baseUrl, token, courseId) {
    const files = await canvasFetch(baseUrl, token,
      `/courses/${courseId}/files?search_term=${SCHEDULE_FILENAME}&per_page=10`);
    const file = files.find((f) => f.display_name === SCHEDULE_FILENAME || f.filename === SCHEDULE_FILENAME);
    if (!file) return null;
    const meta = await canvasFetch(baseUrl, token, `/files/${file.id}/public_url`);
    return meta.public_url;
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
