/**
 * Shown when publishing finds someone else has published since we loaded.
 * Computes a diff of items (added/removed/modified/moved), shows summary
 * counts, and offers three actions: cancel, load theirs, or overwrite
 * with mine.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { T, FONT_DISPLAY, FONT_BODY, FONT_MONO } from '../../theme.js';
import { ActionButton } from '../ui.jsx';

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

export default function ConflictModal({ localState, remoteState, onOverwrite, onCancel, onLoadRemote }) {
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
      return `${name} (${diff.remoteDateMap[id]} → ${diff.localDateMap[id]})`;
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
