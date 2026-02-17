import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { parseChunkFilename } from '@/lib/admin/chunk-utils';

const CHUNKS_RAW_DIR = path.join(process.cwd(), 'data', 'pipeline', 'chunks', 'raw');
const MONTHS_CACHE_TTL_MS = 5 * 60_000;

let monthsCache: { expiresAt: number; value: { months: string[]; oldest: string | null } } | null = null;

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

/** Generate all YYYY-MM strings between two year-month boundaries (inclusive). */
function generateMonthRange(startYM: string, endYM: string): string[] {
  const months: string[] = [];
  const [sy, sm] = startYM.split('-').map(Number);
  const [ey, em] = endYM.split('-').map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

/**
 * Scan local raw files to find the full date range covered.
 * Uses flat naming: {bundesland}_{monat}_{year}.json
 * Also handles legacy date-range filenames.
 */
function getLocalFileRange(): { oldest: string | null; newest: string | null } {
  if (!fs.existsSync(CHUNKS_RAW_DIR)) return { oldest: null, newest: null };

  let oldest: string | null = null;
  let newest: string | null = null;

  const updateRange = (ym: string) => {
    if (!oldest || ym < oldest) oldest = ym;
    if (!newest || ym > newest) newest = ym;
  };

  try {
    const topEntries = fs.readdirSync(CHUNKS_RAW_DIR);

    // 1. Flat files (legacy: hessen_januar_2024.json)
    for (const file of topEntries) {
      if (!file.endsWith('.json') || file.endsWith('.meta.json') || file.includes('_enriched')) continue;

      // German month filename: hessen_januar_2024.json
      const parsed = parseChunkFilename(file);
      if (parsed) {
        updateRange(parsed.yearMonth);
        continue;
      }

      // Legacy date range: "2024-01-01_2024-12-31.json"
      const rangeMatch = file.match(/^\.?(?:chunk_)?(\d{4}-\d{2})-\d{2}_(\d{4}-\d{2})-\d{2}\.json$/);
      if (rangeMatch) {
        updateRange(rangeMatch[1]);
        updateRange(rangeMatch[2]);
        continue;
      }

      // Legacy monthly: "2026-02.json"
      const monthMatch = file.match(/(\d{4}-\d{2})/);
      if (monthMatch) {
        updateRange(monthMatch[1]);
      }
    }

    // 2. Nested: {bundesland}/{year}/{MM}.json — derive yearMonth from path
    for (const bl of topEntries) {
      const blPath = path.join(CHUNKS_RAW_DIR, bl);
      try { if (!fs.statSync(blPath).isDirectory()) continue; } catch { continue; }

      for (const yearDir of fs.readdirSync(blPath)) {
        if (!/^\d{4}$/.test(yearDir)) continue;
        const yearPath = path.join(blPath, yearDir);
        try { if (!fs.statSync(yearPath).isDirectory()) continue; } catch { continue; }

        for (const monthFile of fs.readdirSync(yearPath)) {
          if (!monthFile.endsWith('.json') || monthFile.endsWith('.meta.json')) continue;
          const monthNum = monthFile.replace(/_enriched/, '').replace('.json', '').padStart(2, '0');
          const ym = `${yearDir}-${monthNum}`;
          if (/^\d{4}-\d{2}$/.test(ym)) {
            updateRange(ym);
          }
        }
      }
    }
  } catch {
    /* ignore fs errors */
  }

  return { oldest, newest };
}

export async function GET() {
  try {
    const now = Date.now();
    if (monthsCache && monthsCache.expiresAt > now) {
      return NextResponse.json(monthsCache.value);
    }

    // 1. Scan local files for date range
    const local = getLocalFileRange();

    // 2. Query Supabase for its date range
    let dbOldest: string | null = null;
    let dbNewest: string | null = null;

    try {
      const sb = getSupabase();
      const [oldestRes, newestRes] = await Promise.all([
        sb.from('crime_records').select('published_at').eq('hidden', false)
          .order('published_at', { ascending: true }).limit(1),
        sb.from('crime_records').select('published_at').eq('hidden', false)
          .order('published_at', { ascending: false }).limit(1),
      ]);

      if (oldestRes.data?.length) {
        dbOldest = ((oldestRes.data[0] as Record<string, unknown>).published_at as string).slice(0, 7);
      }
      if (newestRes.data?.length) {
        dbNewest = ((newestRes.data[0] as Record<string, unknown>).published_at as string).slice(0, 7);
      }
    } catch {
      /* Supabase unavailable — use local files only */
    }

    // 3. Merge: use the wider range from both sources
    const allBounds = [local.oldest, local.newest, dbOldest, dbNewest].filter(Boolean) as string[];

    if (allBounds.length === 0) {
      return NextResponse.json({ months: [], oldest: null });
    }

    const globalOldest = allBounds.reduce((a, b) => a < b ? a : b);
    const globalNewest = allBounds.reduce((a, b) => a > b ? a : b);

    const months = generateMonthRange(globalOldest, globalNewest).reverse(); // newest first

    const payload = {
      months,
      oldest: globalOldest,
    };

    monthsCache = {
      value: payload,
      expiresAt: now + MONTHS_CACHE_TTL_MS,
    };

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch available months', details: String(error) },
      { status: 500 },
    );
  }
}
