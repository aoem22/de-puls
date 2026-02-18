-- ============================================================================
-- City Name Normalization for Dashboard Ranking
-- ============================================================================
-- Problem: City ranking is fragmented due to:
--   1. Berlin districts stored as city (Mitte, Neukölln, etc.) instead of "Berlin"
--   2. City-District suffixes (Stuttgart-Mitte → Stuttgart, Hamm-Mitte → Hamm)
--   3. Frankfurt split into "Frankfurt" / "Frankfurt am Main" / "Frankfurt (Oder)"
--   4. Kreis names appearing as city names
--   5. ~11,400 older records with NULL city but valid location_text
-- ============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. normalize_city_name() — maps variant city strings to canonical form
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION normalize_city_name(p_city TEXT, p_bundesland TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_city TEXT;
  v_base TEXT;
  v_suffix TEXT;
  v_dash_pos INT;
BEGIN
  IF p_city IS NULL OR TRIM(p_city) = '' THEN
    RETURN NULL;
  END IF;

  -- Unicode dash normalization (U+2011 non-breaking hyphen → regular hyphen)
  v_city := REPLACE(TRIM(p_city), E'\u2011', '-');

  -- ── Kreis-as-city exclusion ──
  IF v_city ~* '(land)?kreis' THEN
    RETURN NULL;
  END IF;

  -- ── Berlin district → "Berlin" ──
  IF p_bundesland = 'Berlin' THEN
    IF v_city IN (
      'Mitte', 'Neukölln', 'Reinickendorf', 'Steglitz-Zehlendorf',
      'Treptow-Köpenick', 'Friedrichshain-Kreuzberg', 'Charlottenburg-Wilmersdorf',
      'Spandau', 'Tempelhof-Schöneberg', 'Marzahn-Hellersdorf',
      'Lichtenberg', 'Pankow', 'Kreuzberg', 'Friedrichshain',
      'Charlottenburg', 'Wilmersdorf', 'Schöneberg', 'Tempelhof',
      'Steglitz', 'Zehlendorf', 'Treptow', 'Köpenick',
      'Marzahn', 'Hellersdorf', 'Prenzlauer Berg', 'Wedding',
      'Moabit', 'Tiergarten', 'Gesundbrunnen'
    ) THEN
      RETURN 'Berlin';
    END IF;
    -- Also catch "Berlin-Mitte", "Berlin-Neukölln" etc.
    IF v_city LIKE 'Berlin-%' THEN
      RETURN 'Berlin';
    END IF;
    -- If bundesland is Berlin, the city IS Berlin even if stored weirdly
    -- (unless it's already a valid non-Berlin city, which shouldn't happen)
    RETURN COALESCE(NULLIF(v_city, ''), 'Berlin');
  END IF;

  -- ── Frankfurt normalization ──
  -- "Frankfurt" in Hessen → "Frankfurt am Main"
  IF v_city = 'Frankfurt' AND (p_bundesland = 'Hessen' OR p_bundesland IS NULL) THEN
    RETURN 'Frankfurt am Main';
  END IF;
  -- "Frankfurt (Oder)" stays as-is (Brandenburg)

  -- ── City-District suffix stripping ──
  -- Only for known base cities that have district fragments in the DB.
  -- E.g. "Stuttgart-Mitte" → "Stuttgart", "Hamm-Bockum-Hövel" → "Hamm"
  v_dash_pos := POSITION('-' IN v_city);
  IF v_dash_pos > 0 THEN
    v_base := LEFT(v_city, v_dash_pos - 1);
    v_suffix := SUBSTRING(v_city FROM v_dash_pos + 1);

    -- Allowlist of base cities known to have district-suffixed variants
    IF v_base IN (
      'Stuttgart', 'Hamm', 'Köln', 'Dortmund', 'Essen', 'Duisburg',
      'Düsseldorf', 'Bochum', 'Wuppertal', 'Bielefeld', 'Gelsenkirchen',
      'Mönchengladbach', 'Krefeld', 'Oberhausen', 'Hagen', 'Bottrop',
      'Recklinghausen', 'Remscheid', 'Solingen', 'Herne', 'Mülheim',
      'Bonn', 'Münster', 'Mannheim', 'Karlsruhe', 'Freiburg',
      'Heidelberg', 'Ulm', 'Pforzheim', 'Reutlingen', 'Heilbronn',
      'München', 'Nürnberg', 'Augsburg', 'Regensburg', 'Würzburg',
      'Erlangen', 'Fürth', 'Ingolstadt', 'Bamberg',
      'Frankfurt', 'Wiesbaden', 'Kassel', 'Darmstadt', 'Offenbach',
      'Hannover', 'Braunschweig', 'Oldenburg', 'Osnabrück', 'Wolfsburg',
      'Göttingen', 'Hildesheim', 'Salzgitter',
      'Bremen', 'Bremerhaven',
      'Leipzig', 'Dresden', 'Chemnitz',
      'Magdeburg', 'Halle',
      'Erfurt', 'Jena', 'Weimar',
      'Rostock', 'Schwerin',
      'Kiel', 'Lübeck', 'Flensburg',
      'Mainz', 'Ludwigshafen', 'Koblenz', 'Trier',
      'Saarbrücken'
    ) THEN
      -- Exclude legitimate compound city names where the "base" is part of
      -- the actual city name (not a district suffix)
      -- These are cities that start with a base-city name but are independent places
      IF v_city NOT IN (
        'Baden-Baden',
        'Castrop-Rauxel',
        'Halle-Neustadt',  -- Sometimes treated as separate
        'Frankfurt-Oder'   -- Non-standard form, but just in case
      )
      -- Also exclude if the suffix itself looks like a city (compound municipality)
      AND v_suffix NOT IN ('Rauxel', 'Baden')
      THEN
        -- Frankfurt base → needs bundesland check for am Main vs Oder
        IF v_base = 'Frankfurt' AND p_bundesland = 'Brandenburg' THEN
          RETURN v_city;  -- Keep "Frankfurt-*" in Brandenburg as-is
        END IF;
        RETURN v_base;
      END IF;
    END IF;
  END IF;

  RETURN v_city;
END;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Drop old 7-param overloads (now replaced by 8-param with p_bundesland)
-- ──────────────────────────────────────────────────────────────────────────────

-- dashboard_city_ranking: 7-param version
DROP FUNCTION IF EXISTS dashboard_city_ranking(
  TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT
);

-- dashboard_kreis_ranking: 7-param version
DROP FUNCTION IF EXISTS dashboard_kreis_ranking(
  TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ,
  TEXT, TEXT, TEXT
);

-- dashboard_context_stats: 5-param version
DROP FUNCTION IF EXISTS dashboard_context_stats(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT
);

-- dashboard_weapon_counts: 4-param version
DROP FUNCTION IF EXISTS dashboard_weapon_counts(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT
);

-- dashboard_drug_counts_raw: 4-param version
DROP FUNCTION IF EXISTS dashboard_drug_counts_raw(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT
);


-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Recreate dashboard_city_ranking with normalization + p_bundesland
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dashboard_city_ranking(
  p_current_start TIMESTAMPTZ,
  p_current_end TIMESTAMPTZ,
  p_prev_start TIMESTAMPTZ,
  p_prev_end TIMESTAMPTZ,
  p_category TEXT DEFAULT NULL,
  p_weapon TEXT DEFAULT NULL,
  p_pipeline_run TEXT DEFAULT NULL,
  p_bundesland TEXT DEFAULT NULL
)
RETURNS TABLE(city TEXT, current_count BIGINT, previous_count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    normalize_city_name(cr.city, cr.bundesland) AS city,
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
    AND normalize_city_name(cr.city, cr.bundesland) IS NOT NULL
    AND cr.published_at >= p_prev_start AND cr.published_at < p_current_end
    AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
    AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland)
  GROUP BY normalize_city_name(cr.city, cr.bundesland)
  HAVING COUNT(*) FILTER (
    WHERE cr.published_at >= p_current_start AND cr.published_at < p_current_end
  ) > 0
     OR COUNT(*) FILTER (
    WHERE cr.published_at >= p_prev_start AND cr.published_at < p_prev_end
  ) > 0
  ORDER BY current_count DESC, previous_count DESC;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Recreate dashboard_kreis_ranking with p_bundesland
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dashboard_kreis_ranking(
  p_current_start TIMESTAMPTZ,
  p_current_end TIMESTAMPTZ,
  p_prev_start TIMESTAMPTZ,
  p_prev_end TIMESTAMPTZ,
  p_category TEXT DEFAULT NULL,
  p_weapon TEXT DEFAULT NULL,
  p_pipeline_run TEXT DEFAULT NULL,
  p_bundesland TEXT DEFAULT NULL
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
    AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland)
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
-- 5. Recreate dashboard_context_stats with p_bundesland
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dashboard_context_stats(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_category TEXT DEFAULT NULL,
  p_weapon TEXT DEFAULT NULL,
  p_pipeline_run TEXT DEFAULT NULL,
  p_bundesland TEXT DEFAULT NULL
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
      AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland)
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
      AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland)
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
      AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland)
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
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland);

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
      AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland)
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
      AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland)
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
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland);

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
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland);

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
      AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland)
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


