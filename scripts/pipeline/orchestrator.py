"""
Pipeline orchestrator - runs the scraping and enrichment loop.
Handles subprocess execution, retries, and graceful shutdown.
"""

import json
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from .config import (
    SCRAPER_SCRIPT,
    ENRICHER_SCRIPT,
    DELAY_BETWEEN_CHUNKS_SECONDS,
    MAX_RETRIES,
    RETRY_DELAYS_SECONDS,
    LOG_DIR,
)
from .chunk_manager import (
    get_or_create_manifest,
    save_manifest,
    get_next_pending_chunk,
    update_chunk_status,
    reset_in_progress_chunks,
    get_progress_summary,
)


# Global flag for graceful shutdown
_shutdown_requested = False


def _signal_handler(signum, frame):
    """Handle SIGINT/SIGTERM for graceful shutdown."""
    global _shutdown_requested
    print(f"\n[{datetime.now().isoformat()}] Shutdown requested (signal {signum})")
    print("Finishing current chunk before stopping...")
    _shutdown_requested = True


def setup_signal_handlers():
    """Install signal handlers for graceful shutdown."""
    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)


def ensure_directories(chunk: dict) -> None:
    """Ensure output directories exist for a chunk."""
    raw_path = Path(chunk["raw_file"])
    enriched_path = Path(chunk["enriched_file"])
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    enriched_path.parent.mkdir(parents=True, exist_ok=True)


