#!/usr/bin/env python3
"""
Full 2025 scrape orchestrator — month-by-month, all 15 states in parallel.

Runs all scrapers for each month of 2025, collecting police press releases
from 15 German states (Brandenburg skipped — presseportal broken, no
dedicated scraper).

Output structure:
    data/pipeline/2025/
      2025-01/
        baden-wuerttemberg.json
        bayern.json
        ...
        logs/
          baden-wuerttemberg.log
          bayern.log
          ...
      2025-02/
        ...

Usage:
    python3 scripts/scrape_2025.py
    python3 scripts/scrape_2025.py --start-month 6   # resume from June
    python3 scripts/scrape_2025.py --dry-run          # show commands without running
"""

import argparse
import calendar
import json
import os
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

# ── State routing ────────────────────────────────────────────────────────

# 11 states scraped via presseportal.de
PRESSEPORTAL_STATES = [
    "baden-wuerttemberg",
    "bremen",
    "hamburg",
    "hessen",
    "mecklenburg-vorpommern",
    "niedersachsen",
    "nordrhein-westfalen",
    "rheinland-pfalz",
    "saarland",
    "schleswig-holstein",
    "thueringen",
]

# 4 states with dedicated scrapers
DEDICATED_STATES = {
    "berlin":        "scripts/scrapers/scrape_berlin_polizei.py",
    "bayern":        "scripts/scrapers/scrape_bayern_polizei.py",
    "sachsen":       "scripts/scrapers/scrape_sachsen_polizei.py",
    "sachsen-anhalt": "scripts/scrapers/scrape_sachsen_anhalt.py",
}

ALL_STATES = sorted(PRESSEPORTAL_STATES + list(DEDICATED_STATES.keys()))

# ── Paths ────────────────────────────────────────────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BASE_OUTPUT_DIR = PROJECT_ROOT / "data" / "pipeline" / "2025"
CACHE_DIR = BASE_OUTPUT_DIR / ".cache"
PRESSEPORTAL_SCRIPT = PROJECT_ROOT / "scripts" / "scrape_blaulicht_async.py"


def build_command(state: str, start_date: str, end_date: str, output_path: Path) -> list[str]:
    """Build the subprocess command for a given state."""
    if state in DEDICATED_STATES:
        script = str(PROJECT_ROOT / DEDICATED_STATES[state])
        return [
            sys.executable, script,
            "--start-date", start_date,
            "--end-date", end_date,
            "--output", str(output_path),
            "--cache-dir", str(CACHE_DIR),
            "--max-pages", "0",
        ]
    else:
        return [
            sys.executable, str(PRESSEPORTAL_SCRIPT),
            "--bundesland", state,
            "--start-date", start_date,
            "--end-date", end_date,
            "--output", str(output_path),
            "--cache-dir", str(CACHE_DIR),
            "--max-pages", "0",
        ]


def count_articles(path: Path) -> int:
    """Count articles in a JSON file. Returns 0 if file is missing/invalid."""
    try:
        with open(path) as f:
            data = json.load(f)
        if isinstance(data, list):
            return len(data)
        return 0
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return 0


def file_size_str(path: Path) -> str:
    """Human-readable file size."""
    try:
        size = path.stat().st_size
    except OSError:
        return "-"
    if size < 1024:
        return f"{size} B"
    elif size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    else:
        return f"{size / (1024 * 1024):.1f} MB"


