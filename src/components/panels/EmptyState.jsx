/**
 * Onboarding placeholder shown when there are no teaching days yet
 * (typically before the user has set semester start/end + meeting days).
 */

import React from 'react';
import { Calendar, Settings } from 'lucide-react';
import { T, FONT_DISPLAY } from '../../theme.js';
import { ActionButton } from '../ui.jsx';

export default function EmptyState({ onSetup, isConnected }) {
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
          ? 'Set your semester dates and pick a course to get started.'
          : 'Open Course setup to set semester dates and connect to Canvas.'}
      </div>
      <div className="flex gap-3 justify-center flex-wrap">
        <ActionButton onClick={onSetup} primary><Settings size={14} /> Course setup</ActionButton>
      </div>
    </div>
  );
}
