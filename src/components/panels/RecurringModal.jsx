/**
 * Batch-create rich notes on every teaching day matching the chosen
 * weekday set (e.g., "weekly reading quiz on every Monday").
 */

import React, { useState } from 'react';
import { T, FONT_DISPLAY, FONT_BODY, FONT_MONO } from '../../theme.js';
import { DAY_CODES, DAY_SHORT } from '../../utils.js';
import { Field, ActionButton, inputStyle } from '../ui.jsx';

export default function RecurringModal({ classDays, onCreate, onClose }) {
  const [title, setTitle] = useState('');
  const [selectedDays, setSelectedDays] = useState([...classDays]);
  const [html, setHtml] = useState('');

  const toggleDay = (c) =>
    setSelectedDays((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const handleCreate = () => {
    if (!title.trim() && !html.trim()) return;
    onCreate(title.trim(), selectedDays, html.trim() || null);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.4)', zIndex: 40,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: T.paper, borderRadius: 6, padding: 24,
        boxShadow: '0 12px 40px rgba(0,0,0,0.2)', maxWidth: 420, width: '90%',
      }}>
        <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: '18px', fontWeight: 600, marginBottom: 8 }}>
          Recurring note
        </h3>
        <p style={{ fontSize: '13px', color: T.muted, marginBottom: 16 }}>
          Create a note on every matching teaching day. Each note is independent after creation.
        </p>

        <Field label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Weekly Reading Quiz"
            style={inputStyle()}
            autoFocus
          />
        </Field>

        <div style={{ marginTop: 12 }}>
          <Field label="Repeat on">
            <div className="flex gap-2 flex-wrap">
              {DAY_CODES.map((c) => (
                <button key={c} onClick={() => toggleDay(c)}
                  style={{
                    padding: '6px 12px', borderRadius: 2,
                    fontFamily: FONT_MONO, fontSize: '11px', letterSpacing: '0.1em',
                    border: `1px solid ${selectedDays.includes(c) ? T.inkBlue : T.border}`,
                    background: selectedDays.includes(c) ? T.inkBlue : T.paper,
                    color: selectedDays.includes(c) ? '#fff' : T.muted,
                    cursor: 'pointer',
                  }}>
                  {DAY_SHORT[c]}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="Content (optional)">
            <textarea
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              placeholder="Additional text for each note..."
              rows={3}
              style={{ ...inputStyle(), resize: 'vertical' }}
            />
          </Field>
        </div>

        <div style={{ marginTop: 8, fontFamily: FONT_MONO, fontSize: '10px', color: T.muted }}>
          {selectedDays.length === 0
            ? 'Select at least one day'
            : `Will create notes on every ${selectedDays.map((c) => DAY_SHORT[c]).join(', ')}`}
        </div>

        <div className="flex justify-end gap-2" style={{ marginTop: 16 }}>
          <ActionButton onClick={onClose}>Cancel</ActionButton>
          <ActionButton
            onClick={handleCreate}
            primary
            disabled={(!title.trim() && !html.trim()) || selectedDays.length === 0}
          >
            Create recurring notes
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
