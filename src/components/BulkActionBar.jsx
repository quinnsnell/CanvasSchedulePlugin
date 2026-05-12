/**
 * BulkActionBar — floating toolbar shown when one or more items are selected.
 *
 * Renders fixed at the bottom of the viewport above the toast region.
 * Provides bulk Move-to-date and bulk Delete; the parent owns the actual
 * mutation handlers. Closing the bar via the X clears the selection.
 */

import React, { useState } from 'react';
import { X, Trash2, CalendarDays } from 'lucide-react';
import { T, FONT_MONO } from '../theme.js';

export default function BulkActionBar({ count, onClear, onMove, onDelete }) {
  const [moveDate, setMoveDate] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);

  const submitMove = () => {
    if (!moveDate) return;
    onMove(moveDate);
    setMoveDate('');
    setMoveOpen(false);
  };

  return (
    <div
      role="toolbar"
      aria-label={`${count} items selected`}
      className="no-print"
      style={{
        position: 'fixed',
        bottom: 80, left: '50%', transform: 'translateX(-50%)',
        background: T.ink, color: '#fff',
        padding: '10px 14px', borderRadius: 6,
        boxShadow: '0 8px 24px rgba(26,20,16,0.28)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        fontFamily: FONT_MONO, fontSize: 12,
        zIndex: 60,
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <span style={{ fontWeight: 600 }}>
        {count} selected
      </span>

      {!moveOpen ? (
        <button
          onClick={() => setMoveOpen(true)}
          style={pillBtn}
          aria-label="Move selected items to a date"
        >
          <CalendarDays size={13} /> Move to…
        </button>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input
            type="date"
            value={moveDate}
            onChange={(e) => setMoveDate(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitMove(); }}
            autoFocus
            style={{
              fontFamily: FONT_MONO, fontSize: 12,
              padding: '3px 6px', borderRadius: 3,
              border: `1px solid ${T.border}`, background: '#fff', color: T.ink,
            }}
          />
          <button onClick={submitMove} disabled={!moveDate} style={{
            ...pillBtn,
            background: moveDate ? T.inkBlue : '#555',
            opacity: moveDate ? 1 : 0.6,
          }}>
            Apply
          </button>
          <button onClick={() => { setMoveOpen(false); setMoveDate(''); }} style={pillBtnGhost}>
            Cancel
          </button>
        </span>
      )}

      <button onClick={onDelete} style={{ ...pillBtn, background: T.ox || '#a83232' }}
        aria-label="Remove selected items from the schedule">
        <Trash2 size={13} /> Remove
      </button>

      <button onClick={onClear} style={pillBtnGhost} aria-label="Clear selection">
        <X size={13} />
      </button>
    </div>
  );
}

const pillBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  background: 'rgba(255,255,255,0.12)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.22)',
  borderRadius: 3, padding: '4px 10px',
  fontFamily: 'inherit', fontSize: 'inherit',
  cursor: 'pointer',
};

const pillBtnGhost = {
  ...pillBtn,
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.3)',
};
