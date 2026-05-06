/**
 * Theme system — light/dark palettes, typography, and a mutable theme reference.
 *
 * `T` is a module-level `let` that points to either LIGHT or DARK.
 * ES module imports are live bindings, so when App.jsx calls `setTheme(true)`,
 * every module that imported `T` immediately sees the DARK palette.
 *
 * Style helpers that reference T (inputStyle, iconBtnStyle, etc.) must be
 * functions — not constants — so they pick up the current palette on each call.
 */

// ── Light palette ──────────────────────────────────────────────
export const LIGHT = {
  cream: '#F7F3EA', paper: '#FFFFFF', subtle: '#EFE9DB',
  ink: '#1A1410', inkMid: '#3D362E', muted: '#5C5347', faint: '#8A7F71',
  border: '#C7BFA8', borderStrong: '#A89F8E',
  inkBlue: '#1F3A60', inkBlueSoft: '#E8EDF4',
  sienna: '#A04A2A', siennaSoft: '#F5E9DF',
  forest: '#2F6B3A', ox: '#8B2E1F',
  amber: '#B47A1F', amberSoft: '#F6ECDA',
  weekShade: '#F2EBDA', holidayBg: '#f0ece4',
  focusRing: '#1F3A60',
  successBg: '#e8f5e9', successBorder: '#a5d6a7',
  errorBg: '#fbe9e7', errorBorder: '#ef9a9a',
};

// ── Dark palette ───────────────────────────────────────────────
export const DARK = {
  cream: '#1A1A1E', paper: '#242428', subtle: '#2A2A2F',
  ink: '#E8E4DC', inkMid: '#C8C2B8', muted: '#9A9488', faint: '#6E6860',
  border: '#3E3C38', borderStrong: '#555248',
  inkBlue: '#6BA3D6', inkBlueSoft: '#1E2A3A',
  sienna: '#D4724A', siennaSoft: '#2E2018',
  forest: '#5CB86A', ox: '#E05A45',
  amber: '#D4A03A', amberSoft: '#2E2610',
  weekShade: '#2E2C28', holidayBg: '#2A2826',
  focusRing: '#6BA3D6',
  successBg: '#1a2e1a', successBorder: '#3a5a3a',
  errorBg: '#2e1a1a', errorBorder: '#5a3a3a',
};

/** Active palette — reassigned by setTheme(). Import this in any module. */
export let T = LIGHT;

/** Switch between light and dark palettes. Call from App render. */
export function setTheme(dark) {
  T = dark ? DARK : LIGHT;
}

// ── Assignment group colors ────────────────────────────────────
// Soft pastels that remain readable in both light and dark mode.
// Cycled by index when assigning colors to assignment groups.
export const GROUP_COLORS = [
  '#5B8BD4', // soft blue
  '#E07A5F', // terra cotta
  '#6BBF8A', // soft green
  '#D4A03A', // goldenrod
  '#9B7FC4', // soft purple
  '#E0859A', // dusty rose
  '#4DACB0', // teal
  '#C4854C', // warm brown
];

// ── Typography ─────────────────────────────────────────────────
export const FONT_DISPLAY = "'Fraunces', 'Iowan Old Style', Georgia, serif";
export const FONT_BODY = "'Geist', -apple-system, system-ui, sans-serif";
export const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";
