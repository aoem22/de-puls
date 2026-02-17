import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const PROMPTS_DIR = path.join(process.cwd(), 'scripts', 'pipeline', 'prompts');
const ACTIVE_FILE = path.join(PROMPTS_DIR, 'active.txt');
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

function sanitizeName(name: string): string | null {
  // Only allow alphanumeric, dots, hyphens, underscores
  const clean = name.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!clean || clean.startsWith('.')) return null;
  return clean;
}

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

function validatePromptConfig(input: unknown): string | null {
  if (input === undefined) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'config must be an object';
  }
  const raw = input as Record<string, unknown>;
  if ('model' in raw && (typeof raw.model !== 'string' || !raw.model.trim())) {
    return 'config.model must be a non-empty string';
  }
  if ('provider' in raw && raw.provider !== 'openrouter' && raw.provider !== 'deepseek') {
    return 'config.provider must be "openrouter" or "deepseek"';
  }
  if ('max_tokens' in raw && (typeof raw.max_tokens !== 'number' || !Number.isFinite(raw.max_tokens) || raw.max_tokens <= 0)) {
    return 'config.max_tokens must be a positive number';
  }
  if ('temperature' in raw && (typeof raw.temperature !== 'number' || !Number.isFinite(raw.temperature) || raw.temperature < 0 || raw.temperature > 2)) {
    return 'config.temperature must be between 0 and 2';
  }
  return null;
}

function configPathForVersion(name: string): string {
  return path.join(PROMPTS_DIR, `${name}.json`);
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

function loadPromptConfig(name: string): PromptConfig {
  const configPath = configPathForVersion(name);
  if (!fs.existsSync(configPath)) {
    return withConfigDefaults({});
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return withConfigDefaults(normalizePromptConfig(raw));
  } catch {
    return withConfigDefaults({});
  }
}

function writePromptConfig(name: string, config: PromptConfig): void {
  fs.writeFileSync(configPathForVersion(name), `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export async function GET() {
  try {
    if (!fs.existsSync(PROMPTS_DIR)) {
      return NextResponse.json({ versions: [], activeVersion: null });
    }

    const activeVersion = fs.existsSync(ACTIVE_FILE)
      ? fs.readFileSync(ACTIVE_FILE, 'utf-8').trim()
      : null;

    const files = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.txt') && f !== 'active.txt');

    const versions = files.map(f => {
      const filePath = path.join(PROMPTS_DIR, f);
      const stat = fs.statSync(filePath);
      const name = f.replace('.txt', '');

      return {
        name,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        isActive: name === activeVersion,
        config: loadPromptConfig(name),
      };
    }).sort((a, b) => b.modified.localeCompare(a.modified));

    return NextResponse.json({ versions, activeVersion });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to list prompts', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, content, config } = body as { name: string; content: string; config?: unknown };

    if (!name || !content) {
      return NextResponse.json({ error: 'name and content are required' }, { status: 400 });
    }

    const safeName = sanitizeName(name);
    if (!safeName) {
      return NextResponse.json({ error: 'Invalid version name' }, { status: 400 });
    }

    const configError = validatePromptConfig(config);
    if (configError) {
      return NextResponse.json({ error: configError }, { status: 400 });
    }

    const finalConfig = withConfigDefaults(normalizePromptConfig(config));

    fs.mkdirSync(PROMPTS_DIR, { recursive: true });
    const filePath = path.join(PROMPTS_DIR, `${safeName}.txt`);
    fs.writeFileSync(filePath, content, 'utf-8');
    writePromptConfig(safeName, finalConfig);

    return NextResponse.json({ saved: safeName, size: content.length, config: finalConfig });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save prompt', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { version, config } = body as { version: string; config?: unknown };

    if (!version) {
      return NextResponse.json({ error: 'version is required' }, { status: 400 });
    }

    const safeName = sanitizeName(version);
    if (!safeName) {
      return NextResponse.json({ error: 'Invalid version name' }, { status: 400 });
    }

    const filePath = path.join(PROMPTS_DIR, `${safeName}.txt`);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: `Version "${safeName}" not found` }, { status: 404 });
    }

    // Update prompt config for an existing version.
    if (config !== undefined) {
      const configError = validatePromptConfig(config);
      if (configError) {
        return NextResponse.json({ error: configError }, { status: 400 });
      }
      const mergedConfig = withConfigDefaults({
        ...loadPromptConfig(safeName),
        ...normalizePromptConfig(config),
      });
      writePromptConfig(safeName, mergedConfig);
      return NextResponse.json({ version: safeName, config: mergedConfig });
    }

    fs.writeFileSync(ACTIVE_FILE, safeName, 'utf-8');
    return NextResponse.json({ activeVersion: safeName });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to set active version', details: String(error) },
      { status: 500 }
    );
  }
}
