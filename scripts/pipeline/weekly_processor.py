#!/usr/bin/env python3
"""
Weekly pipeline processor.

Loads raw scraped data for a specific ISO week, runs junk filter + incident
grouping, enriches via LLM, and pushes to Supabase with a versioned
pipeline_run tag (e.g. "v2_2026-w01").

Usage (via runner.py):
    python -m scripts.pipeline.runner week --year 2026 --week 1
    python -m scripts.pipeline.runner week --year 2026 --week 1 --dry-run
"""

import json
import os
import sys
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

import certifi
from dotenv import load_dotenv

load_dotenv()
load_dotenv(Path(".env.local"), override=True)
os.environ['SSL_CERT_FILE'] = certifi.where()

from .config import BUNDESLAENDER, CACHE_DIR, CHUNKS_RAW_DIR
from .filter_articles import is_junk_article, group_incidents
from .fast_enricher import FastEnricher
from .push_to_supabase import transform_article


def _months_for_week(year: int, week: int) -> list[tuple[int, int]]:
    """Return the (year, month) pairs needed to cover an ISO week.

    ISO weeks can span month or year boundaries (e.g. week 1 of 2026
    starts Dec 29, 2025), so we may need to load multiple monthly files.
    """
    # Find the Monday of the ISO week
    monday = date.fromisocalendar(year, week, 1)
    sunday = date.fromisocalendar(year, week, 7)

    months = set()
    months.add((monday.year, monday.month))
    months.add((sunday.year, sunday.month))
    return sorted(months)


def _parse_article_date(date_str: str) -> datetime | None:
    """Parse article date string to datetime."""
    if not date_str:
        return None
    try:
        if "T" in date_str:
            return datetime.fromisoformat(
                date_str.replace("Z", "+00:00")
            ).replace(tzinfo=None)
        return datetime.fromisoformat(date_str)
    except (ValueError, TypeError):
        return None


