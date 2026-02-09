#!/usr/bin/env python3
"""
Async scraper for Bavarian police press releases (polizei.bayern.de).

Extracts press releases from the Bayern Polizei portal, which serves all
10 Polizeipraesidien + Bayerisches LKA. Data is loaded from a
`window.montagedata` JavaScript array embedded in the listing page source.

Many Bayern press releases contain multiple incidents in a single article
(numbered like "0207 - Description"). The pipeline's fast_enricher handles
splitting these, so we scrape the full body text without splitting.

Usage:
    python3 scripts/scrapers/scrape_bayern_polizei.py --start-date 2026-02-01 --end-date 2026-02-08
    python3 scripts/scrapers/scrape_bayern_polizei.py --max-pages 1 --verbose
"""

import argparse
import asyncio
import json
import os
import re
import ssl
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import aiohttp
import certifi
from bs4 import BeautifulSoup

# Fix SSL on macOS - certifi provides Mozilla's CA bundle
os.environ['SSL_CERT_FILE'] = certifi.where()

# Constants
BASE_URL = "http://www.polizei.bayern.de"
LISTING_URL = f"{BASE_URL}/aktuelles/pressemitteilungen/"
USER_AGENT = "de-puls/1.0 (+contact: scraper@example.com)"

# Async configuration
CONCURRENT_REQUESTS = 20
DELAY_BETWEEN_BATCHES = 0.3
REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3

# Feuerwehr source filter - drop fire dept articles before enrichment
FEUERWEHR_PATTERN = re.compile(
    r'Feuerwehr|^FW[ -]|Berufsfeuerwehr|Freiwillige Feuerwehr',
    re.IGNORECASE,
)

# Pattern to extract city from body text
# Common formats in Bayern press releases:
#   "AUGSBURG." or "AUGSBURG -" at start of paragraph
#   "(Stadtname)" in parentheses
#   "Ort: Stadtname" or "Tatort: Stadtname"
#   "Lkr. Landkreisname" (county references)
CITY_PATTERNS = [
    # "Ort:" / "Tatort:" / "Einsatzort:" prefix
    re.compile(
        r'(?:Ort|Tatort|Einsatzort)\s*:\s*'
        r'([A-ZÄÖÜ][a-zäöüß]+(?:[\s-][A-ZÄÖÜa-zäöüß][a-zäöüß]+)*)',
    ),
    # City name in parentheses at start: "(Augsburg)"
    re.compile(
        r'^\s*\(([A-ZÄÖÜ][a-zäöüß]+(?:[\s-][A-ZÄÖÜa-zäöüß][a-zäöüß]+)*)\)',
        re.MULTILINE,
    ),
    # UPPERCASE CITY at paragraph start followed by period, comma, dash, or LKR.
    re.compile(
        r'(?:^|\n)\s*([A-ZÄÖÜ]{2,}(?:\s+[A-ZÄÖÜ]+)*)\s*[.,;–\-/]',
    ),
]

# Agency code pattern from title prefix, e.g. "0207" or "PI Augsburg Süd"
AGENCY_CODE_PATTERN = re.compile(r'^(\d{4})\s*[–\-]\s*')


@dataclass
class Article:
    """Represents a scraped press release article."""
    title: str
    date: str
    city: Optional[str]
    bundesland: str
    agency_code: Optional[str]
    source: Optional[str]
    url: str
    body: str
    places: list[str]
    themes: list[str]


class ScrapedUrlsCache:
    """Persistent cache for tracking already-scraped article URLs.

    Prevents re-scraping articles across scraper runs by storing URLs
    with their scrape timestamp.
    """

    def __init__(self, cache_dir: str = ".cache", cache_filename: str = "scraped_urls_bayern.json"):
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / cache_filename
        self.urls: dict[str, str] = {}  # url -> timestamp
        self._load()

    def _load(self) -> None:
        """Load cache from disk if exists."""
        if self.cache_file.exists():
            try:
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    self.urls = json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Could not load scraped URLs cache: {e}")
                self.urls = {}

    def save(self) -> None:
        """Persist cache to disk."""
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        with open(self.cache_file, "w", encoding="utf-8") as f:
            json.dump(self.urls, f, ensure_ascii=False, indent=2)

    def is_scraped(self, url: str) -> bool:
        """Check if URL has already been scraped."""
        return url in self.urls

    def mark_scraped(self, url: str) -> None:
        """Mark a URL as scraped with current timestamp."""
        self.urls[url] = datetime.now().isoformat()

    def __len__(self) -> int:
        """Return number of cached URLs."""
        return len(self.urls)


