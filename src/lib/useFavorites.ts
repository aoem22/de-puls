'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { UserFavoriteRow } from '@/lib/supabase/types';

const DEVICE_ID_KEY = 'adlerlicht_device_id';
const LEGACY_STORAGE_KEY = 'adlerlicht_favorites';

type FavoritesMap = Map<string, string>; // record_id → comment

// Typed helpers that bypass supabase-js v2.95 GenericTable constraints.
// The Database type was authored before Relationships was mandatory; these
// casts keep runtime behaviour identical while silencing the TS inference.
function favoritesTable() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase.from('user_favorites' as any) as any;
}

function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/**
 * Parse legacy localStorage favorites (array or object format).
 * Returns null if nothing is stored.
 */
function parseLegacyFavorites(): FavoritesMap | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);

    const map = new Map<string, string>();
    if (Array.isArray(parsed)) {
      for (const id of parsed) if (typeof id === 'string') map.set(id, '');
    } else if (parsed && typeof parsed === 'object') {
      for (const [id, comment] of Object.entries(parsed)) {
        map.set(id, typeof comment === 'string' ? comment : '');
      }
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

export function useFavorites() {
  const [favoritesMap, setFavoritesMap] = useState<FavoritesMap>(new Map());
  const [loaded, setLoaded] = useState(false);
  const deviceIdRef = useRef('');
  // Track optimistic adds/removes that happen before init() completes,
  // so they survive the setFavoritesMap(fetchedData) call.
  const pendingAdds = useRef<Map<string, string>>(new Map());
  const pendingRemoves = useRef<Set<string>>(new Set());

  // Initial load from Supabase + migrate legacy localStorage
  useEffect(() => {
    const deviceId = getOrCreateDeviceId();
    deviceIdRef.current = deviceId;
    if (!deviceId) return;

    let cancelled = false;

    async function init() {
      const { data, error } = await favoritesTable()
        .select('record_id, comment')
        .eq('device_id', deviceId) as { data: Pick<UserFavoriteRow, 'record_id' | 'comment'>[] | null; error: unknown };

      if (cancelled) return;

      const map = new Map<string, string>();
      if (!error && data) {
        for (const row of data) map.set(row.record_id, row.comment ?? '');
      }

      // Migrate legacy localStorage if Supabase is empty for this device
      if (map.size === 0) {
        const legacy = parseLegacyFavorites();
        if (legacy && legacy.size > 0) {
          const rows = Array.from(legacy.entries()).map(([record_id, comment]) => ({
            device_id: deviceId,
            record_id,
            comment,
          }));
          const { data: inserted } = await favoritesTable()
            .upsert(rows, { onConflict: 'device_id,record_id' })
            .select('record_id, comment') as { data: Pick<UserFavoriteRow, 'record_id' | 'comment'>[] | null };

          if (!cancelled) {
            if (inserted) {
              for (const row of inserted) map.set(row.record_id, row.comment ?? '');
            } else {
              for (const [id, comment] of legacy) map.set(id, comment);
            }
            localStorage.removeItem(LEGACY_STORAGE_KEY);
          }
        }
      }

      if (!cancelled) {
        // Replay any optimistic mutations that happened during the fetch
        for (const removeId of pendingRemoves.current) map.delete(removeId);
        for (const [addId, comment] of pendingAdds.current) map.set(addId, comment);
        pendingAdds.current.clear();
        pendingRemoves.current.clear();

        setFavoritesMap(map);
        setLoaded(true);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const favoriteIds = useMemo(() => new Set(favoritesMap.keys()), [favoritesMap]);

  const toggleFavorite = useCallback((id: string) => {
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;

    setFavoritesMap((prev) => {
      const next = new Map(prev);
      const wasInSet = next.has(id);

      // Track ops so init() can replay them after its fetch completes
      if (!loaded) {
        if (wasInSet) {
          pendingRemoves.current.add(id);
          pendingAdds.current.delete(id);
        } else {
          pendingAdds.current.set(id, '');
          pendingRemoves.current.delete(id);
        }
      }

      if (wasInSet) {
        next.delete(id);
        favoritesTable()
          .delete()
          .eq('device_id', deviceId)
          .eq('record_id', id)
          .then(({ error }: { error: unknown }) => {
            if (error) {
              setFavoritesMap((cur) => {
                const rollback = new Map(cur);
                rollback.set(id, '');
                return rollback;
              });
            }
          });
      } else {
        next.set(id, '');
        favoritesTable()
          .insert({ device_id: deviceId, record_id: id, comment: '' })
          .then(({ error }: { error: unknown }) => {
            if (error) {
              setFavoritesMap((cur) => {
                const rollback = new Map(cur);
                rollback.delete(id);
                return rollback;
              });
            }
          });
      }

      return next;
    });
  }, [loaded]);

  const isFavorite = useCallback((id: string) => favoritesMap.has(id), [favoritesMap]);

  const getComment = useCallback((id: string) => favoritesMap.get(id) ?? '', [favoritesMap]);

  const setComment = useCallback((id: string, comment: string) => {
    const deviceId = deviceIdRef.current;
    if (!deviceId) return;

    setFavoritesMap((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      const oldComment = prev.get(id) ?? '';
      next.set(id, comment);

      favoritesTable()
        .update({ comment })
        .eq('device_id', deviceId)
        .eq('record_id', id)
        .then(({ error }: { error: unknown }) => {
          if (error) {
            setFavoritesMap((cur) => {
              const rollback = new Map(cur);
              if (rollback.has(id)) rollback.set(id, oldComment);
              return rollback;
            });
          }
        });

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
    loaded,
  };
}
