// Light / dark / system theme. style.css keys the palette on <html data-theme>;
// no attribute means "follow prefers-color-scheme". index.html applies the saved
// choice before first paint.
export type Theme = 'system' | 'light' | 'dark';
const KEY = 'fm900-web:theme';

export function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
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
