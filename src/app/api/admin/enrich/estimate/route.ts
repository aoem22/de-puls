import { NextRequest, NextResponse } from 'next/server';

const BATCH_SIZE = 8;
const AVG_PROMPT_TOKENS_PER_BATCH = 3000;
const AVG_COMPLETION_TOKENS_PER_BATCH = 2500;
const AVG_LATENCY_SECONDS = 4;
const CONCURRENCY = 30; // Turbo async enricher runs 30 concurrent LLM requests

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const articleCount = parseInt(params.get('articleCount') || '0', 10);
  const promptPrice = parseFloat(params.get('promptPrice') || '0');
  const completionPrice = parseFloat(params.get('completionPrice') || '0');

  if (articleCount <= 0) {
    return NextResponse.json({ error: 'articleCount must be > 0' }, { status: 400 });
  }

  const numBatches = Math.ceil(articleCount / BATCH_SIZE);
  const estimatedPromptTokens = numBatches * AVG_PROMPT_TOKENS_PER_BATCH;
  const estimatedCompletionTokens = numBatches * AVG_COMPLETION_TOKENS_PER_BATCH;

  // Pricing is per 1M tokens
  const promptCost = (estimatedPromptTokens / 1_000_000) * promptPrice;
  const completionCost = (estimatedCompletionTokens / 1_000_000) * completionPrice;
  const estimatedCostUsd = promptCost + completionCost;

  // Turbo runs CONCURRENCY batches in parallel per wave
  const waves = Math.ceil(numBatches / CONCURRENCY);
  const estimatedTimeSeconds = waves * AVG_LATENCY_SECONDS;

  return NextResponse.json({
    totalArticles: articleCount,
    numBatches,
    estimatedPromptTokens,
    estimatedCompletionTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
    estimatedTimeSeconds: Math.round(estimatedTimeSeconds),
  });
}
