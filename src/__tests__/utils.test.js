import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DAY_CODES,
  DAY_FULL,
  DAY_SHORT,
  PENDING_TTL_MS,
  uid,
  addDays,
  generateClassDays,
  computeAllDays,
  getAddableDatesAfter,
  weekKey,
  weekNumber,
  localDateStr,
  fmtMonthDay,
  fmtFull,
  generateICal,
  parseICal,
  parseCSV,
  exportTemplate,
  importTemplate,
  rewriteEmbeddedLinks,
  Store,
} from '../utils.js';
import { assignmentIsQuiz } from '../services/canvas-sync.js';

// ── DAY_CODES ────────────────────────────────────────────────────

describe('DAY_CODES', () => {
  it('has 7 entries starting with SU and ending with SA', () => {
    expect(DAY_CODES).toEqual(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']);
  });

  it('maps to DAY_FULL for every code', () => {
    DAY_CODES.forEach((c) => expect(DAY_FULL[c]).toBeDefined());
  });

  it('maps to DAY_SHORT for every code', () => {
    DAY_CODES.forEach((c) => expect(DAY_SHORT[c]).toBeDefined());
  });
});

// ── uid ──────────────────────────────────────────────────────────

describe('uid', () => {
  it('starts with "i_"', () => {
    expect(uid()).toMatch(/^i_/);
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid()));
    expect(ids.size).toBe(100);
  });

  it('is a string of reasonable length', () => {
    const id = uid();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThanOrEqual(4);
    expect(id.length).toBeLessThanOrEqual(12);
  });
});

// ── addDays ──────────────────────────────────────────────────────

describe('addDays', () => {
  it('adds positive days', () => {
    expect(addDays('2026-01-01', 5)).toBe('2026-01-06');
  });

  it('subtracts with negative offset', () => {
    expect(addDays('2026-01-10', -3)).toBe('2026-01-07');
  });

  it('crosses month boundaries', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
  });

  it('crosses year boundaries', () => {
    expect(addDays('2025-12-30', 5)).toBe('2026-01-04');
  });

  it('returns same date for offset 0', () => {
    expect(addDays('2026-03-15', 0)).toBe('2026-03-15');
  });

  it('handles leap year', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
  });
});

// ── generateClassDays ────────────────────────────────────────────

describe('generateClassDays', () => {
  it('generates MWF days for a one-week range', () => {
    // 2026-01-05 is Monday
    const days = generateClassDays('2026-01-05', '2026-01-11', ['MO', 'WE', 'FR']);
    expect(days).toEqual(['2026-01-05', '2026-01-07', '2026-01-09']);
  });

  it('generates TR days', () => {
    const days = generateClassDays('2026-01-05', '2026-01-11', ['TU', 'TH']);
    expect(days).toEqual(['2026-01-06', '2026-01-08']);
  });

  it('returns empty for missing start', () => {
    expect(generateClassDays('', '2026-01-11', ['MO'])).toEqual([]);
  });

  it('returns empty for missing end', () => {
    expect(generateClassDays('2026-01-05', '', ['MO'])).toEqual([]);
  });

  it('returns empty for empty dayCodes', () => {
    expect(generateClassDays('2026-01-05', '2026-01-11', [])).toEqual([]);
  });

  it('returns empty for null dayCodes', () => {
    expect(generateClassDays('2026-01-05', '2026-01-11', null)).toEqual([]);
  });

  it('returns empty when start > end', () => {
    expect(generateClassDays('2026-02-01', '2026-01-01', ['MO'])).toEqual([]);
  });

  it('includes start and end dates if they match a day code', () => {
    // 2026-01-05 is Monday, 2026-01-09 is Friday
    const days = generateClassDays('2026-01-05', '2026-01-09', ['MO', 'FR']);
    expect(days).toContain('2026-01-05');
    expect(days).toContain('2026-01-09');
  });

  it('returns single day when start equals end and day matches', () => {
    // 2026-01-05 is Monday
    const days = generateClassDays('2026-01-05', '2026-01-05', ['MO']);
    expect(days).toEqual(['2026-01-05']);
  });

  it('returns empty when start equals end and day does not match', () => {
    // 2026-01-05 is Monday
    const days = generateClassDays('2026-01-05', '2026-01-05', ['TU']);
    expect(days).toEqual([]);
  });

  it('handles all 7 day codes', () => {
    const days = generateClassDays('2026-01-04', '2026-01-10', DAY_CODES);
    expect(days).toHaveLength(7);
  });
});

// ── computeAllDays ───────────────────────────────────────────────

describe('computeAllDays', () => {
  const setup = {
    startDate: '2026-01-05',
    endDate: '2026-01-11',
    classDays: ['MO', 'WE', 'FR'],
  };

  it('returns teaching days when no extra days', () => {
    const days = computeAllDays(setup, []);
    expect(days).toEqual(['2026-01-05', '2026-01-07', '2026-01-09']);
  });

  it('merges extra days and sorts', () => {
    const days = computeAllDays(setup, ['2026-01-06', '2026-01-10']);
    expect(days).toEqual([
      '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-09', '2026-01-10',
    ]);
  });

  it('deduplicates overlapping extra days', () => {
    const days = computeAllDays(setup, ['2026-01-05', '2026-01-07']);
    expect(days).toEqual(['2026-01-05', '2026-01-07', '2026-01-09']);
  });

  it('handles null extraDays', () => {
    const days = computeAllDays(setup, null);
    expect(days).toEqual(['2026-01-05', '2026-01-07', '2026-01-09']);
  });

  it('handles undefined extraDays', () => {
    const days = computeAllDays(setup, undefined);
    expect(days).toEqual(['2026-01-05', '2026-01-07', '2026-01-09']);
  });
});

// ── getAddableDatesAfter ─────────────────────────────────────────

describe('getAddableDatesAfter', () => {
  it('returns gap dates between existing days', () => {
    const allDaysSet = new Set(['2026-01-05', '2026-01-09']);
    const result = getAddableDatesAfter('2026-01-05', allDaysSet, '2026-01-31');
    expect(result).toEqual(['2026-01-06', '2026-01-07', '2026-01-08']);
  });

  it('does not stop at semester end (caller decides whether to extend)', () => {
    const allDaysSet = new Set(['2026-01-05']);
    const result = getAddableDatesAfter('2026-01-05', allDaysSet, '2026-01-07');
    // Returns 21 days even though semester end was 2026-01-07.
    expect(result.length).toBe(21);
    expect(result[0]).toBe('2026-01-06');
  });

  it('returns at most 21 days', () => {
    const allDaysSet = new Set(['2026-01-01']);
    const result = getAddableDatesAfter('2026-01-01', allDaysSet, '2026-12-31');
    expect(result.length).toBeLessThanOrEqual(21);
  });

  it('returns empty if next day is already in set', () => {
    const allDaysSet = new Set(['2026-01-05', '2026-01-06']);
    const result = getAddableDatesAfter('2026-01-05', allDaysSet, '2026-01-31');
    expect(result).toEqual([]);
  });
});

