#!/usr/bin/env python3
"""
Async parallel enrichment for Blaulicht articles.

Uses AsyncOpenAI + asyncio.Semaphore for high-concurrency LLM calls.
Replaces the synchronous fast_enricher.py for bulk backfill scenarios.

No geocoding — always deferred to post_geocode.py.

Usage:
    # Single file
    python3 scripts/pipeline/async_enricher.py \
        --input data/pipeline/chunks/raw/hessen/2025-01-01_2025-12-31.json \
        --output data/pipeline/chunks/enriched/hessen/2025-01-01_2025-12-31.json \
        --concurrency 30

    # Batch mode (all files in directory tree)
    python3 scripts/pipeline/async_enricher.py \
        --input-dir data/pipeline/chunks/raw/ \
        --output-dir data/pipeline/chunks/enriched/ \
        --concurrency 30
"""

import asyncio
import hashlib
import json
import os
import re
import signal
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import certifi
from dotenv import load_dotenv
from openai import AsyncOpenAI, RateLimitError, APIError, APITimeoutError, APIConnectionError

# Load .env
load_dotenv()

# Fix SSL on macOS
os.environ["SSL_CERT_FILE"] = certifi.where()

# Import shared constants and functions from fast_enricher
from .fast_enricher import (
    MODEL,
    OPENROUTER_BASE_URL,
    PROVIDERS,
    DEFAULT_PROVIDER,
    UNIFIED_BATCH_SIZE,
    UNIFIED_MAX_TOKENS,
    load_prompt,
)
from .config import (
    ASYNC_CONCURRENCY,
    ASYNC_BATCH_SIZE,
    ASYNC_CACHE_SAVE_INTERVAL,
    ASYNC_MAX_RETRIES,
    ASYNC_RETRY_BASE_DELAY,
    ASYNC_RETRY_MAX_DELAY,
    CACHE_DIR,
)


@dataclass
class Stats:
    """Tracks enrichment progress and performance."""

    total: int = 0
    cached: int = 0
    cached_removed: int = 0
    processed: int = 0
    enriched: int = 0
    removed: int = 0
    errors: int = 0
    retries: int = 0
    llm_calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    start_time: float = field(default_factory=time.time)

    @property
    def elapsed(self) -> float:
        return time.time() - self.start_time

    @property
    def articles_per_min(self) -> float:
        if self.elapsed < 1:
            return 0
        return (self.processed * 60) / self.elapsed

    @property
    def eta_minutes(self) -> float:
        remaining = self.total - self.cached - self.cached_removed - self.processed
        if self.articles_per_min < 1:
            return float("inf")
        return remaining / self.articles_per_min

    @property
    def estimated_cost(self) -> float:
        """Estimated cost in USD (grok-4-fast pricing, approximate)."""
        # Rough average — actual price depends on provider/model
        return (self.prompt_tokens * 0.27 + self.completion_tokens * 1.10) / 1_000_000

    def progress_line(self) -> str:
        remaining = self.total - self.cached - self.cached_removed - self.processed
        eta = f"{self.eta_minutes:.1f}min" if self.eta_minutes < 1000 else "?"
        return (
            f"  [{self.processed}/{self.total - self.cached - self.cached_removed} uncached] "
            f"{self.articles_per_min:.0f} art/min | "
            f"ETA {eta} | "
            f"${self.estimated_cost:.3f} | "
            f"{self.retries} retries, {self.errors} errors"
        )


