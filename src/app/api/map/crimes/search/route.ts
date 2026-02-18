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

    // Search title and body in parallel, paginating each
    const searchColumn = async (column: string): Promise<string[]> => {
      const PAGE_SIZE = 1000;
      const ids: string[] = [];
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from('crime_records')
          .select('id')
          .eq('hidden', false)
          .ilike(column, pattern)
          .range(from, from + PAGE_SIZE - 1);

        if (error) throw error;

        const rows = (data ?? []) as Array<{ id: string }>;
        for (const row of rows) ids.push(row.id);

        if (rows.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }

      return ids;
    };

    const [titleIds, bodyIds] = await Promise.all([
      searchColumn('title'),
      searchColumn('body'),
    ]);

    // Merge and deduplicate
    const idSet = new Set([...titleIds, ...bodyIds]);

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