def _load_week_articles(year: int, week: int) -> list[dict]:
    """Load articles from all Bundeslaender for the given ISO week."""
    months = _months_for_week(year, week)
    articles = []
    files_loaded = 0

    for bl in BUNDESLAENDER:
        for y, m in months:
            raw_file = CHUNKS_RAW_DIR / bl / f"{y}-{m:02d}.json"
            if not raw_file.exists():
                continue

            with open(raw_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            arts = data if isinstance(data, list) else data.get("articles", [])
            files_loaded += 1

            for art in arts:
                dt = _parse_article_date(art.get("date", ""))
                if dt is None:
                    continue
                iso = dt.isocalendar()
                if iso.year == year and iso.week == week:
                    articles.append(art)

    print(f"Loaded {len(articles)} articles from {files_loaded} files "
          f"(ISO week {year}-W{week:02d})")

    return articles


def process_week(
    year: int,
    week: int,
    dry_run: bool = False,
    no_geocode: bool = False,
    prompt_version: str = "v2",
    batch_size: int = 500,
    model: str = None,
) -> dict:
    """Process a single ISO week through filter -> enrich -> push.

    Args:
        year: ISO year
        week: ISO week number (1-53)
        dry_run: Preview stats without pushing to Supabase
        no_geocode: Skip geocoding (faster testing)
        prompt_version: Prompt version tag (default "v2")
        batch_size: Supabase upsert batch size

    Returns:
        Stats dict with counts.
    """
    run_name = f"{prompt_version}_{year}-w{week:02d}"

    print(f"\n{'='*60}")
    print(f"Weekly Pipeline: {year}-W{week:02d}")
    print(f"Pipeline run: {run_name}")
    print(f"{'='*60}")

    # ── Step 1: Load raw articles ──
    print(f"\n--- Step 1: Load raw articles ---")
    articles = _load_week_articles(year, week)

    if not articles:
        print("No articles found for this week.")
        return {"loaded": 0}

    # ── Step 2: Junk filter ──
    print(f"\n--- Step 2: Junk filter ---")
    kept = []
    removed = []
    for art in articles:
        reason = is_junk_article(art)
        if reason:
            removed.append(reason)
        else:
            kept.append(art)

    print(f"Junk filter: {len(removed)} removed, {len(kept)} kept")
    if removed:
        reason_counts = Counter(r.split(":")[0] for r in removed)
        for reason, count in reason_counts.most_common():
            print(f"  {count:4d} {reason}")

    # ── Step 3: Incident grouping ──
    print(f"\n--- Step 3: Incident grouping ---")
    kept = group_incidents(kept)

    groups = defaultdict(list)
    for art in kept:
        groups[art.get("incident_group_id", "")].append(art)
    multi_groups = {gid: arts for gid, arts in groups.items() if len(arts) > 1}
    grouped_count = sum(len(arts) for arts in multi_groups.values())
    print(f"Incident grouping: {len(multi_groups)} groups with {grouped_count} articles")

    # ── Step 4: Enrich ──
    print(f"\n--- Step 4: Enrich (3-round AI) ---")
    cache_dir = str(CACHE_DIR / f"week_{year}_w{week:02d}")
    enricher = FastEnricher(cache_dir=cache_dir, no_geocode=no_geocode, model=model)

    try:
        enriched, triage_removed = enricher.enrich_all(kept)
    except KeyboardInterrupt:
        print("\nInterrupted — saving caches")
        enricher.save_caches()
        sys.exit(1)

    enricher.save_caches()

    # ── Step 5: Transform + push ──
    print(f"\n--- Step 5: Transform + push to Supabase ---")
    rows = []
    seen_ids: set[str] = set()
    skipped = 0
    dupes = 0

    for art in enriched:
        row = transform_article(art, pipeline_run=run_name)
        if row:
            if row["id"] in seen_ids:
                dupes += 1
                continue
            seen_ids.add(row["id"])
            rows.append(row)
        else:
            skipped += 1

    print(f"Transformed {len(rows)} records "
          f"({skipped} skipped — no coords, {dupes} deduped)")

    # Category distribution
    cats = Counter(cat for r in rows for cat in r["categories"])
    print("\nCategory distribution:")
    for cat, count in cats.most_common():
        print(f"  {count:3d} {cat}")

    stats = {
        "loaded": len(articles),
        "junk_removed": len(removed),
        "after_junk_filter": len(kept),
        "triage_removed": len(triage_removed),
        "enriched_records": len(enriched),
        "skipped_no_coords": skipped,
        "deduped": dupes,
        "records_to_push": len(rows),
        "pipeline_run": run_name,
    }

    if dry_run:
        print(f"\n[DRY RUN] Would push {len(rows)} records with "
              f"pipeline_run='{run_name}'")
        if rows:
            print(f"\nSample records:")
            for row in rows[:5]:
                print(f"  {row['id'][:8]}... | "
                      f"{(row.get('clean_title') or row['title'])[:50]} | "
                      f"({row['latitude']:.4f}, {row['longitude']:.4f}) | "
                      f"{row['categories']}")
        print(f"\n{json.dumps(stats, indent=2)}")
        return stats

    # Push to Supabase
    if not rows:
        print("No records to push.")
        return stats

    from supabase import create_client

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )

    if not supabase_url or not supabase_key:
        print("ERROR: Missing Supabase credentials")
        sys.exit(1)

    print(f"\nConnecting to Supabase: {supabase_url}")
    supabase = create_client(supabase_url, supabase_key)

    total_batches = (len(rows) + batch_size - 1) // batch_size
    inserted = 0
    errors = 0

    print(f"Uploading {len(rows)} records in {total_batches} batches...")

    for i in range(total_batches):
        start = i * batch_size
        end = min(start + batch_size, len(rows))
        batch = rows[start:end]

        try:
            supabase.table("crime_records").upsert(batch).execute()
            inserted += len(batch)
            print(f"  Batch {i + 1}/{total_batches}: "
                  f"{inserted}/{len(rows)} records uploaded")
        except Exception as e:
            errors += len(batch)
            print(f"  Batch {i + 1}/{total_batches} FAILED: {e}")

    stats["inserted"] = inserted
    stats["errors"] = errors

    print(f"\nUpload complete!")
    print(f"  Inserted/updated: {inserted}")
    print(f"  Errors: {errors}")
    print(f"  Pipeline run: {run_name}")

    return stats
