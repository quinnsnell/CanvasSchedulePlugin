/**
 * PublishBanner — success banner shown after publishing to Canvas.
 * ActivityLog — collapsible list of recent publish events.
 */

import React, { useState } from 'react';
import { X, Check, Link2 } from 'lucide-react';
import { T, FONT_MONO } from '../theme.js';
import { IconButton } from './ui.jsx';

export function PublishBanner({ url, onDismiss }) {
  const [copied, setCopied] = useState(false);
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div style={{ background: T.successBg, borderBottom: `1px solid ${T.successBorder}`, padding: '12px 24px' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div className="flex items-center justify-between mb-2">
          <span style={{ fontFamily: FONT_MONO, fontSize: '11px', fontWeight: 600, color: T.forest }}>
            <Check size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />Published to Canvas
          </span>
          <IconButton onClick={onDismiss} aria-label="Dismiss publish notification"><X size={14} /></IconButton>
        </div>
        <p style={{ fontFamily: FONT_MONO, fontSize: '11px', color: T.muted, marginBottom: 8 }}>
          Schedule published as a Canvas Page. Share this link with TAs and students. Re-publish after changes.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <a href={url} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: FONT_MONO, fontSize: '12px', color: T.inkBlue, wordBreak: 'break-all' }}>
            {url}
          </a>
          <button onClick={copyUrl} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 3,
            fontFamily: FONT_MONO, fontSize: '11px',
            border: `1px solid ${copied ? T.successBorder : T.border}`,
            background: copied ? T.successBg : T.paper,
            color: copied ? T.forest : T.ink,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            {copied ? <><Check size={12} /> Copied</> : <><Link2 size={12} /> Copy link</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ActivityLog({ publishHistory, onClose }) {
  const entries = (publishHistory || []).slice().reverse();
  return (
    <div style={{ background: T.subtle, borderBottom: `1px solid ${T.border}`, padding: '12px 24px' }}>
      <div style={{ maxWidth: 1152, margin: '0 auto' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: '11px', fontWeight: 600, color: T.ink, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Publish History
          </span>
          <IconButton onClick={onClose} aria-label="Close activity log"><X size={14} /></IconButton>
        </div>
        {entries.length === 0 ? (
          <p style={{ fontFamily: FONT_MONO, fontSize: '11px', color: T.muted }}>No publish history</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {entries.map((e, i) => (
              <li key={i} style={{
                fontFamily: FONT_MONO, fontSize: '11px', color: T.ink,
                padding: '4px 0', borderBottom: i < entries.length - 1 ? `1px solid ${T.border}` : 'none',
                display: 'flex', gap: 12, alignItems: 'baseline',
              }}>
                <span style={{ color: T.muted, minWidth: 150 }}>
                  {new Date(e.timestamp).toLocaleString()}
                </span>
                <span>{e.itemCount} item{e.itemCount !== 1 ? 's' : ''}</span>
                <span style={{ color: T.muted }}>&middot;</span>
                <span>{e.dayCount} day{e.dayCount !== 1 ? 's' : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
