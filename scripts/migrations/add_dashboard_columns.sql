-- Migration: Add dashboard-specific columns to crime_records
-- These columns enable server-side city/kreis/bundesland queries
-- so the dashboard can read from Supabase instead of local JSON files.

ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS bundesland TEXT;
ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS kreis_ags TEXT;
ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS kreis_name TEXT;
ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS pks_category TEXT;
ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS damage_amount_eur INTEGER;

CREATE INDEX IF NOT EXISTS idx_crime_records_city ON crime_records(city);
CREATE INDEX IF NOT EXISTS idx_crime_records_bundesland ON crime_records(bundesland);
CREATE INDEX IF NOT EXISTS idx_crime_records_kreis_ags ON crime_records(kreis_ags);
CREATE INDEX IF NOT EXISTS idx_crime_records_classification ON crime_records(classification);
