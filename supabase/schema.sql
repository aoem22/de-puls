-- Crime Records Table
-- Run this SQL in your Supabase SQL Editor to create the table

CREATE TABLE IF NOT EXISTS crime_records (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_crime_records_published_at ON crime_records(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_crime_records_categories ON crime_records USING GIN(categories);
CREATE INDEX IF NOT EXISTS idx_crime_records_location ON crime_records(latitude, longitude) WHERE latitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crime_records_precision ON crime_records(precision);

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
