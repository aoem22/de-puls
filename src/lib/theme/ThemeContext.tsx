'use client';

import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'theme';

/** Resolve effective theme from localStorage or system preference */
function resolveTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Apply data-theme attribute to <html> and update color-scheme */
function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
}

// Listeners for useSyncExternalStore
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((l) => l());
}

function subscribe(callback: () => void) {
  listeners.add(callback);

  // Also listen for system preference changes (when no manual override)
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      applyTheme(resolveTheme());
      emitChange();
    }
  };
  mq.addEventListener('change', handler);

  return () => {
    listeners.delete(callback);
    mq.removeEventListener('change', handler);
  };
}

function getSnapshot(): Theme {
  return resolveTheme();
}

function getServerSnapshot(): Theme {
  return 'dark';
}

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleTheme = useCallback(() => {
    const next: Theme = resolveTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    emitChange();
  }, []);

  return { theme, toggleTheme };
}
