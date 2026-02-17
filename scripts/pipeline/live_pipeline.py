#!/usr/bin/env python3
"""
Live Pipeline — automated scrape → enrich → push cycle.

Polls all 16 state sources, processes new articles, and pushes to Supabase.
Designed to run every 15 minutes via GitHub Actions or as a daemon on a VPS.

Usage:
    python -m scripts.pipeline.live_pipeline --mode once          # Single cycle
    python -m scripts.pipeline.live_pipeline --mode daemon        # Loop forever
    python -m scripts.pipeline.live_pipeline --mode once --source berlin --dry-run
"""

import asyncio
import fcntl
import json
import os
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

import certifi
os.environ["SSL_CERT_FILE"] = certifi.where()

from dotenv import load_dotenv
load_dotenv()
load_dotenv(Path(".env.local"), override=True)

from .config import (
    BUNDESLAENDER,
    DEDICATED_SCRAPER_STATES,
    PRESSEPORTAL_STATES,
    CACHE_DIR,
    PROJECT_ROOT,
)
from .poll_state import PollState
from .filter_articles import is_junk_article
from .push_to_supabase import transform_article

# Live pipeline constants
LIVE_POLL_INTERVAL_MINUTES = 15
LIVE_MAX_ARTICLES_PER_SOURCE = 50
LIVE_CONCURRENT_REQUESTS = 5
LIVE_PIPELINE_RUN_NAME = "v1_2026"
PUSH_QUEUE_FILE = CACHE_DIR / "push_queue.json"
LOCK_FILE = CACHE_DIR / "live_pipeline.lock"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _yesterday_iso() -> str:
    return (_now_utc() - timedelta(days=1)).strftime("%Y-%m-%d")


def _today_iso() -> str:
    return _now_utc().strftime("%Y-%m-%d")