def is_feuerwehr_source(source: Optional[str], title: Optional[str] = None) -> bool:
    """Check if article is from a fire department (not police)."""
    if source and FEUERWEHR_PATTERN.search(source):
        return True
    if title and re.match(r'^FW[ -]', title):
        return True
    return False


def ms_timestamp_to_iso(ms_timestamp: int) -> str:
    """Convert Unix timestamp in milliseconds to ISO date string."""
    dt = datetime.fromtimestamp(ms_timestamp / 1000, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def ms_timestamp_to_date(ms_timestamp: int) -> datetime:
    """Convert Unix timestamp in milliseconds to datetime object (UTC, naive)."""
    return datetime.utcfromtimestamp(ms_timestamp / 1000)


def extract_montagedata(html: str) -> list[dict]:
    """Extract the window.montagedata JSON array from the page source.

    The listing page embeds article data as:
        window.montagedata = [{...}, {...}, ...];
    """
    # Match window.montagedata = [...];
    pattern = re.compile(
        r'window\.montagedata\s*=\s*(\[.*\])\s*;',
        re.DOTALL,
    )
    match = pattern.search(html)
    if not match:
        return []

    raw_json = match.group(1)
    # Use raw_decode to stop at the end of the JSON array, ignoring
    # trailing content like "; window.filterdata = [...]" that the
    # greedy regex may capture.
    try:
        decoder = json.JSONDecoder()
        data, _ = decoder.raw_decode(raw_json)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError as e:
        print(f"Warning: Failed to parse montagedata JSON: {e}")

    return []


def build_article_url(href: str) -> str:
    """Build full article URL from relative href."""
    if href.startswith("http"):
        return href
    return BASE_URL + href


def extract_city_from_body(body: str) -> Optional[str]:
    """Try to extract a city name from the article body text."""
    for pattern in CITY_PATTERNS:
        match = pattern.search(body)
        if match:
            city = match.group(1).strip()
            # Normalize ALL-CAPS city names to title case
            if city.isupper() and len(city) > 2:
                city = city.title()
            # Skip obviously non-city matches
            if len(city) < 3 or city.lower() in (
                "die", "der", "das", "und", "ein", "eine", "uhr", "polizei",
                "nachtrag", "medieninfo", "korrektur", "zeugensuche",
            ):
                continue
            return city
    return None


def extract_agency_code_from_title(title: str) -> Optional[str]:
    """Try to extract an agency/incident code from the article title prefix.

    Bayern press release titles often start with a 4-digit code like "0207 -"
    which identifies the press release number within the PP.
    """
    match = AGENCY_CODE_PATTERN.match(title)
    if match:
        return match.group(1)
    return None


def parse_article_page(html: str, url: str) -> Optional[dict]:
    """Parse a Bayern Polizei article page to extract body text.

    Article pages have a simple structure:
    - <h1> tag with title (often includes date and PP name)
    - <p> tags with article body text
    - Multiple incidents may be in a single article with numbered headers
    """
    soup = BeautifulSoup(html, "html.parser")

    # Title - from h1
    title = None
    h1 = soup.select_one("h1")
    if h1:
        title = h1.get_text(strip=True)
    if not title:
        og_title = soup.select_one('meta[property="og:title"]')
        if og_title:
            title = og_title.get("content", "").strip()
    if not title:
        title = "Ohne Titel"

    # Body - collect <p> tags from main content area
    # Try to find the main content container first
    content_area = (
        soup.select_one("main")
        or soup.select_one("#content")
        or soup.select_one(".content")
        or soup.select_one("article")
        or soup
    )

    paragraphs = []
    for p in content_area.find_all("p"):
        text = p.get_text(strip=True)
        if text:
            paragraphs.append(text)

    # Also include text from <strong> tags that are direct children (incident headers)
    # These are already captured inside <p> tags by get_text, so no extra handling needed

    body = "\n\n".join(paragraphs)

    # If no paragraphs found, try a broader extraction
    if not body:
        # Fallback: get all text from content area, excluding nav/header/footer
        for tag in content_area.find_all(["nav", "header", "footer", "script", "style"]):
            tag.decompose()
        body = content_area.get_text(separator="\n", strip=True)

    # Extract city from body
    city = extract_city_from_body(body) if body else None

    # Extract agency code from title
    agency_code = extract_agency_code_from_title(title) if title else None

    return {
        "title": title,
        "body": body,
        "city": city,
        "agency_code": agency_code,
    }


class AsyncBayernPolizeiScraper:
    """
    Async scraper for polizei.bayern.de press releases.

    Fetches the listing page to extract window.montagedata, then
    scrapes individual article pages concurrently with aiohttp.
    """

    def __init__(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        max_pages: int = 0,
        output: str = "bayern_polizei_reports.json",
        verbose: bool = False,
        concurrent_requests: int = CONCURRENT_REQUESTS,
        cache_dir: str = ".cache",
    ):
        self.start_date = datetime.fromisoformat(start_date) if start_date else None
        self.end_date = datetime.fromisoformat(end_date) if end_date else None
        self.max_pages = max_pages  # Limits number of articles (montagedata is single page)
        self.output = output
        self.verbose = verbose
        self.concurrent_requests = concurrent_requests

        self.articles: list[Article] = []
        self.seen_urls: set[str] = set()
        self.url_cache = ScrapedUrlsCache(cache_dir)
        self.skipped_cached_count = 0
        self.feuerwehr_dropped_count = 0

        # Stats
        self.fetch_count = 0
        self.fetch_errors = 0

    def _is_in_date_range(self, ms_timestamp: int) -> bool:
        """Check if article timestamp falls within configured date range."""
        if not self.start_date and not self.end_date:
            return True

        article_date = ms_timestamp_to_date(ms_timestamp)

        if self.start_date and article_date.date() < self.start_date.date():
            return False
        if self.end_date and article_date.date() > self.end_date.date():
            return False

        return True

    async def _fetch_url(
        self,
        session: aiohttp.ClientSession,
        url: str,
        semaphore: asyncio.Semaphore,
    ) -> Optional[str]:
        """Fetch a single URL with semaphore-controlled concurrency and retries."""
        async with semaphore:
            for attempt in range(MAX_RETRIES):
                try:
                    async with session.get(
                        url,
                        timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_SECONDS),
                    ) as response:
                        if response.status == 200:
                            self.fetch_count += 1
                            return await response.text()
                        elif response.status == 429:
                            wait_time = 2 ** attempt
                            if self.verbose:
                                print(f"  Rate limited, waiting {wait_time}s...")
                            await asyncio.sleep(wait_time)
                        else:
                            if self.verbose:
                                print(f"  HTTP {response.status} for {url}")
                            return None
                except asyncio.TimeoutError:
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(1)
                except aiohttp.ClientError as e:
                    if self.verbose:
                        print(f"  Error fetching {url}: {e}")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(1)

            self.fetch_errors += 1
            return None

    async def _fetch_batch(
        self,
        session: aiohttp.ClientSession,
        urls: list[str],
        semaphore: asyncio.Semaphore,
    ) -> list[tuple[str, Optional[str]]]:
        """Fetch a batch of URLs concurrently."""
        tasks = [self._fetch_url(session, url, semaphore) for url in urls]
        results = await asyncio.gather(*tasks)
        return list(zip(urls, results))

    async def _discover_articles(
        self,
        session: aiohttp.ClientSession,
        semaphore: asyncio.Semaphore,
    ) -> list[dict]:
        """Fetch the listing page and extract articles from window.montagedata.

        Returns list of article metadata dicts with keys:
            title, href, date (ms timestamp), teaser, organization, url
        """
        print("Fetching listing page...")
        html = await self._fetch_url(session, LISTING_URL, semaphore)
        if not html:
            print("Error: Could not fetch listing page")
            return []

        entries = extract_montagedata(html)
        if not entries:
            print("Error: No montagedata found in listing page")
            return []

        print(f"  Found {len(entries)} entries in montagedata")

        # Filter and process entries
        filtered = []
        for entry in entries:
            # Must have href
            href = entry.get("href")
            if not href:
                continue

            # Build full URL
            url = build_article_url(href)

            # Check date range
            ms_ts = entry.get("date")
            if ms_ts and not self._is_in_date_range(ms_ts):
                continue

            # Skip if already in persistent cache
            if self.url_cache.is_scraped(url):
                self.skipped_cached_count += 1
                continue

            # Skip duplicates within this run
            if url in self.seen_urls:
                continue
            self.seen_urls.add(url)

            # Attach computed fields
            entry["url"] = url
            entry["iso_date"] = ms_timestamp_to_iso(ms_ts) if ms_ts else None
            entry["org_name"] = (
                entry.get("organization", {}).get("name") if entry.get("organization") else None
            )

            filtered.append(entry)

        # Apply max_pages as article limit (since montagedata is a single listing)
        if self.max_pages > 0 and len(filtered) > self.max_pages:
            filtered = filtered[: self.max_pages]

        if self.skipped_cached_count > 0:
            print(f"  Skipped {self.skipped_cached_count} already-scraped articles")
        print(f"  {len(filtered)} new articles to scrape (in date range)")

        return filtered

    async def _scrape_articles_batch(
        self,
        session: aiohttp.ClientSession,
        article_infos: list[dict],
        semaphore: asyncio.Semaphore,
    ) -> list[Article]:
        """Scrape article pages concurrently in batches."""
        articles = []
        total = len(article_infos)
        batch_size = self.concurrent_requests

        for i in range(0, total, batch_size):
            batch = article_infos[i : i + batch_size]
            urls = [a["url"] for a in batch]

            results = await self._fetch_batch(session, urls, semaphore)

            for (url, html), info in zip(results, batch):
                if not html:
                    continue

                parsed = parse_article_page(html, url)
                if not parsed:
                    continue

                # Prefer montagedata title (specific), fall back to page h1
                # The page <h1> is often generic ("Die Bayerische Polizei - ...")
                listing_title = info.get("title", "").strip()
                page_title = parsed.get("title", "").strip()

                if listing_title:
                    title = listing_title
                elif page_title and page_title != "Ohne Titel":
                    title = page_title
                else:
                    title = "Ohne Titel"

                # Source from organization name
                source = info.get("org_name")

                # Drop Feuerwehr articles
                if is_feuerwehr_source(source, title):
                    self.feuerwehr_dropped_count += 1
                    self.url_cache.mark_scraped(url)
                    continue

                # Body: prefer parsed page body, fall back to teaser
                body = parsed.get("body", "")
                if not body:
                    body = info.get("teaser", "")

                # Date from montagedata timestamp
                date_str = info.get("iso_date", "")

                # City: prefer body extraction, fall back to org-name heuristic
                city = parsed.get("city")

                # Agency code from parsed title
                agency_code = parsed.get("agency_code")

                article = Article(
                    title=title,
                    date=date_str,
                    city=city,
                    bundesland="Bayern",
                    agency_code=agency_code,
                    source=source,
                    url=url,
                    body=body,
                    places=[],
                    themes=[],
                )
                articles.append(article)
                self.url_cache.mark_scraped(url)

            progress = min(i + batch_size, total)
            print(f"  Scraped {progress}/{total} articles ({len(articles)} success)")

            if i + batch_size < total:
                await asyncio.sleep(DELAY_BETWEEN_BATCHES)

        return articles

    async def run_async(self) -> None:
        """Execute the async scraping pipeline."""
        print("=" * 60)
        print("Async Bayern Polizei Scraper (polizei.bayern.de)")
        print("=" * 60)
        print(f"Concurrent requests: {self.concurrent_requests}")

        if self.start_date:
            print(f"Start date: {self.start_date.date()}")
        if self.end_date:
            print(f"End date: {self.end_date.date()}")
        if self.max_pages:
            print(f"Max articles: {self.max_pages}")
        print()

        start_time = time.time()

        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
        }

        ssl_context = ssl.create_default_context(cafile=certifi.where())
        connector = aiohttp.TCPConnector(ssl=ssl_context)
        semaphore = asyncio.Semaphore(self.concurrent_requests)

        async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
            # Phase 1: Discover articles from montagedata
            article_infos = await self._discover_articles(session, semaphore)

            if not article_infos:
                print("No articles found to scrape")
                return

            # Phase 2: Scrape article pages concurrently
            print(
                f"\nScraping {len(article_infos)} articles with "
                f"{self.concurrent_requests} concurrent requests..."
            )
            self.articles = await self._scrape_articles_batch(
                session, article_infos, semaphore
            )

        elapsed = time.time() - start_time

        # Save URL cache
        self.url_cache.save()

        # Write output
        output_data = [asdict(article) for article in self.articles]

        Path(self.output).parent.mkdir(parents=True, exist_ok=True)

        with open(self.output, "w", encoding="utf-8") as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)

        print()
        print("=" * 60)
        print(f"Saved {len(self.articles)} articles to {self.output}")
        if self.feuerwehr_dropped_count:
            print(f"Dropped {self.feuerwehr_dropped_count} Feuerwehr (fire dept) articles")
        print(f"URL cache: {len(self.url_cache)} total URLs in {self.url_cache.cache_file}")
        print(f"Elapsed time: {elapsed:.1f}s ({elapsed / 60:.1f} min)")
        print(f"Fetch stats: {self.fetch_count} requests, {self.fetch_errors} errors")
        if self.articles:
            print(f"Speed: {len(self.articles) / elapsed:.1f} articles/sec")
        print("=" * 60)

    def run(self) -> None:
        """Synchronous entry point - runs the async pipeline."""
        asyncio.run(self.run_async())


