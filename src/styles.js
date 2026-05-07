/**
 * App-level CSS styles — returned as a string for injection via <style>.
 *
 * Must be a function (not a constant) so it reads the current theme palette,
 * which changes with dark mode toggling.
 */

import { T, FONT_DISPLAY, FONT_BODY, FONT_MONO } from './theme.js';

export function appStyles() {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=Geist:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    .planner-card a { color: ${T.inkBlue}; text-decoration: underline; text-underline-offset: 2px; }
    .planner-rich p { margin: 0 0 0.4rem 0; }
    .planner-rich p:last-child { margin-bottom: 0; }
    .planner-rich ul, .planner-rich ol { margin: 0.2rem 0 0.4rem 1.2rem; }
    .planner-rich [contenteditable="true"]:focus { outline: 2px solid ${T.inkBlue}; outline-offset: 2px; border-radius: 3px; }
    .drop-target-active { background: ${T.inkBlueSoft} !important; }
    .item-dragging { opacity: 0.4; }

    /* Responsive layouts */
    .planner-shell { padding: 16px; }
    .planner-main { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
    @media (min-width: 640px)  { .planner-shell { padding: 24px; } }
    @media (min-width: 1024px) { .planner-main.with-sidebar { grid-template-columns: 1fr 280px; } }

    .day-row { display: grid; grid-template-columns: 92px 1fr; }
    @media (min-width: 640px) { .day-row { grid-template-columns: 170px 1fr; } }

    .date-col { padding: 10px 10px 12px; border-right: 1px solid ${T.border}; position: relative; }
    @media (min-width: 640px) { .date-col { padding: 14px 16px; } }

    .date-num { font-family: ${FONT_DISPLAY}; font-weight: 500; color: ${T.ink}; letter-spacing: -0.01em; line-height: 1.1; font-size: 16px; }
    @media (min-width: 640px) { .date-num { font-size: 20px; } }

    .date-day { font-family: ${FONT_MONO}; font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: ${T.muted}; margin-top: 2px; }
    @media (min-width: 640px) { .date-day { font-size: 10px; } }

    .planner-title { font-family: ${FONT_DISPLAY}; font-weight: 600; letter-spacing: -0.01em; line-height: 1.1; font-size: 22px; }
    @media (min-width: 640px) { .planner-title { font-size: 32px; } }

    .planner-header { padding: 14px 16px; }
    @media (min-width: 640px) { .planner-header { padding: 20px 24px; } }

    .planner-header-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }

    .col-header { padding: 10px 12px; font-family: ${FONT_MONO}; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: ${T.muted}; }
    @media (min-width: 640px) { .col-header { padding: 10px 16px; font-size: 10px; letter-spacing: 0.2em; } }

    .day-tools { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

    .holiday-row { position: relative; }
    .holiday-row::after {
      content: '';
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      background: repeating-linear-gradient(135deg, transparent, transparent 8px, rgba(128,128,128,0.06) 8px, rgba(128,128,128,0.06) 16px);
      pointer-events: none;
    }

    .module-header {
      padding: 10px 16px;
      font-family: ${FONT_DISPLAY}; font-size: 16px; font-weight: 600; color: ${T.ink};
      background: ${T.subtle}; border-bottom: 1px solid ${T.border};
      display: flex; align-items: center; justify-content: space-between;
    }

    /* Accessibility */
    button:focus-visible, a:focus-visible, select:focus-visible, input:focus-visible {
      outline: 2px solid ${T.focusRing}; outline-offset: 2px; border-radius: 2px;
    }
    .skip-link {
      position: absolute; top: -40px; left: 0;
      background: ${T.inkBlue}; color: #fff;
      padding: 8px 16px; z-index: 100;
      font-family: ${FONT_BODY}; font-size: 14px;
      text-decoration: none; border-radius: 0 0 4px 0;
    }
    .skip-link:focus { top: 0; }
    .kb-move-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; padding: 0;
      background: ${T.paper}; border: 1px solid ${T.border};
      border-radius: 2px; cursor: pointer; color: ${T.muted};
    }
    .kb-move-btn:hover { background: ${T.subtle}; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
      }
    }

    @media print {
      @page { margin: 0.5in 0.4in; }
      * { color: #000 !important; background: white !important; }
      body { background: white !important; color: #000 !important; font-size: 11pt; }
      .planner-header-row nav,
      .planner-header-row button,
      footer, aside,
      .skip-link { display: none !important; }
      .day-tools { display: none !important; }
      [title="Drag to move"], .kb-move-btn { display: none !important; }
      .planner-card .flex.flex-col { display: none !important; }
      [role="status"][aria-live="polite"] { display: none !important; }
      [role="dialog"] { display: none !important; }
      .module-header button { display: none !important; }
      header[role="banner"] {
        border-bottom: 2px solid #000 !important;
        padding: 0 0 8px 0 !important;
        margin-bottom: 8px !important;
      }
      .planner-header { padding: 0 !important; }
      .planner-header-row { display: block !important; }
      .planner-title {
        font-size: 16pt !important;
        color: #000 !important;
        margin: 0 0 2px 0 !important;
      }
      .planner-shell { padding: 0 !important; max-width: 100% !important; }
      .planner-main { display: block !important; max-width: 100% !important; }
      .planner-main > section { width: 100% !important; }
      .planner-main > section > div {
        border: 1px solid #000 !important;
        border-radius: 0 !important;
        overflow: visible !important;
      }
      .day-row {
        break-inside: avoid;
        page-break-inside: avoid;
        border-bottom: 1px solid #999 !important;
        background: white !important;
      }
      .planner-card {
        break-inside: avoid;
        page-break-inside: avoid;
        box-shadow: none !important;
        border: 1px solid #000 !important;
        border-left: 1px solid #000 !important;
        border-radius: 0 !important;
        background: white !important;
        padding: 6px 8px !important;
        margin-bottom: 4px !important;
        cursor: default !important;
      }
      .module-header {
        break-inside: avoid;
        page-break-inside: avoid;
        border-bottom: 2px solid #000 !important;
        font-size: 12pt !important;
        padding: 6px 8px !important;
      }
      .col-header {
        background: #eee !important;
        color: #000 !important;
        border-bottom: 1px solid #000 !important;
        padding: 4px 8px !important;
      }
      .date-col {
        border-right: 1px solid #999 !important;
        padding: 6px 8px !important;
      }
      .date-num { color: #000 !important; font-size: 12pt !important; }
      .date-day { color: #333 !important; }
      .day-row > div:last-child { padding: 6px 8px !important; }
      .planner-card a { color: #000 !important; text-decoration: underline !important; }
      .planner-rich { overflow: visible !important; max-height: none !important; }
      .planner-rich * { overflow: visible !important; }
      .item-dragging { opacity: 1 !important; }
      .holiday-row::after { display: none !important; }
      .drop-target-active { background: white !important; }
    }
  `;
}
