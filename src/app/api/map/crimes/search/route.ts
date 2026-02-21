import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

/**
 * Full-text search across crime_records title and body.
 * Returns an array of matching record IDs.
 *
 * Uses two parallel ilike queries (title + body) to avoid
 * PostgREST .or() escaping issues with special characters.
 */
export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get('q')?.trim();

    if (!query || query.length < 2) {
      return NextResponse.json([]);
    }

    // Escape SQL LIKE wildcard characters in user input
    const escaped = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const pattern = `%${escaped}%`;

    // Optional dashboard filters
    const sp = request.nextUrl.searchParams;
    const filterCategory = sp.get('category') || null;
    const filterWeapon = sp.get('weapon') || null;
    const filterDrug = sp.get('drug') || null;
    const filterFrom = sp.get('from') || null;
    const filterTo = sp.get('to') || null;

    // Search title and body in parallel, paginating each
    const searchColumn = async (column: string): Promise<string[]> => {
      const PAGE_SIZE = 1000;
      const ids: string[] = [];
      let from = 0;

      while (true) {
        let q = supabase
          .from('crime_records')
          .select('id')
          .eq('hidden', false)
          .ilike(column, pattern);

        // Apply dashboard filters
        if (filterCategory) q = q.contains('categories', [filterCategory]);
        if (filterWeapon) q = q.eq('weapon_type', filterWeapon);
        if (filterDrug) q = q.eq('drug_type', filterDrug);
        if (filterFrom) q = q.gte('published_at', filterFrom);
        if (filterTo) q = q.lte('published_at', filterTo);

        const { data, error } = await q.range(from, from + PAGE_SIZE - 1);

        if (error) throw error;

        const rows = (data ?? []) as Array<{ id: string }>;
        for (const row of rows) ids.push(row.id);

        if (rows.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      return ids;
    };

    const [titleIds, bodyIds, urlIds] = await Promise.all([
      searchColumn('title'),
      searchColumn('body'),
      searchColumn('source_url'),
    ]);

    // Merge and deduplicate
    const idSet = new Set([...titleIds, ...bodyIds, ...urlIds]);

    // When detail=1, return full result objects (for dashboard search dropdown)
    const wantDetails = request.nextUrl.searchParams.get('detail') === '1';
    if (wantDetails) {
      const DETAIL_LIMIT = 50;
      const topIds = [...idSet].slice(0, DETAIL_LIMIT);
      const { data: details, error: detailError } = await supabase
        .from('crime_records')
        .select('id, title, clean_title, published_at, incident_date, incident_time, location_text, city, bundesland, categories, source_url')
        .in('id', topIds)
        .order('published_at', { ascending: false });

      if (detailError) throw detailError;

      return NextResponse.json(
        { total: idSet.size, results: details ?? [] },
        {
          headers: {
            'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          },
        },
      );
    }

    return NextResponse.json([...idSet], {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Search failed', details: String(error) },
      { status: 500 },
    );
  }
}
