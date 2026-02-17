'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useModels } from '@/lib/admin/hooks';

interface ModelOption {
  id: string;
  name: string;
  pricing?: { prompt: string; completion: string };
}

// DeepSeek models (hardcoded — no list API available)
const DEEPSEEK_MODELS: ModelOption[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3.2 (Non-thinking)',
    pricing: { prompt: '0.00000028', completion: '0.00000042' },
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek V3.2 (Thinking)',
    pricing: { prompt: '0.00000028', completion: '0.00000042' },
  },
];

export type Provider = 'openrouter' | 'deepseek';

interface ModelPickerProps {
  value: string;
  onChange: (modelId: string, pricing: { prompt: number; completion: number }) => void;
  disabled?: boolean;
  provider: Provider;
  onProviderChange: (p: Provider) => void;
}

export function ModelPicker({ value, onChange, disabled, provider, onProviderChange }: ModelPickerProps) {
  const { data: openrouterModels, isLoading } = useModels();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const models = provider === 'deepseek' ? DEEPSEEK_MODELS : openrouterModels;

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Emit real pricing once models load and default model is found
  useEffect(() => {
    if (!models) return;
    const match = models.find((m) => m.id === value);
    if (match?.pricing) {
      const prompt = parseFloat(match.pricing.prompt) * 1_000_000;
      const completion = parseFloat(match.pricing.completion) * 1_000_000;
      onChange(value, { prompt, completion });
    }
  // Only fire when models first load or value changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, value]);

  const filtered = useMemo(() => {
    if (!models) return [];
    if (!search) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
  }, [models, search]);

  const selectedModel = models?.find((m) => m.id === value);

  function selectModel(m: ModelOption) {
    const prompt = m.pricing?.prompt ? parseFloat(m.pricing.prompt) * 1_000_000 : 0;
    const completion = m.pricing?.completion ? parseFloat(m.pricing.completion) * 1_000_000 : 0;
    onChange(m.id, { prompt, completion });
    setOpen(false);
    setSearch('');
  }

  function formatPrice(price: string | undefined): string {
    if (!price) return '\u2014';
    const perToken = parseFloat(price);
    if (perToken === 0) return 'free';
    const perMillion = perToken * 1_000_000;
    return perMillion < 0.01 ? `$${perMillion.toFixed(4)}/M` : `$${perMillion.toFixed(2)}/M`;
  }

  return (
    <div>
      {/* Provider toggle */}
      <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Provider
      </label>
      <div className="mb-3 flex gap-1">
        {(['openrouter', 'deepseek'] as const).map((p) => (
          <button
            key={p}
            onClick={() => !disabled && onProviderChange(p)}
            disabled={disabled}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{
              borderColor: provider === p ? 'var(--accent)' : 'var(--border)',
              background: provider === p ? 'var(--accent)' : 'var(--card)',
              color: provider === p ? '#fff' : 'var(--text-secondary)',
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {p === 'openrouter' ? 'OpenRouter' : 'DeepSeek'}
          </button>
        ))}
      </div>

      {/* Model dropdown */}
      <label className="mb-2 block text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Model
      </label>

      <div ref={ref} className="relative">
        <button
          onClick={() => !disabled && setOpen(!open)}
          disabled={disabled}
          className="flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors"
          style={{
            borderColor: open ? 'var(--accent)' : 'var(--border)',
            background: 'var(--card)',
            color: 'var(--text-primary)',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          <span className="truncate font-mono text-xs">
            {provider === 'openrouter' && isLoading ? 'Loading models...' : value || 'Select a model'}
          </span>
          <span className="ml-2 text-xs" style={{ color: 'var(--text-faint)' }}>
            {open ? '\u25B4' : '\u25BE'}
          </span>
        </button>

        {selectedModel?.pricing && (
          <div className="mt-1 flex gap-3 text-[11px] tabular-nums" style={{ color: 'var(--text-faint)' }}>
            <span>Prompt: {formatPrice(selectedModel.pricing.prompt)}</span>
            <span>Completion: {formatPrice(selectedModel.pricing.completion)}</span>
          </div>
        )}

        {open && (
          <div
            className="absolute z-50 mt-1 w-full rounded-xl border shadow-xl"
            style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
          >
            {/* Search — only for OpenRouter (many models) */}
            {provider === 'openrouter' && (
              <div className="p-2">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search models..."
                  autoFocus
                  className="w-full rounded-lg border px-2 py-1.5 text-xs"
                  style={{
                    borderColor: 'var(--border-subtle)',
                    background: 'var(--background)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            )}
            <div className="max-h-64 overflow-y-auto custom-scrollbar">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                  No models found
                </div>
              ) : (
                filtered.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => selectModel(m)}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/5"
                    style={{
                      color: m.id === value ? 'var(--accent)' : 'var(--text-secondary)',
                      background: m.id === value ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : undefined,
                    }}
                  >
                    <span className="truncate font-mono">{m.id}</span>
                    <span className="ml-2 shrink-0 tabular-nums" style={{ color: 'var(--text-faint)' }}>
                      {formatPrice(m.pricing?.prompt)} / {formatPrice(m.pricing?.completion)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
