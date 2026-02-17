import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const PROMPTS_DIR = path.join(process.cwd(), 'scripts', 'pipeline', 'prompts');
type Provider = 'openrouter' | 'deepseek';
type PromptConfig = {
  model?: string;
  provider?: Provider;
  max_tokens?: number;
  temperature?: number;
};

const PROVIDERS: Record<Provider, { baseUrl: string; apiKeyEnv: 'OPENROUTER_API_KEY' | 'DEEPSEEK_API_KEY'; defaultModel: string; defaultMaxTokens: number }> = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'x-ai/grok-4-fast',
    defaultMaxTokens: 10000,
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    defaultMaxTokens: 8192,
  },
};

function normalizePromptConfig(input: unknown): PromptConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const config: PromptConfig = {};
  if (typeof raw.model === 'string' && raw.model.trim()) config.model = raw.model.trim();
  if (raw.provider === 'openrouter' || raw.provider === 'deepseek') config.provider = raw.provider;
  if (typeof raw.max_tokens === 'number' && Number.isFinite(raw.max_tokens) && raw.max_tokens > 0) {
    config.max_tokens = Math.floor(raw.max_tokens);
  }
  if (typeof raw.temperature === 'number' && Number.isFinite(raw.temperature) && raw.temperature >= 0 && raw.temperature <= 2) {
    config.temperature = raw.temperature;
  }
  return config;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

// GET: Fetch existing re-enrichment versions for an article
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const articleUrl = request.nextUrl.searchParams.get('articleUrl');
    if (!articleUrl) {
      return NextResponse.json({ error: 'articleUrl is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('enrichment_versions')
      .select('*')
      .eq('article_url', articleUrl)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load versions', details: String(error) },
      { status: 500 }
    );
  }
}

// POST: Trigger single-article re-enrichment with a specific prompt version
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      articleUrl,
      title,
      body: articleBody,
      date,
      city,
      bundesland,
      source,
      promptVersion,
      model: explicitModel,
      provider: explicitProvider,
    } = body as {
      articleUrl: string;
      title: string;
      body: string;
      date: string;
      city: string | null;
      bundesland: string | null;
      source: string;
      promptVersion: string;
      model?: string;
      provider?: string;
    };

    if (!articleUrl || !title || !articleBody || !promptVersion) {
      return NextResponse.json(
        { error: 'articleUrl, title, body, and promptVersion are required' },
        { status: 400 }
      );
    }
    const hasExplicitProvider = explicitProvider === 'openrouter' || explicitProvider === 'deepseek';
    if (explicitProvider && !hasExplicitProvider) {
      return NextResponse.json({ error: 'provider must be "openrouter" or "deepseek"' }, { status: 400 });
    }

    // Load prompt template
    const promptPath = path.join(PROMPTS_DIR, `${promptVersion}.txt`);
    if (!fs.existsSync(promptPath)) {
      return NextResponse.json(
        { error: `Prompt version "${promptVersion}" not found` },
        { status: 404 }
      );
    }
    const promptTemplate = fs.readFileSync(promptPath, 'utf-8');

    // Load companion JSON config (same basename, .json extension)
    const configPath = path.join(PROMPTS_DIR, `${promptVersion}.json`);
    let promptConfig: PromptConfig = {};
    if (fs.existsSync(configPath)) {
      try {
        promptConfig = normalizePromptConfig(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
      } catch { /* fall back to defaults */ }
    }

    const provider: Provider = hasExplicitProvider ? explicitProvider : (promptConfig.provider || 'openrouter');
    const providerConfig = PROVIDERS[provider];
    const apiKey = process.env[providerConfig.apiKeyEnv];
    if (!apiKey) {
      return NextResponse.json({ error: `${providerConfig.apiKeyEnv} not set` }, { status: 500 });
    }

    // Priority: explicit request body > prompt config > provider defaults
    const model = explicitModel?.trim() || promptConfig.model || providerConfig.defaultModel;
    const maxTokens = promptConfig.max_tokens ?? providerConfig.defaultMaxTokens;
    const temperature = promptConfig.temperature ?? 0;

    // Format article as JSON array (matching fast_enricher.py input format)
    const articleInput = [
      {
        article_index: 0,
        title,
        date: date || '',
        city: city || '',
        bundesland: bundesland || '',
        source: source || '',
        url: articleUrl,
        body: articleBody,
      },
    ];

    // Fill in prompt placeholders
    const prompt = promptTemplate
      .replace('{count}', '1')
      .replace('{articles_json}', JSON.stringify(articleInput, null, 2));

    // Call provider API
    const startTime = Date.now();
    const llmResponse = await fetch(`${providerConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature,
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      return NextResponse.json(
        { error: `LLM call failed (${provider})`, details: errText },
        { status: 502 }
      );
    }

    const llmData = await llmResponse.json();
    const latencyMs = Date.now() - startTime;

    const content = llmData.choices?.[0]?.message?.content ?? '';
    const usage = llmData.usage ?? {};

    // Parse JSON from response (strip markdown fences if present)
    let enrichedData: unknown[];
    try {
      const jsonStr = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      enrichedData = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return NextResponse.json(
        { error: 'Failed to parse LLM response as JSON', rawContent: content },
        { status: 422 }
      );
    }

    // Save to Supabase
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('enrichment_versions')
      .insert({
        article_url: articleUrl,
        prompt_version: promptVersion,
        model,
        enriched_data: enrichedData,
        prompt_tokens: usage.prompt_tokens ?? null,
        completion_tokens: usage.completion_tokens ?? null,
        total_tokens: usage.total_tokens ?? null,
        latency_ms: latencyMs,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Re-enrichment failed', details: String(error) },
      { status: 500 }
    );
  }
}
