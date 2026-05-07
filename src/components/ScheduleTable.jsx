/**
 * ScheduleTable — the main schedule grid with column headers and day rows.
 * Renders module headers between rows and computes module duration (day counts).
 */

import React from 'react';
import { X } from 'lucide-react';
import { T, FONT_MONO } from '../theme.js';
import { weekKey, weekNumber, getAddableDatesAfter } from '../utils.js';
import ClassDayRow from './ClassDayRow.jsx';

export default function ScheduleTable({
  allDays, state, isStudent, teachingSet, pendingByDate,
  draggingId, autoEditId, clearAutoEdit,
  onMoveItem, onUpdateItem, onDeleteItem, onDuplicate, onReorder,
  onAddNote, onAddAssignment, onAddExtraDay, onRemoveExtraDay,
  onToggleHoliday, onAddModule, onRemoveModule,
  onShowRecurringModal,
  allDaysSet, assignmentGroups,
}) {
  const iconBtnStyleVal = { color: T.muted, padding: 2, background: 'transparent', border: 'none', cursor: 'pointer' };
  let prevKey = null;

  // Compute how many non-holiday teaching days each module spans
  const moduleDates = Object.keys(state.modules || {}).filter((d) => allDays.includes(d)).sort();
  const moduleDayCounts = {};
  moduleDates.forEach((mDate, mi) => {
    const startIdx = allDays.indexOf(mDate);
    const endIdx = mi < moduleDates.length - 1 ? allDays.indexOf(moduleDates[mi + 1]) : allDays.length;
    let count = 0;
    for (let i = startIdx; i < endIdx; i++) {
      if (!state.holidays?.[allDays[i]]) count++;
    }
    moduleDayCounts[mDate] = count;
  });

  return (
    <div style={{ background: T.paper, border: `1px solid ${T.border}`, borderRadius: 6, overflow: 'hidden' }}>
      <div className="day-row" style={{ background: T.subtle, borderBottom: `1px solid ${T.border}` }}>
        <div className="col-header" style={{ borderRight: `1px solid ${T.border}` }}>Class meeting</div>
        <div className="col-header">Readings · Assignments · Materials</div>
      </div>
      {allDays.map((d, idx) => {
        const isExtra = !teachingSet.has(d);
        const items = (state.schedule[d] || []).map((id) => state.items[id]).filter(Boolean);
        const k = weekKey(d);
        const weekIdx = weekNumber(d);
        const isWeekStart = idx > 0 && k !== prevKey;
        prevKey = k;
        const moduleTitle = state.modules?.[d];
        const holidayLabel = state.holidays?.[d];

        return (
          <React.Fragment key={d}>
            {moduleTitle && (
              <div className="module-header">
                <span>
                  {moduleTitle}
                  {moduleDayCounts[d] != null && (
                    <span style={{
                      fontFamily: FONT_MONO, fontSize: '11px', fontWeight: 400,
                      color: T.muted, marginLeft: 10, letterSpacing: '0.02em',
                    }}>
                      ({moduleDayCounts[d]} {moduleDayCounts[d] === 1 ? 'day' : 'days'})
                    </span>
                  )}
                </span>
                {!isStudent && (
                  <button onClick={() => onRemoveModule(d)} style={iconBtnStyleVal} title="Remove module header">
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
            <ClassDayRow
              date={d} index={idx} isExtra={isExtra}
              weekIdx={weekIdx} isWeekStart={isWeekStart}
              items={items} isStudent={isStudent}
              canvas={state.canvas}
              canvasReady={state.canvas.connected && !!state.canvas.courseId}
              pendingCount={pendingByDate[d] || 0}
              holidayLabel={holidayLabel}
              onMoveItem={onMoveItem} onUpdateItem={onUpdateItem} onDeleteItem={onDeleteItem}
              onDuplicate={(id) => onDuplicate(id, d)}
              onAddNote={() => onAddNote(d)}
              onAddAssignment={() => onAddAssignment(d)}
              onAddExtraDay={onAddExtraDay}
              onRemoveExtraDay={() => onRemoveExtraDay(d)}
              onToggleHoliday={() => onToggleHoliday(d)}
              onAddModule={() => onAddModule(d)}
              onShowRecurringModal={onShowRecurringModal}
              onReorder={(from, to) => onReorder(d, from, to)}
              addableDates={getAddableDatesAfter(d, allDaysSet, state.setup.endDate)}
              draggingId={draggingId}
              autoEditId={autoEditId} clearAutoEdit={clearAutoEdit}
              assignmentGroups={assignmentGroups}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}
