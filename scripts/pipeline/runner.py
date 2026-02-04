#!/usr/bin/env python3
"""
CLI entry point for the Blaulicht pipeline.

Usage:
    python -m scripts.pipeline.runner start          # Start/resume pipeline
    python -m scripts.pipeline.runner status         # Show progress
    python -m scripts.pipeline.runner retry          # Retry failed chunks
    python -m scripts.pipeline.runner merge          # Merge completed chunks
    python -m scripts.pipeline.runner transform      # Generate crimes.json
    python -m scripts.pipeline.runner reset          # Reset all progress

    # Process a single chunk (for testing)
    python -m scripts.pipeline.runner start --chunk bayern_2024-01
"""

import argparse
import sys
from datetime import datetime

from .config import DEFAULT_START_DATE, DEFAULT_END_DATE, BUNDESLAENDER
from .chunk_manager import (
    get_or_create_manifest,
    save_manifest,
    get_progress_summary,
    reset_in_progress_chunks,
    reset_failed_chunks,
)
from .orchestrator import run_pipeline, retry_failed_chunks
from .merge import run_merge, run_transform


def cmd_start(args):
    """Start or resume the pipeline."""
    if args.chunk:
        # Single chunk mode
        run_pipeline(
            start_date=args.start_date,
            end_date=args.end_date,
            single_chunk=args.chunk,
        )
    elif args.bundesland and args.year and args.month:
        # Construct chunk ID from components
        chunk_id = f"{args.bundesland}_{args.year}-{args.month:02d}"
        run_pipeline(
            start_date=args.start_date,
            end_date=args.end_date,
            single_chunk=chunk_id,
        )
    else:
        # Full pipeline
        run_pipeline(
            start_date=args.start_date,
            end_date=args.end_date,
        )


def cmd_status(args):
    """Show pipeline progress."""
    manifest = get_or_create_manifest()
    print(get_progress_summary(manifest))

    if args.verbose:
        # Show detailed chunk status
        print("\nChunk details:")
        for chunk_id, chunk in sorted(manifest["chunks"].items()):
            status = chunk["status"]
            articles = chunk.get("articles_count") or "?"
            enriched = chunk.get("enriched_count") or "?"

            status_icon = {
                "completed": "✓",
                "in_progress": "→",
                "failed": "✗",
                "pending": "○",
            }.get(status, "?")

            print(f"  {status_icon} {chunk_id}: {status} ({articles}/{enriched})")


def cmd_retry(args):
    """Retry failed chunks."""
    retry_failed_chunks()


def cmd_merge(args):
    """Merge completed chunks."""
    run_merge()


def cmd_transform(args):
    """Transform merged data to crimes.json."""
    run_transform()


def cmd_reset(args):
    """Reset pipeline progress."""
    if not args.confirm:
        print("This will reset pipeline progress. Add --confirm to proceed.")
        print("Options:")
        print("  --failed   Only reset failed chunks")
        print("  --all      Reset all chunks (including completed)")
        return

    manifest = get_or_create_manifest()

    if args.failed:
        count = reset_failed_chunks(manifest)
        print(f"Reset {count} failed chunks to pending")
    elif args.all:
        # Reset everything
        for chunk in manifest["chunks"].values():
            chunk["status"] = "pending"
            chunk["articles_count"] = None
            chunk["enriched_count"] = None
            chunk["error"] = None
            chunk["started_at"] = None
            chunk["completed_at"] = None
            chunk["retries"] = 0
        print(f"Reset all {len(manifest['chunks'])} chunks to pending")
    else:
        # Default: reset in_progress and failed
        count1 = reset_in_progress_chunks(manifest)
        count2 = reset_failed_chunks(manifest)
        print(f"Reset {count1} in_progress and {count2} failed chunks to pending")

    save_manifest(manifest)


def cmd_list_chunks(args):
    """List all chunks."""
    manifest = get_or_create_manifest()

    filter_status = args.status
    filter_bundesland = args.bundesland

    print(f"{'Chunk ID':<40} {'Status':<12} {'Articles':<10} {'Error'}")
    print("-" * 80)

    for chunk_id, chunk in sorted(manifest["chunks"].items()):
        status = chunk["status"]

        # Apply filters
        if filter_status and status != filter_status:
            continue
        if filter_bundesland and chunk["bundesland"] != filter_bundesland:
            continue

        articles = chunk.get("articles_count") or "-"
        error = (chunk.get("error") or "")[:30]

        print(f"{chunk_id:<40} {status:<12} {str(articles):<10} {error}")


def main():
    parser = argparse.ArgumentParser(
        description="Blaulicht Pipeline - 3-year police report scraping",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # start command
    start_parser = subparsers.add_parser("start", help="Start or resume pipeline")
    start_parser.add_argument(
        "--start-date",
        default=DEFAULT_START_DATE,
        help=f"Start date (default: {DEFAULT_START_DATE})",
    )
    start_parser.add_argument(
        "--end-date",
        default=DEFAULT_END_DATE,
        help=f"End date (default: {DEFAULT_END_DATE})",
    )
    start_parser.add_argument(
        "--chunk",
        help="Process only this specific chunk (e.g., bayern_2024-01)",
    )
    start_parser.add_argument(
        "--bundesland",
        choices=BUNDESLAENDER,
        help="Bundesland for single chunk processing",
    )
    start_parser.add_argument(
        "--year",
        type=int,
        help="Year for single chunk processing",
    )
    start_parser.add_argument(
        "--month",
        type=int,
        help="Month for single chunk processing",
    )
    start_parser.set_defaults(func=cmd_start)

    # status command
    status_parser = subparsers.add_parser("status", help="Show pipeline progress")
    status_parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Show detailed chunk status",
    )
    status_parser.set_defaults(func=cmd_status)

    # retry command
    retry_parser = subparsers.add_parser("retry", help="Retry failed chunks")
    retry_parser.set_defaults(func=cmd_retry)

    # merge command
    merge_parser = subparsers.add_parser("merge", help="Merge completed chunks")
    merge_parser.set_defaults(func=cmd_merge)

    # transform command
    transform_parser = subparsers.add_parser("transform", help="Generate crimes.json")
    transform_parser.set_defaults(func=cmd_transform)

    # reset command
    reset_parser = subparsers.add_parser("reset", help="Reset pipeline progress")
    reset_parser.add_argument(
        "--confirm",
        action="store_true",
        help="Confirm reset action",
    )
    reset_parser.add_argument(
        "--failed",
        action="store_true",
        help="Only reset failed chunks",
    )
    reset_parser.add_argument(
        "--all",
        action="store_true",
        help="Reset all chunks including completed",
    )
    reset_parser.set_defaults(func=cmd_reset)

    # list command
    list_parser = subparsers.add_parser("list", help="List chunks")
    list_parser.add_argument(
        "--status",
        choices=["pending", "in_progress", "completed", "failed"],
        help="Filter by status",
    )
    list_parser.add_argument(
        "--bundesland",
        choices=BUNDESLAENDER,
        help="Filter by Bundesland",
    )
    list_parser.set_defaults(func=cmd_list_chunks)

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
