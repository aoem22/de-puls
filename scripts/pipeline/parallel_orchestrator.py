"""
Parallel pipeline orchestrator - dramatically faster processing.

Key optimizations:
1. Parallel scraping across Bundesländer (8 concurrent)
2. Parallel enrichment with batched LLM calls
3. Async I/O for maximum throughput
"""

import asyncio
import json
import signal
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Optional

from .config import (
    SCRAPER_SCRIPT,
    ASYNC_SCRAPER_SCRIPT,
    ENRICHER_SCRIPT,
    FAST_ENRICHER_SCRIPT,
    FILTER_SCRIPT,
    BUNDESLAENDER,
    LOG_DIR,
    DATA_DIR,
)
from .chunk_manager import (
    get_or_create_manifest,
    save_manifest,
    get_progress_summary,
    reset_in_progress_chunks,
    update_chunk_status,
)


# Concurrency settings
MAX_PARALLEL_SCRAPERS = 8  # Run 8 scrapers at once
MAX_PARALLEL_ENRICHERS = 4  # Run 4 enrichers at once (LLM rate limits)
DELAY_BETWEEN_BATCHES = 2  # Seconds between batch starts

# Global shutdown flag
_shutdown_requested = False


def _signal_handler(signum, frame):
    global _shutdown_requested
    print(f"\n[{datetime.now().isoformat()}] Shutdown requested...")
    _shutdown_requested = True


def setup_signal_handlers():
    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)


def ensure_chunk_dirs(chunk: dict) -> None:
    """Ensure output directories exist."""
    Path(chunk["raw_file"]).parent.mkdir(parents=True, exist_ok=True)
    Path(chunk["enriched_file"]).parent.mkdir(parents=True, exist_ok=True)


