-- Dashboard RPC Update for Dense Metrics
-- Adds location_hint, severity, herkunft, and counts to context stats

CREATE OR REPLACE FUNCTION dashboard_context_stats(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_category TEXT DEFAULT NULL,
  p_weapon TEXT DEFAULT NULL,
  p_pipeline_run TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_time_buckets JSONB;
  v_weapon_counts JSONB;
  v_motive_counts JSONB;
  v_damage_sum NUMERIC;
  v_damage_count BIGINT;
  v_suspect_genders JSONB;
  v_victim_genders JSONB;
  v_suspect_ages JSONB;
  v_victim_ages JSONB;
  v_drug_type_counts JSONB;
  
  -- New fields for dense metrics
  v_suspect_herkunft_counts JSONB;
  v_victim_herkunft_counts JSONB;
  v_location_hint_counts JSONB;
  v_severity_counts JSONB;
  v_suspect_count_sum BIGINT;
  v_suspect_count_cases BIGINT;
  v_victim_count_sum BIGINT;
  v_victim_count_cases BIGINT;
BEGIN
  -- Time buckets: 6 four-hour bands (00-04, 04-08, ..., 20-24)
  SELECT COALESCE(jsonb_agg(COALESCE(t.cnt, 0) ORDER BY b.idx), '[]'::jsonb)
  INTO v_time_buckets
  FROM generate_series(0, 5) AS b(idx)
  LEFT JOIN (
    SELECT
      FLOOR(CAST(SUBSTRING(cr.incident_time FROM '^\d{1,2}') AS INT) / 4)::int AS bucket,
      COUNT(*) AS cnt
    FROM crime_records cr
    WHERE cr.hidden = false
      AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
      AND cr.published_at >= p_start AND cr.published_at < p_end
      AND cr.incident_time IS NOT NULL
      AND SUBSTRING(cr.incident_time FROM '^\d{1,2}') IS NOT NULL
      AND CAST(SUBSTRING(cr.incident_time FROM '^\d{1,2}') AS INT) BETWEEN 0 AND 23
      AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
      AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
      AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    GROUP BY bucket
  ) t ON t.bucket = b.idx;

  -- Weapon type counts (excluding none/unknown/vehicle)
  SELECT COALESCE(jsonb_object_agg(sub.weapon_type, sub.cnt), '{}'::jsonb)
  INTO v_weapon_counts
  FROM (
    SELECT cr.weapon_type, COUNT(*) AS cnt
    FROM crime_records cr
    WHERE cr.hidden = false
      AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
      AND cr.published_at >= p_start AND cr.published_at < p_end
      AND cr.weapon_type IS NOT NULL
      AND cr.weapon_type NOT IN ('none', 'unknown', 'vehicle')
      AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
      AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
      AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    GROUP BY cr.weapon_type
  ) sub;

  -- Motive counts
  SELECT COALESCE(jsonb_object_agg(sub.motive, sub.cnt), '{}'::jsonb)
  INTO v_motive_counts
  FROM (
    SELECT cr.motive, COUNT(*) AS cnt
    FROM crime_records cr
    WHERE cr.hidden = false
      AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
      AND cr.published_at >= p_start AND cr.published_at < p_end
      AND cr.motive IS NOT NULL
      AND cr.motive != 'unknown'
      AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
      AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
      AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    GROUP BY cr.motive
  ) sub;

  -- Damage stats
  SELECT COALESCE(SUM(cr.damage_amount_eur), 0), COUNT(*)
  INTO v_damage_sum, v_damage_count
  FROM crime_records cr
  WHERE cr.hidden = false
    AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
    AND cr.published_at >= p_start AND cr.published_at < p_end
    AND cr.damage_amount_eur IS NOT NULL AND cr.damage_amount_eur > 0
    AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
    AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run);

  -- Suspect gender counts
  SELECT COALESCE(jsonb_object_agg(sub.suspect_gender, sub.cnt), '{}'::jsonb)
  INTO v_suspect_genders
  FROM (
    SELECT cr.suspect_gender, COUNT(*) AS cnt
    FROM crime_records cr
    WHERE cr.hidden = false
      AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
      AND cr.published_at >= p_start AND cr.published_at < p_end
      AND cr.suspect_gender IS NOT NULL
      AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
      AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
      AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    GROUP BY cr.suspect_gender
  ) sub;

  -- Victim gender counts
  SELECT COALESCE(jsonb_object_agg(sub.victim_gender, sub.cnt), '{}'::jsonb)
  INTO v_victim_genders
  FROM (
    SELECT cr.victim_gender, COUNT(*) AS cnt
    FROM crime_records cr
    WHERE cr.hidden = false
      AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
      AND cr.published_at >= p_start AND cr.published_at < p_end
      AND cr.victim_gender IS NOT NULL
      AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
      AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
      AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    GROUP BY cr.victim_gender
  ) sub;

  -- Raw suspect ages (for JS parseAges)
  SELECT COALESCE(jsonb_agg(cr.suspect_age), '[]'::jsonb)
  INTO v_suspect_ages
  FROM crime_records cr
  WHERE cr.hidden = false
    AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
    AND cr.published_at >= p_start AND cr.published_at < p_end
    AND cr.suspect_age IS NOT NULL
    AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
    AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run);

  -- Raw victim ages (for JS parseAges)
  SELECT COALESCE(jsonb_agg(cr.victim_age), '[]'::jsonb)
  INTO v_victim_ages
  FROM crime_records cr
  WHERE cr.hidden = false
    AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
    AND cr.published_at >= p_start AND cr.published_at < p_end
    AND cr.victim_age IS NOT NULL
    AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
    AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run);

  -- Raw drug type counts (for JS extractDrugTypes normalization)
  SELECT COALESCE(jsonb_object_agg(sub.drug_type, sub.cnt), '{}'::jsonb)
  INTO v_drug_type_counts
  FROM (
    SELECT cr.drug_type, COUNT(*) AS cnt
    FROM crime_records cr
    WHERE cr.hidden = false
      AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
      AND cr.published_at >= p_start AND cr.published_at < p_end
      AND cr.drug_type IS NOT NULL
      AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
      AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
      AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    GROUP BY cr.drug_type
  ) sub;

  -- NEW: Suspect Herkunft
  SELECT COALESCE(jsonb_object_agg(sub.suspect_herkunft, sub.cnt), '{}'::jsonb)
  INTO v_suspect_herkunft_counts
  FROM (
    SELECT cr.suspect_herkunft, COUNT(*) AS cnt
    FROM crime_records cr
    WHERE cr.hidden = false
      AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
      AND cr.published_at >= p_start AND cr.published_at < p_end
      AND cr.suspect_herkunft IS NOT NULL
      AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
      AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
      AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    GROUP BY cr.suspect_herkunft
  ) sub;

  -- NEW: Victim Herkunft
  SELECT COALESCE(jsonb_object_agg(sub.victim_herkunft, sub.cnt), '{}'::jsonb)
  INTO v_victim_herkunft_counts
  FROM (
    SELECT cr.victim_herkunft, COUNT(*) AS cnt
    FROM crime_records cr
    WHERE cr.hidden = false
      AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
      AND cr.published_at >= p_start AND cr.published_at < p_end
      AND cr.victim_herkunft IS NOT NULL
      AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
      AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
      AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    GROUP BY cr.victim_herkunft
  ) sub;

  -- NEW: Location Hints
  SELECT COALESCE(jsonb_object_agg(sub.location_hint, sub.cnt), '{}'::jsonb)
  INTO v_location_hint_counts
  FROM (
    SELECT cr.location_hint, COUNT(*) AS cnt
    FROM crime_records cr
    WHERE cr.hidden = false
      AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
      AND cr.published_at >= p_start AND cr.published_at < p_end
      AND cr.location_hint IS NOT NULL
      AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
      AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
      AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    GROUP BY cr.location_hint
  ) sub;

  -- NEW: Severity
  SELECT COALESCE(jsonb_object_agg(sub.severity, sub.cnt), '{}'::jsonb)
  INTO v_severity_counts
  FROM (
    SELECT cr.severity, COUNT(*) AS cnt
    FROM crime_records cr
    WHERE cr.hidden = false
      AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
      AND cr.published_at >= p_start AND cr.published_at < p_end
      AND cr.severity IS NOT NULL
      AND cr.severity != 'unknown'
      AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
      AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
      AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    GROUP BY cr.severity
  ) sub;

  -- NEW: Suspect and Victim counts
  SELECT 
    COALESCE(SUM(cr.suspect_count), 0), COUNT(cr.suspect_count),
    COALESCE(SUM(cr.victim_count), 0), COUNT(cr.victim_count)
  INTO v_suspect_count_sum, v_suspect_count_cases, v_victim_count_sum, v_victim_count_cases
  FROM crime_records cr
  WHERE cr.hidden = false
    AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
    AND cr.published_at >= p_start AND cr.published_at < p_end
    AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
    AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run);

  RETURN jsonb_build_object(
    'time_buckets', v_time_buckets,
    'weapon_counts', v_weapon_counts,
    'motive_counts', v_motive_counts,
    'damage_sum', v_damage_sum,
    'damage_count', v_damage_count,
    'suspect_genders', v_suspect_genders,
    'victim_genders', v_victim_genders,
    'suspect_ages', v_suspect_ages,
    'victim_ages', v_victim_ages,
    'drug_type_counts', v_drug_type_counts,
    'suspect_herkunft_counts', v_suspect_herkunft_counts,
    'victim_herkunft_counts', v_victim_herkunft_counts,
    'location_hint_counts', v_location_hint_counts,
    'severity_counts', v_severity_counts,
    'suspect_count_sum', v_suspect_count_sum,
    'suspect_count_cases', v_suspect_count_cases,
    'victim_count_sum', v_victim_count_sum,
    'victim_count_cases', v_victim_count_cases
  );
END;
$$;