// ── weekKey ──────────────────────────────────────────────────────

describe('weekKey', () => {
  it('returns Monday for a Monday', () => {
    // 2026-01-05 is Monday
    expect(weekKey('2026-01-05')).toBe('2026-01-05');
  });

  it('returns Monday for a Wednesday', () => {
    expect(weekKey('2026-01-07')).toBe('2026-01-05');
  });

  it('returns Monday for a Friday', () => {
    expect(weekKey('2026-01-09')).toBe('2026-01-05');
  });

  it('returns Monday for a Sunday (previous week)', () => {
    // 2026-01-04 is Sunday, its week starts on 2025-12-29 (Monday)
    expect(weekKey('2026-01-04')).toBe('2025-12-29');
  });

  it('returns Monday for a Saturday', () => {
    // 2026-01-10 is Saturday
    expect(weekKey('2026-01-10')).toBe('2026-01-05');
  });

  it('crosses month boundaries correctly', () => {
    // 2026-02-01 is Sunday
    expect(weekKey('2026-02-01')).toBe('2026-01-26');
  });
});

// ── weekNumber ───────────────────────────────────────────────────

describe('weekNumber', () => {
  it('returns a number', () => {
    expect(typeof weekNumber('2026-01-05')).toBe('number');
  });

  it('same week dates return same week number', () => {
    expect(weekNumber('2026-01-05')).toBe(weekNumber('2026-01-07'));
    expect(weekNumber('2026-01-05')).toBe(weekNumber('2026-01-09'));
  });

  it('adjacent weeks differ by 1', () => {
    const w1 = weekNumber('2026-01-05');
    const w2 = weekNumber('2026-01-12');
    expect(w2 - w1).toBe(1);
  });

  it('Jan 1 gives week 0 or 1 (not negative)', () => {
    expect(weekNumber('2026-01-01')).toBeGreaterThanOrEqual(0);
  });
});

// ── localDateStr ─────────────────────────────────────────────────

describe('localDateStr', () => {
  it('converts ISO timestamp to YYYY-MM-DD', () => {
    // The exact output depends on the local timezone, but the format should match
    const result = localDateStr('2026-01-15T12:00:00Z');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('pads single-digit months and days', () => {
    const result = localDateStr('2026-01-05T00:00:00Z');
    expect(result).toMatch(/^\d{4}-0\d-0\d$/);
  });

  it('handles end-of-year dates', () => {
    const result = localDateStr('2026-12-31T12:00:00Z');
    expect(result).toMatch(/^2026-12-3[01]$/); // could be 30 or 31 depending on TZ
  });
});

// ── fmtMonthDay ──────────────────────────────────────────────────

describe('fmtMonthDay', () => {
  it('formats a date as "Mon DD"', () => {
    const result = fmtMonthDay('2026-01-15');
    expect(result).toBe('Jan 15');
  });

  it('returns empty string for falsy input', () => {
    expect(fmtMonthDay('')).toBe('');
    expect(fmtMonthDay(null)).toBe('');
    expect(fmtMonthDay(undefined)).toBe('');
  });

  it('formats various months', () => {
    expect(fmtMonthDay('2026-06-01')).toBe('Jun 1');
    expect(fmtMonthDay('2026-12-25')).toBe('Dec 25');
  });
});

// ── fmtFull ──────────────────────────────────────────────────────

describe('fmtFull', () => {
  it('formats a date with weekday, month, day, year', () => {
    // 2026-01-15 is Thursday
    const result = fmtFull('2026-01-15');
    expect(result).toContain('Thursday');
    expect(result).toContain('January');
    expect(result).toContain('15');
    expect(result).toContain('2026');
  });

  it('returns empty string for falsy input', () => {
    expect(fmtFull('')).toBe('');
    expect(fmtFull(null)).toBe('');
    expect(fmtFull(undefined)).toBe('');
  });
});

// ── generateICal ─────────────────────────────────────────────────

describe('generateICal', () => {
  const baseState = {
    setup: {
      courseTitle: 'Test Course',
      startDate: '2026-01-05',
      endDate: '2026-01-11',
      classDays: ['MO', 'WE', 'FR'],
    },
    extraDays: [],
    schedule: {},
    items: {},
  };

  it('produces valid iCal wrapper', () => {
    const ical = generateICal(baseState);
    expect(ical).toContain('BEGIN:VCALENDAR');
    expect(ical).toContain('END:VCALENDAR');
    expect(ical).toContain('VERSION:2.0');
    expect(ical).toContain('PRODID:-//ClassPlanner//EN');
  });

  it('includes course title in X-WR-CALNAME', () => {
    const ical = generateICal(baseState);
    expect(ical).toContain('X-WR-CALNAME:Test Course');
  });

  it('defaults calendar name when courseTitle is empty', () => {
    const state = { ...baseState, setup: { ...baseState.setup, courseTitle: '' } };
    const ical = generateICal(state);
    expect(ical).toContain('X-WR-CALNAME:Course Schedule');
  });

  it('creates VEVENT for scheduled assignments', () => {
    const state = {
      ...baseState,
      items: { a1: { id: 'a1', type: 'assign', title: 'Homework 1', points: 10 } },
      schedule: { '2026-01-05': ['a1'] },
    };
    const ical = generateICal(state);
    expect(ical).toContain('BEGIN:VEVENT');
    expect(ical).toContain('END:VEVENT');
    expect(ical).toContain('SUMMARY:Homework 1 (10 pts)');
    expect(ical).toContain('DTSTART;VALUE=DATE:20260105');
    expect(ical).toContain('UID:2026-01-05-0-a1@classplanner');
  });

  it('creates VEVENT for rich-text notes', () => {
    const state = {
      ...baseState,
      items: { r1: { id: 'r1', type: 'rich', html: '<p>Read chapter 1</p>' } },
      schedule: { '2026-01-05': ['r1'] },
    };
    const ical = generateICal(state);
    expect(ical).toContain('SUMMARY:Read chapter 1');
  });

  it('skips days with no items', () => {
    const ical = generateICal(baseState);
    expect(ical).not.toContain('BEGIN:VEVENT');
  });

  it('uses CRLF line endings', () => {
    const ical = generateICal(baseState);
    expect(ical).toContain('\r\n');
  });

  it('handles assignment with no title', () => {
    const state = {
      ...baseState,
      items: { a1: { id: 'a1', type: 'assign' } },
      schedule: { '2026-01-05': ['a1'] },
    };
    const ical = generateICal(state);
    expect(ical).toContain('SUMMARY:Assignment');
  });

  it('handles rich note with no html', () => {
    const state = {
      ...baseState,
      items: { r1: { id: 'r1', type: 'rich' } },
      schedule: { '2026-01-05': ['r1'] },
    };
    const ical = generateICal(state);
    expect(ical).toContain('SUMMARY:Note');
  });
});

// ── Store ────────────────────────────────────────────────────────

describe('Store', () => {
  let mockStorage;

  beforeEach(() => {
    mockStorage = {};
    // Mock localStorage
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key) => mockStorage[key] ?? null),
      setItem: vi.fn((key, val) => { mockStorage[key] = val; }),
      removeItem: vi.fn((key) => { delete mockStorage[key]; }),
    });
  });

  describe('_key', () => {
    it('returns prefix with courseId', () => {
      expect(Store._key('123')).toBe('class-planner-v3-123');
    });

    it('returns prefix alone when no courseId', () => {
      expect(Store._key(undefined)).toBe('class-planner-v3');
      expect(Store._key('')).toBe('class-planner-v3');
    });
  });

  describe('saveMeta / loadMeta', () => {
    it('round-trips meta data', async () => {
      const meta = { baseUrl: 'https://canvas.example.com', token: 'abc123' };
      Store.saveMeta(meta);
      const loaded = await Store.loadMeta();
      expect(loaded).toEqual(meta);
    });

    it('returns null when no meta is stored', async () => {
      const loaded = await Store.loadMeta();
      expect(loaded).toBeNull();
    });
  });

  describe('save / load', () => {
    it('round-trips course data keyed by courseId', async () => {
      const data = { canvas: { courseId: '42' }, items: { a: 1 } };
      await Store.save(data);
      const loaded = await Store.load('42');
      expect(loaded).toEqual(data);
    });

    it('returns null when nothing is stored', async () => {
      const loaded = await Store.load('999');
      expect(loaded).toBeNull();
    });

    it('isolates data by courseId', async () => {
      const data1 = { canvas: { courseId: '1' }, items: { x: 1 } };
      const data2 = { canvas: { courseId: '2' }, items: { y: 2 } };
      await Store.save(data1);
      await Store.save(data2);
      expect(await Store.load('1')).toEqual(data1);
      expect(await Store.load('2')).toEqual(data2);
    });

    it('returns true on successful save', async () => {
      const result = await Store.save({ canvas: { courseId: '1' } });
      expect(result).toBe(true);
    });
  });
});

