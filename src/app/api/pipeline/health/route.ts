import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';

export const revalidate = 60; // Cache for 1 minute

export async function GET() {
  try {
    // Get the most recent pipeline health record
    const { data: lastCycle, error: cycleError } = await supabase
      .from('pipeline_health')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (cycleError && cycleError.code !== 'PGRST116') {
      // PGRST116 = no rows found, which is OK
      throw cycleError;
    }

    // Get per-source poll state
    const { data: pollState, error: pollError } = await supabase
      .from('pipeline_poll_state')
      .select('*')
      .order('source');

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
      .eq('pipeline_run', 'live')
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
