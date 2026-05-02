/**
 * ClassDayRow — one row of the schedule grid.
 * Renders the date column (with day tools) and content column (with item cards).
 *
 * AddDayPopover — dropdown for picking a non-teaching date to add.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  FileText, BookOpen, ExternalLink, CalendarPlus, MinusCircle,
  Hourglass, Ban, ListPlus,
} from 'lucide-react';
import { T, FONT_DISPLAY, FONT_BODY, FONT_MONO } from '../theme.js';
import { DAY_CODES, DAY_FULL, fmtMonthDay } from '../utils.js';
import { DayToolBtn } from './ui.jsx';
import ItemCard from './ItemCard.jsx';

export default function ClassDayRow({
  date, index, isExtra, items, isStudent, canvas, canvasReady, pendingCount,
  weekIdx, isWeekStart, holidayLabel,
  onMoveItem, onUpdateItem, onDeleteItem, onDuplicate,
  onAddNote, onAddAssignment, onAddExtraDay, onRemoveExtraDay,
  onToggleHoliday, onAddModule, onReorder,
  addableDates, draggingId, setDraggingId,
  autoEditId, clearAutoEdit,
}) {
  const [hovering, setHovering] = useState(false);
  const [showAddDay, setShowAddDay] = useState(false);
  const [dropIdx, setDropIdx] = useState(null);

  const d = new Date(date + 'T00:00:00');
  const weekShade = (weekIdx ?? 0) % 2 === 1;
  const rowBg = isExtra ? T.amberSoft : (weekShade ? T.weekShade : T.paper);
  const dayLabel = DAY_FULL[DAY_CODES[d.getDay()]];

  return (
    <div className={`day-row${holidayLabel ? ' holiday-row' : ''}`} style={{
      borderBottom: `1px solid ${T.border}`,
      boxShadow: isWeekStart ? 'none' : (weekShade ? 'inset 0 1px 0 rgba(255,255,255,0.7)' : 'inset 0 1px 0 rgba(0,0,0,0.04)'),
      borderTop: isWeekStart ? `2px solid ${T.borderStrong}` : 'none',
      background: holidayLabel ? T.holidayBg : rowBg,
      opacity: holidayLabel ? 0.7 : 1,
    }}>
      {/* ── Date column ── */}
      <div className="date-col">
        {isWeekStart && (
          <div style={{
            fontFamily: FONT_MONO, fontSize: '9px', letterSpacing: '0.2em',
            textTransform: 'uppercase', color: T.muted, marginBottom: 4,
          }}>
            Week {(weekIdx ?? 0) + 1}
          </div>
        )}
        <div className="date-num">{fmtMonthDay(date)}</div>
        <div className="date-day">{dayLabel}</div>

        {/* Status badges */}
        {holidayLabel && (
          <StatusBadge color={T.ox} borderColor={`${T.ox}44`}>{holidayLabel}</StatusBadge>
        )}
        {isExtra && !holidayLabel && (
          <StatusBadge color={T.amber} borderColor={`${T.amber}66`}>Added</StatusBadge>
        )}
        {pendingCount > 0 && (
          <div title="Waiting for new Canvas assignment to appear" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6, marginLeft: isExtra ? 4 : 0,
            fontFamily: FONT_MONO, fontSize: '8px', letterSpacing: '0.16em', textTransform: 'uppercase',
            color: T.inkBlue, background: T.inkBlueSoft, border: `1px solid ${T.inkBlue}33`,
            padding: '1px 5px', borderRadius: 2,
          }}>
            <Hourglass size={9} /> Pending
          </div>
        )}

        {/* Day management tools */}
        {!isStudent && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <DayToolBtn
                onClick={() => setShowAddDay((v) => !v)}
                title="Add a non-teaching date after this one"
                disabled={addableDates.length === 0}
              >
                <CalendarPlus size={11} /> Day
              </DayToolBtn>
              {showAddDay && (
                <AddDayPopover
                  dates={addableDates}
                  onPick={(dt) => { onAddExtraDay(dt); setShowAddDay(false); }}
                  onClose={() => setShowAddDay(false)}
                />
              )}
            </div>
            {isExtra && items.length === 0 && (
              <DayToolBtn onClick={onRemoveExtraDay} title="Remove this date">
                <MinusCircle size={11} />
              </DayToolBtn>
            )}
            <DayToolBtn onClick={onToggleHoliday} title={holidayLabel ? 'Remove holiday' : 'Mark as holiday / no class'}>
              <Ban size={11} />
            </DayToolBtn>
            <DayToolBtn onClick={onAddModule} title="Add module/unit header before this day">
              <ListPlus size={11} />
            </DayToolBtn>
          </div>
        )}
      </div>

      {/* ── Content column ── */}
      <ContentColumn
        items={items} date={date} isStudent={isStudent} canvas={canvas}
        canvasReady={canvasReady} holidayLabel={holidayLabel}
        hovering={hovering} setHovering={setHovering}
        dropIdx={dropIdx} setDropIdx={setDropIdx}
        draggingId={draggingId} setDraggingId={setDraggingId}
        onMoveItem={onMoveItem} onUpdateItem={onUpdateItem} onDeleteItem={onDeleteItem}
        onDuplicate={onDuplicate} onReorder={onReorder}
        onAddNote={onAddNote} onAddAssignment={onAddAssignment}
        autoEditId={autoEditId} clearAutoEdit={clearAutoEdit}
      />
    </div>
  );
}

// ── Small status badge (Added, Holiday label) ──────────────────