// ── PENDING_TTL_MS ───────────────────────────────────────────────

describe('PENDING_TTL_MS', () => {
  it('equals 1 hour in milliseconds', () => {
    expect(PENDING_TTL_MS).toBe(3600000);
  });
});

// ── rewriteEmbeddedLinks ─────────────────────────────────────────

describe('rewriteEmbeddedLinks', () => {
  it('rewrites course ID in matching paths', () => {
    const html = '<a href="/courses/100/files/55">PDF</a>';
    const out = rewriteEmbeddedLinks(html, '100', '200', { files: { '55': '999' } });
    expect(out).toBe('<a href="/courses/200/files/999">PDF</a>');
  });

  it('preserves inner ID when remap has no entry for it', () => {
    const html = '<a href="/courses/100/pages/week-one">Week 1</a>';
    const out = rewriteEmbeddedLinks(html, '100', '200', { pages: {} });
    expect(out).toBe('<a href="/courses/200/pages/week-one">Week 1</a>');
  });

  it('rewrites multiple resource types in one pass', () => {
    const html =
      '<a href="/courses/100/assignments/1">A</a> ' +
      '<a href="/courses/100/quizzes/2">Q</a> ' +
      '<a href="/courses/100/files/3">F</a>';
    const out = rewriteEmbeddedLinks(html, '100', '200', {
      assignments: { '1': '11' },
      quizzes: { '2': '22' },
      files: { '3': '33' },
    });
    expect(out).toContain('/courses/200/assignments/11');
    expect(out).toContain('/courses/200/quizzes/22');
    expect(out).toContain('/courses/200/files/33');
  });

  it('handles absolute URLs with protocol and host', () => {
    const html = '<a href="https://canvas.example.com/courses/100/files/55">f</a>';
    const out = rewriteEmbeddedLinks(html, '100', '200', { files: { '55': '999' } });
    expect(out).toBe('<a href="https://canvas.example.com/courses/200/files/999">f</a>');
  });

  it('does not touch URLs for a different source course', () => {
    const html = '<a href="/courses/777/files/55">other</a>';
    const out = rewriteEmbeddedLinks(html, '100', '200', { files: { '55': '999' } });
    expect(out).toBe(html);
  });

  it('is idempotent on already-rewritten HTML', () => {
    const html = '<a href="/courses/200/files/999">PDF</a>';
    const out = rewriteEmbeddedLinks(html, '100', '200', { files: { '55': '999' } });
    expect(out).toBe(html);
  });

  it('handles null/empty html gracefully', () => {
    expect(rewriteEmbeddedLinks('', '100', '200', {})).toBe('');
    expect(rewriteEmbeddedLinks(null, '100', '200', {})).toBe(null);
    expect(rewriteEmbeddedLinks(undefined, '100', '200', {})).toBe(undefined);
  });

  it('returns input unchanged when course IDs are missing', () => {
    const html = '<a href="/courses/100/files/55">f</a>';
    expect(rewriteEmbeddedLinks(html, null, '200', {})).toBe(html);
    expect(rewriteEmbeddedLinks(html, '100', null, {})).toBe(html);
  });

  it('invokes onUnmatched only for IDs missing from the remap', () => {
    const html =
      '<a href="/courses/100/files/55">a</a>' +
      '<a href="/courses/100/files/77">b</a>';
    const unmatched = [];
    rewriteEmbeddedLinks(html, '100', '200',
      { files: { '55': '999' } },
      (info) => unmatched.push(info));
    expect(unmatched).toEqual([{ type: 'files', id: '77' }]);
  });

  it('invokes onUnmatched per occurrence (no de-dup)', () => {
    const html = '<a href="/courses/100/files/77">a</a><a href="/courses/100/files/77">b</a>';
    const unmatched = [];
    rewriteEmbeddedLinks(html, '100', '200', { files: {} }, (info) => unmatched.push(info));
    expect(unmatched).toHaveLength(2);
  });
});

// ── exportTemplate / importTemplate (extraDays round-trip) ───────