class LivePipeline:
    """Orchestrates a single poll cycle across all sources."""

    def __init__(self, dry_run: bool = False, source_filter: str | None = None,
                 cache_dir: str = ".cache"):
        self.dry_run = dry_run
        self.source_filter = source_filter
        self.cache_dir = cache_dir
        self.poll_state = PollState(cache_dir=cache_dir)
        self.enricher = None  # Lazy-init on first use
        self.supabase = None  # Lazy-init on first use

        # Cycle metrics
        self.cycle_start = None
        self.total_scraped = 0
        self.total_enriched = 0
        self.total_pushed = 0
        self.total_errors = 0
        self.source_results: list[dict] = []

    def _init_enricher(self):
        if self.enricher is not None:
            return
        from .fast_enricher import FastEnricher
        self.enricher = FastEnricher(cache_dir=self.cache_dir, no_geocode=True)

    def _init_supabase(self):
        if self.supabase is not None or self.dry_run:
            return
        from supabase import create_client
        url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
               or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY"))
        if not url or not key:
            raise ValueError("Missing Supabase credentials")
        self.supabase = create_client(url, key)

    def _get_sources(self) -> list[dict]:
        """Build list of sources to poll."""
        sources = []

        # Presseportal sources (11 states)
        for state in PRESSEPORTAL_STATES:
            if self.source_filter and self.source_filter != state:
                continue
            sources.append({
                "name": state,
                "type": "presseportal",
                "bundesland": state,
            })

        # Dedicated scraper sources (5 states)
        dedicated_map = {
            "berlin": "scripts.scrapers.scrape_berlin_polizei",
            "brandenburg": "scripts.scrapers.scrape_brandenburg_polizei",
            "bayern": "scripts.scrapers.scrape_bayern_polizei",
            "sachsen-anhalt": "scripts.scrapers.scrape_sachsen_anhalt",
            "sachsen": "scripts.scrapers.scrape_sachsen_polizei",
        }
        for state, module in dedicated_map.items():
            if self.source_filter and self.source_filter != state:
                continue
            sources.append({
                "name": state,
                "type": "dedicated",
                "module": module,
            })

        return sources

    async def _scrape_source(self, source: dict) -> list[dict]:
        """Scrape a single source and return new articles as dicts."""
        start_date = _yesterday_iso()
        end_date = _today_iso()

        if source["type"] == "presseportal":
            from scripts.scrape_blaulicht_async import scrape_new as pp_scrape
            articles = await pp_scrape(
                bundesland=source["bundesland"],
                start_date=start_date,
                end_date=end_date,
                cache_dir=self.cache_dir,
                concurrent=LIVE_CONCURRENT_REQUESTS,
            )
        else:
            import importlib
            mod = importlib.import_module(source["module"])
            articles = await mod.scrape_new(
                start_date=start_date,
                end_date=end_date,
                cache_dir=self.cache_dir,
                concurrent=LIVE_CONCURRENT_REQUESTS,
            )

        # Cap articles per source
        if len(articles) > LIVE_MAX_ARTICLES_PER_SOURCE:
            print(f"  [{source['name']}] Capping {len(articles)} → {LIVE_MAX_ARTICLES_PER_SOURCE}")
            articles = articles[:LIVE_MAX_ARTICLES_PER_SOURCE]

        return articles

    def _filter_junk(self, articles: list[dict]) -> list[dict]:
        """Remove junk articles."""
        kept = []
        for a in articles:
            reason = is_junk_article(a)
            if reason is None:
                kept.append(a)
        return kept

    def _enrich(self, articles: list[dict]) -> list[dict]:
        """Enrich articles via LLM + geocoding."""
        if not articles:
            return []
        self._init_enricher()
        enriched, _removed = self.enricher.enrich_all(articles, skip_clustering=True)
        return enriched

    def _push_to_supabase(self, rows: list[dict]) -> int:
        """Push transformed rows to Supabase. Returns count pushed."""
        if not rows or self.dry_run:
            return 0
        self._init_supabase()
        try:
            # Batch upsert in chunks of 200
            pushed = 0
            for i in range(0, len(rows), 200):
                batch = rows[i:i + 200]
                self.supabase.table("crime_records").upsert(batch).execute()
                pushed += len(batch)
            return pushed
        except Exception as e:
            print(f"  Supabase push failed: {e}")
            self._save_push_queue(rows)
            return 0

    def _save_push_queue(self, rows: list[dict]) -> None:
        """Save failed rows to push queue for next cycle."""
        queue = []
        if PUSH_QUEUE_FILE.exists():
            try:
                with open(PUSH_QUEUE_FILE, "r") as f:
                    queue = json.load(f)
            except (json.JSONDecodeError, OSError):
                pass
        queue.extend(rows)
        PUSH_QUEUE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(PUSH_QUEUE_FILE, "w") as f:
            json.dump(queue, f, default=str)
        print(f"  Saved {len(rows)} rows to push queue ({len(queue)} total pending)")

    def _drain_push_queue(self) -> int:
        """Push any queued rows from previous failed cycles."""
        if not PUSH_QUEUE_FILE.exists() or self.dry_run:
            return 0
        try:
            with open(PUSH_QUEUE_FILE, "r") as f:
                queue = json.load(f)
            if not queue:
                return 0
            self._init_supabase()
            pushed = 0
            for i in range(0, len(queue), 200):
                batch = queue[i:i + 200]
                self.supabase.table("crime_records").upsert(batch).execute()
                pushed += len(batch)
            # Clear queue on success
            PUSH_QUEUE_FILE.unlink(missing_ok=True)
            print(f"  Drained push queue: {pushed} rows")
            return pushed
        except Exception as e:
            print(f"  Failed to drain push queue: {e}")
            return 0

    async def _process_source(self, source: dict) -> dict:
        """Process a single source end-to-end. Returns metrics dict."""
        name = source["name"]
        result = {"source": name, "scraped": 0, "enriched": 0, "pushed": 0, "error": None}

        # Check backoff
        if self.poll_state.should_backoff(name):
            mult = self.poll_state.backoff_multiplier(name)
            print(f"  [{name}] Backing off (x{mult}), skipping this cycle")
            return result

        try:
            # 1. Scrape
            print(f"\n  [{name}] Scraping...")
            articles = await self._scrape_source(source)
            result["scraped"] = len(articles)
            print(f"  [{name}] Scraped {len(articles)} new articles")

            if not articles:
                self.poll_state.record_success(name, 0)
                return result

            # 2. Filter junk
            kept = self._filter_junk(articles)
            filtered_out = len(articles) - len(kept)
            if filtered_out:
                print(f"  [{name}] Filtered {filtered_out} junk articles, {len(kept)} remaining")

            if not kept:
                self.poll_state.record_success(name, 0)
                return result

            # 3. Enrich
            print(f"  [{name}] Enriching {len(kept)} articles...")
            enriched = self._enrich(kept)
            result["enriched"] = len(enriched)
            print(f"  [{name}] Enriched {len(enriched)} articles")

            # 4. Transform + push
            rows = []
            for a in enriched:
                row = transform_article(a, pipeline_run=LIVE_PIPELINE_RUN_NAME)
                if row:
                    rows.append(row)

            if rows:
                if self.dry_run:
                    print(f"  [{name}] [DRY RUN] Would push {len(rows)} records")
                    result["pushed"] = len(rows)
                else:
                    pushed = self._push_to_supabase(rows)
                    result["pushed"] = pushed
                    print(f"  [{name}] Pushed {pushed} records to Supabase")

            self.poll_state.record_success(name, result["pushed"])

        except Exception as e:
            result["error"] = str(e)
            self.poll_state.record_failure(name, str(e))
            print(f"  [{name}] ERROR: {e}")
            traceback.print_exc()
            self.total_errors += 1

        return result

    async def run_cycle(self) -> dict:
        """Run one complete poll cycle across all sources."""
        self.cycle_start = _now_utc()
        sources = self._get_sources()
        print(f"\n{'='*60}")
        print(f"Live Pipeline Cycle — {self.cycle_start.isoformat()}")
        print(f"Sources: {len(sources)} | Dry run: {self.dry_run}")
        print(f"{'='*60}")

        # Drain push queue first
        drained = self._drain_push_queue()
        if drained:
            self.total_pushed += drained

        # Process each source sequentially (to be polite to APIs)
        for source in sources:
            result = await self._process_source(source)
            self.source_results.append(result)
            self.total_scraped += result["scraped"]
            self.total_enriched += result["enriched"]
            self.total_pushed += result["pushed"]

        duration = (_now_utc() - self.cycle_start).total_seconds()
        metrics = {
            "started_at": self.cycle_start.isoformat(),
            "duration_seconds": round(duration, 1),
            "sources_polled": len(sources),
            "total_scraped": self.total_scraped,
            "total_enriched": self.total_enriched,
            "total_pushed": self.total_pushed,
            "total_errors": self.total_errors,
            "source_results": self.source_results,
        }

        print(f"\n{'='*60}")
        print(f"Cycle complete in {duration:.1f}s")
        print(f"  Scraped: {self.total_scraped} | Enriched: {self.total_enriched} | Pushed: {self.total_pushed} | Errors: {self.total_errors}")
        print(f"{'='*60}")

        # Record health metrics to Supabase
        if not self.dry_run:
            self._record_health(metrics)

        return metrics

    def _record_health(self, metrics: dict) -> None:
        """Write cycle metrics to pipeline_health table."""
        try:
            self._init_supabase()
            self.supabase.table("pipeline_health").insert({
                "started_at": metrics["started_at"],
                "duration_seconds": metrics["duration_seconds"],
                "sources_polled": metrics["sources_polled"],
                "total_scraped": metrics["total_scraped"],
                "total_enriched": metrics["total_enriched"],
                "total_pushed": metrics["total_pushed"],
                "total_errors": metrics["total_errors"],
            }).execute()
        except Exception as e:
            print(f"  Failed to record health metrics: {e}")