def run_scraper(chunk: dict) -> tuple[bool, Optional[int], Optional[str]]:
    """
    Run the scraper for a single chunk.

    Returns: (success, article_count, error_message)
    """
    cmd = [
        sys.executable,
        str(SCRAPER_SCRIPT),
        "--bundesland", chunk["bundesland"],
        "--start-date", chunk["start_date"],
        "--end-date", chunk["end_date"],
        "--output", chunk["raw_file"],
    ]

    print(f"  Running scraper: {' '.join(cmd)}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=3600,  # 1 hour timeout per chunk
        )

        if result.returncode != 0:
            error = result.stderr.strip() or result.stdout.strip() or "Unknown error"
            return False, None, f"Scraper failed: {error}"

        # Count articles in output file
        raw_path = Path(chunk["raw_file"])
        if raw_path.exists():
            with open(raw_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                article_count = len(data.get("articles", []))
        else:
            return False, None, "Scraper completed but output file not found"

        return True, article_count, None

    except subprocess.TimeoutExpired:
        return False, None, "Scraper timed out after 1 hour"
    except Exception as e:
        return False, None, f"Scraper exception: {str(e)}"


def run_enricher(chunk: dict) -> tuple[bool, Optional[int], Optional[str]]:
    """
    Run the enricher for a single chunk.

    Returns: (success, enriched_count, error_message)
    """
    cmd = [
        sys.executable,
        str(ENRICHER_SCRIPT),
        "--input", chunk["raw_file"],
        "--output", chunk["enriched_file"],
    ]

    print(f"  Running enricher: {' '.join(cmd)}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=7200,  # 2 hour timeout for enrichment (LLM calls take time)
        )

        if result.returncode != 0:
            error = result.stderr.strip() or result.stdout.strip() or "Unknown error"
            return False, None, f"Enricher failed: {error}"

        # Count enriched articles
        enriched_path = Path(chunk["enriched_file"])
        if enriched_path.exists():
            with open(enriched_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                enriched_count = len(data.get("articles", []))
        else:
            return False, None, "Enricher completed but output file not found"

        return True, enriched_count, None

    except subprocess.TimeoutExpired:
        return False, None, "Enricher timed out after 2 hours"
    except Exception as e:
        return False, None, f"Enricher exception: {str(e)}"


def process_chunk(chunk: dict, manifest: dict) -> bool:
    """
    Process a single chunk (scrape + enrich).

    Returns True if successful, False if failed.
    """
    chunk_id = chunk["id"]
    print(f"\n[{datetime.now().isoformat()}] Processing chunk: {chunk_id}")
    print(f"  Bundesland: {chunk['bundesland']}")
    print(f"  Date range: {chunk['start_date']} to {chunk['end_date']}")

    # Mark as in progress
    update_chunk_status(manifest, chunk_id, "in_progress")
    save_manifest(manifest)

    # Ensure directories exist
    ensure_directories(chunk)

    # Step 1: Scrape
    print(f"\n  Step 1/2: Scraping...")
    success, article_count, error = run_scraper(chunk)

    if not success:
        print(f"  FAILED: {error}")
        update_chunk_status(manifest, chunk_id, "failed", error=error)
        save_manifest(manifest)
        return False

    print(f"  Scraped {article_count} articles")
    update_chunk_status(manifest, chunk_id, "in_progress", articles_count=article_count)
    save_manifest(manifest)

    # Step 2: Enrich
    print(f"\n  Step 2/2: Enriching...")
    success, enriched_count, error = run_enricher(chunk)

    if not success:
        print(f"  FAILED: {error}")
        update_chunk_status(manifest, chunk_id, "failed", error=error)
        save_manifest(manifest)
        return False

    print(f"  Enriched {enriched_count} articles")

    # Mark as completed
    update_chunk_status(
        manifest, chunk_id, "completed",
        articles_count=article_count,
        enriched_count=enriched_count
    )
    save_manifest(manifest)

    print(f"  COMPLETED: {chunk_id}")
    return True


def process_chunk_with_retries(chunk: dict, manifest: dict) -> bool:
    """
    Process a chunk with retry logic.

    Returns True if successful (possibly after retries), False if all retries exhausted.
    """
    chunk_id = chunk["id"]
    retries = manifest["chunks"][chunk_id].get("retries", 0)

    for attempt in range(MAX_RETRIES):
        if _shutdown_requested:
            return False

        if attempt > 0:
            delay = RETRY_DELAYS_SECONDS[min(attempt - 1, len(RETRY_DELAYS_SECONDS) - 1)]
            print(f"\n  Retry {attempt}/{MAX_RETRIES} for {chunk_id} after {delay}s delay...")
            time.sleep(delay)

        success = process_chunk(chunk, manifest)
        if success:
            return True

        # Check if we should retry
        if attempt < MAX_RETRIES - 1:
            # Reset status to pending for retry
            manifest["chunks"][chunk_id]["status"] = "pending"

    return False


def run_pipeline(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    single_chunk: Optional[str] = None,
) -> None:
    """
    Run the main pipeline loop.

    Args:
        start_date: Override default start date
        end_date: Override default end date
        single_chunk: If set, only process this specific chunk (for testing)
    """
    setup_signal_handlers()

    # Create log directory
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[{datetime.now().isoformat()}] Starting Blaulicht Pipeline")
    print("=" * 60)

    # Load or create manifest
    kwargs = {}
    if start_date:
        kwargs["start_date"] = start_date
    if end_date:
        kwargs["end_date"] = end_date

    manifest = get_or_create_manifest(**kwargs)

    # Reset any in_progress chunks (from previous crashed run)
    reset_count = reset_in_progress_chunks(manifest)
    if reset_count > 0:
        print(f"Reset {reset_count} in_progress chunks from previous run")
        save_manifest(manifest)

    # Show initial progress
    print("\n" + get_progress_summary(manifest))
    print("=" * 60)

    # If single chunk mode, process just that chunk
    if single_chunk:
        if single_chunk not in manifest["chunks"]:
            print(f"ERROR: Unknown chunk: {single_chunk}")
            return

        chunk = {"id": single_chunk, **manifest["chunks"][single_chunk]}

        # Reset to pending if not already
        if chunk["status"] != "pending":
            manifest["chunks"][single_chunk]["status"] = "pending"
            save_manifest(manifest)

        success = process_chunk_with_retries(chunk, manifest)
        print("\n" + get_progress_summary(manifest))
        return

    # Main processing loop
    processed = 0
    while not _shutdown_requested:
        chunk = get_next_pending_chunk(manifest)

        if chunk is None:
            print(f"\n[{datetime.now().isoformat()}] All chunks processed!")
            break

        success = process_chunk_with_retries(chunk, manifest)
        processed += 1

        # Show progress every 10 chunks
        if processed % 10 == 0:
            print("\n" + "-" * 60)
            print(get_progress_summary(manifest))
            print("-" * 60)

        # Delay between chunks to be nice to the server
        if not _shutdown_requested and success:
            print(f"\n  Waiting {DELAY_BETWEEN_CHUNKS_SECONDS}s before next chunk...")
            time.sleep(DELAY_BETWEEN_CHUNKS_SECONDS)

    # Final summary
    print("\n" + "=" * 60)
    print(f"[{datetime.now().isoformat()}] Pipeline {'stopped' if _shutdown_requested else 'completed'}")
    print(get_progress_summary(manifest))


def retry_failed_chunks() -> None:
    """Reset and retry all failed chunks."""
    from .chunk_manager import reset_failed_chunks

    manifest = get_or_create_manifest()
    count = reset_failed_chunks(manifest)

    if count == 0:
        print("No failed chunks to retry")
        return

    print(f"Reset {count} failed chunks to pending")
    save_manifest(manifest)

    # Run the pipeline (will pick up the reset chunks)
    run_pipeline()
