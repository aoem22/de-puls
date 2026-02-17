#!/usr/bin/env python3
"""
Reset raw scraped data while preserving enrichment cache and enriched chunks.

Safe because:
- Enriched chunks contain the original `url` for traceability
- Enrichment cache is keyed by sha256(url:body)[:16], so re-scraped articles
  will hit the cache and skip re-enrichment (no wasted LLM cost)

Usage:
    python3 scripts/pipeline/reset_raw_data.py            # dry-run (default)
    python3 scripts/pipeline/reset_raw_data.py --execute   # actually delete
"""

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

RAW_DIR = ROOT / "data" / "pipeline" / "chunks" / "raw"
MERGED_DIR = ROOT / "data" / "pipeline" / "merged"
SCRAPED_URLS_CACHE = ROOT / ".cache" / "scraped_urls.json"


def scan_raw_dir():
    """Scan raw/ subdirectories and return per-state stats."""
    stats = {}
    if not RAW_DIR.exists():
        return stats

    for state_dir in sorted(RAW_DIR.iterdir()):
        if not state_dir.is_dir():
            continue
        state = state_dir.name
        files = list(state_dir.rglob("*.json"))
        total_bytes = 0
        total_articles = 0
        for f in files:
            total_bytes += f.stat().st_size
            try:
                with open(f) as fh:
                    data = json.load(fh)
                    total_articles += len(data) if isinstance(data, list) else 1
            except (json.JSONDecodeError, IOError):
                pass
        stats[state] = {
            "files": len(files),
            "articles": total_articles,
            "bytes": total_bytes,
        }
    return stats


def scan_merged_dir():
    """Scan merged/ directory."""
    if not MERGED_DIR.exists():
        return []
    files = []
    for f in MERGED_DIR.iterdir():
        if f.is_file():
            files.append({"name": f.name, "bytes": f.stat().st_size})
    return sorted(files, key=lambda x: x["name"])


def scan_scraped_urls_cache():
    """Check scraped URLs cache."""
    if not SCRAPED_URLS_CACHE.exists():
        return None
    size = SCRAPED_URLS_CACHE.stat().st_size
    try:
        with open(SCRAPED_URLS_CACHE) as f:
            data = json.load(f)
            count = len(data) if isinstance(data, (list, dict)) else 0
    except (json.JSONDecodeError, IOError):
        count = 0
    return {"entries": count, "bytes": size}


def fmt_bytes(n):
    if n < 1024:
        return f"{n} B"
    elif n < 1024 * 1024:
        return f"{n / 1024:.1f} KB"
    else:
        return f"{n / (1024 * 1024):.1f} MB"


def print_summary(raw_stats, merged_files, url_cache):
    print("=" * 60)
    print("RAW DATA RESET — SUMMARY")
    print("=" * 60)

    # Raw chunks
    print("\n--- data/pipeline/chunks/raw/ ---")
    total_files = 0
    total_articles = 0
    total_bytes = 0
    for state, s in raw_stats.items():
        print(f"  {state:<25} {s['files']:>4} files  {s['articles']:>7} articles  {fmt_bytes(s['bytes']):>10}")
        total_files += s["files"]
        total_articles += s["articles"]
        total_bytes += s["bytes"]
    print(f"  {'TOTAL':<25} {total_files:>4} files  {total_articles:>7} articles  {fmt_bytes(total_bytes):>10}")

    # Merged
    print("\n--- data/pipeline/merged/ ---")
    if merged_files:
        merged_bytes = 0
        for mf in merged_files:
            print(f"  {mf['name']:<40} {fmt_bytes(mf['bytes']):>10}")
            merged_bytes += mf["bytes"]
        print(f"  {'TOTAL':<40} {fmt_bytes(merged_bytes):>10}")
    else:
        print("  (empty or does not exist)")

    # Scraped URLs cache
    print("\n--- .cache/scraped_urls.json ---")
    if url_cache:
        print(f"  {url_cache['entries']} entries, {fmt_bytes(url_cache['bytes'])}")
    else:
        print("  (does not exist)")

    print()
    return total_files, total_articles, total_bytes


def execute_reset():
    deleted_files = 0

    # Delete raw JSON files recursively (keep directory structure)
    if RAW_DIR.exists():
        for state_dir in RAW_DIR.iterdir():
            if not state_dir.is_dir():
                continue
            for f in state_dir.rglob("*.json"):
                f.unlink()
                deleted_files += 1

    # Delete scraped URLs cache
    if SCRAPED_URLS_CACHE.exists():
        SCRAPED_URLS_CACHE.unlink()
        deleted_files += 1

    # Delete merged files
    if MERGED_DIR.exists():
        for f in MERGED_DIR.iterdir():
            if f.is_file():
                f.unlink()
                deleted_files += 1

    return deleted_files


def main():
    parser = argparse.ArgumentParser(description="Reset raw scraped data (safe — enrichment cache preserved)")
    parser.add_argument("--execute", action="store_true", help="Actually delete files (default is dry-run)")
    args = parser.parse_args()

    raw_stats = scan_raw_dir()
    merged_files = scan_merged_dir()
    url_cache = scan_scraped_urls_cache()

    total_files, total_articles, total_bytes = print_summary(raw_stats, merged_files, url_cache)

    if not args.execute:
        print("DRY RUN — no files deleted. Pass --execute to delete.")
        return

    print("EXECUTING RESET...")
    deleted = execute_reset()
    print(f"Done. Deleted {deleted} files.")
    print("Preserved: data/pipeline/chunks/enriched/, .cache/enrichment_cache.json")


if __name__ == "__main__":
    main()