class AsyncFastEnricher:
    """Async parallel article enricher using AsyncOpenAI."""

    def __init__(
        self,
        cache_dir: str = ".cache",
        concurrency: int = ASYNC_CONCURRENCY,
        batch_size: int = ASYNC_BATCH_SIZE,
        model: str = None,
        prompt_version: str = None,
        provider: str = None,
    ):
        # Load prompt config first — it may supply model/provider defaults
        self.prompt_config = load_prompt(version=prompt_version)

        # CLI overrides > prompt config > provider defaults
        effective_provider = provider or self.prompt_config.get("provider", DEFAULT_PROVIDER)
        prov = PROVIDERS[effective_provider]
        api_key = os.environ.get(prov["api_key_env"])
        if not api_key:
            raise ValueError(f"{prov['api_key_env']} required")

        self.client = AsyncOpenAI(
            base_url=prov["base_url"],
            api_key=api_key,
        )
        self.model = model or self.prompt_config.get("model") or prov["default_model"]
        self.max_output_tokens = self.prompt_config.get("max_tokens") or prov.get("max_output_tokens", UNIFIED_MAX_TOKENS)
        self.batch_size = batch_size or prov.get("batch_size", ASYNC_BATCH_SIZE)
        self.prompt_version = prompt_version

        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / "enrichment_cache.json"
        self.cache = self._load_cache(self.cache_file)

        self._semaphore = asyncio.Semaphore(concurrency)
        self._cache_lock = asyncio.Lock()
        self._save_counter = 0
        self._shutdown = False

        self.stats = Stats()

    def _load_cache(self, path: Path) -> dict:
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_cache_sync(self) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        with open(self.cache_file, "w", encoding="utf-8") as f:
            json.dump(self.cache, f, ensure_ascii=False)

    async def _save_cache_async(self) -> None:
        """Non-blocking cache save via thread pool."""
        # Snapshot the cache dict under lock, then write in thread
        async with self._cache_lock:
            snapshot = dict(self.cache)
        await asyncio.to_thread(self._write_cache_snapshot, snapshot)

    def _write_cache_snapshot(self, snapshot: dict) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.cache_file.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False)
        tmp.rename(self.cache_file)

    @staticmethod
    def _cache_key(url: str, body: str) -> str:
        return hashlib.sha256(f"{url}:{body}".encode()).hexdigest()[:16]

    async def _call_llm(self, prompt: str, max_tokens: int, batch_size: int) -> list[dict]:
        """Call LLM with semaphore-controlled concurrency and retry logic."""
        last_error = None

        for attempt in range(ASYNC_MAX_RETRIES):
            if self._shutdown:
                return []

            async with self._semaphore:
                try:
                    start_time = time.time()
                    response = await self.client.chat.completions.create(
                        model=self.model,
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.1,
                        max_tokens=max_tokens,
                    )
                    latency_ms = int((time.time() - start_time) * 1000)
                    text = response.choices[0].message.content

                    # Track token usage
                    if response.usage:
                        self.stats.prompt_tokens += response.usage.prompt_tokens
                        self.stats.completion_tokens += response.usage.completion_tokens

                    self.stats.llm_calls += 1

                    # Log token usage to file (non-blocking)
                    if response.usage:
                        entry = {
                            "timestamp": time.time(),
                            "model": self.model,
                            "prompt_tokens": response.usage.prompt_tokens,
                            "completion_tokens": response.usage.completion_tokens,
                            "total_tokens": response.usage.total_tokens,
                            "batch_size": batch_size,
                            "latency_ms": latency_ms,
                        }
                        asyncio.create_task(self._log_usage(entry))

                    # Parse JSON response
                    text = text.strip()
                    if "```json" in text:
                        text = text.split("```json", 1)[1]
                    if "```" in text:
                        text = text.split("```")[0]

                    match = re.search(r"\[[\s\S]*\]", text)
                    if match:
                        return json.loads(match.group())
                    return []

                except RateLimitError as e:
                    last_error = e
                    self.stats.retries += 1
                    # Exponential backoff with jitter
                    import random
                    delay = min(
                        ASYNC_RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 1),
                        ASYNC_RETRY_MAX_DELAY,
                    )
                    if attempt == 0:
                        print(f"    Rate limited, backing off {delay:.1f}s...")
                    await asyncio.sleep(delay)

                except (APITimeoutError, APIConnectionError) as e:
                    last_error = e
                    self.stats.retries += 1
                    import random
                    delay = min(
                        ASYNC_RETRY_BASE_DELAY * (2 ** attempt) + random.uniform(0, 1),
                        ASYNC_RETRY_MAX_DELAY,
                    )
                    await asyncio.sleep(delay)

                except APIError as e:
                    # Non-retryable API errors
                    self.stats.errors += 1
                    print(f"    LLM API error: {e}")
                    return []

                except Exception as e:
                    self.stats.errors += 1
                    print(f"    LLM error: {e}")
                    return []

        # All retries exhausted
        self.stats.errors += 1
        print(f"    LLM failed after {ASYNC_MAX_RETRIES} retries: {last_error}")
        return []

    async def _log_usage(self, entry: dict) -> None:
        """Log token usage to JSONL file (fire-and-forget)."""
        try:
            usage_path = self.cache_dir / "token_usage.jsonl"
            line = json.dumps(entry) + "\n"
            await asyncio.to_thread(self._append_line, usage_path, line)
        except Exception:
            pass  # Non-critical

    @staticmethod
    def _append_line(path: Path, line: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a") as f:
            f.write(line)

    async def _enrich_batch(self, batch: list[dict]) -> list[dict]:
        """Enrich a single batch of articles via LLM."""
        articles_data = []
        for i, art in enumerate(batch):
            articles_data.append({
                "index": i,
                "title": art.get("title", "")[:200],
                "body": art.get("body", ""),
                "date": art.get("date", ""),
                "city": art.get("city", ""),
                "source": art.get("source", ""),
            })

        prompt = self.prompt_config["template"].format(
            count=len(batch),
            articles_json=json.dumps(articles_data, ensure_ascii=False, indent=2),
        )

        return await self._call_llm(prompt, max_tokens=self.max_output_tokens, batch_size=len(batch))

    def _process_llm_results(
        self, batch: list[dict], llm_results: list[dict]
    ) -> tuple[dict[int, list[dict]], dict[int, dict]]:
        """Process LLM results into enriched records and removed records.

        Returns: (results_by_batch_idx, removed_by_batch_idx)
        """
        results: dict[int, list[dict]] = {}
        removed: dict[int, dict] = {}

        # Group by article_index
        incidents_by_idx: dict[int, list[dict]] = {}
        for llm_result in llm_results:
            idx = llm_result.get("article_index", -1)
            if 0 <= idx < len(batch):
                incidents_by_idx.setdefault(idx, []).append(llm_result)

        for idx, incidents in incidents_by_idx.items():
            art = batch[idx]
            first = incidents[0]
            classification = first.get("classification", "crime")

            if classification in ("junk", "feuerwehr"):
                removed[idx] = {
                    **art,
                    "_removal_reason": f"llm:{classification}",
                    "_triage_reason": first.get("reason", ""),
                }
                continue

            if classification == "update" and not first.get("location") and not first.get("crime"):
                removed[idx] = {
                    **art,
                    "_removal_reason": "llm:update",
                    "_triage_reason": first.get("reason", ""),
                }
                continue

            # Crime or update-with-data
            enrichments = []
            for llm_result in incidents:
                loc = llm_result.get("location") or {}
                is_update = llm_result.get("is_update", False) or classification == "update"
                enrichment = {
                    "clean_title": llm_result.get("clean_title"),
                    "classification": classification,
                    "location": {**loc, "lat": None, "lon": None, "precision": "none"},
                    "incident_time": llm_result.get("incident_time") or {},
                    "crime": llm_result.get("crime") or {},
                    "details": llm_result.get("details") or {},
                    "is_update": is_update,
                }
                if is_update:
                    enrichment["update_type"] = first.get("update_type", "nachtrag")
                enrichments.append(enrichment)

            results[idx] = [{**art, **e} for e in enrichments]

        return results, removed

    async def _process_single_batch(
        self, batch: list[dict], batch_num: int, total_batches: int
    ) -> tuple[list[dict], list[dict], list[dict]]:
        """Process one batch: call LLM, parse results, update cache.

        Returns: (enriched_records, removed_records, cache_entries_to_write)
        """
        if self._shutdown:
            return [], [], []

        llm_results = await self._enrich_batch(batch)
        results_by_idx, removed_by_idx = self._process_llm_results(batch, llm_results)

        enriched = []
        removed = []

        # Update cache and collect results
        async with self._cache_lock:
            for idx in range(len(batch)):
                art = batch[idx]
                key = self._cache_key(art.get("url", ""), art.get("body", ""))

                if idx in removed_by_idx:
                    classification = removed_by_idx[idx]["_removal_reason"].split(":")[1]
                    reason = removed_by_idx[idx].get("_triage_reason", "")
                    self.cache[key] = [{"_classification": classification, "reason": reason}]
                    removed.append(removed_by_idx[idx])
                    self.stats.removed += 1
                elif idx in results_by_idx:
                    # Store enrichment data (without original article fields) in cache
                    cache_entries = []
                    for record in results_by_idx[idx]:
                        cache_entry = {
                            k: v for k, v in record.items()
                            if k not in ("title", "body", "date", "city", "url", "source",
                                         "bundesland", "source_url", "scraped_at")
                        }
                        cache_entries.append(cache_entry)
                    self.cache[key] = cache_entries
                    enriched.extend(results_by_idx[idx])
                    self.stats.enriched += len(results_by_idx[idx])

            self.stats.processed += len(batch)
            self._save_counter += len(batch)

        # Periodic cache save
        if self._save_counter >= ASYNC_CACHE_SAVE_INTERVAL:
            self._save_counter = 0
            await self._save_cache_async()

        return enriched, removed, []

    async def enrich_all(self, articles: list[dict]) -> tuple[list[dict], list[dict]]:
        """Enrich all articles with async concurrent LLM calls.

        Returns: (enriched_records, removed_records)
        """
        self.stats = Stats(total=len(articles))

        print(f"\n{'='*60}")
        print(f"Async parallel enrichment: {len(articles)} articles")
        print(f"  Concurrency: {self._semaphore._value}, Batch size: {self.batch_size}")
        print(f"  Model: {self.model}")
        print(f"  Cache: {len(self.cache)} entries")
        print(f"{'='*60}")

        if not articles:
            return [], []

        # Separate cached vs uncached
        uncached = []
        all_enriched = []
        all_removed = []

        for art in articles:
            key = self._cache_key(art.get("url", ""), art.get("body", ""))
            if key in self.cache:
                cached = self.cache[key]
                entries = cached if isinstance(cached, list) else [cached]

                if len(entries) == 1 and entries[0].get("_classification"):
                    cls = entries[0]["_classification"]
                    all_removed.append({
                        **art,
                        "_removal_reason": f"llm:{cls}",
                        "_triage_reason": entries[0].get("reason", ""),
                    })
                    self.stats.cached_removed += 1
                else:
                    all_enriched.extend([{**art, **e} for e in entries])
                    self.stats.cached += 1
            else:
                uncached.append(art)

        print(f"  Cached: {self.stats.cached} enriched, {self.stats.cached_removed} removed")
        print(f"  Uncached: {len(uncached)} to process")

        if not uncached:
            print("  All articles cached — nothing to do!")
            return all_enriched, all_removed

        # Batch uncached articles
        batches = [
            uncached[i : i + self.batch_size]
            for i in range(0, len(uncached), self.batch_size)
        ]
        total_batches = len(batches)
        print(f"  Batches: {total_batches} ({self.batch_size} articles each)")
        print()

        # Fire all batches as async tasks
        tasks = [
            asyncio.create_task(
                self._process_single_batch(batch, i + 1, total_batches)
            )
            for i, batch in enumerate(batches)
        ]

        # Collect results with progress reporting
        last_report = time.time()
        report_interval = 5.0  # seconds

        for coro in asyncio.as_completed(tasks):
            try:
                enriched, removed, _ = await coro
                all_enriched.extend(enriched)
                all_removed.extend(removed)
            except Exception as e:
                self.stats.errors += 1
                print(f"    Batch error: {e}")

            # Progress report every N seconds
            now = time.time()
            if now - last_report >= report_interval:
                print(self.stats.progress_line(), flush=True)
                last_report = now

        # Final progress
        print(self.stats.progress_line(), flush=True)

        # Assign group IDs (solo, no clustering)
        for art in all_enriched:
            if not art.get("incident_group_id"):
                art["incident_group_id"] = uuid.uuid4().hex[:12]
                art["group_role"] = "primary"

        # Final stats
        print(f"\n{'='*60}")
        print(f"Enrichment complete in {self.stats.elapsed:.1f}s")
        print(f"  Enriched: {len(all_enriched)} records")
        print(f"  Removed: {len(all_removed)} articles")
        print(f"  LLM calls: {self.stats.llm_calls}")
        print(f"  Cost: ${self.stats.estimated_cost:.3f}")
        print(f"  Throughput: {self.stats.articles_per_min:.0f} articles/min")
        print(f"  Retries: {self.stats.retries}, Errors: {self.stats.errors}")
        print(f"{'='*60}\n")

        return all_enriched, all_removed

    async def save_cache(self) -> None:
        await self._save_cache_async()

    def save_cache_sync(self) -> None:
        self._save_cache_sync()


async def _run_single_file(
    input_path: Path,
    output_path: Path,
    concurrency: int,
    batch_size: int,
    cache_dir: str,
    prompt_version: str = None,
    model: str = None,
    no_prefilter: bool = False,
    provider: str = None,
) -> tuple[int, int]:
    """Enrich a single input file. Returns (enriched_count, removed_count)."""
    # Load articles
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        articles = data
    else:
        articles = data.get("articles", [])

    if not articles:
        print(f"No articles in {input_path}")
        return 0, 0

    print(f"\nLoaded {len(articles)} articles from {input_path}")

    # Optional regex pre-filter
    prefilter_removed = []
    if not no_prefilter:
        from .filter_articles import is_junk_article

        kept = []
        for art in articles:
            reason = is_junk_article(art)
            if reason:
                prefilter_removed.append({**art, "_removal_reason": f"prefilter:{reason}"})
            else:
                kept.append(art)
        if prefilter_removed:
            print(f"Pre-filter: removed {len(prefilter_removed)}, kept {len(kept)}")
        articles = kept

    # Enrich
    enricher = AsyncFastEnricher(
        cache_dir=cache_dir,
        concurrency=concurrency,
        batch_size=batch_size,
        model=model,
        prompt_version=prompt_version,
        provider=provider,
    )

    # Handle graceful shutdown
    loop = asyncio.get_running_loop()

    def _signal_shutdown():
        enricher._shutdown = True
        print("\nShutdown requested — finishing in-flight requests...")

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _signal_shutdown)

    try:
        enriched, removed = await enricher.enrich_all(articles)
    except Exception:
        enricher.save_cache_sync()
        raise

    await enricher.save_cache()

    all_removed = prefilter_removed + removed

    # Save output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_data = {"articles": enriched} if isinstance(data, dict) else enriched
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    # Save removed log
    if all_removed:
        removed_path = output_path.with_name(output_path.stem + "_removed.json")
        with open(removed_path, "w", encoding="utf-8") as f:
            json.dump(all_removed, f, ensure_ascii=False, indent=2)

    print(f"Saved {len(enriched)} enriched to {output_path}")
    return len(enriched), len(all_removed)