describe('exportTemplate + importTemplate (extraDays)', () => {
  // 3-week semester, MWF.
  const sourceSetup = {
    courseTitle: 'Source',
    startDate: '2026-01-05', // Monday
    endDate: '2026-01-23',
    classDays: ['MO', 'WE', 'FR'],
  };

  it('round-trips an extra day with items, holiday label, and module', () => {
    const sourceState = {
      setup: sourceSetup,
      items: {
        n1: { id: 'n1', type: 'rich', html: '<p>Make-up reading</p>' },
      },
      schedule: { '2026-01-13': ['n1'] }, // Tuesday — not a teaching day
      extraDays: ['2026-01-13'],
      unscheduled: [],
      holidays: { '2026-01-13': 'Make-up class' },
      modules: { '2026-01-13': 'Bonus unit' },
    };
    const template = exportTemplate(sourceState);
    expect(template.extraSlots).toHaveLength(1);
    expect(template.extraSlots[0].daysFromStart).toBe(8); // Jan 5 → Jan 13
    expect(template.extraSlots[0].holiday).toBe('Make-up class');
    expect(template.extraSlots[0].module).toBe('Bonus unit');
    expect(template.extraSlots[0].items).toHaveLength(1);
    expect(template.extraSlots[0].items[0].html).toContain('Make-up reading');

    // New semester starts on a different Monday — extra day should land
    // 8 days later: Aug 24 + 8 = Sep 1 (a Tuesday, still not a teaching day).
    const newSetup = {
      courseTitle: 'Target',
      startDate: '2026-08-24',
      endDate: '2026-09-11',
      classDays: ['MO', 'WE', 'FR'],
    };
    const result = importTemplate(template, newSetup);
    expect(result.extraDays).toContain('2026-09-01');
    expect(result.holidays['2026-09-01']).toBe('Make-up class');
    expect(result.modules['2026-09-01']).toBe('Bonus unit');
    const placedIds = result.schedule['2026-09-01'] || [];
    expect(placedIds).toHaveLength(1);
    expect(result.items[placedIds[0]].html).toContain('Make-up reading');
  });

  it('drops extra days that fall outside the new semester window', () => {
    const sourceState = {
      setup: sourceSetup,
      items: { n1: { id: 'n1', type: 'rich', html: '<p>x</p>' } },
      schedule: { '2026-01-30': ['n1'] }, // 25 days after start — past source end, but exportTemplate still records the offset
      extraDays: ['2026-01-30'],
      unscheduled: [],
      holidays: {},
      modules: {},
    };
    const template = exportTemplate(sourceState);
    expect(template.extraSlots).toHaveLength(1);

    // New semester only spans 1 week — offset of 25 days lands outside it.
    const newSetup = { ...sourceSetup, startDate: '2026-08-24', endDate: '2026-08-30' };
    const result = importTemplate(template, newSetup);
    expect(result.droppedExtras).toBe(1);
    expect(result.extraDays).toHaveLength(0);
  });

  it('does not duplicate teaching-day entries into extraSlots', () => {
    const sourceState = {
      setup: sourceSetup,
      items: { a1: { id: 'a1', type: 'assign', title: 'HW1' } },
      schedule: { '2026-01-05': ['a1'] }, // Monday — a teaching day
      extraDays: ['2026-01-05'], // mistakenly listed (defensive)
      unscheduled: [],
      holidays: {},
      modules: {},
    };
    const template = exportTemplate(sourceState);
    expect(template.extraSlots).toHaveLength(0);
    expect(template.slots.some((s) => s.items.some((i) => i.title === 'HW1'))).toBe(true);
  });
});

// ── exportTemplate / importTemplate (week+position mapping) ──────

