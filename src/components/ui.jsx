/**
 * Shared UI primitives — buttons, form fields, and style helpers.
 *
 * Style helpers are functions (not constants) so they always read
 * the current theme palette, which changes with dark mode.
 */

import React from 'react';
import { T, FONT_DISPLAY, FONT_BODY, FONT_MONO } from '../theme.js';

// ── Style helpers (functions to pick up current theme) ─────────

export const inputStyle = () => ({
  width: '100%', padding: '7px 10px', border: `1px solid ${T.border}`, borderRadius: 3,
  fontFamily: FONT_BODY, fontSize: '13px', color: T.ink, background: T.paper,
});

export const iconBtnStyle = () => ({
  color: T.muted, padding: 2, background: 'transparent', border: 'none', cursor: 'pointer',
});

export const pillStyle = (color, bg) => ({
  fontFamily: FONT_MONO, fontSize: '9px', letterSpacing: '0.18em',
  textTransform: 'uppercase', color, background: bg,
  padding: '2px 6px', borderRadius: 2,
});

// ── Form field with label ──────────────────────────────────────

export function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{
        fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.16em',
        textTransform: 'uppercase', color: T.muted, marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
    </label>
  );
}

// ── Icon button (square, bordered) ─────────────────────────────

export function IconButton({ children, onClick, title, disabled, ...rest }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled}
      aria-label={rest['aria-label'] || title}
      style={{
        padding: 8, border: `1px solid ${T.border}`, borderRadius: 3,
        background: T.paper, color: disabled ? T.faint : T.ink,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        minWidth: 36, minHeight: 36,
      }}>
      {children}
    </button>
  );
}

// ── Toggle button (pressed/unpressed state) ────────────────────

export function ToggleButton({ active, children, onClick, ...rest }) {
  return (
    <button onClick={onClick} aria-label={rest['aria-label']} aria-pressed={active}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 12px', borderRadius: 3,
        fontFamily: FONT_MONO, fontSize: '11px', letterSpacing: '0.08em',
        border: `1px solid ${active ? T.inkBlue : T.border}`,
        background: active ? T.inkBlue : T.paper,
        color: active ? '#fff' : T.ink,
        cursor: 'pointer', textTransform: 'uppercase',
      }}>
      {children}
    </button>
  );
}

// ── Action button (primary or secondary) ───────────────────────

export function ActionButton({ children, onClick, primary }) {
  return (
    <button onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 14px', borderRadius: 3,
        fontFamily: FONT_BODY, fontSize: '13px', fontWeight: 500,
        border: `1px solid ${primary ? T.inkBlue : T.border}`,
        background: primary ? T.inkBlue : T.paper,
        color: primary ? '#fff' : T.ink,
        cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}

// ── Rich editor toolbar button ─────────────────────────────────

export function ToolbarBtn({ children, onClick, title }) {
  return (
    <button onMouseDown={(e) => { e.preventDefault(); onClick(); }} title={title}
      style={{
        padding: '4px 8px', border: `1px solid ${T.border}`, background: T.paper,
        color: T.muted, borderRadius: 2, fontFamily: FONT_MONO, fontSize: '11px',
        minWidth: 24, cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}

// ── Day row tool button (small, monospaced) ────────────────────

export function DayToolBtn({ children, onClick, title, disabled }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '6px 10px', border: `1px solid ${T.border}`, background: T.paper,
        color: disabled ? T.faint : T.muted, borderRadius: 2,
        fontFamily: FONT_MONO, fontSize: '10px', letterSpacing: '0.06em',
        textTransform: 'uppercase',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        minHeight: 32,
      }}>
      {children}
    </button>
  );
}
