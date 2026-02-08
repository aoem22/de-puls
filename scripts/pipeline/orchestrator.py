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
    FILTER_SCRIPT,
    DELAY_BETWEEN_CHUNKS_SECONDS,
    MAX_RETRIES,
    RETRY_DELAYS_SECONDS,
    LOG_DIR,
    BUNDESLAENDER,
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


def run_scraper(chunk: dict, manifest: dict) -> tuple[bool, Optional[int], Optional[str]]:
    """
    Run the scraper for a single monthly chunk (all Bundesländer).

    Processes all 16 Bundesländer sequentially, aggregating results
    into a single monthly JSON file.

    Returns: (success, article_count, error_message)
    """
    chunk_id = chunk["id"]
    all_articles = []
    completed_states = chunk.get("bundeslaender_completed", [])

    total_states = len(BUNDESLAENDER)

    for i, bundesland in enumerate(BUNDESLAENDER, 1):
        if _shutdown_requested:
            return False, len(all_articles), "Shutdown requested"

        # Skip already completed states (for resumption)
        if bundesland in completed_states:
            print(f"    Skipping {bundesland} ({i}/{total_states}) - already completed")
            continue

        print(f"    Scraping {bundesland} ({i}/{total_states}) for {chunk['year_month']}...")

        cmd = [
            sys.executable,
            str(SCRAPER_SCRIPT),
            "--bundesland", bundesland,
            "--start-date", chunk["start_date"],
            "--end-date", chunk["end_date"],
            "--output", f"/tmp/scrape_{bundesland}_{chunk['year_month']}.json",
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=1800,  # 30 min timeout per state
            )

            if result.returncode != 0:
                error = result.stderr.strip() or result.stdout.strip() or "Unknown error"
                print(f"    WARNING: {bundesland} failed: {error[:100]}")
                # Continue with other states instead of failing entirely
                continue

            # Load articles from temp file
            temp_path = Path(f"/tmp/scrape_{bundesland}_{chunk['year_month']}.json")
            if temp_path.exists():
                with open(temp_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    articles = data.get("articles", [])
                    print(f"    Found {len(articles)} articles in {bundesland}")
                    all_articles.extend(articles)
                # Clean up temp file
                temp_path.unlink()

            # Track progress
            completed_states.append(bundesland)
            manifest["chunks"][chunk_id]["bundeslaender_completed"] = completed_states
            save_manifest(manifest)

        except subprocess.TimeoutExpired:
            print(f"    WARNING: {bundesland} timed out after 30 min")
            continue
        except Exception as e:
            print(f"    WARNING: {bundesland} exception: {str(e)}")
            continue

    # Save aggregated results
    raw_path = Path(chunk["raw_file"])
    raw_path.parent.mkdir(parents=True, exist_ok=True)

    output_data = {
        "year_month": chunk["year_month"],
        "start_date": chunk["start_date"],
        "end_date": chunk["end_date"],
        "bundeslaender_scraped": completed_states,
        "articles": all_articles,
    }

    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print(f"    Total: {len(all_articles)} articles from {len(completed_states)} states")

    return True, len(all_articles), None


def run_enricher(chunk: dict) -> tuple[bool, Optional[int], Optional[str]]:
    """
    Run the enricher for a single monthly chunk.

    The enricher expects a JSON file with an "articles" array.
    Returns: (success, enriched_count, error_message)
    """
    # Use filtered file if available, otherwise fall back to raw
    input_file = chunk.get("filtered_file") or chunk["raw_file"]
    raw_path = Path(input_file)
    if not raw_path.exists():
        # Fall back to raw file
        raw_path = Path(chunk["raw_file"])
    if not raw_path.exists():
        return False, None, f"Input file not found: {raw_path}"

    # Load data and extract articles for enricher
    with open(raw_path, "r", encoding="utf-8") as f:
        raw_data = json.load(f)

    articles = raw_data.get("articles", [])
    if not articles:
        print("    No articles to enrich")
        # Create empty enriched file
        enriched_path = Path(chunk["enriched_file"])
        enriched_path.parent.mkdir(parents=True, exist_ok=True)
        with open(enriched_path, "w", encoding="utf-8") as f:
            json.dump([], f)
        return True, 0, None

    # Write articles to temp file for enricher (enricher expects list format)
    temp_input = Path(f"/tmp/enrich_input_{chunk['year_month']}.json")
    with open(temp_input, "w", encoding="utf-8") as f:
        json.dump(articles, f, ensure_ascii=False)

    cmd = [
        sys.executable,
        str(ENRICHER_SCRIPT),
        "--input", str(temp_input),
        "--output", chunk["enriched_file"],
    ]

    print(f"    Running enricher on {len(articles)} articles...")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=14400,  # 4 hour timeout for enrichment (many articles)
        )

        # Clean up temp file
        if temp_input.exists():
            temp_input.unlink()

        if result.returncode != 0:
            error = result.stderr.strip() or result.stdout.strip() or "Unknown error"
            return False, None, f"Enricher failed: {error}"

        # Count enriched articles
        enriched_path = Path(chunk["enriched_file"])
        if enriched_path.exists():
            with open(enriched_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Handle both list and dict formats
                if isinstance(data, list):
                    enriched_count = len(data)
                else:
                    enriched_count = len(data.get("articles", data))
        else:
            return False, None, "Enricher completed but output file not found"

        return True, enriched_count, None

    except subprocess.TimeoutExpired:
        if temp_input.exists():
            temp_input.unlink()
        return False, None, "Enricher timed out after 4 hours"
    except Exception as e:
        if temp_input.exists():
            temp_input.unlink()
        return False, None, f"Enricher exception: {str(e)}"


def run_filter(chunk: dict) -> tuple[bool, Optional[int], Optional[str]]:
    """
    Run the article filter for a single monthly chunk.

    Filters junk and groups incidents. Reads raw file, writes filtered file.
    Returns: (success, filtered_count, error_message)
    """
    raw_path = Path(chunk["raw_file"])
    if not raw_path.exists():
        return False, None, f"Raw file not found: {raw_path}"

    # Filtered output goes alongside raw file with _filtered suffix
    filtered_path = Path(str(raw_path).replace("/raw/", "/filtered/"))
    filtered_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        str(FILTER_SCRIPT),
        "--input", str(raw_path),
        "--output", str(filtered_path),
    ]

    print(f"    Running filter on {raw_path}...")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 min timeout (no network calls)
        )

        if result.returncode != 0:
            error = result.stderr.strip() or result.stdout.strip() or "Unknown error"
            return False, None, f"Filter failed: {error}"

        # Count filtered articles
        if filtered_path.exists():
            with open(filtered_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    count = len(data)
                else:
                    count = len(data.get("articles", []))
            # Update chunk to point enricher at filtered file
            chunk["filtered_file"] = str(filtered_path)
            return True, count, None

        return False, None, "Filter completed but output not found"

    except subprocess.TimeoutExpired:
        return False, None, "Filter timed out"
    except Exception as e:
        return False, None, f"Filter exception: {str(e)}"


def process_chunk(chunk: dict, manifest: dict) -> bool:
    """
    Process a single monthly chunk (scrape all states + enrich).

    Returns True if successful, False if failed.
    """
    chunk_id = chunk["id"]
    print(f"\n[{datetime.now().isoformat()}] Processing chunk: {chunk_id}")
    print(f"  Month: {chunk['year_month']}")
    print(f"  Date range: {chunk['start_date']} to {chunk['end_date']}")
    print(f"  Processing all {len(BUNDESLAENDER)} Bundesländer sequentially")

    # Mark as in progress
    update_chunk_status(manifest, chunk_id, "in_progress")
    save_manifest(manifest)

    # Ensure directories exist
    ensure_directories(chunk)

    # Step 1: Scrape all Bundesländer
    print(f"\n  Step 1/3: Scraping all Bundesländer...")
    success, article_count, error = run_scraper(chunk, manifest)

    if not success:
        print(f"  FAILED: {error}")
        update_chunk_status(manifest, chunk_id, "failed", error=error)
        save_manifest(manifest)
        return False

    print(f"  Scraped {article_count} total articles")
    update_chunk_status(manifest, chunk_id, "in_progress", articles_count=article_count)
    save_manifest(manifest)

    # Step 2: Filter (junk removal + incident grouping)
    skip_filter = chunk.get("_skip_filter", False)
    if not skip_filter:
        print(f"\n  Step 2/3: Filtering...")
        success, filtered_count, error = run_filter(chunk)
        if not success:
            print(f"  Filter FAILED (continuing without filter): {error}")
            # Non-fatal: continue with unfiltered data
        else:
            print(f"  Filtered: {filtered_count} articles kept (from {article_count})")
    else:
        print(f"\n  Step 2/3: Filtering skipped (--skip-filter)")

    # Step 3: Enrich
    print(f"\n  Step 3/3: Enriching...")
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
