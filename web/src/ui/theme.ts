// Colour themes. style.css keys each palette on <html data-theme>; no attribute means
// "follow prefers-color-scheme" (Light or Dark). index.html applies the saved choice
// before first paint: keep its list in sync with THEMES.
export const THEMES = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
  ['fppblue', 'FPP Blue'],
  ['amber', 'Amber'],
  ['green', 'Green screen'],
  ['slate', 'Slate'],
  ['contrast', 'High contrast'],
] as const;
export type Theme = (typeof THEMES)[number][0];
const KEY = 'fm900-web:theme';

const isTheme = (t: unknown): t is Theme => THEMES.some(([id]) => id === t);

export function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return isTheme(t) ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    // storage unavailable: the choice lasts for this page only
  }
}
