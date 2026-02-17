#!/usr/bin/env python3
"""
Migrate raw/enriched/filtered chunk data from flat structure to 3-level hierarchy.

Old: chunks/raw/{bundesland}/{year_month}.json  OR  {start_date}_{end_date}.json
New: chunks/raw/{bundesland}/{year}/{MM}.json

Handles three cases:
1. Year-spanning files (e.g. 2024-01-01_2024-12-31.json): split by article date
2. Monthly files (e.g. 2026-02.json): move to {year}/{MM}.json
3. Hidden chunk files (.chunk_*): skip (intermediate artifacts)

Usage:
    python3 scripts/pipeline/migrate_to_monthly.py            # dry-run (default)
    python3 scripts/pipeline/migrate_to_monthly.py --execute   # actually migrate
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

CHUNK_DIRS = [
    ROOT / "data" / "pipeline" / "chunks" / "raw",
    ROOT / "data" / "pipeline" / "chunks" / "enriched",
    ROOT / "data" / "pipeline" / "chunks" / "filtered",
]

# Patterns
YEAR_SPAN_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json$")
MONTHLY_RE = re.compile(r"^(\d{4})-(\d{2})\.json$")
HIDDEN_RE = re.compile(r"^\.")
# Hidden chunk: .chunk_2021-05-01_2021-05-31.json (single-month date range)
HIDDEN_CHUNK_RE = re.compile(r"^\.chunk_(\d{4})-(\d{2})-\d{2}_(\d{4})-(\d{2})-\d{2}\.json$")
# Hidden enriched/removed: .chunk_..._enriched.json or .chunk_..._enriched_removed.json
HIDDEN_ENRICHED_RE = re.compile(r"^\.chunk_(\d{4})-(\d{2})-\d{2}_(\d{4})-(\d{2})-\d{2}_enriched\.json$")
HIDDEN_REMOVED_RE = re.compile(r"^\.chunk_.*_enriched_removed\.json$")


def extract_year_month(date_str: str) -> str | None:
    """Extract YYYY-MM from a date string like '2024-06-15' or '2024-06-15T10:00:00Z'."""
    if not date_str or len(date_str) < 7:
        return None
    ym = date_str[:7]
    if re.match(r"^\d{4}-\d{2}$", ym):
        return ym
    return None


def scan_state_dir(state_dir: Path) -> list[dict]:
    """Scan a bundesland directory and classify each JSON file."""
    results = []
    if not state_dir.is_dir():
        return results

    for f in sorted(state_dir.iterdir()):
        if not f.is_file() or not f.name.endswith(".json"):
            continue
        if f.name.endswith(".meta.json"):
            continue

        name = f.name

        # Hidden chunk files: .chunk_2021-05-01_2021-05-31.json
        if HIDDEN_RE.match(name):
            # Skip _enriched_removed files (not useful for migration)
            if HIDDEN_REMOVED_RE.match(name):
                results.append({"path": f, "type": "hidden_removed", "action": "delete"})
                continue

            # Hidden enriched: .chunk_..._enriched.json -> move to enriched structure
            m = HIDDEN_ENRICHED_RE.match(name)
            if m:
                start_year, start_month = m.group(1), m.group(2)
                end_year, end_month = m.group(3), m.group(4)
                if start_year == end_year and start_month == end_month:
                    results.append({"path": f, "type": "hidden_enriched", "action": "move_enriched",
                                    "year": start_year, "month": start_month})
                else:
                    results.append({"path": f, "type": "hidden_enriched_span", "action": "split_enriched",
                                    "start": f"{start_year}-{start_month}", "end": f"{end_year}-{end_month}"})
                continue

            # Hidden raw chunk: .chunk_2021-05-01_2021-05-31.json
            m = HIDDEN_CHUNK_RE.match(name)
            if m:
                start_year, start_month = m.group(1), m.group(2)
                end_year, end_month = m.group(3), m.group(4)
                if start_year == end_year and start_month == end_month:
                    # Single-month hidden chunk — just move it
                    results.append({"path": f, "type": "hidden_chunk", "action": "move",
                                    "year": start_year, "month": start_month})
                else:
                    # Multi-month hidden chunk — split by article date
                    results.append({"path": f, "type": "hidden_chunk_span", "action": "split",
                                    "start": f"{start_year}-{start_month}-01",
                                    "end": f"{end_year}-{end_month}-28"})
                continue

            # Other hidden files (meta, etc.) — skip
            results.append({"path": f, "type": "hidden_other", "action": "skip"})
            continue

        # Year-spanning file
        m = YEAR_SPAN_RE.match(name)
        if m:
            results.append({"path": f, "type": "year_span", "action": "split", "start": m.group(1), "end": m.group(2)})
            continue

        # Monthly file
        m = MONTHLY_RE.match(name)
        if m:
            year, month = m.group(1), m.group(2)
            results.append({"path": f, "type": "monthly", "action": "move", "year": year, "month": month})
            continue

        # Already in year/month structure or unknown — skip
        results.append({"path": f, "type": "unknown", "action": "skip"})

    return results


def split_year_span_file(file_path: Path, state_dir: Path, dry_run: bool) -> dict:
    """Split a year-spanning file into per-month files."""
    stats = {"articles_read": 0, "months_written": 0, "articles_written": 0, "no_date": 0}

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    articles = data if isinstance(data, list) else data.get("articles", [])
    stats["articles_read"] = len(articles)

    # Group by month
    by_month: dict[str, list] = defaultdict(list)
    for art in articles:
        date_str = art.get("date", "")
        ym = extract_year_month(date_str)
        if ym:
            by_month[ym].append(art)
        else:
            stats["no_date"] += 1

    for ym, month_articles in sorted(by_month.items()):
        year, month = ym.split("-")
        target = state_dir / year / f"{month}.json"

        if not dry_run:
            target.parent.mkdir(parents=True, exist_ok=True)
            # Merge with existing if target already exists
            existing = []
            if target.exists():
                with open(target, "r", encoding="utf-8") as f:
                    existing = json.load(f)
                if not isinstance(existing, list):
                    existing = existing.get("articles", [])

            # Deduplicate by URL
            seen_urls = {a.get("url") for a in existing if a.get("url")}
            merged = list(existing)
            for art in month_articles:
                url = art.get("url")
                if url and url in seen_urls:
                    continue
                if url:
                    seen_urls.add(url)
                merged.append(art)

            with open(target, "w", encoding="utf-8") as f:
                json.dump(merged, f, ensure_ascii=False, indent=2)

        stats["months_written"] += 1
        stats["articles_written"] += len(month_articles)

    return stats


def move_monthly_file(file_path: Path, state_dir: Path, year: str, month: str, dry_run: bool) -> dict:
    """Move a monthly file to the new structure."""
    target = state_dir / year / f"{month}.json"
    stats = {"articles": 0}

    if target == file_path:
        return {"articles": 0, "skipped": "already in place"}

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    articles = data if isinstance(data, list) else data.get("articles", [])
    stats["articles"] = len(articles)

    if not dry_run:
        target.parent.mkdir(parents=True, exist_ok=True)

        # Merge with existing if target already exists
        if target.exists():
            with open(target, "r", encoding="utf-8") as f:
                existing = json.load(f)
            if not isinstance(existing, list):
                existing = existing.get("articles", [])
            seen_urls = {a.get("url") for a in existing if a.get("url")}
            merged = list(existing)
            for art in articles:
                url = art.get("url")
                if url and url in seen_urls:
                    continue
                if url:
                    seen_urls.add(url)
                merged.append(art)
            with open(target, "w", encoding="utf-8") as f:
                json.dump(merged, f, ensure_ascii=False, indent=2)
        else:
            with open(target, "w", encoding="utf-8") as f:
                json.dump(articles, f, ensure_ascii=False, indent=2)

    return stats


def migrate_chunk_dir(chunk_dir: Path, dry_run: bool) -> dict:
    """Migrate one chunk directory (raw, enriched, or filtered)."""
    dir_stats = {"states": 0, "files_processed": 0, "files_skipped": 0, "files_deleted": 0, "errors": []}

    if not chunk_dir.exists():
        return dir_stats

    for state_dir in sorted(chunk_dir.iterdir()):
        if not state_dir.is_dir():
            continue

        # Skip year directories that are part of the new structure
        if re.match(r"^\d{4}$", state_dir.name):
            continue

        files = scan_state_dir(state_dir)
        if not files:
            continue

        dir_stats["states"] += 1
        state_name = state_dir.name

        for file_info in files:
            fp = file_info["path"]
            action = file_info["action"]

            if action == "skip":
                dir_stats["files_skipped"] += 1
                continue

            try:
                if action == "delete":
                    # _enriched_removed files — just delete
                    print(f"  DELETE: {state_name}/{fp.name}")
                    if not dry_run:
                        fp.unlink()
                    dir_stats["files_deleted"] += 1
                    continue

                if action == "split":
                    print(f"  SPLIT: {state_name}/{fp.name}")
                    stats = split_year_span_file(fp, state_dir, dry_run)
                    print(f"    -> {stats['articles_read']} articles -> {stats['months_written']} months"
                          f" ({stats['no_date']} without date)")
                    dir_stats["files_processed"] += 1

                    if not dry_run:
                        fp.unlink()
                        dir_stats["files_deleted"] += 1
                        # Also delete companion .meta.json
                        meta_name = fp.name.replace(".json", ".meta.json")
                        meta = fp.parent / meta_name
                        if meta.exists():
                            meta.unlink()

                elif action == "move":
                    year, month = file_info["year"], file_info["month"]
                    print(f"  MOVE: {state_name}/{fp.name} -> {state_name}/{year}/{month}.json")
                    stats = move_monthly_file(fp, state_dir, year, month, dry_run)
                    if "skipped" in stats:
                        print(f"    -> skipped ({stats['skipped']})")
                        dir_stats["files_skipped"] += 1
                    else:
                        print(f"    -> {stats['articles']} articles")
                        dir_stats["files_processed"] += 1

                        if not dry_run:
                            fp.unlink()
                            dir_stats["files_deleted"] += 1
                            meta_name = fp.name.replace(".json", ".meta.json")
                            meta = fp.parent / meta_name
                            if meta.exists():
                                meta.unlink()

                elif action == "move_enriched":
                    # Hidden enriched file -> move to enriched dir structure
                    year, month = file_info["year"], file_info["month"]
                    enriched_dir = chunk_dir.parent / "enriched"
                    target = enriched_dir / state_name / year / f"{month}.json"
                    print(f"  MOVE_ENRICHED: {state_name}/{fp.name} -> enriched/{state_name}/{year}/{month}.json")
                    stats = move_monthly_file(fp, enriched_dir / state_name, year, month, dry_run)
                    if "skipped" in stats:
                        print(f"    -> skipped ({stats['skipped']})")
                        dir_stats["files_skipped"] += 1
                    else:
                        print(f"    -> {stats['articles']} articles")
                        dir_stats["files_processed"] += 1
                        if not dry_run:
                            fp.unlink()
                            dir_stats["files_deleted"] += 1

                elif action == "split_enriched":
                    # Hidden multi-month enriched file -> split into enriched dir
                    enriched_dir = chunk_dir.parent / "enriched"
                    enriched_state_dir = enriched_dir / state_name
                    print(f"  SPLIT_ENRICHED: {state_name}/{fp.name}")
                    stats = split_year_span_file(fp, enriched_state_dir, dry_run)
                    print(f"    -> {stats['articles_read']} articles -> {stats['months_written']} months")
                    dir_stats["files_processed"] += 1
                    if not dry_run:
                        fp.unlink()
                        dir_stats["files_deleted"] += 1

            except Exception as e:
                error = f"{state_name}/{fp.name}: {e}"
                print(f"  ERROR: {error}")
                dir_stats["errors"].append(error)

    return dir_stats


def main():
    parser = argparse.ArgumentParser(
        description="Migrate chunk data to 3-level hierarchy (bundesland/year/month.json)"
    )
    parser.add_argument(
        "--execute", action="store_true",
        help="Actually migrate files (default is dry-run)"
    )
    args = parser.parse_args()
    dry_run = not args.execute

    print("=" * 60)
    print(f"CHUNK DATA MIGRATION {'(DRY RUN)' if dry_run else '(EXECUTING)'}")
    print("=" * 60)
    print(f"Target structure: {{bundesland}}/{{year}}/{{MM}}.json\n")

    total_processed = 0
    total_deleted = 0
    all_errors = []

    for chunk_dir in CHUNK_DIRS:
        rel = chunk_dir.relative_to(ROOT)
        print(f"\n--- {rel}/ ---")

        if not chunk_dir.exists():
            print("  (does not exist)")
            continue

        stats = migrate_chunk_dir(chunk_dir, dry_run)
        total_processed += stats["files_processed"]
        total_deleted += stats["files_deleted"]
        all_errors.extend(stats["errors"])

        print(f"  Summary: {stats['states']} states, "
              f"{stats['files_processed']} processed, "
              f"{stats['files_skipped']} skipped, "
              f"{stats['files_deleted']} deleted")

    print(f"\n{'=' * 60}")
    print(f"Total: {total_processed} files processed, {total_deleted} deleted")
    if all_errors:
        print(f"Errors ({len(all_errors)}):")
        for e in all_errors:
            print(f"  - {e}")

    if dry_run:
        print(f"\nDRY RUN — no files changed. Pass --execute to migrate.")


if __name__ == "__main__":
    main()
