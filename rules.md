# Pipeline Rules

## Rule 1: Auto-publish enriched data as Pipeline-Lauf

**When** enriched output is produced (`*_enriched.json`) and all records are geocoded (have `lat`/`lon`),
**then** push the data to Supabase as a new Pipeline-Lauf so it is immediately available in the frontend.

### Steps

1. Run enrichment:
   ```bash
   python3 -m scripts.pipeline.fast_enricher \
     --input <input.json> \
     --output <output_enriched.json> \
     --cache-dir .cache/<run_name>
   ```

2. Verify quality:
   - All records have `location.lat` and `location.lon`
   - All records have `crime.pks_code`, `details`, `clean_title`
   - All records have `incident_group_id` and `group_role`
   - Removed log (`*_removed.json`) contains only junk/feuerwehr

3. Push to Supabase with a descriptive run name:
   ```bash
   python3 scripts/pipeline/push_to_supabase.py \
     --input <output_enriched.json> \
     --run-name "<run_name>"
   ```

4. The data appears in the frontend under **Pipeline-Lauf** pill buttons in the LayerControl sidebar.

### Run naming convention

| Pattern | Example | Use case |
|---------|---------|----------|
| `<city>_<count>` | `darmstadt_100` | City-specific test batch |
| `v<N>_<year>-w<week>` | `v2_2026-w06` | Weekly production run |
| `default` | `default` | Legacy/untagged data |
