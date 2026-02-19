#!/usr/bin/env python3
"""
One-time backfill: split full digest bodies into per-incident sections.

Queries crime_records for source_urls with multiple records (digest splits),
applies the same regex splitting logic from fast_enricher, and updates each
record's body with its individual section text.

Usage:
    python3 scripts/pipeline/backfill_split_bodies.py --dry-run
    python3 scripts/pipeline/backfill_split_bodies.py
    python3 scripts/pipeline/backfill_split_bodies.py --limit 100
"""
import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
load_dotenv(Path(".env.local"), override=True)

# Import the splitting function from fast_enricher
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from scripts.pipeline.fast_enricher import _split_body_sections


def main():
    parser = argparse.ArgumentParser(description="Backfill per-incident body sections")
    parser.add_argument("--dry-run", action="store_true", help="Preview without updating")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of source_urls to process (0=all)")
    parser.add_argument("--batch-size", type=int, default=500, help="Records per update batch")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show per-article details")
    args = parser.parse_args()

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not supabase_url or not supabase_key:
        print("ERROR: Missing Supabase credentials")
        sys.exit(1)

    supabase = create_client(supabase_url, supabase_key)

    # Find all source_urls that have multiple records (digest splits)
    print("Querying for multi-record source_urls...")
    rpc_data = None
    try:
        result = supabase.rpc("get_multi_record_urls", {}).execute()
        rpc_data = result.data
    except Exception:
        pass

    if not rpc_data:
        # Fallback: fetch all records and group in Python
        print("RPC not available, fetching all records to group locally...")
        all_records = []
        page_size = 1000
        offset = 0
        while True:
            batch = (
                supabase.table("crime_records")
                .select("id, source_url, body, clean_title")
                .order("source_url")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            if not batch.data:
                break
            all_records.extend(batch.data)
            offset += page_size
            if len(batch.data) < page_size:
                break

        print(f"Fetched {len(all_records)} total records")

        # Group by source_url
        groups: dict[str, list[dict]] = {}
        for rec in all_records:
            url = rec.get("source_url", "")
            if url:
                groups.setdefault(url, []).append(rec)

        # Filter to multi-record groups only
        multi_groups = {url: recs for url, recs in groups.items() if len(recs) > 1}
    else:
        # RPC returned list of {source_url, count}
        multi_urls = [r["source_url"] for r in rpc_data]
        print(f"Found {len(multi_urls)} multi-record source_urls via RPC")

        multi_groups: dict[str, list[dict]] = {}
        for url in multi_urls:
            recs = (
                supabase.table("crime_records")
                .select("id, source_url, body, clean_title")
                .eq("source_url", url)
                .execute()
            )
            if recs.data and len(recs.data) > 1:
                multi_groups[url] = recs.data

    total_urls = len(multi_groups)
    total_records = sum(len(recs) for recs in multi_groups.values())
    print(f"Found {total_urls} source_urls with {total_records} total records to process")

    if args.limit:
        urls_to_process = list(multi_groups.keys())[:args.limit]
        multi_groups = {url: multi_groups[url] for url in urls_to_process}
        print(f"Limited to {len(multi_groups)} source_urls")

    # Process each group
    updated_count = 0
    skipped_count = 0
    failed_count = 0
    updates: list[dict] = []

    for url, records in multi_groups.items():
        # All records in a group share the same body (the full digest)
        body = records[0].get("body", "")
        incident_count = len(records)

        if not body:
            skipped_count += incident_count
            continue

        # Check if bodies are already different (already split)
        bodies = {r.get("body", "") for r in records}
        if len(bodies) > 1:
            skipped_count += incident_count
            if args.verbose:
                print(f"  SKIP (already split): {url} ({incident_count} records)")
            continue

        sections = _split_body_sections(body, incident_count)
        if not sections:
            failed_count += incident_count
            if args.verbose:
                print(f"  FAIL (split mismatch): {url} ({incident_count} records)")
            continue

        # Match sections to records by order (sorted by clean_title or id for consistency)
        sorted_records = sorted(records, key=lambda r: r.get("clean_title") or r.get("id", ""))

        for rec, section in zip(sorted_records, sections):
            updates.append({"id": rec["id"], "body": section})

        updated_count += incident_count
        if args.verbose:
            print(f"  OK: {url} → {incident_count} sections")

    print(f"\nResults:")
    print(f"  Would update: {updated_count} records")
    print(f"  Skipped (already split or empty): {skipped_count}")
    print(f"  Failed (split mismatch): {failed_count}")

    if args.dry_run:
        print(f"\n[DRY RUN] Sample updates:")
        for u in updates[:5]:
            body_preview = u["body"][:80].replace("\n", " ")
            print(f"  {u['id'][:12]}... → \"{body_preview}...\"")
        print(f"\n[DRY RUN] {len(updates)} records ready for update")
        return

    if not updates:
        print("Nothing to update.")
        return

    # Batch update
    print(f"\nUpdating {len(updates)} records...")
    batch_size = args.batch_size
    done = 0
    for i in range(0, len(updates), batch_size):
        batch = updates[i:i + batch_size]
        for update in batch:
            try:
                supabase.table("crime_records").update({"body": update["body"]}).eq("id", update["id"]).execute()
                done += 1
            except Exception as e:
                print(f"  ERROR updating {update['id']}: {e}")

        print(f"  Updated {done}/{len(updates)} records")

    print(f"\nBackfill complete! Updated {done} records.")


if __name__ == "__main__":
    main()