describe('exportTemplate + importTemplate (cross-pattern remap)', () => {
  // Helper: build a state with one assignment on each teaching day,
  // titled by its date for easy assertion.
  const buildState = (setup, weekItems) => {
    // weekItems: { 'YYYY-MM-DD': [titles] }
    const items = {};
    const schedule = {};
    Object.entries(weekItems).forEach(([date, titles]) => {
      schedule[date] = [];
      titles.forEach((title) => {
        const id = `i_${title}`;
        items[id] = { id, type: 'assign', title };
        schedule[date].push(id);
      });
    });
    return { setup, items, schedule, holidays: {}, modules: {}, unscheduled: [], extraDays: [] };
  };

  // Map { date: [titles by item id resolution] } from importTemplate result
  const titlesByDate = (result) => {
    const out = {};
    Object.entries(result.schedule).forEach(([date, ids]) => {
      out[date] = ids.map((id) => result.items[id].title);
    });
    return out;
  };

  it('TR → MWF: items map by week+position; Friday stays empty', () => {
    // 2-week TR semester: Jan 6 (Tue), Jan 8 (Thu), Jan 13, Jan 15.
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-01-17', classDays: ['TU', 'TH'] };
    const source = buildState(sourceSetup, {
      '2026-01-06': ['Wk1-Tue'],
      '2026-01-08': ['Wk1-Thu'],
      '2026-01-13': ['Wk2-Tue'],
      '2026-01-15': ['Wk2-Thu'],
    });
    const template = exportTemplate(source);
    // 2-week MWF semester: Aug 24 (Mon), Aug 26 (Wed), Aug 28 (Fri), Aug 31, Sep 2, Sep 4.
    const target = { courseTitle: 'tgt', startDate: '2026-08-24', endDate: '2026-09-04', classDays: ['MO', 'WE', 'FR'] };
    const result = importTemplate(template, target);
    const t = titlesByDate(result);

    expect(t['2026-08-24']).toEqual(['Wk1-Tue']);  // Mon week 1 ← Tue
    expect(t['2026-08-26']).toEqual(['Wk1-Thu']);  // Wed week 1 ← Thu
    expect(t['2026-08-28']).toBeUndefined();       // Fri week 1 stays empty
    expect(t['2026-08-31']).toEqual(['Wk2-Tue']);
    expect(t['2026-09-02']).toEqual(['Wk2-Thu']);
    expect(t['2026-09-04']).toBeUndefined();
  });

  it('MWF → TR: 3-day source compresses to 2-day target with last-day stacking', () => {
    // 2-week MWF semester
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-01-17', classDays: ['MO', 'WE', 'FR'] };
    const source = buildState(sourceSetup, {
      '2026-01-05': ['Wk1-Mon'],
      '2026-01-07': ['Wk1-Wed'],
      '2026-01-09': ['Wk1-Fri'],
      '2026-01-12': ['Wk2-Mon'],
      '2026-01-14': ['Wk2-Wed'],
      '2026-01-16': ['Wk2-Fri'],
    });
    const template = exportTemplate(source);
    // 2-week TR semester: Aug 25 (Tue), Aug 27 (Thu), Sep 1, Sep 3.
    const target = { courseTitle: 'tgt', startDate: '2026-08-24', endDate: '2026-09-04', classDays: ['TU', 'TH'] };
    const result = importTemplate(template, target);
    const t = titlesByDate(result);

    // Monday → Tue (pos 0). Wednesday → Thu (pos 1). Friday clamped to Thu (pos 1, last).
    expect(t['2026-08-25']).toEqual(['Wk1-Mon']);
    expect(t['2026-08-27']).toEqual(['Wk1-Wed', 'Wk1-Fri']);  // stacked
    expect(t['2026-09-01']).toEqual(['Wk2-Mon']);
    expect(t['2026-09-03']).toEqual(['Wk2-Wed', 'Wk2-Fri']);  // stacked
  });

  it('MWF → Mon-only: everything stacks onto Monday', () => {
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-01-17', classDays: ['MO', 'WE', 'FR'] };
    const source = buildState(sourceSetup, {
      '2026-01-05': ['Wk1-Mon'],
      '2026-01-07': ['Wk1-Wed'],
      '2026-01-09': ['Wk1-Fri'],
      '2026-01-12': ['Wk2-Mon'],
      '2026-01-14': ['Wk2-Wed'],
      '2026-01-16': ['Wk2-Fri'],
    });
    const template = exportTemplate(source);
    // 2-week Mon-only semester
    const target = { courseTitle: 'tgt', startDate: '2026-08-24', endDate: '2026-09-04', classDays: ['MO'] };
    const result = importTemplate(template, target);
    const t = titlesByDate(result);

    expect(t['2026-08-24']).toEqual(['Wk1-Mon', 'Wk1-Wed', 'Wk1-Fri']);
    expect(t['2026-08-31']).toEqual(['Wk2-Mon', 'Wk2-Wed', 'Wk2-Fri']);
  });

  it('TR → Mon-only: everything stacks onto Monday', () => {
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-01-17', classDays: ['TU', 'TH'] };
    const source = buildState(sourceSetup, {
      '2026-01-06': ['Wk1-Tue'],
      '2026-01-08': ['Wk1-Thu'],
      '2026-01-13': ['Wk2-Tue'],
      '2026-01-15': ['Wk2-Thu'],
    });
    const template = exportTemplate(source);
    const target = { courseTitle: 'tgt', startDate: '2026-08-24', endDate: '2026-09-04', classDays: ['MO'] };
    const result = importTemplate(template, target);
    const t = titlesByDate(result);

    expect(t['2026-08-24']).toEqual(['Wk1-Tue', 'Wk1-Thu']);
    expect(t['2026-08-31']).toEqual(['Wk2-Tue', 'Wk2-Thu']);
  });

  it('same pattern, same length: idempotent', () => {
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-01-17', classDays: ['MO', 'WE', 'FR'] };
    const source = buildState(sourceSetup, {
      '2026-01-05': ['A'], '2026-01-07': ['B'], '2026-01-09': ['C'],
      '2026-01-12': ['D'], '2026-01-14': ['E'], '2026-01-16': ['F'],
    });
    const template = exportTemplate(source);
    // Different start date but same MWF pattern + same week count.
    const target = { courseTitle: 'tgt', startDate: '2026-08-24', endDate: '2026-09-04', classDays: ['MO', 'WE', 'FR'] };
    const result = importTemplate(template, target);
    const t = titlesByDate(result);

    expect(t['2026-08-24']).toEqual(['A']);
    expect(t['2026-08-26']).toEqual(['B']);
    expect(t['2026-08-28']).toEqual(['C']);
    expect(t['2026-08-31']).toEqual(['D']);
    expect(t['2026-09-02']).toEqual(['E']);
    expect(t['2026-09-04']).toEqual(['F']);
  });

  it('source much longer than target: auto-compress stacks rather than drops', () => {
    // 3-week source, 1-week target. Ratio 1/3 ≈ 0.33 → compress mode.
    // All three source weeks stack onto the one target day rather than
    // dropping the last two.
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-01-23', classDays: ['MO'] };
    const source = buildState(sourceSetup, {
      '2026-01-05': ['Wk1'],
      '2026-01-12': ['Wk2'],
      '2026-01-19': ['Wk3'],
    });
    const template = exportTemplate(source);
    const target = { courseTitle: 'tgt', startDate: '2026-08-24', endDate: '2026-08-28', classDays: ['MO'] };
    const result = importTemplate(template, target);
    const t = titlesByDate(result);

    expect(result.mode).toBe('compress');
    expect(t['2026-08-24']).toEqual(['Wk1', 'Wk2', 'Wk3']);
    expect(result.droppedExtras).toBe(0);
  });

  it('source longer than target by a small margin: literal mode truncates', () => {
    // 3-week source, 2-week target. Ratio 2/3 ≈ 0.67 → still literal.
    // Within the literal band, trailing source weeks beyond the target
    // end get dropped (counted in droppedExtras).
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-01-23', classDays: ['MO'] };
    const source = buildState(sourceSetup, {
      '2026-01-05': ['Wk1'],
      '2026-01-12': ['Wk2'],
      '2026-01-19': ['Wk3'],
    });
    const template = exportTemplate(source);
    const target = { courseTitle: 'tgt', startDate: '2026-08-24', endDate: '2026-09-04', classDays: ['MO'] };
    const result = importTemplate(template, target);
    const t = titlesByDate(result);

    expect(result.mode).toBe('literal');
    expect(t['2026-08-24']).toEqual(['Wk1']);
    expect(t['2026-08-31']).toEqual(['Wk2']);
    expect(result.droppedExtras).toBe(1);
  });

  it('legacy template (no weekIndex/weekPosition) falls back to index-based placement', () => {
    // Hand-craft a template that looks like one exported by the
    // pre-refactor code: only `index` is present, no week fields.
    const legacyTemplate = {
      version: 1,
      classDays: ['MO', 'WE', 'FR'],
      totalTeachingDays: 6,
      slots: [
        { index: 0, dayCode: 'MO', items: [{ type: 'assign', title: 'A' }] },
        { index: 1, dayCode: 'WE', items: [{ type: 'assign', title: 'B' }] },
        { index: 2, dayCode: 'FR', items: [{ type: 'assign', title: 'C' }] },
      ],
      extraSlots: [],
      unscheduledItems: [],
    };
    const target = { courseTitle: 'tgt', startDate: '2026-01-05', endDate: '2026-01-09', classDays: ['MO', 'WE', 'FR'] };
    const result = importTemplate(legacyTemplate, target);
    const t = titlesByDate(result);

    expect(t['2026-01-05']).toEqual(['A']);
    expect(t['2026-01-07']).toEqual(['B']);
    expect(t['2026-01-09']).toEqual(['C']);
  });

  it('exportTemplate emits weekIndex + weekPosition for new templates', () => {
    const setup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-01-17', classDays: ['MO', 'WE', 'FR'] };
    const state = buildState(setup, {
      '2026-01-05': ['A'], '2026-01-07': ['B'], '2026-01-09': ['C'],
      '2026-01-12': ['D'], '2026-01-14': ['E'], '2026-01-16': ['F'],
    });
    const template = exportTemplate(state);
    expect(template.slots).toHaveLength(6);
    expect(template.slots[0]).toMatchObject({ weekIndex: 0, weekPosition: 0, dayCode: 'MO' });
    expect(template.slots[1]).toMatchObject({ weekIndex: 0, weekPosition: 1, dayCode: 'WE' });
    expect(template.slots[2]).toMatchObject({ weekIndex: 0, weekPosition: 2, dayCode: 'FR' });
    expect(template.slots[3]).toMatchObject({ weekIndex: 1, weekPosition: 0, dayCode: 'MO' });
    expect(template.slots[5]).toMatchObject({ weekIndex: 1, weekPosition: 2, dayCode: 'FR' });
  });

  it('holidays + modules carry through cross-pattern remaps', () => {
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-01-09', classDays: ['MO', 'WE', 'FR'] };
    const source = {
      setup: sourceSetup,
      items: { x: { id: 'x', type: 'assign', title: 'Reading' } },
      schedule: { '2026-01-05': ['x'] },
      holidays: { '2026-01-09': 'Snow day' },
      modules: { '2026-01-05': 'Unit 1' },
      unscheduled: [], extraDays: [],
    };
    const template = exportTemplate(source);
    // Target has TR pattern, so source's Friday holiday slot (weekIndex 0,
    // weekPosition 2) clamps to Thursday (target's last position in week 0).
    const target = { courseTitle: 'tgt', startDate: '2026-08-24', endDate: '2026-08-29', classDays: ['TU', 'TH'] };
    const result = importTemplate(template, target);

    expect(result.modules['2026-08-25']).toBe('Unit 1');     // Mon → Tue, week 0 pos 0
    expect(result.holidays['2026-08-27']).toBe('Snow day');  // Fri → Thu (clamped)
  });
});