-- ──────────────────────────────────────────────────────────────────────────────
-- 6. Recreate dashboard_weapon_counts with p_bundesland
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dashboard_weapon_counts(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_category TEXT DEFAULT NULL,
  p_pipeline_run TEXT DEFAULT NULL,
  p_bundesland TEXT DEFAULT NULL
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
    AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland)
  GROUP BY cr.weapon_type
  ORDER BY count DESC;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
-- 7. Recreate dashboard_drug_counts_raw with p_bundesland
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION dashboard_drug_counts_raw(
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_category TEXT DEFAULT NULL,
  p_pipeline_run TEXT DEFAULT NULL,
  p_bundesland TEXT DEFAULT NULL
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
    AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland)
  GROUP BY cr.drug_type
  ORDER BY count DESC;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
-- 8. Backfill city from location_text for older pipeline records
-- ──────────────────────────────────────────────────────────────────────────────

-- Multi-segment location_text: last comma-segment = city
-- (built by push_to_supabase.py:build_location_text() which always puts city last)
UPDATE crime_records
SET city = TRIM(SPLIT_PART(
  location_text, ',',
  array_length(string_to_array(location_text, ','), 1)
))
WHERE city IS NULL
  AND location_text IS NOT NULL
  AND location_text LIKE '%,%';

-- Single-segment location_text (no comma, just the city name)
UPDATE crime_records
SET city = TRIM(location_text)
WHERE city IS NULL
  AND location_text IS NOT NULL
  AND location_text NOT LIKE '%,%'
  AND LENGTH(TRIM(location_text)) > 2;
