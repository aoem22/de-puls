import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { PipelineStats } from '@/lib/admin/types';
import { collectLocalPipelineStats } from '@/lib/admin/local-pipeline-stats';

const MANIFEST_CACHE_TTL_MS = 30_000;

let manifestCache: { expiresAt: number; value: PipelineStats } | null = null;

export async function GET() {
  try {
    const now = Date.now();
    if (manifestCache && manifestCache.expiresAt > now) {
      return NextResponse.json(manifestCache.value);
    }

    const local = collectLocalPipelineStats();

    const chunksByMonth: Record<string, { raw: number; enriched: number }> = {};
    let totalJunk = 0;
    const bundeslandCounts: Record<string, { raw: number; enriched: number }> = {};

    for (const [ym, counts] of Object.entries(local.byMonth)) {
      chunksByMonth[ym] = {
        raw: counts.raw,
        enriched: counts.enriched,
      };
    }

    for (const [bundesland, counts] of Object.entries(local.byBundesland)) {
      bundeslandCounts[bundesland] = {
        raw: counts.raw,
        enriched: counts.enriched,
      };
    }

    // ── 3. Count junk from enrichment cache ──
    const cachePath = path.join(process.cwd(), '.cache', 'enrichment_cache.json');
    if (fs.existsSync(cachePath)) {
      try {
        const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        for (const val of Object.values(cache)) {
          const entries = Array.isArray(val) ? val : [val];
          if (entries.length === 1 && (entries[0] as Record<string, unknown>)?._classification) {
            totalJunk++;
          }
        }
      } catch { /* skip */ }
    }

    const stats: PipelineStats = {
      totalScraped: local.totalScraped,
      totalEnriched: local.totalEnriched,
      totalGeocoded: local.totalGeocoded,
      totalJunk,
      chunksByMonth,
      bundeslandCounts,
    };

    manifestCache = {
      value: stats,
      expiresAt: now + MANIFEST_CACHE_TTL_MS,
    };

    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to read pipeline manifest', details: String(error) },
      { status: 500 }
    );
  }
}
