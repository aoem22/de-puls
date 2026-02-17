import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase config');
  return createClient(url, key);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const { searchParams } = request.nextUrl;
    const articleUrl = searchParams.get('articleUrl');

    let query = supabase
      .from('admin_comments')
      .select('*')
      .order('created_at', { ascending: false });

    if (articleUrl) {
      query = query.eq('article_url', articleUrl);
    }

    const { data, error } = await query.limit(200);
    if (error) throw error;

    return NextResponse.json(data ?? []);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load comments', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase();
    const body = await request.json();

    const { article_url, field_path, comment_text, suggested_fix, cache_key } = body;

    if (!article_url || !field_path || !comment_text) {
      return NextResponse.json(
        { error: 'article_url, field_path, and comment_text are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('admin_comments')
      .insert({
        article_url,
        field_path,
        comment_text,
        suggested_fix: suggested_fix || null,
        cache_key: cache_key || null,
        status: 'open',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save comment', details: String(error) },
      { status: 500 }
    );
  }
}
