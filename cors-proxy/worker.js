// Cloudflare Worker: CORS proxy for Canvas LMS API
// Forwards requests to the Canvas instance specified in the URL path
// and returns responses with permissive CORS headers.
//
// Usage: https://<worker>.workers.dev/<canvas-host>/api/v1/...
// Example: https://canvas-cors-proxy.you.workers.dev/byu.instructure.com/api/v1/courses

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname.slice(1); // remove leading /
    const host = path.split('/')[0];    // e.g. byu.instructure.com
    const rest = path.slice(host.length); // e.g. /api/v1/courses

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
  },
};
