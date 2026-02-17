-- Add new enrichment columns to crime_records
-- These fields come from the unified enrichment prompt (fast_enricher.py)

ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS victim_description TEXT;
ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS suspect_description TEXT;
ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS incident_end_date TEXT;
ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS incident_end_time TEXT;
ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS classification TEXT;