def acquire_lock() -> int | None:
    """Acquire file lock. Returns fd on success, None if already locked."""
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(LOCK_FILE), os.O_CREAT | os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        os.write(fd, str(os.getpid()).encode())
        os.fsync(fd)
        return fd
    except OSError:
        os.close(fd)
        return None


def release_lock(fd: int) -> None:
    """Release file lock."""
    try:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)
        LOCK_FILE.unlink(missing_ok=True)
    except OSError:
        pass


async def run_once(dry_run: bool = False, source: str | None = None,
                   cache_dir: str = ".cache") -> dict:
    """Run a single pipeline cycle."""
    pipeline = LivePipeline(dry_run=dry_run, source_filter=source, cache_dir=cache_dir)
    return await pipeline.run_cycle()


async def run_daemon(dry_run: bool = False, interval_minutes: int = LIVE_POLL_INTERVAL_MINUTES,
                     cache_dir: str = ".cache") -> None:
    """Run pipeline in a loop."""
    print(f"Starting live pipeline daemon (interval: {interval_minutes}min)")
    while True:
        try:
            pipeline = LivePipeline(dry_run=dry_run, cache_dir=cache_dir)
            await pipeline.run_cycle()
        except Exception as e:
            print(f"Cycle failed: {e}")
            traceback.print_exc()

        sleep_seconds = interval_minutes * 60
        print(f"\nSleeping {interval_minutes} minutes until next cycle...")
        await asyncio.sleep(sleep_seconds)


def show_status(cache_dir: str = ".cache") -> None:
    """Print current poll state."""
    ps = PollState(cache_dir=cache_dir)
    ps.load_from_supabase()
    print(ps.summary())


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Live Pipeline — automated scrape/enrich/push")
    parser.add_argument("--mode", choices=["once", "daemon", "status"], default="once",
                        help="Run mode (default: once)")
    parser.add_argument("--source", help="Only poll this source (e.g. 'berlin')")
    parser.add_argument("--dry-run", action="store_true", help="Scrape + enrich but don't push")
    parser.add_argument("--interval", type=int, default=LIVE_POLL_INTERVAL_MINUTES,
                        help=f"Poll interval in minutes for daemon mode (default: {LIVE_POLL_INTERVAL_MINUTES})")
    parser.add_argument("--cache-dir", default=".cache", help="Cache directory")
    args = parser.parse_args()

    if args.mode == "status":
        show_status(args.cache_dir)
        return

    # Acquire lock
    lock_fd = acquire_lock()
    if lock_fd is None:
        print("ERROR: Another live pipeline instance is already running.")
        print(f"  Lock file: {LOCK_FILE}")
        sys.exit(1)

    try:
        if args.mode == "once":
            asyncio.run(run_once(
                dry_run=args.dry_run,
                source=args.source,
                cache_dir=args.cache_dir,
            ))
        elif args.mode == "daemon":
            asyncio.run(run_daemon(
                dry_run=args.dry_run,
                interval_minutes=args.interval,
                cache_dir=args.cache_dir,
            ))
    finally:
        release_lock(lock_fd)


if __name__ == "__main__":
    main()
