-- Dashboard RPC Functions
-- Replaces client-side fetchAllRows() pagination with server-side SQL aggregation.
-- Run this in your Supabase SQL Editor or via migration tool.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. get_pipeline_run_counts
--    Replaces: fetchPipelineRuns() in queries.ts
--    Returns distinct pipeline_run values with their record counts.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_pipeline_run_counts()
RETURNS TABLE(pipeline_run TEXT, count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(cr.pipeline_run, 'default') AS pipeline_run,
    COUNT(*) AS count
  FROM crime_records cr
  WHERE cr.hidden = false
  GROUP BY COALESCE(cr.pipeline_run, 'default')
  ORDER BY count DESC;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. dashboard_weapon_counts
--    Replaces: getWeaponCounts() in dashboard-queries.ts
--    Returns weapon_type grouped counts, excluding none/unknown/vehicle.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dashboard_weapon_counts(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_category TEXT DEFAULT NULL,
  p_pipeline_run TEXT DEFAULT NULL
)
RETURNS TABLE(weapon_type TEXT, count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT cr.weapon_type, COUNT(*) AS count
  FROM crime_records cr
  WHERE cr.hidden = false
    AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
    AND cr.published_at >= p_start AND cr.published_at < p_end
    AND cr.weapon_type IS NOT NULL
    AND cr.weapon_type NOT IN ('none', 'unknown', 'vehicle')
    AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
  GROUP BY cr.weapon_type
  ORDER BY count DESC;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. dashboard_drug_counts_raw
--    Replaces: getDrugCounts() in dashboard-queries.ts
--    Returns raw drug_type values with counts. JS normalizes with extractDrugTypes().
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dashboard_drug_counts_raw(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_category TEXT DEFAULT NULL,
  p_pipeline_run TEXT DEFAULT NULL
)
RETURNS TABLE(drug_type TEXT, count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT cr.drug_type, COUNT(*) AS count
  FROM crime_records cr
  WHERE cr.hidden = false
    AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
    AND cr.published_at >= p_start AND cr.published_at < p_end
    AND cr.drug_type IS NOT NULL
    AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
  GROUP BY cr.drug_type
  ORDER BY count DESC;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. dashboard_city_ranking
--    Replaces: getCityRows() + JS bucketing in route.ts
--    Returns pre-aggregated city counts for current and previous time windows.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dashboard_city_ranking(
  p_current_start TIMESTAMPTZ,
  p_current_end TIMESTAMPTZ,
  p_prev_start TIMESTAMPTZ,
  p_prev_end TIMESTAMPTZ,
  p_category TEXT DEFAULT NULL,
  p_weapon TEXT DEFAULT NULL,
  p_pipeline_run TEXT DEFAULT NULL
)
RETURNS TABLE(city TEXT, current_count BIGINT, previous_count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    cr.city,
    COUNT(*) FILTER (
      WHERE cr.published_at >= p_current_start AND cr.published_at < p_current_end
    ) AS current_count,
    COUNT(*) FILTER (
      WHERE cr.published_at >= p_prev_start AND cr.published_at < p_prev_end
    ) AS previous_count
  FROM crime_records cr
  WHERE cr.hidden = false
    AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
    AND cr.city IS NOT NULL
    AND cr.published_at >= p_prev_start AND cr.published_at < p_current_end
    AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
    AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
  GROUP BY cr.city
  HAVING COUNT(*) FILTER (
    WHERE cr.published_at >= p_current_start AND cr.published_at < p_current_end
  ) > 0
     OR COUNT(*) FILTER (
    WHERE cr.published_at >= p_prev_start AND cr.published_at < p_prev_end
  ) > 0
  ORDER BY current_count DESC, previous_count DESC;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. dashboard_kreis_ranking
--    Replaces: getKreisRows() + JS bucketing in route.ts
--    Returns pre-aggregated kreis counts for current and previous time windows.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dashboard_kreis_ranking(
  p_current_start TIMESTAMPTZ,
  p_current_end TIMESTAMPTZ,
  p_prev_start TIMESTAMPTZ,
  p_prev_end TIMESTAMPTZ,
  p_category TEXT DEFAULT NULL,
  p_weapon TEXT DEFAULT NULL,
  p_pipeline_run TEXT DEFAULT NULL
)
RETURNS TABLE(kreis_ags TEXT, kreis_name TEXT, current_count BIGINT, previous_count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    cr.kreis_ags,
    MIN(cr.kreis_name) AS kreis_name,
    COUNT(*) FILTER (
      WHERE cr.published_at >= p_current_start AND cr.published_at < p_current_end
    ) AS current_count,
    COUNT(*) FILTER (
      WHERE cr.published_at >= p_prev_start AND cr.published_at < p_prev_end
    ) AS previous_count
  FROM crime_records cr
  WHERE cr.hidden = false
    AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
    AND cr.kreis_ags IS NOT NULL
    AND cr.published_at >= p_prev_start AND cr.published_at < p_current_end
    AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
    AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
  GROUP BY cr.kreis_ags
  HAVING COUNT(*) FILTER (
    WHERE cr.published_at >= p_current_start AND cr.published_at < p_current_end
  ) > 0
     OR COUNT(*) FILTER (
    WHERE cr.published_at >= p_prev_start AND cr.published_at < p_prev_end
  ) > 0
  ORDER BY current_count DESC, previous_count DESC;
$$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. dashboard_context_stats
--    Replaces: getContextStats() in dashboard-queries.ts
--    Returns aggregated stats as JSONB. Age parsing and drug normalization
--    remain in JS since they require complex string parsing.
-- ──────────────────────────────────────────────────────────────────────────────

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
    'drug_type_counts', v_drug_type_counts
  );
END;
$$;