function StatusBadge({ color, borderColor, children }) {
  return (
    <div style={{
      display: 'inline-block', marginTop: 6,
      fontFamily: FONT_MONO, fontSize: '8px', letterSpacing: '0.18em', textTransform: 'uppercase',
      color, background: T.paper, border: `1px solid ${borderColor}`,
      padding: '1px 5px', borderRadius: 2,
    }}>
      {children}
    </div>
  );
}

// ── Content column (drop target + item list + add buttons) ─────

function ContentColumn({
  items, date, isStudent, canvas, canvasReady, holidayLabel,
  hovering, setHovering, dropIdx, setDropIdx,
  draggingId, setDraggingId,
  onMoveItem, onUpdateItem, onDeleteItem, onDuplicate, onReorder,
  onAddNote, onAddAssignment,
  autoEditId, clearAutoEdit,
}) {
  return (
    <div
      onDragOver={(e) => { if (!isStudent) e.preventDefault(); }}
      onDragLeave={() => { setHovering(false); setDropIdx(null); }}
      onDrop={(e) => {
        if (isStudent) return;
        e.preventDefault();
        setHovering(false);
        setDraggingId(null);
        const id = e.dataTransfer.getData('text/plain');
        if (id) onMoveItem(id, date, dropIdx != null ? dropIdx : undefined);
        setDropIdx(null);
      }}
      className={hovering ? 'drop-target-active' : ''}
      style={{
        padding: '12px', minHeight: 60,
        display: 'flex', flexDirection: 'column', gap: 0,
        transition: 'background 120ms', minWidth: 0,
      }}
    >
      {items.length === 0 && !isStudent && (
        <div style={{ color: T.faint, fontSize: '12px', fontStyle: 'italic', padding: '4px 4px' }}>
          Drop items here, or use the buttons below.
        </div>
      )}

      {items.map((item, idx) => (
        <React.Fragment key={item.id}>
          {/* Drop zone indicator before each item */}
          {!isStudent && draggingId && draggingId !== item.id && (
            <DropZone
              active={dropIdx === idx}
              onActivate={(e) => { e.preventDefault(); e.stopPropagation(); setDropIdx(idx); setHovering(true); }}
              onDeactivate={(e) => { e.stopPropagation(); if (dropIdx === idx) setDropIdx(null); }}
            />
          )}
          <div style={{ marginBottom: 8 }}>
            <ItemCard
              item={item} isStudent={isStudent} canvas={canvas}
              onUpdate={onUpdateItem} onDelete={onDeleteItem}
              onDuplicate={() => onDuplicate(item.id)}
              onMoveUp={idx > 0 ? () => onReorder(idx, idx - 1) : null}
              onMoveDown={idx < items.length - 1 ? () => onReorder(idx, idx + 1) : null}
              draggingId={draggingId} setDraggingId={setDraggingId}
              autoEdit={autoEditId === item.id}
              onAutoEditConsumed={clearAutoEdit}
            />
          </div>
        </React.Fragment>
      ))}

      {/* Drop zone after the last item */}
      {!isStudent && draggingId && items.length > 0 && (
        <DropZone
          active={dropIdx === items.length}
          onActivate={(e) => { e.preventDefault(); e.stopPropagation(); setDropIdx(items.length); setHovering(true); }}
          onDeactivate={(e) => { e.stopPropagation(); if (dropIdx === items.length) setDropIdx(null); }}
        />
      )}

      {/* Add note / assignment buttons */}
      {!isStudent && !holidayLabel && (
        <div className="day-tools" style={{ marginTop: 'auto', paddingTop: 6 }}>
          <DayToolBtn onClick={onAddNote} title="Add a reading / note on this day">
            <FileText size={11} /> Note
          </DayToolBtn>
          <DayToolBtn
            onClick={onAddAssignment}
            title={canvasReady ? 'Open Canvas to create an assignment for this day' : 'Connect Canvas to add assignments'}
            disabled={!canvasReady}
          >
            <BookOpen size={11} /> Assignment <ExternalLink size={9} />
          </DayToolBtn>
        </div>
      )}
    </div>
  );
}

// ── Drop zone indicator (thin line between items during drag) ──

function DropZone({ active, onActivate, onDeactivate }) {
  return (
    <div
      onDragOver={onActivate}
      onDragLeave={onDeactivate}
      style={{
        height: active ? 6 : 4,
        borderRadius: 2,
        background: active ? T.inkBlue : 'transparent',
        transition: 'all 120ms',
      }}
    />
  );
}

// ── Add Day Popover ────────────────────────────────────────────

function AddDayPopover({ dates, onPick, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  if (dates.length === 0) return null;

  return (
    <div ref={ref} style={{
      position: 'absolute', top: 'calc(100% + 4px)', left: 0,
      background: T.paper, border: `1px solid ${T.borderStrong}`, borderRadius: 4,
      boxShadow: '0 6px 20px rgba(26,20,16,0.12)', zIndex: 30,
      minWidth: 200, padding: 4,
    }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: T.muted, padding: '6px 10px 4px' }}>
        Add a date
      </div>
      {dates.map((dt) => {
        const d = new Date(dt + 'T00:00:00');
        return (
          <button key={dt} onClick={() => onPick(dt)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              width: '100%', padding: '6px 10px', textAlign: 'left',
              fontFamily: FONT_BODY, fontSize: '13px', color: T.ink,
              background: 'transparent', border: 'none', borderRadius: 2, cursor: 'pointer',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = T.inkBlueSoft)}
            onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}>
            <span>{d.toLocaleDateString('en-US', { weekday: 'long' })}</span>
            <span style={{ fontFamily: FONT_MONO, fontSize: '11px', color: T.muted }}>
              {fmtMonthDay(dt)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
