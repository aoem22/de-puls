-- Add damage amount tracking to crime_records
-- damage_amount_eur: property damage or stolen goods value in EUR (integer)
-- damage_estimate: precision of the amount (exact, approximate, unknown)

ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS damage_amount_eur INT;
ALTER TABLE crime_records ADD COLUMN IF NOT EXISTS damage_estimate TEXT;
