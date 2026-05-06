/**
 * Configuration panels and modals:
 * - SetupPanel: semester dates, course title, class meeting days
 * - CanvasPanel: Canvas LMS connection, course picker, CORS proxy config
 * - ShiftModal: bulk-shift all dates forward/backward
 * - ConflictModal: conflict resolution when publishing to Canvas
 * - RecurringModal: batch-create recurring notes across matching teaching days
 * - EmptyState: onboarding prompt for new users
 */

import React, { useState } from 'react';
import {
  X, RefreshCw, Check, AlertCircle, AlertTriangle, Cloud, Calendar, Settings,
  ChevronLeft, ChevronRight, Upload,
} from 'lucide-react';
import { T, FONT_DISPLAY, FONT_BODY, FONT_MONO } from '../theme.js';
import { DAY_CODES, DAY_SHORT, parseICal, parseCSV } from '../utils.js';
import { CORS_PROXY, CORS_PROXY_DEFAULT, getCorsProxy, setCorsProxy } from '../canvas-api.js';
import { Field, IconButton, ActionButton, inputStyle, iconBtnStyle } from './ui.jsx';

// ── Setup Panel ────────────────────────────────────────────────

export function SetupPanel({ state, updateState, onImport, onClose }) {
  const [title, setTitle] = useState(state.setup.courseTitle);
  const [start, setStart] = useState(state.setup.startDate);
  const [end, setEnd] = useState(state.setup.endDate);
  const [days, setDays] = useState(state.setup.classDays);

  const toggleDay = (c) =>
    setDays((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const apply = () => {
    updateState((s) => {
      s.setup = { courseTitle: title, startDate: start, endDate: end, classDays: days };
      return s;
    });
    onClose();
  };

  const handleFileImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result;
      const ext = file.name.split('.').pop().toLowerCase();
      let events;
      if (ext === 'ics') {
        events = parseICal(text);
      } else if (ext === 'csv') {
        events = parseCSV(text);
      } else {
        events = [];
      }
      if (onImport) onImport(events);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div style={{ background: T.paper, borderBottom: `1px solid ${T.border}` }}>
      <div className="planner-header" style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 id="setup-heading" style={{ fontFamily: FONT_DISPLAY, fontSize: '18px', fontWeight: 600 }}>Course setup</h2>
          <IconButton onClick={onClose} aria-label="Close setup panel"><X size={16} /></IconButton>
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <Field label="Course title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle()} />
          </Field>
          <Field label="Semester start">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle()} />
          </Field>
          <Field label="Semester end">
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle()} />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Class meeting days">
            <div className="flex gap-2 flex-wrap">
              {DAY_CODES.map((c) => (
                <button key={c} onClick={() => toggleDay(c)}
                  style={{
                    padding: '6px 12px', borderRadius: 2,
                    fontFamily: FONT_MONO, fontSize: '11px', letterSpacing: '0.1em',
                    border: `1px solid ${days.includes(c) ? T.inkBlue : T.border}`,
                    background: days.includes(c) ? T.inkBlue : T.paper,
                    color: days.includes(c) ? '#fff' : T.muted,
                  }}>
                  {DAY_SHORT[c]}
                </button>
              ))}
            </div>
          </Field>
        </div>
        {onImport && (
          <div className="mt-4">
            <Field label="Import">
              <div className="flex items-center gap-3 flex-wrap">
                <label style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', borderRadius: 3, cursor: 'pointer',
                  fontFamily: FONT_BODY, fontSize: '13px', fontWeight: 500,
                  border: `1px solid ${T.border}`,
                  background: T.paper, color: T.ink,
                }}>
                  <input type="file" accept=".ics,.csv" onChange={handleFileImport}
                    style={{ display: 'none' }} />
                  <Upload size={14} /> Import file
                </label>
                <span style={{ fontSize: '12px', color: T.muted, fontFamily: FONT_BODY }}>
                  Import from iCal (.ics) or CSV (date, title columns)
                </span>
              </div>
            </Field>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <ActionButton onClick={apply} primary>Apply</ActionButton>
        </div>
      </div>
    </div>
  );
}

// ── Canvas Panel ───────────────────────────────────────────────

