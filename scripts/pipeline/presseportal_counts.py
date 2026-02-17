#!/usr/bin/env python3
"""
Presseportal Blaulicht count scraper — compares official presseportal.de article
counts against our locally scraped data.

Fetches the <title> tag from presseportal.de/blaulicht/l/{state}?startDate=...&endDate=...
which contains the total count (e.g. "1136 Blaulicht-Meldungen aus Hessen | Presseportal"),
and compares it against the number of articles in our raw chunk files.

Usage:
    python3 scripts/pipeline/presseportal_counts.py                    # all presseportal states
    python3 scripts/pipeline/presseportal_counts.py --state hessen     # single state
    python3 scripts/pipeline/presseportal_counts.py --refresh          # bypass cache
"""

import argparse
import asyncio
import calendar
import json
import re
import ssl
import sys
from pathlib import Path

import aiohttp
import certifi

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from scripts.pipeline.config import (
    CHUNKS_RAW_DIR,
    DATA_DIR,
    PRESSEPORTAL_STATES,
    chunk_raw_path,
)

# --- Constants ---

CACHE_FILE = DATA_DIR / "presseportal_counts.json"
CONCURRENCY = 3
DELAY_BETWEEN_BATCHES = 0.5  # seconds
START_YEAR = 2021
END_YEAR = 2026
END_MONTH = 2  # inclusive — fetches through Feb 2026
TITLE_RE = re.compile(r"(\d+)\s+Blaulicht-Meldungen")
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# ANSI colors
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def build_month_ranges():
    """Generate (year, month) tuples from START_YEAR-01 through END_YEAR-END_MONTH."""
    months = []
    for year in range(START_YEAR, END_YEAR + 1):
        last_month = END_MONTH if year == END_YEAR else 12
        for month in range(1, last_month + 1):
            months.append((year, month))
    return months


def presseportal_url(state: str, year: int, month: int) -> str:
    last_day = calendar.monthrange(year, month)[1]
    start = f"{year}-{month:02d}-01"
    end = f"{year}-{month:02d}-{last_day:02d}"
    return f"https://www.presseportal.de/blaulicht/l/{state}?startDate={start}&endDate={end}"


def count_local_articles(state: str, year: int, month: int) -> int | None:
    """Count articles in our raw chunk file, return None if file doesn't exist."""
    fpath = chunk_raw_path(state, f"{year}-{month:02d}")
    if not fpath.exists():
        return None
    try:
        with open(fpath) as f:
            data = json.load(f)
        return len(data) if isinstance(data, list) else 0
    except (json.JSONDecodeError, IOError):
        return None


async def fetch_count(
    session: aiohttp.ClientSession,
    semaphore: asyncio.Semaphore,
    state: str,
    year: int,
    month: int,
) -> tuple[str, int, int, int | None]:
    """Fetch the official count from presseportal.de for a state/month."""
    url = presseportal_url(state, year, month)
    async with semaphore:
        try:
            async with session.get(
                url, timeout=aiohttp.ClientTimeout(total=30)
            ) as resp:
                if resp.status != 200:
                    return (state, year, month, None)
                html = await resp.text()
                match = TITLE_RE.search(html)
                if match:
                    return (state, year, month, int(match.group(1)))
                # Page loaded but no count in title — likely 0 results
                return (state, year, month, 0)
        except (aiohttp.ClientError, asyncio.TimeoutError):
            return (state, year, month, None)


async def fetch_all_counts(
    states: list[str], months: list[tuple[int, int]], cached: dict
) -> dict:
    """Fetch official counts for all state×month combinations not already cached."""
    results = dict(cached)  # start with cached values
    semaphore = asyncio.Semaphore(CONCURRENCY)
    headers = {"User-Agent": USER_AGENT}
    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    connector = aiohttp.TCPConnector(ssl=ssl_ctx)

    # Build list of tasks for uncached combinations
    tasks = []
    async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
        for state in states:
            for year, month in months:
                key = f"{state}/{year}-{month:02d}"
                if key in results:
                    continue
                tasks.append(fetch_count(session, semaphore, state, year, month))

        if not tasks:
            print(f"All {len(states) * len(months)} combinations already cached.")
            return results

        print(f"Fetching {len(tasks)} pages from presseportal.de ...")
        # Process in batches to add delay
        batch_size = CONCURRENCY
        for i in range(0, len(tasks), batch_size):
            batch = tasks[i : i + batch_size]
            batch_results = await asyncio.gather(*batch)
            for state, year, month, count in batch_results:
                key = f"{state}/{year}-{month:02d}"
                results[key] = count
            done = min(i + batch_size, len(tasks))
            print(f"  {done}/{len(tasks)} fetched", end="\r")
            if i + batch_size < len(tasks):
                await asyncio.sleep(DELAY_BETWEEN_BATCHES)

        print()  # newline after progress
    return results


