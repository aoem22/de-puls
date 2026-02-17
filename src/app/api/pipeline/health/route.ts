import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

export const revalidate = 60; // Cache for 1 minute

interface PipelineHealthRow {
  started_at: string;
  duration_seconds: number;
  sources_polled: number;
  total_scraped: number;
  total_enriched: number;
  total_pushed: number;
  total_errors: number;
}

export async function GET() {
  try {
    // Get the most recent pipeline health record
    // Cast needed: pipeline_health table is not in generated Supabase types
    const { data: lastCycle, error: cycleError } = await supabase
      .from('pipeline_health' as never)
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .single() as { data: PipelineHealthRow | null; error: { code?: string; message?: string } | null };

    if (cycleError && cycleError.code !== 'PGRST116') {
      throw cycleError;
    }

    // Get per-source poll state
    const { data: pollState, error: pollError } = await supabase
      .from('pipeline_poll_state' as never)
      .select('*')
      .order('source') as { data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null };

    if (pollError) {
      throw pollError;
    }

    // Check staleness: no new records in 2+ hours
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const isStale = !lastCycle || lastCycle.started_at < twoHoursAgo;

    // Count recent records pushed by live pipeline
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from('crime_records')
      .select('id', { count: 'exact', head: true })
      .eq('pipeline_run', 'v1_2026')
      .gte('created_at', oneDayAgo);

    return NextResponse.json({
      status: isStale ? 'stale' : 'healthy',
      last_cycle: lastCycle || null,
      sources: pollState || [],
      recent_records_24h: recentCount || 0,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Pipeline health check failed:', error);
    return NextResponse.json(
      { status: 'error', message: 'Failed to fetch pipeline health' },
      { status: 500 }
    );
  }
}