export function CanvasPanel({ state, updateState, onConnect, onRefresh, refreshing, onSwitchCourse, onClose }) {
  const [baseUrl, setBaseUrl] = useState(state.canvas.baseUrl || '');
  const [token, setToken] = useState(state.canvas.token || '');
  const [proxyUrl, setProxyUrl] = useState(CORS_PROXY || '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const handleProxyChange = (val) => {
    setProxyUrl(val);
    const trimmed = val.trim().replace(/\/+$/, '');
    try { localStorage.setItem('planner-cors-proxy', trimmed); } catch {}
    setCorsProxy(trimmed || getCorsProxy());
  };

  const doConnect = async () => {
    setBusy(true);
    setStatus(null);
    const result = await onConnect(baseUrl.trim(), token.trim());
    if (result.ok) {
      setStatus({ msg: `Connected — ${result.count} courses found`, kind: 'ok' });
    } else {
      setStatus({ msg: result.error, kind: 'err' });
    }
    setBusy(false);
  };

  return (
    <div style={{ background: T.paper, borderBottom: `1px solid ${T.border}` }}>
      <div className="planner-header" style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 id="canvas-heading" style={{ fontFamily: FONT_DISPLAY, fontSize: '18px', fontWeight: 600 }}>Canvas connection</h2>
          <IconButton onClick={onClose} aria-label="Close Canvas panel"><X size={16} /></IconButton>
        </div>
        <p style={{ color: T.muted, fontSize: '13px', marginBottom: 16, maxWidth: 760 }}>
          Generate a Personal Access Token in Canvas (Account → Settings → "+ New Access Token").
          Refresh imports every Canvas assignment as a draggable card on its due date.
          Off-day due dates are added to the schedule automatically.
        </p>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <Field label="Canvas base URL">
            <input placeholder="https://canvas.youruniversity.edu"
              value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} style={inputStyle()} />
          </Field>
          <Field label="Personal Access Token">
            <input type="password" placeholder="paste token…"
              value={token} onChange={(e) => setToken(e.target.value)} style={inputStyle()} />
          </Field>
          <Field label="CORS proxy URL (optional)">
            <input placeholder={CORS_PROXY_DEFAULT}
              value={proxyUrl} onChange={(e) => handleProxyChange(e.target.value)} style={inputStyle()} />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <ActionButton onClick={doConnect} primary>
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Cloud size={14} />}
            {state.canvas.connected ? 'Reconnect' : 'Connect'}
          </ActionButton>
          {state.canvas.connected && (
            <>
              <span style={{ color: T.forest, fontSize: '12px', fontFamily: FONT_MONO }}>
                <Check size={12} style={{ display: 'inline', marginRight: 4 }} />
                Connected
              </span>
              <select
                value={state.canvas.courseId || ''}
                onChange={(e) => onSwitchCourse(e.target.value)}
                style={{ ...inputStyle(), width: 'auto', minWidth: 220 }}>
                <option value="">— pick a course —</option>
                {state.canvas.courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ActionButton onClick={onRefresh} disabled={refreshing}>
                <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing…' : 'Refresh'}
              </ActionButton>
            </>
          )}
        </div>

        {/* Status message */}
        {status && (
          <div style={{
            marginTop: 14, padding: 10, borderRadius: 3, fontSize: '12px', display: 'flex', gap: 8,
            background: status.kind === 'ok' ? T.successBg : T.errorBg,
            border: `1px solid ${status.kind === 'ok' ? T.successBorder : T.errorBorder}`,
            color: status.kind === 'ok' ? T.forest : T.ox,
          }}>
            {status.kind === 'ok'
              ? <Check size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              : <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />}
            <span>{status.msg}</span>
          </div>
        )}

        {/* CORS help text (only shown before first connection) */}
        {!state.canvas.connected && !status && (
          <div style={{
            marginTop: 14, padding: 10, background: T.subtle, border: `1px solid ${T.border}`,
            borderRadius: 3, fontSize: '12px', color: T.muted, display: 'flex', gap: 8,
          }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              If connecting fails, your browser may be blocking cross-origin requests (CORS).
              The app routes requests through a CORS proxy. You can use the default or enter your own proxy URL above.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shift Modal ────────────────────────────────────────────────

export function ShiftModal({ onShift, onClose, hasHolidays }) {
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

// ── Conflict diff computation ──────────────────────────────────

function computeConflictDiff(local, remote) {
  const localItems = local.items || {};
  const remoteItems = remote.items || {};
  const localIds = new Set(Object.keys(localItems));
  const remoteIds = new Set(Object.keys(remoteItems));

  // Items added/removed between versions
  const onlyLocal = [...localIds].filter((id) => !remoteIds.has(id));
  const onlyRemote = [...remoteIds].filter((id) => !localIds.has(id));

  // Items present in both but with different titles or types
  const changed = [...localIds].filter((id) =>
    remoteIds.has(id) && (
      localItems[id].title !== remoteItems[id].title ||
      localItems[id].html !== remoteItems[id].html ||
      localItems[id].points !== remoteItems[id].points
    )
  );

  // Schedule differences: items that moved to a different date
  const localSchedule = local.schedule || {};
  const remoteSchedule = remote.schedule || {};
  const localDates = Object.keys(localSchedule).filter((d) => localSchedule[d]?.length > 0);
  const remoteDates = Object.keys(remoteSchedule).filter((d) => remoteSchedule[d]?.length > 0);

  // Build item->date maps
  const localDateMap = {};
  for (const d of localDates) for (const id of localSchedule[d]) localDateMap[id] = d;
  const remoteDateMap = {};
  for (const d of remoteDates) for (const id of remoteSchedule[d]) remoteDateMap[id] = d;

  const moved = [...localIds].filter((id) =>
    remoteIds.has(id) && localDateMap[id] && remoteDateMap[id] && localDateMap[id] !== remoteDateMap[id]
  );

  return {
    localItemCount: localIds.size,
    remoteItemCount: remoteIds.size,
    localDayCount: localDates.length,
    remoteDayCount: remoteDates.length,
    onlyLocal,
    onlyRemote,
    changed,
    moved,
    localItems,
    remoteItems,
    localDateMap,
    remoteDateMap,
  };
}

// ── Conflict Modal ────────────────────────────────────────────────

export function ConflictModal({ localState, remoteState, onOverwrite, onCancel, onLoadRemote }) {
  const diff = computeConflictDiff(localState, remoteState);
  const localTime = localState.loadedAt
    ? new Date(localState.loadedAt).toLocaleString()
    : 'unknown';
  const remoteTime = remoteState.publishedAt
    ? new Date(remoteState.publishedAt).toLocaleString()
    : 'unknown';

  const summaryRows = [];
  if (diff.onlyLocal.length > 0) summaryRows.push({
    label: 'Items only in yours',
    value: diff.onlyLocal.length,
    detail: diff.onlyLocal.slice(0, 4).map((id) => diff.localItems[id]?.title || id).join(', '),
  });
  if (diff.onlyRemote.length > 0) summaryRows.push({
    label: 'Items only in theirs',
    value: diff.onlyRemote.length,
    detail: diff.onlyRemote.slice(0, 4).map((id) => diff.remoteItems[id]?.title || id).join(', '),
  });
  if (diff.changed.length > 0) summaryRows.push({
    label: 'Items modified',
    value: diff.changed.length,
    detail: diff.changed.slice(0, 4).map((id) => diff.localItems[id]?.title || id).join(', '),
  });
  if (diff.moved.length > 0) summaryRows.push({
    label: 'Items rescheduled',
    value: diff.moved.length,
    detail: diff.moved.slice(0, 4).map((id) => {
      const name = diff.localItems[id]?.title || id;
      return `${name} (${diff.remoteDateMap[id]} \u2192 ${diff.localDateMap[id]})`;
    }).join(', '),
  });

  const rowStyle = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    padding: '6px 0', borderBottom: `1px solid ${T.border}`,
  };
  const labelStyle = { fontFamily: FONT_BODY, fontSize: '13px', color: T.ink };
  const valueStyle = { fontFamily: FONT_MONO, fontSize: '13px', color: T.inkBlue, fontWeight: 600 };
  const detailStyle = {
    fontFamily: FONT_BODY, fontSize: '11px', color: T.muted,
    marginTop: 2, lineHeight: 1.4, wordBreak: 'break-word',
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.4)', zIndex: 40,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div style={{
        background: T.paper, borderRadius: 6, padding: 24,
        boxShadow: '0 12px 40px rgba(0,0,0,0.2)', maxWidth: 480, width: '90%',
      }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
          <AlertTriangle size={20} color={T.amber} />
          <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: '18px', fontWeight: 600, color: T.ink, margin: 0 }}>
            Publish conflict
          </h3>
        </div>

        <p style={{ fontSize: '13px', color: T.muted, marginBottom: 16, lineHeight: 1.5 }}>
          Someone else published changes since you last loaded.
          Review the differences and choose how to proceed.
        </p>

        {/* Timestamps */}
        <div style={{
          background: T.subtle, borderRadius: 4, padding: 12, marginBottom: 16,
          border: `1px solid ${T.border}`,
        }}>
          <div style={{ ...rowStyle, borderBottom: `1px solid ${T.border}` }}>
            <span style={labelStyle}>Your version loaded</span>
            <span style={{ ...valueStyle, color: T.ink }}>{localTime}</span>
          </div>
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <span style={labelStyle}>Their version published</span>
            <span style={{ ...valueStyle, color: T.ink }}>{remoteTime}</span>
          </div>
        </div>

        {/* Summary counts */}
        <div style={{
          background: T.subtle, borderRadius: 4, padding: 12, marginBottom: 16,
          border: `1px solid ${T.border}`,
        }}>
          <div style={{ ...rowStyle, borderBottom: `1px solid ${T.border}` }}>
            <span style={labelStyle}>Total items (yours / theirs)</span>
            <span style={valueStyle}>{diff.localItemCount} / {diff.remoteItemCount}</span>
          </div>
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <span style={labelStyle}>Scheduled days (yours / theirs)</span>
            <span style={valueStyle}>{diff.localDayCount} / {diff.remoteDayCount}</span>
          </div>
        </div>

        {/* Detailed diff rows */}
        {summaryRows.length > 0 ? (
          <div style={{
            background: T.subtle, borderRadius: 4, padding: 12, marginBottom: 20,
            border: `1px solid ${T.border}`,
          }}>
            {summaryRows.map((row, i) => (
              <div key={i} style={{ ...rowStyle, borderBottom: i < summaryRows.length - 1 ? `1px solid ${T.border}` : 'none', flexDirection: 'column', alignItems: 'stretch' }}>
                <div className="flex justify-between">
                  <span style={labelStyle}>{row.label}</span>
                  <span style={valueStyle}>{row.value}</span>
                </div>
                {row.detail && <div style={detailStyle}>{row.detail}</div>}
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: '12px', color: T.muted, marginBottom: 20, fontStyle: 'italic' }}>
            No structural differences detected — the conflict is timestamp-only.
          </p>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-2 flex-wrap">
          <ActionButton onClick={onCancel}>Cancel</ActionButton>
          <ActionButton onClick={onLoadRemote}>Load theirs</ActionButton>
          <ActionButton onClick={onOverwrite} primary>Overwrite with mine</ActionButton>
        </div>
      </div>
    </div>
  );
}

// ── Recurring Modal ─────────────────────────────────────────────

export function RecurringModal({ classDays, onCreate, onClose }) {
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

// ── Empty State (onboarding) ───────────────────────────────────

export function EmptyState({ onSetup, onConnect, isConnected }) {
  return (
    <div style={{
      background: T.paper, border: `1px dashed ${T.borderStrong}`, borderRadius: 4,
      padding: 48, textAlign: 'center',
    }}>
      <Calendar size={28} color={T.muted} style={{ margin: '0 auto 12px' }} />
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: '20px', color: T.ink, marginBottom: 6 }}>
        Get started
      </div>
      <div style={{ fontSize: '13px', color: T.muted, marginBottom: 18, maxWidth: 420, margin: '0 auto 18px' }}>
        {isConnected
          ? 'Pick a course from the Canvas panel, then set your semester dates.'
          : 'Connect to Canvas to import your courses and assignments, then set your semester dates.'}
      </div>
      <div className="flex gap-3 justify-center flex-wrap">
        {!isConnected && (
          <ActionButton onClick={onConnect} primary><Cloud size={14} /> Connect Canvas</ActionButton>
        )}
        <ActionButton onClick={onSetup} primary={isConnected}><Settings size={14} /> Course setup</ActionButton>
      </div>
    </div>
  );
}
