/**
 * renderScheduleHtml — generates a static HTML table for publishing
 * the schedule to a Canvas Page.
 *
 * Uses CSS custom properties with light-theme fallbacks in every var() call.
 * A <style> block defines dark-mode overrides via prefers-color-scheme.
 * If Canvas strips the <style> tag, the light theme still renders correctly
 * because every var(--x, fallback) falls back to the hardcoded light value.
 */

import { LIGHT, DARK } from './theme.js';
import { computeAllDays, generateClassDays, weekKey, weekNumber } from './utils.js';

export default function renderScheduleHtml(s) {
  const L = LIGHT;
  const D = DARK;

  // var(--name, lightFallback) — works even if <style> is stripped
  const v = (name, light) => `var(--s-${name}, ${light})`;

  const darkStyleBlock = `
    <style>
      @media (prefers-color-scheme: dark) {
        .schedule-wrap {
          --s-paper: ${D.paper}; --s-subtle: ${D.subtle};
          --s-ink: ${D.ink}; --s-ink-mid: ${D.inkMid}; --s-muted: ${D.muted};
          --s-border: ${D.border}; --s-border-strong: ${D.borderStrong};
          --s-ink-blue: ${D.inkBlue}; --s-ink-blue-soft: ${D.inkBlueSoft};
          --s-sienna: ${D.sienna}; --s-ox: ${D.ox};
          --s-amber-soft: ${D.amberSoft};
          --s-week-shade: ${D.weekShade}; --s-holiday-bg: ${D.holidayBg};
        }
        .schedule-wrap a { color: ${D.inkBlue}; }
      }
    </style>`;

  const days = computeAllDays(s.setup, s.extraDays);
  const teaching = new Set(generateClassDays(s.setup.startDate, s.setup.endDate, s.setup.classDays));
  let prevWk = null;
  let rows = '';

  // Compute module day counts for published HTML
  const pubModuleDates = Object.keys(s.modules || {}).filter((d) => days.includes(d)).sort();
  const pubModuleDayCounts = {};
  pubModuleDates.forEach((mDate, mi) => {
    const startIdx = days.indexOf(mDate);
    const endIdx = mi < pubModuleDates.length - 1 ? days.indexOf(pubModuleDates[mi + 1]) : days.length;
    let count = 0;
    for (let i = startIdx; i < endIdx; i++) {
      if (!s.holidays?.[days[i]]) count++;
    }
    pubModuleDayCounts[mDate] = count;
  });

  days.forEach((d) => {
    const dt = new Date(d + 'T00:00:00');
    const dayName = dt.toLocaleDateString('en-US', { weekday: 'long' });
    const dateNum = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const wk = weekKey(d);
    const isNewWeek = wk !== prevWk;
    prevWk = wk;
    const isExtra = !teaching.has(d);
    const items = (s.schedule[d] || []).map((id) => s.items[id]).filter(Boolean);
    const shadedWeek = weekNumber(d) % 2 === 1;
    const holidayLabel = s.holidays?.[d];

    let bgColor;
    if (holidayLabel) bgColor = v('holiday-bg', L.holidayBg);
    else if (isExtra) bgColor = v('amber-soft', L.amberSoft);
    else if (shadedWeek) bgColor = v('week-shade', L.weekShade);
    else bgColor = v('paper', L.paper);

    // Module header row
    const moduleTitle = s.modules?.[d];
    if (moduleTitle) {
      const dayCount = pubModuleDayCounts[d];
      const dayCountHtml = dayCount != null
        ? ` <span style="font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 400; color: ${v('muted', L.muted)}; margin-left: 10px; letter-spacing: 0.02em;">(${dayCount} ${dayCount === 1 ? 'day' : 'days'})</span>`
        : '';
      rows += `<tr><td colspan="2" style="padding: 10px 16px; font-family: Georgia, serif; font-size: 16px; font-weight: 600; color: ${v('ink', L.ink)}; background: ${v('subtle', L.subtle)}; border-bottom: 1px solid ${v('border', L.border)};">${moduleTitle}${dayCountHtml}</td></tr>`;
    }

    if (isNewWeek) {
      rows += `<tr><td colspan="2" style="padding: 0;"><div style="border-top: 2px solid ${v('border-strong', L.borderStrong)};"></div></td></tr>`;
    }

    let content = '';
    items.forEach((item) => {
      if (item.type === 'assign') {
        const titleHtml = item.htmlUrl
          ? `<a href="${item.htmlUrl}" style="color: ${v('ink-blue', L.inkBlue)}; text-decoration: underline; text-underline-offset: 2px;">${item.title || 'Untitled'}</a>`
          : (item.title || 'Untitled');
        content += `<div style="margin: 0 0 8px 0; background: ${v('paper', L.paper)}; border: 1px solid ${v('border', L.border)}; border-left: 3px solid ${v('ink-blue', L.inkBlue)}; border-radius: 3px; padding: 10px 12px;">
          <div style="margin-bottom: 4px;">
            <span style="font-family: ui-monospace, monospace; font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: ${v('ink-blue', L.inkBlue)}; background: ${v('ink-blue-soft', L.inkBlueSoft)}; padding: 2px 6px; border-radius: 2px;">Assignment</span>
            ${item.points ? `<span style="font-family: ui-monospace, monospace; font-size: 10px; color: ${v('muted', L.muted)}; margin-left: 6px;">${item.points} pts</span>` : ''}
          </div>
          <div style="font-family: Georgia, serif; font-size: 15px; font-weight: 500; color: ${v('ink', L.ink)}; line-height: 1.3;">${titleHtml}</div>
        </div>`;
      } else if (item.type === 'rich') {
        content += `<div style="margin: 0 0 8px 0; background: ${v('paper', L.paper)}; border: 1px solid ${v('border', L.border)}; border-left: 3px solid ${v('sienna', L.sienna)}; border-radius: 3px; padding: 10px 12px;">
          <div style="font-size: 13px; color: ${v('ink', L.ink)}; line-height: 1.5;">${item.html || ''}</div>
        </div>`;
      }
    });

    if (holidayLabel) {
      content = `<div style="padding: 4px 0; font-family: ui-monospace, monospace; font-size: 11px; color: ${v('ox', L.ox)}; text-transform: uppercase; letter-spacing: 0.1em;">${holidayLabel}</div>`;
    } else if (!content) {
      content = `<div style="padding: 4px 0;">&nbsp;</div>`;
    }

    const rowShadow = shadedWeek ? 'inset 0 1px 0 rgba(255,255,255,0.7)' : 'inset 0 1px 0 rgba(0,0,0,0.04)';
    const rowOpacity = holidayLabel ? 'opacity: 0.7;' : '';
    rows += `<tr style="background: ${bgColor}; border-bottom: 1px solid ${v('border', L.border)}; box-shadow: ${rowShadow}; ${rowOpacity}">
      <td style="padding: 14px 16px; border-right: 1px solid ${v('border', L.border)}; vertical-align: top; width: 170px;">
        <div style="font-family: Georgia, serif; font-weight: 500; color: ${v('ink', L.ink)}; font-size: 20px; line-height: 1.1; letter-spacing: -0.01em;">${dateNum}</div>
        <div style="font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: ${v('muted', L.muted)}; margin-top: 2px;">${dayName}</div>
      </td>
      <td style="padding: 14px 16px; vertical-align: top;">${content}</td>
    </tr>`;
  });

  return `${darkStyleBlock}
  <div class="schedule-wrap" style="max-width: 1152px; margin: 0 auto;">
    <table style="width: 100%; border-collapse: collapse; border: 1px solid ${v('border', L.border)}; border-radius: 6px; overflow: hidden; font-family: -apple-system, system-ui, sans-serif; color: ${v('ink', L.ink)};">
      <thead><tr style="background: ${v('subtle', L.subtle)}; border-bottom: 1px solid ${v('border', L.border)};">
        <th style="padding: 10px 16px; text-align: left; font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: ${v('muted', L.muted)}; border-right: 1px solid ${v('border', L.border)};">Class meeting</th>
        <th style="padding: 10px 16px; text-align: left; font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: ${v('muted', L.muted)};">Readings · Assignments · Materials</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}