// ── importTemplate compress/expand modes (semester ↔ term) ───────

describe('importTemplate (semester ↔ term)', () => {
  // Helper builders cribbed from the cross-pattern block above. Repeated
  // here to keep the new tests self-contained.
  const buildState = (setup, weekItems) => {
    const items = {};
    const schedule = {};
    Object.entries(weekItems).forEach(([date, titles]) => {
      schedule[date] = [];
      titles.forEach((title) => {
        const id = `i_${title}`;
        items[id] = { id, type: 'assign', title };
        schedule[date].push(id);
      });
    });
    return { setup, items, schedule, holidays: {}, modules: {}, unscheduled: [], extraDays: [] };
  };
  const titlesByDate = (result) => {
    const out = {};
    Object.entries(result.schedule).forEach(([date, ids]) => {
      out[date] = ids.map((id) => result.items[id].title);
    });
    return out;
  };

  it('14-week TR → 7-week TR: one source week per target day', () => {
    // 14-week TR source. 28 source teaching days.
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-06', endDate: '2026-04-09', classDays: ['TU', 'TH'] };
    const weekItems = {};
    const start = new Date('2026-01-06T12:00:00');  // a Tuesday
    for (let w = 0; w < 14; w++) {
      ['TU', 'TH'].forEach((dow, i) => {
        const d = new Date(start.getTime() + (w * 7 + [0, 2][i]) * 86400000);
        weekItems[d.toISOString().slice(0, 10)] = [`Wk${w + 1}-${dow}`];
      });
    }
    const template = exportTemplate(buildState(sourceSetup, weekItems));

    // 7-week TR target — 14 target teaching days, perfect 2:1 fit.
    const target = { courseTitle: 'tgt', startDate: '2026-08-25', endDate: '2026-10-08', classDays: ['TU', 'TH'] };
    const result = importTemplate(template, target);

    expect(result.mode).toBe('compress');
    expect(result.droppedExtras).toBe(0);

    const t = titlesByDate(result);

    // Source week 1's Tue+Thu → target wk1 Tue (Aug 25).
    // Source week 2's Tue+Thu → target wk1 Thu (Aug 27).
    expect(t['2026-08-25']).toEqual(['Wk1-TU', 'Wk1-TH']);
    expect(t['2026-08-27']).toEqual(['Wk2-TU', 'Wk2-TH']);
    expect(t['2026-09-01']).toEqual(['Wk3-TU', 'Wk3-TH']);
    expect(t['2026-09-03']).toEqual(['Wk4-TU', 'Wk4-TH']);

    // Last target day (Thu Oct 8) gets the 14th source week.
    expect(t['2026-10-08']).toEqual(['Wk14-TU', 'Wk14-TH']);
  });

  it('14-week MWF → 7-week MWF: pairs of consecutive source days per target day', () => {
    // 14-week MWF source (42 source teaching days).
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-04-10', classDays: ['MO', 'WE', 'FR'] };
    const weekItems = {};
    const start = new Date('2026-01-05T12:00:00');
    for (let w = 0; w < 14; w++) {
      ['MO', 'WE', 'FR'].forEach((dow, i) => {
        const d = new Date(start.getTime() + (w * 7 + [0, 2, 4][i]) * 86400000);
        weekItems[d.toISOString().slice(0, 10)] = [`Wk${w + 1}-${dow}`];
      });
    }
    const template = exportTemplate(buildState(sourceSetup, weekItems));

    // 7-week MWF target — 21 target teaching days. 42/21 = 2 source days per target day.
    const target = { courseTitle: 'tgt', startDate: '2026-08-24', endDate: '2026-10-09', classDays: ['MO', 'WE', 'FR'] };
    const result = importTemplate(template, target);

    expect(result.mode).toBe('compress');
    expect(result.droppedExtras).toBe(0);

    const t = titlesByDate(result);
    // Aug 24 (tgt day 0) gets src days 0+1: wk1 Mon + wk1 Wed.
    expect(t['2026-08-24']).toEqual(['Wk1-MO', 'Wk1-WE']);
    // Aug 26 (tgt day 1) gets src days 2+3: wk1 Fri + wk2 Mon.
    expect(t['2026-08-26']).toEqual(['Wk1-FR', 'Wk2-MO']);
    // Aug 28 (tgt day 2) gets src days 4+5: wk2 Wed + wk2 Fri.
    expect(t['2026-08-28']).toEqual(['Wk2-WE', 'Wk2-FR']);
  });

  it('14-week MWF → 7-week TR: 42 source days into 14 target days, three src per tgt', () => {
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-04-10', classDays: ['MO', 'WE', 'FR'] };
    const weekItems = {};
    const start = new Date('2026-01-05T12:00:00');
    for (let w = 0; w < 14; w++) {
      ['MO', 'WE', 'FR'].forEach((dow, i) => {
        const d = new Date(start.getTime() + (w * 7 + [0, 2, 4][i]) * 86400000);
        weekItems[d.toISOString().slice(0, 10)] = [`Wk${w + 1}-${dow}`];
      });
    }
    const template = exportTemplate(buildState(sourceSetup, weekItems));

    // 7-week TR target — 14 target teaching days. 42/14 = 3 source days per target day.
    const target = { courseTitle: 'tgt', startDate: '2026-08-25', endDate: '2026-10-08', classDays: ['TU', 'TH'] };
    const result = importTemplate(template, target);

    expect(result.mode).toBe('compress');

    const t = titlesByDate(result);
    // Tgt day 0 (Aug 25, Tue) ← src days 0,1,2 = wk1 M+W+F.
    expect(t['2026-08-25']).toEqual(['Wk1-MO', 'Wk1-WE', 'Wk1-FR']);
    // Tgt day 1 (Aug 27, Thu) ← src days 3,4,5 = wk2 M+W+F.
    expect(t['2026-08-27']).toEqual(['Wk2-MO', 'Wk2-WE', 'Wk2-FR']);
  });

  it('7-week → 14-week MWF: expands 1:2, alternating weeks blank', () => {
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-02-13', classDays: ['MO', 'WE', 'FR'] };
    const weekItems = {};
    const start = new Date('2026-01-05T12:00:00');
    for (let w = 0; w < 7; w++) {
      ['MO', 'WE', 'FR'].forEach((dow, i) => {
        const d = new Date(start.getTime() + (w * 7 + [0, 2, 4][i]) * 86400000);
        weekItems[d.toISOString().slice(0, 10)] = [`Wk${w + 1}-${dow}`];
      });
    }
    const template = exportTemplate(buildState(sourceSetup, weekItems));

    const target = { courseTitle: 'tgt', startDate: '2026-08-24', endDate: '2026-11-27', classDays: ['MO', 'WE', 'FR'] };
    const result = importTemplate(template, target);

    expect(result.mode).toBe('expand');

    const t = titlesByDate(result);
    // Target week 0 = source week 1.
    expect(t['2026-08-24']).toEqual(['Wk1-MO']);
    expect(t['2026-08-26']).toEqual(['Wk1-WE']);
    expect(t['2026-08-28']).toEqual(['Wk1-FR']);
    // Target week 1 = blank (source weeks are mapped to even target indices).
    expect(t['2026-08-31']).toBeUndefined();
    expect(t['2026-09-02']).toBeUndefined();
    // Target week 2 = source week 2.
    expect(t['2026-09-07']).toEqual(['Wk2-MO']);
  });

  it('explicit options.mode = "literal" disables auto-compression', () => {
    // Same 14→7 setup as the compress test, but force literal mode.
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-04-10', classDays: ['MO'] };
    const weekItems = {};
    const start = new Date('2026-01-05T12:00:00');
    for (let w = 0; w < 14; w++) {
      const d = new Date(start.getTime() + (w * 7) * 86400000);
      weekItems[d.toISOString().slice(0, 10)] = [`Wk${w + 1}`];
    }
    const template = exportTemplate(buildState(sourceSetup, weekItems));

    const target = { courseTitle: 'tgt', startDate: '2026-08-24', endDate: '2026-10-09', classDays: ['MO'] };
    const result = importTemplate(template, target, { mode: 'literal' });

    expect(result.mode).toBe('literal');
    expect(result.droppedExtras).toBe(7); // weeks 8..14 dropped in literal mode
  });

  it('compress mode preserves source-week ordering with surplus stacked on last day', () => {
    // 5-week TR source, 2-week TR target. 10 source days, 4 target days.
    // floor(idx * 4 / 10): 0→0, 1→0, 2→0, 3→1, 4→1, 5→2, 6→2, 7→2, 8→3, 9→3.
    // So the 9th and 10th source days end up on the last target day (no
    // dropping). Surplus stacking matches the existing "never lose items"
    // promise of the literal day-position compression.
    const sourceSetup = { courseTitle: 'src', startDate: '2026-01-06', endDate: '2026-02-05', classDays: ['TU', 'TH'] };
    const weekItems = {};
    const start = new Date('2026-01-06T12:00:00');
    for (let w = 0; w < 5; w++) {
      ['TU', 'TH'].forEach((dow, i) => {
        const d = new Date(start.getTime() + (w * 7 + [0, 2][i]) * 86400000);
        weekItems[d.toISOString().slice(0, 10)] = [`Wk${w + 1}-${dow}`];
      });
    }
    const template = exportTemplate(buildState(sourceSetup, weekItems));

    const target = { courseTitle: 'tgt', startDate: '2026-08-25', endDate: '2026-09-03', classDays: ['TU', 'TH'] };
    const result = importTemplate(template, target);

    expect(result.mode).toBe('compress');
    expect(result.droppedExtras).toBe(0);
    const t = titlesByDate(result);
    expect(t['2026-08-25']).toEqual(['Wk1-TU', 'Wk1-TH', 'Wk2-TU']);
    expect(t['2026-08-27']).toEqual(['Wk2-TH', 'Wk3-TU']);
    expect(t['2026-09-01']).toEqual(['Wk3-TH', 'Wk4-TU', 'Wk4-TH']);
    expect(t['2026-09-03']).toEqual(['Wk5-TU', 'Wk5-TH']);
  });

  it('exportTemplate emits totalWeeks based on max weekIndex', () => {
    const setup = { courseTitle: 'src', startDate: '2026-01-05', endDate: '2026-01-23', classDays: ['MO'] };
    const template = exportTemplate({
      setup,
      items: { a: { id: 'a', type: 'assign', title: 'X' } },
      schedule: { '2026-01-19': ['a'] }, // week 2 (third Monday)
      holidays: {}, modules: {}, unscheduled: [], extraDays: [],
    });
    expect(template.totalWeeks).toBe(3);
  });
});

