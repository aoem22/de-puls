-- Live Pipeline tables: poll state tracking and cycle health metrics
-- Run this migration once to set up the live pipeline infrastructure.

-- Per-source poll state (tracks last success, failure count, etc.)
CREATE TABLE IF NOT EXISTS pipeline_poll_state (
    source TEXT PRIMARY KEY,
    last_success_at TIMESTAMPTZ,
    last_articles_count INTEGER DEFAULT 0,
    consecutive_failures INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_poll_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_poll_state_updated ON pipeline_poll_state;
CREATE TRIGGER trg_poll_state_updated
    BEFORE UPDATE ON pipeline_poll_state
    FOR EACH ROW
    EXECUTE FUNCTION update_poll_state_timestamp();

-- Per-cycle health metrics (one row per pipeline run)
CREATE TABLE IF NOT EXISTS pipeline_health (
    id BIGSERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL,
    duration_seconds REAL,
    sources_polled INTEGER,
    total_scraped INTEGER DEFAULT 0,
    total_enriched INTEGER DEFAULT 0,
    total_pushed INTEGER DEFAULT 0,
    total_errors INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for recent health lookups
CREATE INDEX IF NOT EXISTS idx_pipeline_health_started
    ON pipeline_health (started_at DESC);

-- Enable RLS but allow service role full access
ALTER TABLE pipeline_poll_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_health ENABLE ROW LEVEL SECURITY;

-- Allow read for anon (for health endpoint)
CREATE POLICY "Allow public read on pipeline_health"
    ON pipeline_health FOR SELECT
    USING (true);

CREATE POLICY "Allow public read on pipeline_poll_state"
    ON pipeline_poll_state FOR SELECT
    USING (true);

-- Allow service role full access (for pipeline writes)
CREATE POLICY "Allow service role write on pipeline_health"
    ON pipeline_health FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow service role write on pipeline_poll_state"
    ON pipeline_poll_state FOR ALL
    USING (true)
    WITH CHECK (true);
