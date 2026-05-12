/**
 * Bulk-shift the entire schedule forward or backward by N days. Optionally
 * skip holidays (so items land on teaching days only).
 */

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { T, FONT_DISPLAY, FONT_BODY, FONT_MONO } from '../../theme.js';
import { ActionButton, inputStyle, iconBtnStyle } from '../ui.jsx';

export default function ShiftModal({ onShift, onClose, hasHolidays }) {
  const [days, setDays] = useState(7);
  const [skipHolidays, setSkipHolidays] = useState(true);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.4)', zIndex: 40,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: T.paper, borderRadius: 6, padding: 24,
        boxShadow: '0 12px 40px rgba(0,0,0,0.2)', maxWidth: 360, width: '90%',
      }}>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: '18px', fontWeight: 600, marginBottom: 12 }}>
          Shift all dates
        </h3>
        <p style={{ fontSize: '13px', color: T.muted, marginBottom: 16 }}>
          Move the entire schedule forward or backward by a number of days.
          {skipHolidays
            ? ' Items land on teaching days, skipping holidays.'
            : ' Semester start/end, all items, holidays, and modules will shift together.'}
        </p>
        <div className="flex items-center gap-3 mb-4">
          <button onClick={() => setDays((d) => d - 1)}
            style={{ ...iconBtnStyle(), border: `1px solid ${T.border}`, padding: 6, borderRadius: 3 }}>
            <ChevronLeft size={16} />
          </button>
          <input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))}
            style={{ ...inputStyle(), width: 80, textAlign: 'center' }} />
          <button onClick={() => setDays((d) => d + 1)}
            style={{ ...iconBtnStyle(), border: `1px solid ${T.border}`, padding: 6, borderRadius: 3 }}>
            <ChevronRight size={16} />
          </button>
          <span style={{ fontFamily: FONT_MONO, fontSize: '11px', color: T.muted }}>days</span>
        </div>
        {hasHolidays && (
          <label className="flex items-center gap-2 mb-4" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={skipHolidays}
              onChange={(e) => setSkipHolidays(e.target.checked)}
              style={{ accentColor: T.inkBlue, width: 14, height: 14 }} />
            <span style={{ fontFamily: FONT_BODY, fontSize: '13px', color: T.ink }}>
              Skip holidays when shifting
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <ActionButton onClick={onClose}>Cancel</ActionButton>
          <ActionButton onClick={() => onShift(days, hasHolidays ? skipHolidays : false)} primary>
            Shift {days > 0 ? `+${days}` : days} days
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