// ── parseICal ────────────────────────────────────────────────────

describe('parseICal', () => {
  // Build VCALENDAR text from an array of `BEGIN:VEVENT...END:VEVENT` chunks.
  const wrap = (events) => [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n');

  it('returns empty array for empty input', () => {
    expect(parseICal('')).toEqual([]);
  });

  it('returns empty array when there are no VEVENTs', () => {
    expect(parseICal(wrap([]))).toEqual([]);
  });

  it('parses a single DATE-format event', () => {
    const text = wrap([
      'BEGIN:VEVENT',
      'SUMMARY:Reading 1',
      'DTSTART;VALUE=DATE:20260115',
      'END:VEVENT',
    ]);
    expect(parseICal(text)).toEqual([{ title: 'Reading 1', date: '2026-01-15' }]);
  });

  it('parses a DATE-TIME format event (extracts the date portion)', () => {
    const text = wrap([
      'BEGIN:VEVENT',
      'SUMMARY:Class meets',
      'DTSTART:20260115T143000Z',
      'END:VEVENT',
    ]);
    expect(parseICal(text)[0].date).toBe('2026-01-15');
  });

  it('parses multiple events', () => {
    const text = wrap([
      'BEGIN:VEVENT', 'SUMMARY:Event A', 'DTSTART;VALUE=DATE:20260115', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:Event B', 'DTSTART;VALUE=DATE:20260116', 'END:VEVENT',
    ]);
    const events = parseICal(text);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.title)).toEqual(['Event A', 'Event B']);
  });

  it('extracts DESCRIPTION when present', () => {
    const text = wrap([
      'BEGIN:VEVENT',
      'SUMMARY:Quiz',
      'DESCRIPTION:Bring your textbook',
      'DTSTART;VALUE=DATE:20260115',
      'END:VEVENT',
    ]);
    expect(parseICal(text)[0]).toEqual({
      title: 'Quiz',
      date: '2026-01-15',
      description: 'Bring your textbook',
    });
  });

  it('unescapes RFC 5545 sequences in SUMMARY and DESCRIPTION', () => {
    const text = wrap([
      'BEGIN:VEVENT',
      'SUMMARY:Read chapters 1\\, 2\\; and 3',
      'DESCRIPTION:Line one\\nLine two',
      'DTSTART;VALUE=DATE:20260115',
      'END:VEVENT',
    ]);
    const ev = parseICal(text)[0];
    expect(ev.title).toBe('Read chapters 1, 2; and 3');
    expect(ev.description).toBe('Line one\nLine two');
  });

  it('unfolds RFC 5545 continuation lines (CRLF + whitespace)', () => {
    // SUMMARY split across two lines via line-folding.
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Very long event title that wraps',
      ' onto a second line',
      'DTSTART;VALUE=DATE:20260115',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseICal(text)[0].title).toBe('Very long event title that wrapsonto a second line');
  });

  it('skips events missing DTSTART or SUMMARY', () => {
    const text = wrap([
      'BEGIN:VEVENT', 'SUMMARY:No date here', 'END:VEVENT',
      'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20260115', 'END:VEVENT',
      'BEGIN:VEVENT', 'SUMMARY:Good one', 'DTSTART;VALUE=DATE:20260116', 'END:VEVENT',
    ]);
    const events = parseICal(text);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Good one');
  });

  it('handles LF-only line endings as well as CRLF', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:LF endings',
      'DTSTART;VALUE=DATE:20260115',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    expect(parseICal(text)).toHaveLength(1);
  });
});