async def _run_directory(
    input_dir: Path,
    output_dir: Path,
    concurrency: int,
    batch_size: int,
    cache_dir: str,
    prompt_version: str = None,
    model: str = None,
    no_prefilter: bool = False,
    provider: str = None,
) -> None:
    """Enrich all JSON files in a directory tree."""
    # Find all JSON files recursively
    input_files = sorted(input_dir.rglob("*.json"))
    if not input_files:
        print(f"No JSON files found in {input_dir}")
        return

    print(f"Found {len(input_files)} JSON files in {input_dir}")

    # Load all articles from all files, tracking which file each came from
    all_articles = []
    file_ranges: list[tuple[Path, int, int]] = []  # (output_path, start_idx, end_idx)

    for input_file in input_files:
        rel = input_file.relative_to(input_dir)
        output_file = output_dir / rel

        with open(input_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        articles = data if isinstance(data, list) else data.get("articles", [])

        if not articles:
            continue

        start_idx = len(all_articles)
        all_articles.extend(articles)
        file_ranges.append((output_file, start_idx, start_idx + len(articles)))

    print(f"Total: {len(all_articles)} articles across {len(file_ranges)} files")

    # Optional pre-filter
    prefilter_removed = []
    if not no_prefilter:
        from .filter_articles import is_junk_article

        kept = []
        kept_indices = []
        for i, art in enumerate(all_articles):
            reason = is_junk_article(art)
            if reason:
                prefilter_removed.append({**art, "_removal_reason": f"prefilter:{reason}"})
            else:
                kept.append(art)
                kept_indices.append(i)
        if prefilter_removed:
            print(f"Pre-filter: removed {len(prefilter_removed)}, kept {len(kept)}")
        all_articles = kept

    # Enrich all at once (single enricher, single cache)
    enricher = AsyncFastEnricher(
        cache_dir=cache_dir,
        concurrency=concurrency,
        batch_size=batch_size,
        model=model,
        prompt_version=prompt_version,
        provider=provider,
    )

    loop = asyncio.get_running_loop()

    def _signal_shutdown():
        enricher._shutdown = True
        print("\nShutdown requested — finishing in-flight requests...")

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _signal_shutdown)

    try:
        enriched, removed = await enricher.enrich_all(all_articles)
    except Exception:
        enricher.save_cache_sync()
        raise

    await enricher.save_cache()

    # Split results back into per-file outputs based on source URL matching
    # Build a lookup from (url, body_hash) to enriched records
    enriched_by_url: dict[str, list[dict]] = {}
    for rec in enriched:
        url = rec.get("url", "")
        enriched_by_url.setdefault(url, []).append(rec)

    for output_file, start_idx, end_idx in file_ranges:
        # Reconstruct which articles were in this file
        file_enriched = []
        orig_range = range(start_idx, end_idx)
        for idx in orig_range:
            if idx < len(all_articles):  # Could be out of bounds after prefilter
                art = all_articles[idx] if not no_prefilter else all_articles[idx]
                url = art.get("url", "")
                if url in enriched_by_url:
                    file_enriched.extend(enriched_by_url.pop(url, []))

        if file_enriched:
            output_file.parent.mkdir(parents=True, exist_ok=True)
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(file_enriched, f, ensure_ascii=False, indent=2)
            print(f"  Saved {len(file_enriched)} to {output_file}")

    total_enriched = len(enriched)
    total_removed = len(prefilter_removed) + len(removed)
    print(f"\nBatch complete: {total_enriched} enriched, {total_removed} removed")


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Async parallel article enrichment",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # Input/output modes
    file_group = parser.add_argument_group("Single file mode")
    file_group.add_argument("--input", "-i", help="Input JSON file")
    file_group.add_argument("--output", "-o", help="Output JSON file")

    dir_group = parser.add_argument_group("Directory mode")
    dir_group.add_argument("--input-dir", help="Input directory with JSON files")
    dir_group.add_argument("--output-dir", help="Output directory for enriched files")

    # Tuning
    parser.add_argument(
        "--concurrency", "-c", type=int, default=ASYNC_CONCURRENCY,
        help=f"Max concurrent LLM requests (default: {ASYNC_CONCURRENCY})",
    )
    parser.add_argument(
        "--batch-size", "-b", type=int, default=ASYNC_BATCH_SIZE,
        help=f"Articles per LLM call (default: {ASYNC_BATCH_SIZE})",
    )

    # Options
    parser.add_argument("--cache-dir", default=".cache", help="Cache directory")
    parser.add_argument("--prompt-version", default=None, help="Override prompt version")
    parser.add_argument("--model", default=None, help="Override LLM model")
    parser.add_argument("--provider", default=None, choices=list(PROVIDERS.keys()),
                        help="LLM provider (default: openrouter)")
    parser.add_argument("--no-prefilter", action="store_true", help="Skip regex pre-filter")

    args = parser.parse_args()

    # Validate args
    if args.input and args.input_dir:
        print("ERROR: Specify either --input or --input-dir, not both")
        sys.exit(1)

    if not args.input and not args.input_dir:
        print("ERROR: Specify --input (single file) or --input-dir (batch)")
        sys.exit(1)

    if args.input:
        if not args.output:
            print("ERROR: --output required with --input")
            sys.exit(1)
        asyncio.run(
            _run_single_file(
                input_path=Path(args.input),
                output_path=Path(args.output),
                concurrency=args.concurrency,
                batch_size=args.batch_size,
                cache_dir=args.cache_dir,
                prompt_version=args.prompt_version,
                model=args.model,
                no_prefilter=args.no_prefilter,
                provider=args.provider,
            )
        )
    else:
        if not args.output_dir:
            print("ERROR: --output-dir required with --input-dir")
            sys.exit(1)
        asyncio.run(
            _run_directory(
                input_dir=Path(args.input_dir),
                output_dir=Path(args.output_dir),
                concurrency=args.concurrency,
                batch_size=args.batch_size,
                cache_dir=args.cache_dir,
                prompt_version=args.prompt_version,
                model=args.model,
                no_prefilter=args.no_prefilter,
                provider=args.provider,
            )
        )


if __name__ == "__main__":
    main()