def load_cache() -> dict:
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    return {}


def save_cache(data: dict):
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE_FILE, "w") as f:
        json.dump(data, f, indent=2, sort_keys=True)
    print(f"Cache saved to {CACHE_FILE}")


def colorize_ratio(scraped: int | None, official: int | None) -> str:
    """Format scraped/official with color coding based on coverage percentage."""
    if official is None:
        return f"{DIM}  ?/?  {RESET}"
    if official == 0:
        if scraped is None or scraped == 0:
            return f"{DIM}  -/-  {RESET}"
        return f"{YELLOW}{scraped:>4}/0  {RESET}"
    if scraped is None:
        return f"{RED}   -/{official:<4}{RESET}"

    pct = (scraped / official) * 100 if official > 0 else 0
    color = GREEN if pct >= 95 else YELLOW if pct >= 80 else RED
    return f"{color}{scraped:>4}/{official:<4}{RESET}"


def print_state_table(state: str, months: list[tuple[int, int]], official_counts: dict):
    """Print a comparison table for a single state."""
    years = sorted(set(y for y, _ in months))
    month_names = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]

    print(f"\n{BOLD}{'─' * 70}")
    print(f"  {state.replace('-', ' ').title()}")
    print(f"{'─' * 70}{RESET}")

    # Header row
    header = f"{'Month':>6}"
    for year in years:
        header += f"  {year:>9}"
    print(header)
    print(f"{'─' * 70}")

    # Totals per year
    year_scraped = {y: 0 for y in years}
    year_official = {y: 0 for y in years}
    year_has_data = {y: False for y in years}

    for m in range(1, 13):
        row = f"{month_names[m - 1]:>6}"
        for year in years:
            if (year, m) not in [(y, mo) for y, mo in months]:
                row += f"{'':>11}"
                continue
            key = f"{state}/{year}-{m:02d}"
            official = official_counts.get(key)
            scraped = count_local_articles(state, year, m)
            row += f"  {colorize_ratio(scraped, official)}"

            if official is not None:
                year_official[year] += official
                year_has_data[year] = True
            if scraped is not None:
                year_scraped[year] += scraped
        print(row)

    # Totals row
    print(f"{'─' * 70}")
    totals = f"{'Total':>6}"
    grand_scraped = 0
    grand_official = 0
    for year in years:
        if year_has_data[year]:
            totals += f"  {colorize_ratio(year_scraped[year], year_official[year])}"
            grand_scraped += year_scraped[year]
            grand_official += year_official[year]
        else:
            totals += f"{'':>11}"
    print(totals)

    if grand_official > 0:
        pct = (grand_scraped / grand_official) * 100
        color = GREEN if pct >= 95 else YELLOW if pct >= 80 else RED
        print(f"\n  Overall: {color}{grand_scraped:,}/{grand_official:,} ({pct:.1f}%){RESET}")


def _read_feuerwehr_dropped(state: str, year_month: str) -> int:
    """Read the feuerwehr dropped count from a chunk's .meta.json file."""
    data_path = chunk_raw_path(state, year_month)
    meta_path = Path(str(data_path).rsplit(".json", 1)[0] + ".meta.json")
    try:
        with open(meta_path) as f:
            meta = json.load(f)
            return meta.get("articles_feuerwehr_skip", 0) or 0
    except (FileNotFoundError, json.JSONDecodeError, IOError):
        return 0


async def _fetch_counts_for_month(
    states: list[str], year: int, month: int, cached: dict
) -> dict:
    """Fetch presseportal counts for multiple states for a single month."""
    results = {}
    tasks_to_run = []

    semaphore = asyncio.Semaphore(CONCURRENCY)
    headers = {"User-Agent": USER_AGENT}
    ssl_ctx = ssl.create_default_context(cafile=certifi.where())
    connector = aiohttp.TCPConnector(ssl=ssl_ctx)

    async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
        for state in states:
            key = f"{state}/{year}-{month:02d}"
            if key in cached:
                results[key] = cached[key]
            else:
                tasks_to_run.append(fetch_count(session, semaphore, state, year, month))

        if tasks_to_run:
            batch_results = await asyncio.gather(*tasks_to_run)
            for state_r, y, m, count in batch_results:
                key = f"{state_r}/{y}-{m:02d}"
                results[key] = count

    return results


