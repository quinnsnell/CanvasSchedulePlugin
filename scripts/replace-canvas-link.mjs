#!/usr/bin/env node
/**
 * Replace a Discord invite link (or arbitrary URL) across Canvas
 * content for a single course. Sweeps pages, assignments, discussion
 * topics (including announcements), and the syllabus body.
 *
 * Runs as a dry-run by default — prints every match with the containing
 * item's id. Pass --apply to write changes back.
 *
 * Does NOT touch the planner's rich-text notes (those live in the
 * browser's localStorage, not on Canvas). For those, see the companion
 * console snippet in scripts/replace-planner-notes.js.
 *
 * Usage:
 *   CANVAS_BASE_URL=https://byu.instructure.com \
 *   CANVAS_TOKEN=xxxxxxxxxxxxxxxxxxxx \
 *   CANVAS_COURSE_ID=38965 \
 *   node scripts/replace-canvas-link.mjs \
 *     --old https://discord.gg/OLDCODE \
 *     --new https://discord.gg/NEWCODE \
 *     [--apply]
 */

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    old: { type: 'string' },
    new: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
});

const OLD_URL = values.old;
const NEW_URL = values.new;
if (!OLD_URL || !NEW_URL) {
  console.error('Missing --old or --new. See file header for usage.');
  process.exit(1);
}

const BASE_URL = (process.env.CANVAS_BASE_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.CANVAS_TOKEN;
const COURSE_ID = process.env.CANVAS_COURSE_ID;
if (!BASE_URL || !TOKEN || !COURSE_ID) {
  console.error('Set CANVAS_BASE_URL, CANVAS_TOKEN, CANVAS_COURSE_ID env vars.');
  process.exit(1);
}

// Pull the Discord invite code out of --old so we also catch the
// alternate /invite/CODE form. If the URL isn't a Discord invite, fall
// back to a literal string match on --old only.
const codeMatch =
  OLD_URL.match(/discord\.gg\/([^\/?#]+)/i) ||
  OLD_URL.match(/discord\.com\/invite\/([^\/?#]+)/i);
const oldCode = codeMatch?.[1];
const MATCH_RE = oldCode
  ? new RegExp(`https?://(?:www\\.)?discord\\.(?:gg/${oldCode}|com/invite/${oldCode})\\b`, 'gi')
  : new RegExp(OLD_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

const DRY = !values.apply;
console.log(`Mode:    ${DRY ? 'DRY RUN (no writes)' : 'APPLY (will write changes)'}`);
console.log(`Old:     ${OLD_URL}${oldCode ? ` (code=${oldCode})` : ''}`);
console.log(`New:     ${NEW_URL}`);
console.log(`Course:  ${BASE_URL}/courses/${COURSE_ID}`);
console.log(`Match:   ${MATCH_RE}`);
console.log('');

async function canvas(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE_URL}/api/v1${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Canvas ${res.status} on ${url}: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function canvasAll(path) {
  const results = [];
  let url = `${BASE_URL}/api/v1${path}`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Canvas ${res.status}: ${await res.text().catch(() => '')}`);
    const data = await res.json();
    if (!Array.isArray(data)) return data;
    results.push(...data);
    const link = res.headers.get('Link') || '';
    const nextPart = link.split(',').find((p) => /rel="next"/.test(p));
    url = nextPart?.match(/<([^>]+)>/)?.[1] || null;
  }
  return results;
}

let totalMatches = 0;
let totalWrites = 0;

/** Search `body` for MATCH_RE, print hits, and (if --apply) run `updater(newBody)`. */
async function sweep(label, id, body, updater) {
  if (!body) return;
  const matches = body.match(MATCH_RE);
  if (!matches || matches.length === 0) return;
  totalMatches += matches.length;
  console.log(`[${label} ${id}] ${matches.length} match(es):`);
  for (const m of matches) console.log(`    ${m}`);
  if (!DRY) {
    await updater(body.replace(MATCH_RE, NEW_URL));
    totalWrites += matches.length;
    console.log(`    → updated`);
  }
}

// ── Pages ──────────────────────────────────────────────────────
console.log('--- Pages ---');
const pages = await canvasAll(`/courses/${COURSE_ID}/pages?per_page=100`);
for (const p of pages) {
  const full = await canvas(`/courses/${COURSE_ID}/pages/${p.url}`);
  await sweep('Page', p.url, full.body, (body) =>
    canvas(`/courses/${COURSE_ID}/pages/${p.url}`, {
      method: 'PUT', body: JSON.stringify({ wiki_page: { body } }),
    })
  );
}

// ── Assignments ────────────────────────────────────────────────
console.log('\n--- Assignments ---');
const assignments = await canvasAll(`/courses/${COURSE_ID}/assignments?per_page=100`);
for (const a of assignments) {
  await sweep('Assignment', a.id, a.description, (description) =>
    canvas(`/courses/${COURSE_ID}/assignments/${a.id}`, {
      method: 'PUT', body: JSON.stringify({ assignment: { description } }),
    })
  );
}

// ── Discussion topics (also covers announcements) ──────────────
console.log('\n--- Discussion topics / announcements ---');
const topics = await canvasAll(`/courses/${COURSE_ID}/discussion_topics?per_page=100`);
for (const t of topics) {
  await sweep('Discussion', t.id, t.message, (message) =>
    canvas(`/courses/${COURSE_ID}/discussion_topics/${t.id}`, {
      method: 'PUT', body: JSON.stringify({ message }),
    })
  );
}

// ── Syllabus ───────────────────────────────────────────────────
console.log('\n--- Syllabus ---');
const course = await canvas(`/courses/${COURSE_ID}?include[]=syllabus_body`);
await sweep('Syllabus', COURSE_ID, course.syllabus_body, (syllabus_body) =>
  canvas(`/courses/${COURSE_ID}`, {
    method: 'PUT', body: JSON.stringify({ course: { syllabus_body } }),
  })
);

console.log('');
console.log('─────────────────────────────────');
console.log(`Total matches: ${totalMatches}`);
if (!DRY) console.log(`Total writes:  ${totalWrites}`);
console.log(DRY
  ? 'Dry run complete. Re-run with --apply to write changes.'
  : 'Apply complete.');
console.log('');
console.log('NOTE: This did not touch planner notes (they live in browser');
console.log('localStorage). For those, run the console snippet in');
console.log('scripts/replace-planner-notes.js on your planner tab.');
