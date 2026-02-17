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
    DEDICATED_SCRAPER_STATES,
    STATE_SCRAPER_SCRIPTS,
    LOG_DIR,
    DATA_DIR,
    CHUNKS_RAW_DIR,
    CHUNKS_ENRICHED_DIR,
    ASYNC_CONCURRENCY,
    ASYNC_BATCH_SIZE,
    GERMAN_MONTHS,
    chunk_raw_path,
    chunk_enriched_path,
    parse_chunk_filename,
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


def _run_single_state_scraper(
    bundesland: str,
    start_date: str,
    end_date: str,
    output_file: str,
    use_async: bool = True,
) -> tuple[bool, int, str]:
    """Run a single state scraper. Returns (success, count, error)."""
    from .config import CHUNKS_RAW_DIR

    # Route to dedicated state scraper or presseportal
    if bundesland in DEDICATED_SCRAPER_STATES:
        scraper_script = STATE_SCRAPER_SCRIPTS.get(bundesland)
        if not scraper_script or not scraper_script.exists():
            return False, 0, f"Dedicated scraper not found for {bundesland}"
        cmd = [
            sys.executable,
            str(scraper_script),
            "--start-date", start_date,
            "--end-date", end_date,
            "--output", output_file,
        ]
    else:
        scraper_script = ASYNC_SCRAPER_SCRIPT if use_async else SCRAPER_SCRIPT
        cmd = [
            sys.executable,
            str(scraper_script),
            "--bundesland", bundesland,
            "--start-date", start_date,
            "--end-date", end_date,
            "--output", output_file,
        ]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=1800,
        )
        if result.returncode != 0:
            return False, 0, (result.stderr.strip()[:200] or "Unknown error")

        out = Path(output_file)
        if out.exists():
            with open(out, "r", encoding="utf-8") as f:
                data = json.load(f)
                count = len(data) if isinstance(data, list) else len(data.get("articles", []))
            return True, count, ""
        return False, 0, "Output file not found"
    except subprocess.TimeoutExpired:
        return False, 0, "Timeout"
    except Exception as e:
        return False, 0, str(e)[:200]


