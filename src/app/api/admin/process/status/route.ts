import { NextRequest, NextResponse } from 'next/server';
import { readProcessState, checkPidsAlive, clearState } from '@/lib/admin/process-store';

/**
 * GET /api/admin/process/status?since=<timestamp>
 *
 * Returns the current state of scrape, enrich, and geocode processes.
 * If `since` is provided, only returns logs newer than that timestamp
 * (used for incremental polling).
 */
export async function GET(request: NextRequest) {
  const since = Number(request.nextUrl.searchParams.get('since') || '0');

  const scrapeState = readProcessState('scrape');
  const enrichState = readProcessState('enrich');
  const geocodeState = readProcessState('geocode');

  // Auto-correct stale "running" state if all PIDs are dead
  const scrapeAlive = scrapeState.running ? checkPidsAlive('scrape') : false;
  const enrichAlive = enrichState.running ? checkPidsAlive('enrich') : false;
  const geocodeAlive = geocodeState.running ? checkPidsAlive('geocode') : false;

  // Re-read after possible auto-correction
  const scrape = scrapeAlive ? readProcessState('scrape') : { ...scrapeState, running: false };
  const enrich = enrichAlive ? readProcessState('enrich') : { ...enrichState, running: false };
  const geocode = geocodeAlive ? readProcessState('geocode') : { ...geocodeState, running: false };

  // Filter logs by timestamp if `since` is provided
  if (since > 0) {
    scrape.logs = scrape.logs.filter((l) => l.ts > since);
    enrich.logs = enrich.logs.filter((l) => l.ts > since);
    geocode.logs = geocode.logs.filter((l) => l.ts > since);
  }

  return NextResponse.json({ scrape, enrich, geocode });
}

/**
 * POST /api/admin/process/status
 * Body: { action: 'clear', process: 'scrape' | 'enrich' | 'geocode' | 'all' }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const proc = body.process as string;

    if (body.action === 'clear') {
      if (proc === 'all' || proc === 'scrape') clearState('scrape');
      if (proc === 'all' || proc === 'enrich') clearState('enrich');
      if (proc === 'all' || proc === 'geocode') clearState('geocode');
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
