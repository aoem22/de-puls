-- Crime Records Table
-- Run this SQL in your Supabase SQL Editor to create the table

CREATE TABLE IF NOT EXISTS crime_records (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  clean_title TEXT,
  summary TEXT,
  body TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  source_url TEXT NOT NULL,
  source_agency TEXT,
  location_text TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  precision TEXT CHECK (precision IN ('street', 'neighborhood', 'city', 'region', 'unknown')),
  categories TEXT[] NOT NULL,
  weapon_type TEXT,
  confidence DOUBLE PRECISION,
  hidden BOOLEAN DEFAULT false,
  incident_date TEXT,
  incident_time TEXT,
  incident_time_precision TEXT,
  crime_sub_type TEXT,
  crime_confidence DOUBLE PRECISION,
  drug_type TEXT,
  victim_count SMALLINT,
  suspect_count SMALLINT,
  victim_age TEXT,
  suspect_age TEXT,
  victim_gender TEXT,
  suspect_gender TEXT,
  victim_herkunft TEXT,
  suspect_herkunft TEXT,
  victim_description TEXT,
  suspect_description TEXT,
  severity TEXT,
  motive TEXT,
  incident_end_date TEXT,
  incident_end_time TEXT,
  classification TEXT,
  incident_group_id TEXT,
  group_role TEXT CHECK (group_role IN ('primary', 'follow_up', 'update', 'resolution', 'related')),
  pipeline_run TEXT DEFAULT 'default',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_crime_records_published_at ON crime_records(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_crime_records_categories ON crime_records USING GIN(categories);
CREATE INDEX IF NOT EXISTS idx_crime_records_location ON crime_records(latitude, longitude) WHERE latitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crime_records_precision ON crime_records(precision);
CREATE INDEX IF NOT EXISTS idx_crime_records_hidden ON crime_records(hidden) WHERE hidden = false;
CREATE INDEX IF NOT EXISTS idx_crime_records_pipeline_run ON crime_records(pipeline_run);
CREATE INDEX IF NOT EXISTS idx_crime_records_incident_group ON crime_records(incident_group_id) WHERE incident_group_id IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE crime_records ENABLE ROW LEVEL SECURITY;

-- Allow public read access (anyone can view crime records)
CREATE POLICY "Allow public read access"
  ON crime_records
  FOR SELECT
  TO public
  USING (true);

-- Optional: Allow authenticated users to insert/update
-- Uncomment if you need write access from the client
-- CREATE POLICY "Allow authenticated insert"
--   ON crime_records
--   FOR INSERT
--   TO authenticated
--   WITH CHECK (true);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_crime_records_updated_at ON crime_records;
CREATE TRIGGER update_crime_records_updated_at
  BEFORE UPDATE ON crime_records
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Geo Boundaries Table (Kreis, City, Country)
-- Stores GeoJSON boundaries keyed by level + AGS
-- ============================================================

CREATE TABLE IF NOT EXISTS geo_boundaries (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('country', 'land', 'kreis', 'gemeinde', 'city')),
  ags TEXT NOT NULL,
  name TEXT NOT NULL,
  bundesland TEXT,
  geometry JSONB NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb,
  bbox DOUBLE PRECISION[] NOT NULL CHECK (array_length(bbox, 1) = 4),
  source TEXT,
  source_dataset TEXT,
  snapshot TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(level, ags)
);

CREATE INDEX IF NOT EXISTS idx_geo_boundaries_level ON geo_boundaries(level);
CREATE INDEX IF NOT EXISTS idx_geo_boundaries_bundesland ON geo_boundaries(bundesland) WHERE bundesland IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_geo_boundaries_properties_gin ON geo_boundaries USING GIN(properties);

ALTER TABLE geo_boundaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read geo boundaries"
  ON geo_boundaries
  FOR SELECT
  TO public
  USING (true);

DROP TRIGGER IF EXISTS update_geo_boundaries_updated_at ON geo_boundaries;
CREATE TRIGGER update_geo_boundaries_updated_at
  BEFORE UPDATE ON geo_boundaries
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Pipeline Runs Metadata Table
-- Tracks enrichment pipeline executions for observability
-- ============================================================

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,            -- e.g. "v2_2026-w03"
  year INT NOT NULL,
  week INT NOT NULL,
  model TEXT,                     -- e.g. "google/gemini-2.5-flash-lite"
  status TEXT DEFAULT 'running',  -- running | enriched | clustered | complete
  record_count INT,
  stats JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_runs_public_read"
  ON pipeline_runs FOR SELECT
  USING (true);

CREATE POLICY "pipeline_runs_service_write"
  ON pipeline_runs FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION update_pipeline_runs_updated_at()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_pipeline_runs_updated_at
  BEFORE UPDATE ON pipeline_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_pipeline_runs_updated_at();
