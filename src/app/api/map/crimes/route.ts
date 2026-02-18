import { NextRequest, NextResponse } from 'next/server';
import type { CrimeCategory } from '@/lib/types/crime';
import type { CrimeRecord } from '@/lib/types/crime';
import { fetchCrimesFromSupabase } from '@/lib/supabase/queries';

// ────────────────────────── In-memory cache ──────────────────────────

interface CacheEntry {
  data: CrimeRecord[];
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const crimesCache = new Map<string, CacheEntry>();

function getCacheKey(category: string, pipelineRun: string): string {
  return `${category}:${pipelineRun}`;
}

// ────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const categoryParam = request.nextUrl.searchParams.get('category') ?? undefined;
    const pipelineRunParam = request.nextUrl.searchParams.get('pipeline_run') ?? undefined;

    const category = categoryParam as CrimeCategory | undefined;

    // Check cache
    const cacheKey = getCacheKey(categoryParam ?? 'all', pipelineRunParam ?? 'all');
    const cached = crimesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
          'X-Cache': 'HIT',
        },
      });
    }

    // Fetch from Supabase with server-side pagination
    const crimes = await fetchCrimesFromSupabase(category, pipelineRunParam);

    // Store in cache
    crimesCache.set(cacheKey, {
      data: crimes,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return NextResponse.json(crimes, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch crimes', details: String(error) },
      { status: 500 },
    );
  }
}
