import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { MetricKey, BreakdownRow, MetricBreakdownResponse } from '@/lib/admin/types';
import { collectLocalPipelineStats } from '@/lib/admin/local-pipeline-stats';

/** Build scraped breakdown from raw chunk files on disk */
function getScrapedBreakdown(): MetricBreakdownResponse {
  const local = collectLocalPipelineStats();

  return {
    metric: 'scraped',
    byMonth: Object.entries(local.byMonth)
      .map(([k, v]) => ({ dimension: 'month', dimension_value: k, total: v.raw, geocoded: 0 }))
      .filter((row) => row.total > 0)
      .sort((a, b) => a.dimension_value.localeCompare(b.dimension_value)),
    byPipelineRun: [],
    byBundesland: Object.entries(local.byBundesland)
      .map(([k, v]) => ({ dimension: 'bundesland', dimension_value: k, total: v.raw, geocoded: 0 }))
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total),
  };
}

/** Build junk breakdown — minimal, just total from cache */
function getJunkBreakdown(): MetricBreakdownResponse {
  const cachePath = path.join(process.cwd(), '.cache', 'enrichment_cache.json');
  let totalJunk = 0;

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

  return {
    metric: 'junk',
    byMonth: [{ dimension: 'month', dimension_value: 'all', total: totalJunk, geocoded: 0 }],
    byPipelineRun: [],
    byBundesland: [],
  };
}

export async function GET(request: NextRequest) {
  try {
    const metric = request.nextUrl.searchParams.get('metric') as MetricKey | null;

    if (!metric || !['scraped', 'enriched', 'geocoded', 'junk'].includes(metric)) {
      return NextResponse.json({ error: 'Invalid metric parameter' }, { status: 400 });
    }

    if (metric === 'junk') {
      return NextResponse.json(getJunkBreakdown());
    }

    if (metric === 'scraped') {
      return NextResponse.json(getScrapedBreakdown());
    }

    const local = collectLocalPipelineStats();

    const monthEntries = Object.entries(local.byMonth)
      .sort(([a], [b]) => a.localeCompare(b));
    const bundeslandEntries = Object.entries(local.byBundesland)
      .sort(([, a], [, b]) => {
        const aTotal = metric === 'geocoded' ? a.geocoded : a.enriched;
        const bTotal = metric === 'geocoded' ? b.geocoded : b.enriched;
        return bTotal - aTotal;
      });

    const byMonth: BreakdownRow[] = monthEntries
      .map(([ym, counts]) => ({
        dimension: 'month',
        dimension_value: ym,
        total: metric === 'geocoded' ? counts.geocoded : counts.enriched,
        geocoded: counts.geocoded,
      }))
      .filter((row) => row.total > 0 || row.geocoded > 0);

    const byBundesland: BreakdownRow[] = bundeslandEntries
      .map(([bundesland, counts]) => ({
        dimension: 'bundesland',
        dimension_value: bundesland,
        total: metric === 'geocoded' ? counts.geocoded : counts.enriched,
        geocoded: counts.geocoded,
      }))
      .filter((row) => row.total > 0 || row.geocoded > 0);

    const response: MetricBreakdownResponse = {
      metric,
      byMonth,
      byPipelineRun: [],
      byBundesland,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load metric breakdown', details: String(error) },
      { status: 500 }
    );
  }
}
