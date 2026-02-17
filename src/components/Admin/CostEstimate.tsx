'use client';

import type { EnrichEstimate } from '@/lib/admin/types';

interface CostEstimateProps {
  estimate: EnrichEstimate | null;
  isLoading: boolean;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `~${mins} min ${secs}s` : `~${mins} min`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function CostEstimate({ estimate, isLoading }: CostEstimateProps) {
  if (isLoading) {
    return (
      <div
        className="rounded-xl border p-4"
        style={{
          borderColor: 'var(--border-subtle)',
          background: 'color-mix(in srgb, var(--card) 80%, transparent)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="space-y-3">
          <div className="h-4 w-24 animate-pulse rounded" style={{ background: 'var(--border-subtle)' }} />
          <div className="h-8 w-20 animate-pulse rounded" style={{ background: 'var(--border-subtle)' }} />
          <div className="h-3 w-32 animate-pulse rounded" style={{ background: 'var(--border-subtle)' }} />
        </div>
      </div>
    );
  }

  if (!estimate) return null;

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'color-mix(in srgb, var(--card) 80%, transparent)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <label className="mb-3 block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Estimate
      </label>

      <div className="flex items-baseline gap-3">
        <span
          className="text-2xl font-bold tabular-nums"
          style={{ color: 'var(--accent)' }}
        >
          {formatCost(estimate.estimatedCostUsd)}
        </span>
        <span
          className="text-sm font-medium tabular-nums"
          style={{ color: 'var(--text-secondary)' }}
        >
          {formatTime(estimate.estimatedTimeSeconds)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums" style={{ color: 'var(--text-faint)' }}>
        <span>Articles</span>
        <span className="text-right">{estimate.totalArticles.toLocaleString()}</span>
        <span>Batches</span>
        <span className="text-right">{estimate.numBatches.toLocaleString()}</span>
        <span>Prompt tokens</span>
        <span className="text-right">{estimate.estimatedPromptTokens.toLocaleString()}</span>
        <span>Completion tokens</span>
        <span className="text-right">{estimate.estimatedCompletionTokens.toLocaleString()}</span>
      </div>
    </div>
  );
}