def main():
    parser = argparse.ArgumentParser(
        description="Async scrape police press releases from polizei.bayern.de",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 scripts/scrapers/scrape_bayern_polizei.py --start-date 2026-02-01 --end-date 2026-02-08
  python3 scripts/scrapers/scrape_bayern_polizei.py --max-pages 10 --verbose
  python3 scripts/scrapers/scrape_bayern_polizei.py -o data/pipeline/raw/bayern_polizei.json
        """,
    )

    parser.add_argument(
        "--start-date",
        type=str,
        help="Start date filter (ISO format: YYYY-MM-DD)",
    )

    parser.add_argument(
        "--end-date",
        type=str,
        help="End date filter (ISO format: YYYY-MM-DD)",
    )

    parser.add_argument(
        "--max-pages",
        type=int,
        default=0,
        help="Maximum number of articles to scrape (0 = no limit)",
    )

    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default="bayern_polizei_reports.json",
        help="Output JSON file path (default: bayern_polizei_reports.json)",
    )

    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose output",
    )

    parser.add_argument(
        "--concurrent",
        type=int,
        default=CONCURRENT_REQUESTS,
        help=f"Number of concurrent requests (default: {CONCURRENT_REQUESTS})",
    )

    parser.add_argument(
        "--cache-dir",
        type=str,
        default=".cache",
        help="Directory for caches (default: .cache)",
    )

    args = parser.parse_args()

    # Validate dates
    if args.start_date:
        try:
            datetime.fromisoformat(args.start_date)
        except ValueError:
            print(f"Error: Invalid start date format: {args.start_date}")
            print("Use ISO format: YYYY-MM-DD")
            sys.exit(1)

    if args.end_date:
        try:
            datetime.fromisoformat(args.end_date)
        except ValueError:
            print(f"Error: Invalid end date format: {args.end_date}")
            print("Use ISO format: YYYY-MM-DD")
            sys.exit(1)

    scraper = AsyncBayernPolizeiScraper(
        start_date=args.start_date,
        end_date=args.end_date,
        max_pages=args.max_pages,
        output=args.output,
        verbose=args.verbose,
        concurrent_requests=args.concurrent,
        cache_dir=args.cache_dir,
    )

    try:
        scraper.run()
    except KeyboardInterrupt:
        print("\nInterrupted by user")
        scraper.url_cache.save()
        sys.exit(1)


if __name__ == "__main__":
    main()
