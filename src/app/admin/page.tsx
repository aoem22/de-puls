'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { MetricCards } from '@/components/Admin/MetricCards';
import { PipelineCalendar } from '@/components/Admin/PipelineCalendar';
import { BundeslandProgress } from '@/components/Admin/BundeslandProgress';
import { useManifest } from '@/lib/admin/hooks';
import type { MetricKey } from '@/lib/admin/types';

const MetricBreakdownTable = dynamic(
  () => import('@/components/Admin/MetricBreakdownTable').then((mod) => mod.MetricBreakdownTable),
  {
    loading: () => (
      <div
        className="h-72 animate-pulse rounded-2xl"
        style={{ background: 'var(--loading-skeleton)' }}
      />
    ),
  },
);

export default function AdminDashboard() {
  const { data: stats, isLoading, error } = useManifest();
  const [selectedMetric, setSelectedMetric] = useState<MetricKey | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-xl font-bold"
          style={{ color: 'var(--text-primary)' }}
        >
          Pipeline Dashboard
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Scrape → Filter → Enrich → Geocode → Push
        </p>
      </div>

      {error && (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: '#ef4444', color: '#ef4444', background: 'rgba(239,68,68,0.08)' }}
        >
          Failed to load pipeline data: {error.message}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl"
              style={{ background: 'var(--loading-skeleton)' }}
            />
          ))}
        </div>
      ) : (
        <MetricCards
          stats={stats}
          selectedMetric={selectedMetric}
          onSelectMetric={setSelectedMetric}
        />
      )}

      {selectedMetric && (
        <MetricBreakdownTable metric={selectedMetric} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <PipelineCalendar chunksByMonth={stats?.chunksByMonth ?? {}} />
        <BundeslandProgress bundeslandCounts={stats?.bundeslandCounts ?? {}} />
      </div>
    </div>
  );
}
