'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePrompts, usePromptContent, usePersistedState, type PromptConfig } from '@/lib/admin/hooks';
import { ModelPicker, type Provider } from './ModelPicker';

const DEFAULT_MODELS: Record<Provider, string> = {
  openrouter: 'x-ai/grok-4-fast',
  deepseek: 'deepseek-chat',
};
const DEFAULT_MAX_TOKENS: Record<Provider, number> = {
  openrouter: 10000,
  deepseek: 8192,
};

const DEFAULT_PROMPT_CONFIG = {
  provider: 'openrouter' as Provider,
  model: DEFAULT_MODELS.openrouter,
  max_tokens: DEFAULT_MAX_TOKENS.openrouter,
  temperature: 0,
};

function normalizePromptConfig(config?: PromptConfig | null) {
  const provider: Provider = config?.provider === 'deepseek' ? 'deepseek' : 'openrouter';
  const rawMaxTokens = typeof config?.max_tokens === 'number' && Number.isFinite(config.max_tokens) && config.max_tokens > 0
    ? Math.floor(config.max_tokens)
    : DEFAULT_MAX_TOKENS[provider];

  return {
    provider,
    model: config?.model?.trim() || DEFAULT_MODELS[provider],
    max_tokens: provider === 'deepseek'
      ? Math.min(rawMaxTokens, DEFAULT_MAX_TOKENS.deepseek)
      : rawMaxTokens,
    temperature: typeof config?.temperature === 'number' && Number.isFinite(config.temperature)
      ? Math.min(2, Math.max(0, config.temperature))
      : DEFAULT_PROMPT_CONFIG.temperature,
  };
}

