-- Pipeline Admin Dashboard tables
-- Run this in Supabase SQL editor to create the required tables

-- Token usage tracking
CREATE TABLE IF NOT EXISTS token_usage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ DEFAULT now(),
  model             TEXT NOT NULL,
  prompt_tokens     INT NOT NULL,
  completion_tokens INT NOT NULL,
  total_tokens      INT NOT NULL,
  batch_size        INT,
  chunk_id          TEXT,
  pipeline_run      TEXT DEFAULT 'default',
  latency_ms        INT,
  cost_usd          NUMERIC(10, 6),
  stage             TEXT DEFAULT 'enrich'
);

CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage(created_at);

-- Admin comments for field-level feedback
CREATE TABLE IF NOT EXISTS admin_comments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ DEFAULT now(),
  article_url       TEXT NOT NULL,
  cache_key         TEXT,
  field_path        TEXT NOT NULL,
  comment_text      TEXT NOT NULL,
  suggested_fix     TEXT,
  status            TEXT DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS idx_comments_article ON admin_comments(article_url);

-- Disable RLS for admin tables (internal use only)
ALTER TABLE token_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for token_usage" ON token_usage FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE admin_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for admin_comments" ON admin_comments FOR ALL USING (true) WITH CHECK (true);
