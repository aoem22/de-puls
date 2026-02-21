import { NextRequest, NextResponse } from 'next/server';
import { buildDashboardOverview } from '@/lib/supabase/build-overview';
import type { SecurityOverviewResponse } from '@/lib/dashboard/types';

// ────────────────────────── In-memory response cache ──────────────────────────

interface CacheEntry {
  data: SecurityOverviewResponse;
  expiresAt: number;
}

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const CACHE_MAX_ENTRIES = 100;
const responseCache = new Map<string, CacheEntry>();

function getCacheKey(params: URLSearchParams): string {
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${k}=${v}`).join('&');
}

function evictExpiredEntries(): void {
  if (responseCache.size <= CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (entry.expiresAt <= now) responseCache.delete(key);
  }
}

// ────────────────────────── GET handler ──────────────────────────

export async function GET(request: NextRequest) {
  try {
    // ── Check cache ──
    const cacheKey = getCacheKey(request.nextUrl.searchParams);
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          'X-Cache': 'HIT',
        },
      });
    }

    const sp = request.nextUrl.searchParams;
    const payload = await buildDashboardOverview({
      category: sp.get('category'),
      timeframe: sp.get('timeframe'),
      page: sp.get('page'),
      weapon: sp.get('weapon'),
      drug: sp.get('drug'),
      pipelineRun: sp.get('pipeline_run'),
      city: sp.get('city'),
      kreis: sp.get('kreis'),
      plz: sp.get('plz'),
      bundesland: sp.get('bundesland'),
    });

    // ── Store in cache ──
    evictExpiredEntries();
    responseCache.set(cacheKey, {
      data: payload,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    const message = error instanceof Error && error.message === 'Invalid category'
      ? 'Invalid category'
      : 'Failed to build dashboard overview';
    const status = message === 'Invalid category' ? 400 : 500;

    return NextResponse.json(
      { error: message, details: String(error) },
      { status },
    );
  }
}
