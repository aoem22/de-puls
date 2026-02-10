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
    python -m scripts.pipeline.runner week --year 2026 --week 1  # Process one week

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
from .parallel_orchestrator import (
    run_parallel_pipeline,
    run_scrape_only,
    run_enrich_only,
)
from .merge import run_merge, run_transform
from .weekly_processor import process_week


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


def cmd_fast(args):
    """Run the FAST parallel pipeline."""
    run_parallel_pipeline(
        start_date=args.start_date,
        end_date=args.end_date,
        skip_filter=getattr(args, 'skip_filter', False),
        run_name=getattr(args, 'run_name', 'default'),
    )


def cmd_scrape(args):
    """Run scraping only (no LLM enrichment)."""
    run_scrape_only(
        start_date=args.start_date,
        end_date=args.end_date,
    )


def cmd_filter(args):
    """Run article filter on scraped data."""
    from .filter_articles import run_filter

    if not args.input or not args.output:
        print("ERROR: --input and --output are required for filter command")
        return

    run_filter(
        input_path=args.input,
        output_path=args.output,
        dry_run=args.dry_run,
    )


def cmd_enrich(args):
    """Run enrichment only (on already-scraped data)."""
    run_enrich_only()


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


def cmd_week(args):
    """Process a single ISO week through the full pipeline."""
    process_week(
        year=args.year,
        week=args.week,
        dry_run=args.dry_run,
        no_geocode=args.no_geocode,
        prompt_version=args.prompt_version,
        model=args.model,
        skip_clustering=args.skip_clustering,
    )


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
        description="Blaulicht Pipeline - police report scraping and enrichment",
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

    # fast command (parallel pipeline)
    fast_parser = subparsers.add_parser(
        "fast",
        help="Run FAST parallel pipeline (8 scrapers + 4 enrichers)",
    )
    fast_parser.add_argument(
        "--start-date",
        default=DEFAULT_START_DATE,
        help=f"Start date (default: {DEFAULT_START_DATE})",
    )
    fast_parser.add_argument(
        "--end-date",
        default=DEFAULT_END_DATE,
        help=f"End date (default: {DEFAULT_END_DATE})",
    )
    fast_parser.add_argument(
        "--skip-filter",
        action="store_true",
        help="Skip the article filter step (for raw comparison runs)",
    )
    fast_parser.add_argument(
        "--run-name",
        default="default",
        help="Pipeline run name for A/B experiments (default: 'default')",
    )
    fast_parser.set_defaults(func=cmd_fast)

    # scrape command (scraping only)
    scrape_parser = subparsers.add_parser(
        "scrape",
        help="Run ONLY scraping phase (no LLM, very fast)",
    )
    scrape_parser.add_argument(
        "--start-date",
        default=DEFAULT_START_DATE,
        help=f"Start date (default: {DEFAULT_START_DATE})",
    )
    scrape_parser.add_argument(
        "--end-date",
        default=DEFAULT_END_DATE,
        help=f"End date (default: {DEFAULT_END_DATE})",
    )
    scrape_parser.set_defaults(func=cmd_scrape)

    # filter command (junk removal + incident grouping)
    filter_parser = subparsers.add_parser(
        "filter",
        help="Run article filter (junk removal + incident grouping)",
    )
    filter_parser.add_argument("--input", "-i", help="Input JSON file")
    filter_parser.add_argument("--output", "-o", help="Output JSON file")
    filter_parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    filter_parser.set_defaults(func=cmd_filter)

    # enrich command (enrichment only)
    enrich_parser = subparsers.add_parser(
        "enrich",
        help="Run ONLY enrichment phase (on already-scraped data)",
    )
    enrich_parser.set_defaults(func=cmd_enrich)

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

    # week command (weekly processing with prompt versioning)
    week_parser = subparsers.add_parser(
        "week",
        help="Process a single ISO week (filter + enrich + push)",
    )
    week_parser.add_argument(
        "--year", type=int, required=True,
        help="ISO year (e.g. 2026)",
    )
    week_parser.add_argument(
        "--week", type=int, required=True,
        help="ISO week number (1-53)",
    )
    week_parser.add_argument(
        "--dry-run", action="store_true",
        help="Preview stats without pushing to Supabase",
    )
    week_parser.add_argument(
        "--no-geocode", action="store_true",
        help="Skip geocoding (faster testing)",
    )
    week_parser.add_argument(
        "--prompt-version", default="v2",
        help="Prompt version tag (default: 'v2')",
    )
    week_parser.add_argument(
        "--model",
        help="LLM model to use (default: x-ai/grok-4-fast)",
    )
    week_parser.add_argument(
        "--skip-clustering", action="store_true",
        help="Skip rule-based incident grouping (articles get solo group IDs)",
    )
    week_parser.set_defaults(func=cmd_week)

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
