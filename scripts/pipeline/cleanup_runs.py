#!/usr/bin/env python3
"""Delete all crime_records for given pipeline_run values.

Supabase delete() can time out on large sets, so we batch by selecting IDs first.
Reconnects the Supabase client periodically to avoid HTTP/2 stream limits.

Usage:
    python3 scripts/pipeline/cleanup_runs.py --runs v1_2026 default
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
load_dotenv(Path(".env.local"), override=True)


def get_client():
    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    return create_client(supabase_url, supabase_key)


def delete_run(run_name: str, batch_size: int = 500, reconnect_every: int = 500):
    """Delete all crime_records with the given pipeline_run in batches."""
    print(f"\npipeline_run='{run_name}': starting deletion...")

    sb = get_client()
    deleted = 0
    batches_since_reconnect = 0

    while True:
        # Reconnect periodically to avoid HTTP/2 stream exhaustion
        if batches_since_reconnect >= reconnect_every:
            print(f"  Reconnecting client at {deleted} records...")
            sb = get_client()
            batches_since_reconnect = 0

        try:
            batch_resp = (
                sb.table("crime_records")
                .select("id")
                .eq("pipeline_run", run_name)
                .limit(batch_size)
                .execute()
            )
            ids = [r["id"] for r in batch_resp.data]
            if not ids:
                break

            sb.table("crime_records").delete().in_("id", ids).execute()
            deleted += len(ids)
            batches_since_reconnect += 1

            if deleted % 5000 == 0:
                print(f"  Deleted {deleted} records so far...")

        except Exception as e:
            print(f"  Connection error at {deleted} records: {e}")
            print(f"  Reconnecting and retrying...")
            sb = get_client()
            batches_since_reconnect = 0
            continue

    print(f"  Done: deleted {deleted} records for pipeline_run='{run_name}'")
    return deleted


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Delete crime_records by pipeline_run")
    parser.add_argument("--runs", nargs="+", required=True, help="Pipeline run names to delete")
    parser.add_argument("--batch-size", type=int, default=500, help="IDs per delete batch")
    args = parser.parse_args()

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

    if not supabase_url or not supabase_key:
        print("ERROR: Missing Supabase credentials")
        sys.exit(1)

    print(f"Connecting to Supabase: {supabase_url}")

    total_deleted = 0
    for run_name in args.runs:
        total_deleted += delete_run(run_name, batch_size=args.batch_size)

    print(f"\nTotal {total_deleted} records deleted across all runs.")


if __name__ == "__main__":
    main()