def check_completeness_for_states(
    states: list[str], year_month: str
) -> list[tuple]:
    """Check scrape completeness for given states against presseportal.de counts.

    Only checks states that use presseportal.de (skips dedicated scraper states).
    Logs colored warnings for states with coverage < 90%.

    Args:
        states: List of state slugs that were scraped
        year_month: Month string in YYYY-MM format

    Returns:
        List of (state, local_count, feuerwehr_dropped, presseportal_count, pct) tuples
    """
    pp_set = set(PRESSEPORTAL_STATES)
    pp_states = [s for s in states if s in pp_set]
    if not pp_states:
        return []

    year, month_str = year_month.split("-")
    year, month = int(year), int(month_str)

    # Fetch presseportal counts (with cache)
    cached = load_cache()
    counts = asyncio.run(_fetch_counts_for_month(pp_states, year, month, cached))

    # Save new values to cache (silently — no print)
    cached.update(counts)
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE_FILE, "w") as f:
        json.dump(cached, f, indent=2, sort_keys=True)

    results = []
    for state in pp_states:
        key = f"{state}/{year}-{month:02d}"
        pp_count = counts.get(key)
        local = count_local_articles(state, year, month) or 0
        fw_dropped = _read_feuerwehr_dropped(state, year_month)

        # Coverage = (scraped + feuerwehr_dropped) / presseportal_count
        if pp_count and pp_count > 0:
            effective = local + fw_dropped
            pct = (effective / pp_count) * 100
        else:
            pct = None

        results.append((state, local, fw_dropped, pp_count, pct))

        # Log output
        label = state.replace("-", " ").title()
        fw_str = f" — {fw_dropped} Feuerwehr dropped" if fw_dropped else ""

        if pp_count is None:
            print(f"    {label}: {local:,} scraped (presseportal count unavailable)")
        elif pct is not None:
            if pct >= 90:
                print(
                    f"    {GREEN}{label}: {local:,} / {pp_count:,} ({pct:.1f}%)"
                    f"{fw_str}{RESET}"
                )
            else:
                color = YELLOW if pct >= 70 else RED
                print(
                    f"    {color}\u26a0\ufe0f  {label}: {local:,} / {pp_count:,} ({pct:.1f}%)"
                    f"{fw_str}{RESET}"
                )

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Compare presseportal.de article counts against local scraped data."
    )
    parser.add_argument(
        "--state",
        type=str,
        help="Single state slug to check (e.g. hessen)",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Bypass cache and re-fetch all counts from presseportal.de",
    )
    args = parser.parse_args()

    # Determine states to check
    if args.state:
        if args.state not in PRESSEPORTAL_STATES:
            print(f"Error: '{args.state}' is not a presseportal state.")
            print(f"Available: {', '.join(PRESSEPORTAL_STATES)}")
            sys.exit(1)
        states = [args.state]
    else:
        states = PRESSEPORTAL_STATES

    months = build_month_ranges()

    # Load/refresh cache
    cached = {} if args.refresh else load_cache()

    # Fetch official counts
    official_counts = asyncio.run(fetch_all_counts(states, months, cached))

    # Save cache
    save_cache(official_counts)

    # Print tables
    for state in states:
        print_state_table(state, months, official_counts)

    # Summary across all states
    if len(states) > 1:
        print(f"\n{BOLD}{'═' * 70}")
        print(f"  SUMMARY — All Presseportal States")
        print(f"{'═' * 70}{RESET}")
        total_scraped = 0
        total_official = 0
        for state in states:
            s_scraped = 0
            s_official = 0
            for year, month in months:
                key = f"{state}/{year}-{month:02d}"
                off = official_counts.get(key)
                loc = count_local_articles(state, year, month)
                if off is not None:
                    s_official += off
                if loc is not None:
                    s_scraped += loc
            pct = (s_scraped / s_official * 100) if s_official > 0 else 0
            color = GREEN if pct >= 95 else YELLOW if pct >= 80 else RED
            label = state.replace("-", " ").title()
            print(f"  {label:<25} {color}{s_scraped:>6,}/{s_official:>6,}  ({pct:5.1f}%){RESET}")
            total_scraped += s_scraped
            total_official += s_official

        if total_official > 0:
            pct = total_scraped / total_official * 100
            color = GREEN if pct >= 95 else YELLOW if pct >= 80 else RED
            print(f"{'─' * 70}")
            print(f"  {'TOTAL':<25} {color}{total_scraped:>6,}/{total_official:>6,}  ({pct:5.1f}%){RESET}")


if __name__ == "__main__":
    main()
