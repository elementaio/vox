/** Light/dark theme: follows the OS by default, remembers an explicit choice. */
export type Theme = "light" | "dark";
const KEY = "vox-theme";

export function currentTheme(): Theme {
  const stored = localStorage.getItem(KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute("data-theme", t);
}

/** Apply the stored/system theme at startup (before first paint). */
export function initTheme(): void {
  applyTheme(currentTheme());
}

/** Flip and persist; returns the new theme. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(KEY, next);
  applyTheme(next);
  return next;
}
