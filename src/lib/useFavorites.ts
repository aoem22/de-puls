'use client';

import { useState, useCallback, useMemo } from 'react';

const STORAGE_KEY = 'kanakmap_favorites';

type FavoritesMap = Map<string, string>;

/**
 * Load favorites from localStorage.
 * Handles both legacy array format ["id1","id2"] and new object format {"id1":"comment"}.
 */
function loadFavorites(): FavoritesMap {
  if (typeof window === 'undefined') return new Map();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return new Map();
    const parsed = JSON.parse(stored);

    // Legacy format: string array → migrate to map with empty comments
    if (Array.isArray(parsed)) {
      const map = new Map<string, string>();
      for (const id of parsed) {
        if (typeof id === 'string') map.set(id, '');
      }
      return map;
    }

    // New format: object { id: comment }
    if (parsed && typeof parsed === 'object') {
      const map = new Map<string, string>();
      for (const [id, comment] of Object.entries(parsed)) {
        map.set(id, typeof comment === 'string' ? comment : '');
      }
      return map;
    }
  } catch { /* ignore */ }
  return new Map();
}

function saveFavorites(favorites: FavoritesMap) {
  try {
    const obj: Record<string, string> = {};
    for (const [id, comment] of favorites) obj[id] = comment;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

export function useFavorites() {
  const [favoritesMap, setFavoritesMap] = useState<FavoritesMap>(() => loadFavorites());

  // Derived Set<string> for backward compat with consumers that only need IDs
  const favoriteIds = useMemo(() => new Set(favoritesMap.keys()), [favoritesMap]);

  const toggleFavorite = useCallback((id: string) => {
    setFavoritesMap((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, '');
      saveFavorites(next);
      return next;
    });
  }, []);

  const isFavorite = useCallback((id: string) => favoritesMap.has(id), [favoritesMap]);

  const getComment = useCallback((id: string) => favoritesMap.get(id) ?? '', [favoritesMap]);

  const setComment = useCallback((id: string, comment: string) => {
    setFavoritesMap((prev) => {
      if (!prev.has(id)) return prev; // only set comments on favorited items
      const next = new Map(prev);
      next.set(id, comment);
      saveFavorites(next);
      return next;
    });
  }, []);

  return {
    favoriteIds,
    toggleFavorite,
    isFavorite,
    count: favoritesMap.size,
    getComment,
    setComment,
  };
}
