/**
 * Inline warning panel rendered inside SetupPanel's clone-completion
 * block. Groups warnings by `kind`, shows a summary line per kind, and
 * a "Show details" toggle that expands per-occurrence detail.
 */

import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { T, FONT_MONO } from '../../theme.js';

export default function CloneWarnings({ warnings }) {
  const [expanded, setExpanded] = useState(false);

  // Group by kind for the summary.
  const byKind = {};
  warnings.forEach((w) => {
    byKind[w.kind] = byKind[w.kind] || [];
    byKind[w.kind].push(w);
  });

  const summaryLine = (kind, group) => {
    if (kind === 'unmatched-assignment') {
      return `${group.length} assignment${group.length === 1 ? '' : 's'} could not be re-linked (title not found in target course)`;
    }
    if (kind === 'unmatched-link') {
      // Each entry is one occurrence — aggregate by type for the summary.
      const byType = {};
      group.forEach((w) => { byType[w.type] = (byType[w.type] || 0) + 1; });
      const totals = Object.entries(byType)
        .map(([type, n]) => `${n} ${type.replace(/_/g, ' ')}`)
        .join(', ');
      return `Broken embedded link${group.length === 1 ? '' : 's'} in notes: ${totals}`;
    }
    if (kind === 'title-collision') {
      return `${group.length} title collision${group.length === 1 ? '' : 's'} in source course — relink may have picked the wrong assignment`;
    }
    if (kind === 'date-push-failed') {
      return `${group.length} Canvas due date${group.length === 1 ? '' : 's'} could not be synced`;
    }
    if (kind === 'ambiguous-file') {
      return `${group.length} file${group.length === 1 ? '' : 's'} had multiple matches in the new course — embedded links may point to the wrong copy; verify by hand`;
    }
    return `${group.length} ${kind}`;
  };

  const detailFor = (kind, group) => {
    if (kind === 'unmatched-assignment') {
      return group.map((w) => w.title).join(', ');
    }
    if (kind === 'unmatched-link') {
      // Render one line per occurrence: "files: 'syllabus.pdf' (id 12345) — in note: 'Read chapter…'"
      return group.map((w) => {
        const label = w.sourceName ? `"${w.sourceName}"` : `${w.type.slice(0, -1)}#${w.sourceId}`;
        const ctx = w.noteSnippet ? ` — in note: "${w.noteSnippet}…"` : '';
        return `${w.type}: ${label} (id ${w.sourceId})${ctx}`;
      }).join('\n');
    }
    if (kind === 'title-collision') {
      return group.map((w) => `"${w.title}" (×${w.count})`).join(', ');
    }
    if (kind === 'date-push-failed') {
      return group.map((w) => `"${w.title}" — ${w.error}`).join('; ');
    }
    if (kind === 'ambiguous-file') {
      return group.map((w) => `"${w.filename}" (${w.candidates} matches)`).join(', ');
    }
    return JSON.stringify(group);
  };

  return (
    <div style={{
      display: 'block', marginTop: 8, padding: 8, borderRadius: 3,
      background: T.errorBg, border: `1px solid ${T.errorBorder}`, color: T.ox,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>
            {warnings.length} issue{warnings.length === 1 ? '' : 's'} to review:
          </div>
          <ul style={{ margin: '4px 0 0', paddingLeft: 16, lineHeight: 1.5 }}>
            {Object.entries(byKind).map(([kind, group]) => (
              <li key={kind}>{summaryLine(kind, group)}</li>
            ))}
          </ul>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              marginTop: 6, padding: 0, background: 'none', border: 'none',
              color: T.ox, fontFamily: FONT_MONO, fontSize: '11px',
              textDecoration: 'underline', cursor: 'pointer',
            }}>
            {expanded ? 'Hide details' : 'Show details'}
          </button>
          {expanded && (
            <div style={{
              marginTop: 6, padding: 6, fontFamily: FONT_MONO, fontSize: '11px',
              background: T.paper, color: T.ink, borderRadius: 2,
              maxHeight: 200, overflow: 'auto',
              whiteSpace: 'pre-line',
            }}>
              {Object.entries(byKind).map(([kind, group]) => (
                <div key={kind} style={{ marginBottom: 4 }}>
                  <strong>{kind}:</strong> {detailFor(kind, group)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