export function PromptEditor() {
  const { data, mutate: mutateList } = usePrompts();
  const [selectedVersion, setSelectedVersion] = usePersistedState<string | null>('prompts.version', null);
  const { data: contentData, mutate: mutateContent } = usePromptContent(selectedVersion);
  const [editorContent, setEditorContent] = useState('');
  const [promptProvider, setPromptProvider] = useState<Provider>(DEFAULT_PROMPT_CONFIG.provider);
  const [promptModel, setPromptModel] = useState(DEFAULT_PROMPT_CONFIG.model);
  const [maxTokens, setMaxTokens] = useState(DEFAULT_PROMPT_CONFIG.max_tokens);
  const [temperature, setTemperature] = useState(DEFAULT_PROMPT_CONFIG.temperature);
  const [saving, setSaving] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [activating, setActivating] = useState(false);
  const [newVersionName, setNewVersionName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Auto-select active version on first load
  useEffect(() => {
    if (data?.activeVersion && !selectedVersion) {
      setSelectedVersion(data.activeVersion);
    }
  }, [data?.activeVersion, selectedVersion, setSelectedVersion]);

  // Load content into editor when selected version changes
  useEffect(() => {
    if (contentData?.content !== undefined) {
      setEditorContent(contentData.content);
    }
    if (contentData) {
      const cfg = normalizePromptConfig(contentData.config);
      setPromptProvider(cfg.provider);
      setPromptModel(cfg.model);
      setMaxTokens(cfg.max_tokens);
      setTemperature(cfg.temperature);
    }
  }, [contentData]);

  const showMessage = useCallback((text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  }, []);

  const handleSave = async () => {
    if (!newVersionName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newVersionName.trim(),
          content: editorContent,
          config: {
            provider: promptProvider,
            model: promptModel,
            max_tokens: maxTokens,
            temperature,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Save failed');
      }
      await mutateList();
      setSelectedVersion(newVersionName.trim());
      setShowSaveDialog(false);
      setNewVersionName('');
      showMessage(`Saved as ${newVersionName.trim()}`, 'success');
    } catch (e) {
      showMessage(String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSetActive = async () => {
    if (!selectedVersion) return;
    setActivating(true);
    try {
      const res = await fetch('/api/admin/prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: selectedVersion }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Activation failed');
      }
      await mutateList();
      showMessage(`${selectedVersion} is now active`, 'success');
    } catch (e) {
      showMessage(String(e), 'error');
    } finally {
      setActivating(false);
    }
  };

  const handleSaveConfig = async () => {
    if (!selectedVersion) return;
    setSavingConfig(true);
    try {
      const res = await fetch('/api/admin/prompts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: selectedVersion,
          config: {
            provider: promptProvider,
            model: promptModel,
            max_tokens: maxTokens,
            temperature,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Config save failed');
      }
      await mutateList();
      await mutateContent();
      showMessage(`Model config updated for ${selectedVersion}`, 'success');
    } catch (e) {
      showMessage(String(e), 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleDuplicate = () => {
    const base = selectedVersion || 'v1';
    const match = base.match(/^(.*?)(\d+)$/);
    const suggested = match ? `${match[1]}${parseInt(match[2]) + 1}` : `${base}-copy`;
    setNewVersionName(suggested);
    setShowSaveDialog(true);
  };

  // Validation
  const hasCountPlaceholder = editorContent.includes('{count}');
  const hasArticlesPlaceholder = editorContent.includes('{articles_json}');
  const isValid = hasCountPlaceholder && hasArticlesPlaceholder;
  const charCount = editorContent.length;
  const isActive = data?.versions?.find(v => v.name === selectedVersion)?.isActive ?? false;
  const isDirty = contentData?.content !== undefined && editorContent !== contentData.content;
  const originalConfig = normalizePromptConfig(contentData?.config);
  const isConfigDirty =
    contentData !== undefined
    && (
      promptProvider !== originalConfig.provider
      || promptModel !== originalConfig.model
      || maxTokens !== originalConfig.max_tokens
      || temperature !== originalConfig.temperature
    );

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Version List - Left Sidebar */}
      <div
        className="w-56 shrink-0 rounded-2xl border p-3 flex flex-col gap-1 overflow-y-auto custom-scrollbar"
        style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
      >
        <span
          className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em]"
          style={{ color: 'var(--text-faint)' }}
        >
          Versions
        </span>
        {data?.versions?.map(v => (
          <button
            key={v.name}
            onClick={() => setSelectedVersion(v.name)}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium transition-all"
            style={{
              background: selectedVersion === v.name ? 'var(--accent)' : 'transparent',
              color: selectedVersion === v.name ? '#fff' : 'var(--text-secondary)',
            }}
          >
            <span className="flex-1 truncate">{v.name}</span>
            {v.isActive && (
              <span
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase"
                style={{
                  background: selectedVersion === v.name ? 'rgba(255,255,255,0.2)' : 'rgba(34,197,94,0.12)',
                  color: selectedVersion === v.name ? '#fff' : '#22c55e',
                }}
              >
                Active
              </span>
            )}
          </button>
        ))}
        {(!data?.versions || data.versions.length === 0) && (
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
            No versions found
          </span>
        )}
      </div>

      {/* Main Editor Area */}
      <div className="flex flex-1 flex-col gap-3 min-w-0">
        {/* Controls Bar */}
        <div
          className="flex items-center gap-2 rounded-2xl border px-4 py-3"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {selectedVersion || 'Select a version'}
          </span>
          {isDirty && (
            <span
              className="rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}
            >
              Modified
            </span>
          )}
          <div className="flex-1" />

          <button
            onClick={handleSaveConfig}
            disabled={!selectedVersion || !isConfigDirty || savingConfig}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
            style={{
              borderColor: isConfigDirty ? 'var(--accent)' : 'var(--border)',
              color: isConfigDirty ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {savingConfig ? 'Saving Model...' : isConfigDirty ? 'Save Model' : 'Model Saved'}
          </button>
          <button
            onClick={handleDuplicate}
            disabled={!selectedVersion}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            Duplicate
          </button>
          <button
            onClick={handleSetActive}
            disabled={!selectedVersion || isActive || activating}
            className="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40"
            style={{
              borderColor: isActive ? '#22c55e' : 'var(--border)',
              color: isActive ? '#22c55e' : 'var(--text-secondary)',
            }}
          >
            {activating ? 'Activating...' : isActive ? 'Active' : 'Set Active'}
          </button>
          <button
            onClick={() => {
              const base = selectedVersion || 'v1';
              const match = base.match(/^(.*?)(\d+)$/);
              setNewVersionName(match ? `${match[1]}${parseInt(match[2]) + 1}` : `${base}-new`);
              setShowSaveDialog(true);
            }}
            disabled={!editorContent || !promptModel.trim()}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            Save As New
          </button>
        </div>

        {/* Model Assignment */}
        <div
          className="rounded-2xl border px-4 py-3"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Model Assignment
            </span>
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase"
              style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
            >
              {promptProvider}
            </span>
            <span
              className="truncate rounded-md px-1.5 py-0.5 text-[10px] font-mono"
              style={{ background: 'var(--card-inner)', color: 'var(--text-muted)', maxWidth: '260px' }}
              title={promptModel}
            >
              {promptModel}
            </span>
          </div>
          <ModelPicker
            value={promptModel}
            provider={promptProvider}
            disabled={!selectedVersion || saving || savingConfig || activating}
            onProviderChange={(nextProvider) => {
              setPromptProvider(nextProvider);
              setPromptModel(DEFAULT_MODELS[nextProvider]);
              setMaxTokens(DEFAULT_MAX_TOKENS[nextProvider]);
            }}
            onChange={(modelId) => setPromptModel(modelId)}
          />
          <p className="mt-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
            Saved with the prompt version and reused automatically when that prompt is selected for enrichment.
          </p>
        </div>

        {/* Save Dialog */}
        {showSaveDialog && (
          <div
            className="flex items-center gap-2 rounded-2xl border px-4 py-3"
            style={{ background: 'var(--card)', borderColor: 'var(--accent)' }}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              Version name:
            </span>
            <input
              type="text"
              value={newVersionName}
              onChange={e => setNewVersionName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="e.g., v2"
              className="flex-1 rounded-lg border bg-transparent px-3 py-1.5 text-sm outline-none"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              autoFocus
            />
            <button
              onClick={handleSave}
              disabled={!newVersionName.trim() || saving}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setShowSaveDialog(false)}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Message */}
        {message && (
          <div
            className="rounded-xl px-4 py-2 text-xs font-medium"
            style={{
              background: message.type === 'success' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
              color: message.type === 'success' ? '#22c55e' : '#ef4444',
            }}
          >
            {message.text}
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 min-h-0">
          <textarea
            value={editorContent}
            onChange={e => setEditorContent(e.target.value)}
            className="h-full w-full resize-none rounded-2xl border p-4 text-sm outline-none custom-scrollbar"
            style={{
              background: 'var(--card)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
              lineHeight: 1.6,
            }}
            placeholder="Select a prompt version to edit..."
            spellCheck={false}
          />
        </div>

        {/* Metadata Bar */}
        <div
          className="flex items-center gap-4 rounded-2xl border px-4 py-2"
          style={{ background: 'var(--card)', borderColor: 'var(--border)' }}
        >
          <span className="text-[10px] font-medium" style={{ color: 'var(--text-faint)' }}>
            {charCount.toLocaleString()} chars
          </span>
          <span
            className="flex items-center gap-1 text-[10px] font-medium"
            style={{ color: hasCountPlaceholder ? '#22c55e' : '#ef4444' }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
            {'{count}'}
          </span>
          <span
            className="flex items-center gap-1 text-[10px] font-medium"
            style={{ color: hasArticlesPlaceholder ? '#22c55e' : '#ef4444' }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
            {'{articles_json}'}
          </span>
          <span className="text-[10px] font-medium" style={{ color: 'var(--text-faint)' }}>
            {promptProvider}:{' '}
            <span className="font-mono">{promptModel}</span>
          </span>
          {!isValid && (
            <span className="text-[10px] font-medium" style={{ color: '#ef4444' }}>
              Missing required placeholders
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