def run_scraper_sync(chunk: dict, use_async: bool = True) -> tuple[str, bool, Optional[int], Optional[str]]:
    """
    Run scraper for a single chunk (synchronous, for ThreadPoolExecutor).
    Uses async scraper by default for 10-20x speedup.
    Returns: (chunk_id, success, article_count, error)
    """
    chunk_id = chunk["id"]

    if _shutdown_requested:
        return chunk_id, False, None, "Shutdown requested"

    ensure_chunk_dirs(chunk)

    # Use async scraper for 10-20x speedup
    scraper_script = ASYNC_SCRAPER_SCRIPT if use_async else SCRAPER_SCRIPT

    cmd = [
        sys.executable,
        str(scraper_script),
        "--bundesland", chunk["bundesland"],
        "--start-date", chunk["start_date"],
        "--end-date", chunk["end_date"],
        "--output", chunk["raw_file"],
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=1800,  # 30 min timeout (async is much faster)
        )

        if result.returncode != 0:
            error = result.stderr.strip()[:200] or "Unknown error"
            return chunk_id, False, None, error

        # Count articles - async scraper outputs flat list, not {"articles": [...]}
        raw_path = Path(chunk["raw_file"])
        if raw_path.exists():
            with open(raw_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Handle both formats: flat list or {"articles": [...]}
                if isinstance(data, list):
                    count = len(data)
                else:
                    count = len(data.get("articles", []))
            return chunk_id, True, count, None

        return chunk_id, False, None, "Output file not found"

    except subprocess.TimeoutExpired:
        return chunk_id, False, None, "Timeout"
    except Exception as e:
        return chunk_id, False, None, str(e)[:200]


def run_filter_sync(chunk: dict) -> tuple[str, bool, Optional[int], Optional[str]]:
    """
    Run article filter for a single chunk (synchronous, for ThreadPoolExecutor).
    Returns: (chunk_id, success, filtered_count, error)
    """
    chunk_id = chunk["id"]

    if _shutdown_requested:
        return chunk_id, False, None, "Shutdown requested"

    raw_path = Path(chunk["raw_file"])
    if not raw_path.exists():
        return chunk_id, False, None, "Raw file not found"

    # Filtered output alongside raw
    filtered_path = Path(str(raw_path).replace("/raw/", "/filtered/"))
    filtered_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        str(FILTER_SCRIPT),
        "--input", str(raw_path),
        "--output", str(filtered_path),
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.returncode != 0:
            error = result.stderr.strip()[:200] or "Unknown error"
            return chunk_id, False, None, error

        if filtered_path.exists():
            with open(filtered_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                count = len(data) if isinstance(data, list) else len(data.get("articles", []))
            # Store filtered path for enricher to use
            chunk["filtered_file"] = str(filtered_path)
            return chunk_id, True, count, None

        return chunk_id, False, None, "Output file not found"

    except subprocess.TimeoutExpired:
        return chunk_id, False, None, "Timeout"
    except Exception as e:
        return chunk_id, False, None, str(e)[:200]


def run_enricher_sync(chunk: dict) -> tuple[str, bool, Optional[int], Optional[str]]:
    """
    Run FAST enricher for a single chunk (synchronous, for ThreadPoolExecutor).
    Uses batched LLM calls for 10x speedup.
    Returns: (chunk_id, success, enriched_count, error)
    """
    chunk_id = chunk["id"]

    if _shutdown_requested:
        return chunk_id, False, None, "Shutdown requested"

    # Use filtered file if available, otherwise raw
    input_file = chunk.get("filtered_file") or chunk["raw_file"]
    input_path = Path(input_file)
    if not input_path.exists():
        input_path = Path(chunk["raw_file"])
    if not input_path.exists():
        return chunk_id, False, None, "Input file not found"

    # Use FAST enricher (batched LLM calls)
    cmd = [
        sys.executable,
        str(FAST_ENRICHER_SCRIPT),
        "--input", str(input_path),
        "--output", chunk["enriched_file"],
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=3600,  # 1 hour timeout
        )

        if result.returncode != 0:
            error = result.stderr.strip()[:200] or "Unknown error"
            return chunk_id, False, None, error

        # Count enriched - handle both formats: flat list or {"articles": [...]}
        enriched_path = Path(chunk["enriched_file"])
        if enriched_path.exists():
            with open(enriched_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    count = len(data)
                else:
                    count = len(data.get("articles", []))
            return chunk_id, True, count, None

        return chunk_id, False, None, "Output file not found"

    except subprocess.TimeoutExpired:
        return chunk_id, False, None, "Timeout"
    except Exception as e:
        return chunk_id, False, None, str(e)[:200]


def run_parallel_phase(
    chunks: list[dict],
    phase_name: str,
    worker_fn,
    max_workers: int,
    manifest: dict,
) -> tuple[int, int]:
    """
    Run a phase (scrape or enrich) in parallel.
    Returns: (success_count, fail_count)
    """
    print(f"\n{'='*60}")
    print(f"[{datetime.now().isoformat()}] Starting {phase_name} phase")
    print(f"  Chunks: {len(chunks)}, Workers: {max_workers}")
    print(f"{'='*60}")

    success_count = 0
    fail_count = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all chunks
        future_to_chunk = {
            executor.submit(worker_fn, chunk): chunk
            for chunk in chunks
        }

        # Process results as they complete
        for future in as_completed(future_to_chunk):
            if _shutdown_requested:
                executor.shutdown(wait=False, cancel_futures=True)
                break

            chunk = future_to_chunk[future]
            chunk_id = chunk["id"]

            try:
                result_id, success, count, error = future.result()

                if success:
                    success_count += 1
                    print(f"  ✓ {chunk_id}: {count} articles")

                    if phase_name == "scrape":
                        update_chunk_status(manifest, chunk_id, "in_progress", articles_count=count)
                    else:
                        update_chunk_status(manifest, chunk_id, "completed", enriched_count=count)
                else:
                    fail_count += 1
                    print(f"  ✗ {chunk_id}: {error}")
                    update_chunk_status(manifest, chunk_id, "failed", error=error)

                # Save manifest periodically
                if (success_count + fail_count) % 10 == 0:
                    save_manifest(manifest)

            except Exception as e:
                fail_count += 1
                print(f"  ✗ {chunk_id}: Exception - {str(e)[:100]}")
                update_chunk_status(manifest, chunk_id, "failed", error=str(e)[:200])

    save_manifest(manifest)

    print(f"\n{phase_name.capitalize()} complete: {success_count} success, {fail_count} failed")
    return success_count, fail_count


def run_parallel_pipeline(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    skip_filter: bool = False,
    run_name: str = "default",
) -> None:
    """
    Run the full pipeline with parallel processing.

    Phase 1: Parallel scraping (8 concurrent)
    Phase 2: Parallel enrichment (4 concurrent)
    """
    setup_signal_handlers()
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[{datetime.now().isoformat()}] Starting PARALLEL Blaulicht Pipeline")
    print(f"  Scraper workers: {MAX_PARALLEL_SCRAPERS}")
    print(f"  Enricher workers: {MAX_PARALLEL_ENRICHERS}")
    print(f"  Pipeline run: {run_name}")

    # Load manifest
    kwargs = {}
    if start_date:
        kwargs["start_date"] = start_date
    if end_date:
        kwargs["end_date"] = end_date

    manifest = get_or_create_manifest(**kwargs)

    # Reset in-progress chunks
    reset_count = reset_in_progress_chunks(manifest)
    if reset_count > 0:
        print(f"Reset {reset_count} in_progress chunks")
        save_manifest(manifest)

    print("\n" + get_progress_summary(manifest))

    # Get pending chunks
    pending_chunks = [
        {"id": chunk_id, **chunk}
        for chunk_id, chunk in manifest["chunks"].items()
        if chunk["status"] == "pending"
    ]

    if not pending_chunks:
        print("\nNo pending chunks. Pipeline complete!")
        return

    start_time = time.time()

    # Phase 1: Parallel scraping
    if not _shutdown_requested:
        # Mark all as in_progress
        for chunk in pending_chunks:
            update_chunk_status(manifest, chunk["id"], "in_progress")
        save_manifest(manifest)

        scrape_success, scrape_fail = run_parallel_phase(
            pending_chunks,
            "scrape",
            run_scraper_sync,
            MAX_PARALLEL_SCRAPERS,
            manifest,
        )

    # Phase 2: Filter (junk removal + incident grouping)
    if not _shutdown_requested and not skip_filter:
        to_filter = [
            {"id": chunk_id, **chunk}
            for chunk_id, chunk in manifest["chunks"].items()
            if chunk["status"] == "in_progress" and chunk.get("articles_count", 0) > 0
        ]

        if to_filter:
            filter_success, filter_fail = run_parallel_phase(
                to_filter,
                "filter",
                run_filter_sync,
                MAX_PARALLEL_SCRAPERS,  # Filters are fast, use same concurrency
                manifest,
            )

    # Phase 3: Parallel enrichment (only for successfully scraped)
    if not _shutdown_requested:
        # Get chunks that were scraped but not yet enriched
        to_enrich = [
            {"id": chunk_id, **chunk}
            for chunk_id, chunk in manifest["chunks"].items()
            if chunk["status"] == "in_progress" and chunk.get("articles_count", 0) > 0
        ]

        if to_enrich:
            enrich_success, enrich_fail = run_parallel_phase(
                to_enrich,
                "enrich",
                run_enricher_sync,
                MAX_PARALLEL_ENRICHERS,
                manifest,
            )

    elapsed = time.time() - start_time

    # Final summary
    print(f"\n{'='*60}")
    print(f"[{datetime.now().isoformat()}] Pipeline {'stopped' if _shutdown_requested else 'completed'}")
    print(f"Elapsed time: {elapsed/60:.1f} minutes")
    print(get_progress_summary(manifest))


def run_scrape_only(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> None:
    """Run only the scraping phase (fast, no LLM calls)."""
    setup_signal_handlers()
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[{datetime.now().isoformat()}] Starting SCRAPE-ONLY phase")

    kwargs = {}
    if start_date:
        kwargs["start_date"] = start_date
    if end_date:
        kwargs["end_date"] = end_date

    manifest = get_or_create_manifest(**kwargs)
    reset_in_progress_chunks(manifest)
    save_manifest(manifest)

    # Get chunks that need scraping
    to_scrape = [
        {"id": chunk_id, **chunk}
        for chunk_id, chunk in manifest["chunks"].items()
        if chunk["status"] == "pending" or (
            chunk["status"] == "in_progress" and not chunk.get("articles_count")
        )
    ]

    if not to_scrape:
        print("No chunks need scraping.")
        return

    print(f"Scraping {len(to_scrape)} chunks with {MAX_PARALLEL_SCRAPERS} workers...")

    start_time = time.time()

    run_parallel_phase(
        to_scrape,
        "scrape",
        run_scraper_sync,
        MAX_PARALLEL_SCRAPERS,
        manifest,
    )

    elapsed = time.time() - start_time
    print(f"\nScraping complete in {elapsed/60:.1f} minutes")
    print(get_progress_summary(manifest))


def run_enrich_only() -> None:
    """Run only the enrichment phase on already-scraped data."""
    setup_signal_handlers()

    print(f"[{datetime.now().isoformat()}] Starting ENRICH-ONLY phase")

    manifest = get_or_create_manifest()

    # Get chunks that are scraped but not enriched
    to_enrich = [
        {"id": chunk_id, **chunk}
        for chunk_id, chunk in manifest["chunks"].items()
        if chunk["status"] == "in_progress" and chunk.get("articles_count", 0) > 0
    ]

    if not to_enrich:
        print("No chunks need enrichment.")
        return

    print(f"Enriching {len(to_enrich)} chunks with {MAX_PARALLEL_ENRICHERS} workers...")

    start_time = time.time()

    run_parallel_phase(
        to_enrich,
        "enrich",
        run_enricher_sync,
        MAX_PARALLEL_ENRICHERS,
        manifest,
    )

    elapsed = time.time() - start_time
    print(f"\nEnrichment complete in {elapsed/60:.1f} minutes")
    print(get_progress_summary(manifest))
