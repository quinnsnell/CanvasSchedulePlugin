// Cloudflare Worker: CORS proxy for Canvas LMS API + .ics subscription feed.
//
// Two responsibilities, one worker:
//
// 1. Canvas CORS proxy (any path NOT starting with /calendar/)
//    Usage: https://<worker>.workers.dev/<canvas-host>/api/v1/...
//
// 2. Public .ics subscription feed (path /calendar/<courseKey>.ics)
//    - GET → returns the latest .ics from KV with public CORS + text/calendar
//    - PUT → upload latest .ics. Auth: Authorization: Bearer <canvas-pat>.
//            The worker validates the PAT against Canvas itself by calling
//            GET /api/v1/courses/<courseId>?include[]=permissions and
//            checking the user has teacher-level permissions on that course.
//            No shared upload secret — each professor uses their own PAT.
//
//    The planner calls PUT on every Publish; calendar apps (Google/Apple/
//    Outlook) poll GET periodically and pick up changes automatically.
//
// Setup checklist (see wrangler.toml for binding placeholders):
//   1. wrangler kv:namespace create ICAL_KV
//      → copy the returned id into wrangler.toml [[kv_namespaces]] block
//   2. wrangler deploy
//   (No worker secret needed — auth is per-professor via their Canvas PAT.)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

// Cap KV writes at 512 KB. iCal feeds for a normal semester run well under
// 50 KB; anything over half a meg is almost certainly junk or abuse.
const MAX_ICAL_BYTES = 512 * 1024;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (url.pathname.startsWith('/calendar/')) {
      return handleCalendar(request, env, url);
    }

    return handleProxy(request, url);
  },
};

// ── Calendar feed ──────────────────────────────────────────────

async function handleCalendar(request, env, url) {
  // /calendar/<courseKey>.ics  →  courseKey = "byu.instructure.com-12345"
  // courseKey format: <canvas-host>-<courseId>. Canvas hosts may contain
  // hyphens (e.g. my-school.instructure.com), so we rsplit on the last
  // hyphen and require the trailing portion to be a numeric courseId.
  const raw = url.pathname.slice('/calendar/'.length).replace(/\.ics$/i, '');
  if (!raw || raw.includes('/')) {
    return new Response('Bad request', { status: 400, headers: CORS_HEADERS });
  }
  const courseKey = decodeURIComponent(raw);

  if (!env.ICAL_KV) {
    return new Response('KV not configured', { status: 500, headers: CORS_HEADERS });
  }

  if (request.method === 'GET') {
    const ics = await env.ICAL_KV.get(courseKey);
    if (!ics) return new Response('Not found', { status: 404, headers: CORS_HEADERS });
    return new Response(ics, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/calendar; charset=utf-8',
        // Five-minute edge cache. Calendar clients poll on their own
        // schedule (hours to a day) — short edge TTL just smooths bursts.
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  if (request.method === 'PUT') {
    // Parse courseKey into <host> + <courseId>.
    const m = /^(.+)-(\d+)$/.exec(courseKey);
    if (!m) {
      return new Response('Bad courseKey format', { status: 400, headers: CORS_HEADERS });
    }
    const [, canvasHost, courseId] = m;

    // Per-professor auth: validate the bearer token against Canvas itself.
    const auth = request.headers.get('Authorization') || '';
    if (!/^Bearer\s+\S+/i.test(auth)) {
      return new Response('Missing Authorization: Bearer <canvas-pat>', { status: 401, headers: CORS_HEADERS });
    }
    const ok = await canUserManageCourse(canvasHost, courseId, auth);
    if (!ok) {
      return new Response('Forbidden — Canvas PAT does not have teacher-level access to this course', { status: 403, headers: CORS_HEADERS });
    }

    const body = await request.text();
    if (body.length > MAX_ICAL_BYTES) {
      return new Response('Too large', { status: 413, headers: CORS_HEADERS });
    }
    if (!body.startsWith('BEGIN:VCALENDAR')) {
      return new Response('Not an iCal payload', { status: 415, headers: CORS_HEADERS });
    }
    await env.ICAL_KV.put(courseKey, body);
    return new Response('OK', { status: 200, headers: CORS_HEADERS });
  }

  return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
}

/**
 * Ask Canvas whether the bearer-token holder has teacher-level permission
 * on the given course. Uses the standard ?include[]=permissions response;
 * `manage_content` (or its newer equivalents) is true for teachers and TAs
 * and false for students.
 */
async function canUserManageCourse(canvasHost, courseId, authHeader) {
  const apiUrl = `https://${canvasHost}/api/v1/courses/${courseId}?include[]=permissions`;
  let resp;
  try {
    resp = await fetch(apiUrl, { headers: { Authorization: authHeader } });
  } catch {
    return false;
  }
  if (!resp.ok) return false;
  let data;
  try { data = await resp.json(); } catch { return false; }
  const p = data?.permissions || {};
  // Accept any of the teacher-level permission keys Canvas uses across
  // generations — older instances expose manage_content, newer ones
  // split it into per-feature permissions.
  return !!(p.manage_content || p.manage_course_content_edit || p.manage_assignments || p.update);
}

// ── Canvas API proxy (unchanged behavior) ──────────────────────

async function handleProxy(request, url) {
  const path = url.pathname.slice(1);
  const host = path.split('/')[0];
  const rest = path.slice(host.length);

  if (!host || !rest.startsWith('/api/v1')) {
    return new Response('Usage: /<canvas-host>/api/v1/...', { status: 400, headers: CORS_HEADERS });
  }

  const target = `https://${host}${rest}${url.search}`;
  const headers = new Headers(request.headers);
  headers.delete('host');

  const resp = await fetch(target, {
    method: request.method,
    headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
  });

  const responseHeaders = new Headers(resp.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    responseHeaders.set(k, v);
  }

  return new Response(resp.body, {
    status: resp.status,
    headers: responseHeaders,
  });
}
