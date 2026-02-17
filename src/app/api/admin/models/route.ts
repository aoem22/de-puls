import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENROUTER_API_KEY not set' }, { status: 500 });
    }

    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `OpenRouter returned ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();

    // Extract just what we need: id, name, pricing
    const models = (data.data ?? []).map((m: Record<string, unknown>) => ({
      id: m.id,
      name: m.name,
      pricing: m.pricing,
    }));

    return NextResponse.json(models);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch models', details: String(error) },
      { status: 500 }
    );
  }
}