def scrape_month(year: int, month: int, dry_run: bool = False) -> dict:
    """
    Scrape all 15 states for a given month. Returns stats dict.
    """
    start_date = date(year, month, 1)
    last_day = calendar.monthrange(year, month)[1]
    end_date = date(year, month, last_day)

    start_str = start_date.isoformat()
    end_str = end_date.isoformat()
    month_label = f"{year}-{month:02d}"

    month_dir = BASE_OUTPUT_DIR / month_label
    logs_dir = month_dir / "logs"
    month_dir.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*70}")
    print(f"  MONTH: {month_label}  ({start_str} → {end_str})")
    print(f"{'='*70}")

    # Check which states need scraping (resume support)
    states_to_scrape = []
    skipped = []
    for state in ALL_STATES:
        output_path = month_dir / f"{state}.json"
        existing = count_articles(output_path)
        if existing > 0:
            skipped.append((state, existing))
        else:
            states_to_scrape.append(state)

    if skipped:
        print(f"\n  Skipping {len(skipped)} states with existing data:")
        for state, n in skipped:
            print(f"    {state}: {n} articles")

    if not states_to_scrape:
        print(f"\n  All states already scraped for {month_label}. Skipping.")
        # Collect stats from existing files
        stats = {}
        for state in ALL_STATES:
            output_path = month_dir / f"{state}.json"
            n = count_articles(output_path)
            stats[state] = {"articles": n, "status": "skipped", "duration": 0}
        return stats

    print(f"\n  Launching {len(states_to_scrape)} scrapers...")

    if dry_run:
        for state in states_to_scrape:
            output_path = month_dir / f"{state}.json"
            cmd = build_command(state, start_str, end_str, output_path)
            print(f"    [DRY RUN] {' '.join(cmd)}")
        return {s: {"articles": 0, "status": "dry-run", "duration": 0} for s in ALL_STATES}

    # Launch all scrapers in parallel
    processes = {}
    log_files = {}
    t0 = time.time()

    for state in states_to_scrape:
        output_path = month_dir / f"{state}.json"
        log_path = logs_dir / f"{state}.log"
        cmd = build_command(state, start_str, end_str, output_path)

        log_f = open(log_path, "w")
        log_files[state] = log_f
        proc = subprocess.Popen(
            cmd,
            stdout=log_f,
            stderr=subprocess.STDOUT,
            cwd=str(PROJECT_ROOT),
        )
        processes[state] = proc
        print(f"    Started: {state} (PID {proc.pid})")

    # Wait for all to complete
    print(f"\n  Waiting for {len(processes)} scrapers to finish...")
    stats = {}

    # Collect results from skipped states
    for state, n in skipped:
        stats[state] = {"articles": n, "status": "skipped", "duration": 0}

    for state, proc in processes.items():
        proc.wait()
        log_files[state].close()

        output_path = month_dir / f"{state}.json"
        n = count_articles(output_path)
        duration = time.time() - t0

        if proc.returncode == 0 and n > 0:
            status = "ok"
        elif proc.returncode == 0 and n == 0:
            status = "empty"
        else:
            status = f"error (rc={proc.returncode})"

        stats[state] = {"articles": n, "status": status, "duration": duration}

    elapsed = time.time() - t0
    print(f"\n  All scrapers finished in {elapsed:.1f}s")

    return stats


def print_stats_table(stats: dict, month_label: str, cumulative: int) -> int:
    """Print formatted stats table. Returns month total."""
    print(f"\n  {'State':<25} {'Articles':>8}  {'Size':>10}  {'Status'}")
    print(f"  {'-'*25} {'-'*8}  {'-'*10}  {'-'*15}")

    month_total = 0
    month_dir = BASE_OUTPUT_DIR / month_label

    for state in ALL_STATES:
        s = stats.get(state, {"articles": 0, "status": "missing", "duration": 0})
        n = s["articles"]
        month_total += n
        output_path = month_dir / f"{state}.json"
        size = file_size_str(output_path)
        status = s["status"]
        print(f"  {state:<25} {n:>8}  {size:>10}  {status}")

    new_cumulative = cumulative + month_total
    print(f"  {'-'*25} {'-'*8}")
    print(f"  {'Month total':<25} {month_total:>8}")
    print(f"  {'Cumulative total':<25} {new_cumulative:>8}")
    return month_total


def main():
    parser = argparse.ArgumentParser(
        description="Scrape all 15 German states for every month of 2025"
    )
    parser.add_argument(
        "--start-month", type=int, default=1,
        help="First month to scrape (1-12, default: 1)"
    )
    parser.add_argument(
        "--end-month", type=int, default=12,
        help="Last month to scrape (1-12, default: 12)"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print commands without running them"
    )
    args = parser.parse_args()

    year = 2025

    # Ensure base dirs exist
    BASE_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Full 2025 Scrape Orchestrator")
    print(f"  Output: {BASE_OUTPUT_DIR}")
    print(f"  Cache:  {CACHE_DIR}")
    print(f"  States: {len(ALL_STATES)} (15 active, Brandenburg skipped)")
    print(f"  Months: {args.start_month:02d} → {args.end_month:02d}")

    cumulative = 0
    all_stats = {}
    t_start = time.time()

    for month in range(args.start_month, args.end_month + 1):
        month_label = f"{year}-{month:02d}"
        stats = scrape_month(year, month, dry_run=args.dry_run)
        month_total = print_stats_table(stats, month_label, cumulative)
        cumulative += month_total
        all_stats[month_label] = stats

    elapsed = time.time() - t_start
    print(f"\n{'='*70}")
    print(f"  COMPLETE")
    print(f"  Total articles: {cumulative:,}")
    print(f"  Total time: {elapsed / 60:.1f} minutes")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
