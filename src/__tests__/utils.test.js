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
  exportTemplate,
  importTemplate,
  rewriteEmbeddedLinks,
  Store,
} from '../utils.js';

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

  it('stops at semester end', () => {
    const allDaysSet = new Set(['2026-01-05']);
    const result = getAddableDatesAfter('2026-01-05', allDaysSet, '2026-01-07');
    expect(result).toEqual(['2026-01-06', '2026-01-07']);
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