def run_scraper_sync(chunk: dict, use_async: bool = True) -> tuple[str, bool, Optional[int], Optional[str]]:
    """
    Run scraper for a single monthly chunk across all Bundesländer.

    Each chunk covers one month. This function iterates through all 16 states,
    routing each to either the presseportal scraper or a dedicated state scraper,
    and writes per-state raw files under chunks/raw/{bundesland}/{year-month}.json.
    Returns: (chunk_id, success, total_article_count, error)
    """
    from .config import CHUNKS_RAW_DIR

    chunk_id = chunk["id"]

    if _shutdown_requested:
        return chunk_id, False, None, "Shutdown requested"

    ensure_chunk_dirs(chunk)

    total_articles = 0
    failed_states = []

    for bundesland in BUNDESLAENDER:
        if _shutdown_requested:
            break

        # Per-state output file: chunks/raw/{bundesland}/{year}/{MM}.json
        state_file = str(chunk_raw_path(bundesland, chunk['year_month']))

        # Skip if already exists with data
        sf = Path(state_file)
        if sf.exists() and sf.stat().st_size > 10:
            try:
                with open(sf, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    count = len(data) if isinstance(data, list) else len(data.get("articles", []))
                total_articles += count
                continue
            except (json.JSONDecodeError, IOError):
                pass  # Re-scrape if corrupt

        success, count, error = _run_single_state_scraper(
            bundesland, chunk["start_date"], chunk["end_date"], state_file, use_async,
        )

        if success:
            total_articles += count
        else:
            failed_states.append(f"{bundesland}: {error}")

    if failed_states and len(failed_states) == len(BUNDESLAENDER):
        return chunk_id, False, None, f"All states failed: {failed_states[0]}"

    if failed_states:
        print(f"  Warning: {len(failed_states)} states failed for {chunk_id}")

    return chunk_id, True, total_articles, None


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
        "--no-geocode",  # Geocoding is intentionally run as a manual follow-up step
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
    print(f"  Enricher: turbo (async, {ASYNC_CONCURRENCY} concurrent LLM calls)")
    print("  Geocoding: deferred (run scripts/pipeline/post_geocode.py manually)")
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

    # Phase 3: Turbo enrichment (async, 30 concurrent LLM calls)
    if not _shutdown_requested:
        has_enrichable = any(
            chunk["status"] == "in_progress" and chunk.get("articles_count", 0) > 0
            for chunk in manifest["chunks"].values()
        )
        if has_enrichable:
            asyncio.run(_run_turbo_phase(manifest, ASYNC_CONCURRENCY, ASYNC_BATCH_SIZE))

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
    """Run only the enrichment phase on already-scraped data (uses turbo)."""
    setup_signal_handlers()

    print(f"[{datetime.now().isoformat()}] Starting ENRICH-ONLY phase (turbo)")

    manifest = get_or_create_manifest()

    has_enrichable = any(
        chunk["status"] == "in_progress" and chunk.get("articles_count", 0) > 0
        for chunk in manifest["chunks"].values()
    )

    if not has_enrichable:
        print("No chunks need enrichment.")
        return

    start_time = time.time()

    asyncio.run(_run_turbo_phase(manifest, ASYNC_CONCURRENCY, ASYNC_BATCH_SIZE))

    elapsed = time.time() - start_time
    print(f"\nEnrichment complete in {elapsed/60:.1f} minutes")
    print(get_progress_summary(manifest))


async def _run_turbo_phase(
    manifest: dict,
    concurrency: int = ASYNC_CONCURRENCY,
    batch_size: int = ASYNC_BATCH_SIZE,
    model: str = None,
    prompt_version: str = None,
    provider: str = None,
) -> None:
    """Run turbo (async) enrichment on all in-progress manifest chunks.

    Loads all articles from raw/filtered chunk files, enriches them via
    AsyncFastEnricher with high concurrency, then splits results back
    into per-chunk enriched files and updates the manifest.

    Used by both `run_parallel_pipeline()` Phase 3 and `run_turbo_enrich()` Mode 3.
    """
    from .async_enricher import AsyncFastEnricher

    to_enrich = [
        (chunk_id, chunk)
        for chunk_id, chunk in manifest["chunks"].items()
        if chunk["status"] == "in_progress" and chunk.get("articles_count", 0) > 0
    ]

    if not to_enrich:
        print("No chunks need enrichment.")
        return

    print(f"\n{'='*60}")
    print(f"[{datetime.now().isoformat()}] Starting turbo enrichment phase")
    print(f"  Concurrency: {concurrency}, Batch size: {batch_size}")
    print(f"  Chunks to enrich: {len(to_enrich)}")
    print(f"{'='*60}")

    # Load all articles from raw chunk files
    all_articles = []
    chunk_article_ranges: list[tuple[str, dict, int, int]] = []

    for chunk_id, chunk in to_enrich:
        # Use filtered file if available, otherwise raw
        input_file = chunk.get("filtered_file") or chunk.get("raw_file")
        if not input_file or not Path(input_file).exists():
            # Try per-state raw files: {bundesland}_{german_month}_{year}.json
            ym = chunk.get('year_month', '')
            if '-' in ym:
                ym_year, ym_month = ym.split('-')
                german_month = GERMAN_MONTHS.get(ym_month, '')
                raw_files = sorted(CHUNKS_RAW_DIR.glob(f"*_{german_month}_{ym_year}.json")) if german_month else []
            else:
                raw_files = []
            if not raw_files:
                print(f"  Skipping {chunk_id}: no input files found")
                continue
            articles = []
            for rf in raw_files:
                with open(rf, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    arts = data if isinstance(data, list) else data.get("articles", [])
                    articles.extend(arts)
        else:
            with open(input_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                articles = data if isinstance(data, list) else data.get("articles", [])

        if not articles:
            continue

        start_idx = len(all_articles)
        all_articles.extend(articles)
        chunk_article_ranges.append((chunk_id, chunk, start_idx, start_idx + len(articles)))

    print(f"  Total articles loaded: {len(all_articles)}")

    if not all_articles:
        print("No articles to enrich.")
        return

    # Enrich all articles in one shot
    enricher = AsyncFastEnricher(
        cache_dir=".cache",
        concurrency=concurrency,
        batch_size=batch_size,
        model=model,
        prompt_version=prompt_version,
        provider=provider,
    )

    import signal as sig

    loop = asyncio.get_running_loop()

    def _signal_shutdown():
        enricher._shutdown = True
        print("\nShutdown requested — finishing in-flight requests...")

    for s in (sig.SIGINT, sig.SIGTERM):
        loop.add_signal_handler(s, _signal_shutdown)

    try:
        enriched, removed = await enricher.enrich_all(all_articles)
    except Exception:
        enricher.save_cache_sync()
        raise

    await enricher.save_cache()

    # Build URL-based lookup for splitting results back into chunks
    enriched_by_url: dict[str, list[dict]] = {}
    for rec in enriched:
        url = rec.get("url", "")
        enriched_by_url.setdefault(url, []).append(rec)

    # Split results back into per-chunk output files
    for chunk_id, chunk, start_idx, end_idx in chunk_article_ranges:
        chunk_enriched = []
        for idx in range(start_idx, end_idx):
            art = all_articles[idx]
            url = art.get("url", "")
            if url in enriched_by_url:
                chunk_enriched.extend(enriched_by_url.pop(url, []))

        enriched_file = chunk.get("enriched_file")
        if not enriched_file:
            bl = chunk.get("bundesland", "unknown")
            ym = chunk.get("year_month", chunk_id)
            enriched_file = str(chunk_enriched_path(bl, ym))

        if chunk_enriched:
            Path(enriched_file).parent.mkdir(parents=True, exist_ok=True)
            with open(enriched_file, "w", encoding="utf-8") as f:
                json.dump(chunk_enriched, f, ensure_ascii=False, indent=2)

        update_chunk_status(manifest, chunk_id, "completed", enriched_count=len(chunk_enriched))

    save_manifest(manifest)
    print(f"\nTurbo enrichment complete. {len(enriched)} records across {len(chunk_article_ranges)} chunks.")


async def run_turbo_enrich(
    concurrency: int = ASYNC_CONCURRENCY,
    batch_size: int = ASYNC_BATCH_SIZE,
    input_path: str = None,
    output_path: str = None,
    input_dir: str = None,
    output_dir: str = None,
    prompt_version: str = None,
    model: str = None,
    run_name: str = "default",
    provider: str = None,
) -> None:
    """Run async parallel enrichment — single process, many concurrent LLM calls.

    Modes:
      1. Single file: --input + --output
      2. Directory:   --input-dir + --output-dir
      3. Manifest:    no input args → reads manifest, processes all pending chunks
    """
    from .async_enricher import AsyncFastEnricher, _run_single_file, _run_directory

    print(f"[{datetime.now().isoformat()}] Starting TURBO enrichment")
    print(f"  Concurrency: {concurrency}, Batch size: {batch_size}")
    print(f"  Pipeline run: {run_name}")

    # Mode 1: Single file
    if input_path:
        if not output_path:
            print("ERROR: --output required with --input")
            return
        await _run_single_file(
            input_path=Path(input_path),
            output_path=Path(output_path),
            concurrency=concurrency,
            batch_size=batch_size,
            cache_dir=".cache",
            prompt_version=prompt_version,
            model=model,
            provider=provider,
        )
        return

    # Mode 2: Directory
    if input_dir:
        if not output_dir:
            print("ERROR: --output-dir required with --input-dir")
            return
        await _run_directory(
            input_dir=Path(input_dir),
            output_dir=Path(output_dir),
            concurrency=concurrency,
            batch_size=batch_size,
            cache_dir=".cache",
            prompt_version=prompt_version,
            model=model,
            provider=provider,
        )
        return

    # Mode 3: Manifest-driven — delegates to shared _run_turbo_phase
    manifest = get_or_create_manifest()
    await _run_turbo_phase(manifest, concurrency, batch_size, model, prompt_version, provider)
