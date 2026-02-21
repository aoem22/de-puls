-- ============================================================================
-- PLZ Ranking RPC for Dashboard
-- ============================================================================
-- Mirrors dashboard_city_ranking / dashboard_kreis_ranking pattern.
-- Replaces sequential fetchAllRows + JS bucketing with a single SQL GROUP BY.
-- ============================================================================

CREATE OR REPLACE FUNCTION dashboard_plz_ranking(
  p_current_start TIMESTAMPTZ,
  p_current_end TIMESTAMPTZ,
  p_prev_start TIMESTAMPTZ,
  p_prev_end TIMESTAMPTZ,
  p_category TEXT DEFAULT NULL,
  p_weapon TEXT DEFAULT NULL,
  p_pipeline_run TEXT DEFAULT NULL,
  p_bundesland TEXT DEFAULT NULL
)
RETURNS TABLE(plz TEXT, current_count BIGINT, previous_count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT
    cr.plz,
    COUNT(*) FILTER (
      WHERE cr.published_at >= p_current_start AND cr.published_at < p_current_end
    ) AS current_count,
    COUNT(*) FILTER (
      WHERE cr.published_at >= p_prev_start AND cr.published_at < p_prev_end
    ) AS previous_count
  FROM crime_records cr
  WHERE cr.hidden = false
    AND (cr.classification IN ('crime', 'update') OR cr.classification IS NULL)
    AND cr.plz IS NOT NULL
    AND cr.published_at >= p_prev_start AND cr.published_at < p_current_end
    AND (p_category IS NULL OR cr.categories @> ARRAY[p_category]::text[])
    AND (p_weapon IS NULL OR cr.weapon_type = p_weapon)
    AND (p_pipeline_run IS NULL OR cr.pipeline_run = p_pipeline_run)
    AND (p_bundesland IS NULL OR cr.bundesland = p_bundesland)
  GROUP BY cr.plz
  HAVING COUNT(*) FILTER (
    WHERE cr.published_at >= p_current_start AND cr.published_at < p_current_end
  ) > 0
     OR COUNT(*) FILTER (
    WHERE cr.published_at >= p_prev_start AND cr.published_at < p_prev_end
  ) > 0
  ORDER BY current_count DESC, previous_count DESC;
$$;
