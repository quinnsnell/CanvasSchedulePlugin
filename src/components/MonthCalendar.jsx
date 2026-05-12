/**
 * MonthCalendar — alternate view of the schedule as stacked monthly grids.
 *
 * Renders one Sun-Sat grid per month spanning the semester. Each cell shows
 * the date number, holiday/module markers, and the items scheduled on that
 * day (or a count badge if there are too many to fit). Clicking a cell
 * fires `onDayClick(date)` so the parent can switch back to the linear
 * view and scroll to that day.
 *
 * Read-only view: no drag-and-drop, no inline editing. The linear view
 * remains the canonical editor.
 */

import React from 'react';
import { T, FONT_DISPLAY, FONT_BODY, FONT_MONO } from '../theme.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** ISO YYYY-MM-DD for a Date object using local time. */
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Enumerate every {year, month0} pair touched by the [start, end] window
 * (inclusive of both endpoints).
 */
function monthsInRange(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  const out = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

/**
 * Build a 6-row × 7-col grid of YYYY-MM-DD strings for a given month.
 * Pads with the trailing days of the prior month and leading days of
 * the next month so the grid is always rectangular. `null` cells in
 * the trailing rows mean "no day to show" — rendered blank.
 */
function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const dayOfWeek = first.getDay(); // 0 = Sun
  const grid = [];
  // Backfill leading days from prior month.
  for (let i = dayOfWeek; i > 0; i--) {
    grid.push(ymd(new Date(year, month, 1 - i)));
  }
  // Days in current month.
  const lastDay = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    grid.push(ymd(new Date(year, month, d)));
  }
  // Trail to fill the last row to a multiple of 7.
  while (grid.length % 7 !== 0) {
    const offset = grid.length - dayOfWeek - lastDay + 1;
    grid.push(ymd(new Date(year, month + 1, offset)));
  }
  return grid;
}

export default function MonthCalendar({ state, allDays, onDayClick }) {
  const startDate = state.setup?.startDate;
  const endDate = state.setup?.endDate;
  if (!startDate || !endDate) return null;

  const allDaysSet = new Set(allDays);
  const months = monthsInRange(startDate, endDate);

  return (
    <div className="month-calendar" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {months.map(({ year, month }) => {
        const grid = buildMonthGrid(year, month);
        const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        return (
          <section key={`${year}-${month}`} aria-label={monthName}
            style={{ background: T.paper, border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
            <header style={{
              padding: '10px 16px', borderBottom: `1px solid ${T.border}`, background: T.subtle,
              fontFamily: FONT_DISPLAY, fontSize: '16px', fontWeight: 600, color: T.ink,
            }}>
              {monthName}
            </header>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {WEEKDAYS.map((wd) => (
                <div key={wd} style={{
                  padding: '6px 8px', borderBottom: `1px solid ${T.border}`,
                  fontFamily: FONT_MONO, fontSize: '9px', letterSpacing: '0.18em',
                  textTransform: 'uppercase', color: T.muted, textAlign: 'center',
                }}>{wd}</div>
              ))}
              {grid.map((date, i) => (
                <DayCell
                  key={`${date}-${i}`}
                  date={date}
                  inMonth={new Date(date + 'T12:00:00').getMonth() === month}
                  inSemester={date >= startDate && date <= endDate}
                  isClassDay={allDaysSet.has(date)}
                  state={state}
                  onClick={onDayClick}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DayCell({ date, inMonth, inSemester, isClassDay, state, onClick }) {
  const items = (state.schedule?.[date] || []).map((id) => state.items?.[id]).filter(Boolean);
  const holiday = state.holidays?.[date];
  const moduleHeader = state.modules?.[date];
  const dayNum = new Date(date + 'T12:00:00').getDate();

  const dim = !inMonth || !inSemester;
  const interactive = inSemester && (isClassDay || items.length > 0 || holiday);

  // Cap visible item rows; remaining count rolls into a "+N more" badge.
  const MAX_VISIBLE = 3;
  const visible = items.slice(0, MAX_VISIBLE);
  const overflow = items.length - visible.length;

  return (
    <button
      onClick={interactive ? () => onClick?.(date) : undefined}
      disabled={!interactive}
      aria-label={interactive ? `${date}: ${items.length} item${items.length === 1 ? '' : 's'}${holiday ? ', ' + holiday : ''}` : undefined}
      style={{
        textAlign: 'left',
        minHeight: 90,
        padding: '4px 6px',
        background: holiday ? T.holidayBg : (dim ? T.subtle : T.paper),
        borderRight: `1px solid ${T.border}`,
        borderBottom: `1px solid ${T.border}`,
        opacity: dim ? 0.45 : 1,
        cursor: interactive ? 'pointer' : 'default',
        font: 'inherit', color: 'inherit',
        display: 'flex', flexDirection: 'column', gap: 2,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{
          fontFamily: FONT_DISPLAY, fontSize: 13, fontWeight: 500,
          color: isClassDay && !dim ? T.ink : T.muted,
        }}>
          {dayNum}
        </span>
        {moduleHeader && (
          <span style={{
            fontFamily: FONT_MONO, fontSize: 8, color: T.muted, letterSpacing: '0.1em',
            textTransform: 'uppercase', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={moduleHeader}>
            {moduleHeader}
          </span>
        )}
      </div>
      {holiday && (
        <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: T.muted, fontStyle: 'italic' }}>
          {holiday}
        </div>
      )}
      {visible.map((it) => {
        const isAssign = it.type === 'assign';
        const accent = isAssign ? (it.isQuiz ? T.amber : T.inkBlue) : T.sienna;
        const label = isAssign ? (it.title || 'Untitled') : stripHtml(it.html);
        return (
          <div key={it.id} style={{
            fontFamily: FONT_BODY, fontSize: 10, color: T.ink, lineHeight: 1.2,
            borderLeft: `2px solid ${accent}`, paddingLeft: 4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={label}>
            {label || (isAssign ? 'Untitled' : 'Note')}
          </div>
        );
      })}
      {overflow > 0 && (
        <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: T.muted }}>+{overflow} more</div>
      )}
    </button>
  );
}

/** Strip HTML tags for compact text preview in a calendar cell. */
function stripHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
