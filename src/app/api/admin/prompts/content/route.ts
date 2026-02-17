import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const PROMPTS_DIR = path.join(process.cwd(), 'scripts', 'pipeline', 'prompts');
const CONFIG_DEFAULTS = {
  model: 'x-ai/grok-4-fast',
  provider: 'openrouter',
  max_tokens: 10000,
  temperature: 0,
} as const;
const PROVIDER_DEFAULTS = {
  openrouter: { model: 'x-ai/grok-4-fast', max_tokens: 10000 },
  deepseek: { model: 'deepseek-chat', max_tokens: 8192 },
} as const;

type Provider = 'openrouter' | 'deepseek';
type PromptConfig = {
  model: string;
  provider: Provider;
  max_tokens: number;
  temperature: number;
};

function normalizePromptConfig(input: unknown): Partial<PromptConfig> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const raw = input as Record<string, unknown>;
  const next: Partial<PromptConfig> = {};

  if (typeof raw.model === 'string' && raw.model.trim()) {
    next.model = raw.model.trim();
  }
  if (raw.provider === 'openrouter' || raw.provider === 'deepseek') {
    next.provider = raw.provider;
  }
  if (typeof raw.max_tokens === 'number' && Number.isFinite(raw.max_tokens) && raw.max_tokens > 0) {
    next.max_tokens = Math.floor(raw.max_tokens);
  }
  if (typeof raw.temperature === 'number' && Number.isFinite(raw.temperature) && raw.temperature >= 0 && raw.temperature <= 2) {
    next.temperature = raw.temperature;
  }

  return next;
}

function withConfigDefaults(config: Partial<PromptConfig>): PromptConfig {
  const provider: Provider = config.provider ?? CONFIG_DEFAULTS.provider;
  const providerDefaults = PROVIDER_DEFAULTS[provider];
  const maxTokens = config.max_tokens ?? providerDefaults.max_tokens;
  return {
    provider,
    model: config.model ?? providerDefaults.model,
    max_tokens: provider === 'deepseek' ? Math.min(maxTokens, PROVIDER_DEFAULTS.deepseek.max_tokens) : maxTokens,
    temperature: config.temperature ?? CONFIG_DEFAULTS.temperature,
  };
}

export async function GET(request: NextRequest) {
  const version = request.nextUrl.searchParams.get('version');
  if (!version) {
    return NextResponse.json({ error: 'version parameter required' }, { status: 400 });
  }

  const safe = version.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe || safe.startsWith('.')) {
    return NextResponse.json({ error: 'Invalid version name' }, { status: 400 });
  }

  const filePath = path.join(PROMPTS_DIR, `${safe}.txt`);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 });
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  const configPath = path.join(PROMPTS_DIR, `${safe}.json`);
  let config = withConfigDefaults({});
  if (fs.existsSync(configPath)) {
    try {
      const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config = withConfigDefaults(normalizePromptConfig(rawConfig));
    } catch {
      config = withConfigDefaults({});
    }
  }

  return NextResponse.json({ version: safe, content, config });
}