// ── parseCSV ─────────────────────────────────────────────────────

describe('parseCSV', () => {
  it('returns empty array for empty input', () => {
    expect(parseCSV('')).toEqual([]);
  });

  it('returns empty array for header-only input', () => {
    expect(parseCSV('date,title')).toEqual([]);
  });

  it('parses a basic two-column CSV', () => {
    const csv = 'date,title\n2026-01-15,Reading 1\n2026-01-22,Reading 2';
    expect(parseCSV(csv)).toEqual([
      { date: '2026-01-15', title: 'Reading 1' },
      { date: '2026-01-22', title: 'Reading 2' },
    ]);
  });

  it('matches header aliases for title (summary, name, event)', () => {
    expect(parseCSV('date,summary\n2026-01-15,A')[0].title).toBe('A');
    expect(parseCSV('date,name\n2026-01-15,B')[0].title).toBe('B');
    expect(parseCSV('date,event\n2026-01-15,C')[0].title).toBe('C');
  });

  it('captures description when a description column is present', () => {
    const csv = 'date,title,description\n2026-01-15,Quiz,Bring textbook';
    expect(parseCSV(csv)).toEqual([
      { date: '2026-01-15', title: 'Quiz', description: 'Bring textbook' },
    ]);
  });

  it('returns empty when required columns are missing', () => {
    expect(parseCSV('foo,bar\n1,2')).toEqual([]);
    expect(parseCSV('date,foo\n2026-01-15,bar')).toEqual([]);
    expect(parseCSV('title,foo\nA,bar')).toEqual([]);
  });

  it('handles quoted fields containing commas', () => {
    const csv = 'date,title\n2026-01-15,"Hello, world"';
    expect(parseCSV(csv)[0].title).toBe('Hello, world');
  });

  it('handles quoted fields containing newlines', () => {
    const csv = 'date,title\n2026-01-15,"Line 1\nLine 2"';
    expect(parseCSV(csv)[0].title).toBe('Line 1\nLine 2');
  });

  it('handles escaped double quotes ("")', () => {
    const csv = 'date,title\n2026-01-15,"She said ""hi"""';
    expect(parseCSV(csv)[0].title).toBe('She said "hi"');
  });

  it('normalizes YYYY/MM/DD to YYYY-MM-DD', () => {
    const csv = 'date,title\n2026/01/15,Event';
    expect(parseCSV(csv)[0].date).toBe('2026-01-15');
  });

  it('normalizes M/D/YYYY to YYYY-MM-DD with zero-padding', () => {
    const csv = 'date,title\n1/5/2026,Event';
    expect(parseCSV(csv)[0].date).toBe('2026-01-05');
  });

  it('skips rows missing date or title', () => {
    const csv = 'date,title\n,No date\n2026-01-15,\n2026-01-15,Good';
    const events = parseCSV(csv);
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Good');
  });

  it('skips rows whose date can\'t be normalized', () => {
    const csv = 'date,title\nnot-a-date,Bad\n2026-01-15,Good';
    const events = parseCSV(csv);
    expect(events.map((e) => e.title)).toEqual(['Good']);
  });

  it('case-insensitive on header names', () => {
    const csv = 'DATE,Title\n2026-01-15,Event';
    expect(parseCSV(csv)[0].title).toBe('Event');
  });

  it('handles CRLF line endings', () => {
    const csv = 'date,title\r\n2026-01-15,Event';
    expect(parseCSV(csv)).toHaveLength(1);
  });
});

// ── assignmentIsQuiz ─────────────────────────────────────────────

describe('assignmentIsQuiz', () => {
  it('returns false for a plain assignment', () => {
    expect(assignmentIsQuiz({ id: 1, name: 'Homework' })).toBe(false);
  });

  it('returns true when is_quiz_lti_assignment is set (New Quiz)', () => {
    expect(assignmentIsQuiz({ id: 1, name: 'Quiz', is_quiz_lti_assignment: true })).toBe(true);
  });

  it('returns true when quiz_id is set (Classic Quiz)', () => {
    expect(assignmentIsQuiz({ id: 1, name: 'Quiz', quiz_id: 42 })).toBe(true);
  });

  it('returns true when both flags are set', () => {
    expect(assignmentIsQuiz({ is_quiz_lti_assignment: true, quiz_id: 42 })).toBe(true);
  });

  it('returns false for null or undefined input', () => {
    expect(assignmentIsQuiz(null)).toBe(false);
    expect(assignmentIsQuiz(undefined)).toBe(false);
  });

  it('returns false for objects with falsy quiz_id (0, null, "")', () => {
    expect(assignmentIsQuiz({ quiz_id: 0 })).toBe(false);
    expect(assignmentIsQuiz({ quiz_id: null })).toBe(false);
    expect(assignmentIsQuiz({ quiz_id: '' })).toBe(false);
  });
});
