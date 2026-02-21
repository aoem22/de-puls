#!/usr/bin/env python3
"""
Async scraper for Polizei Sachsen-Anhalt press releases.

Source: sachsen-anhalt.de/bs/pressemitteilungen/polizei
TYPO3 CMS with paginated listing (~4,651 pages, ~20 articles/page).
Archive is chronologically ordered newest-first, so pagination stops
once articles fall before --start-date.

Usage:
    python3 scripts/scrapers/scrape_sachsen_anhalt.py --start-date 2026-01-01 --end-date 2026-01-31
    python3 scripts/scrapers/scrape_sachsen_anhalt.py --max-pages 5 --verbose
"""

import argparse
import asyncio
import json
import os
import re
import ssl
import sys
import time
from dataclasses import dataclass, asdict, field
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin, urlencode, parse_qs, urlparse

import aiohttp
import certifi
from bs4 import BeautifulSoup

# Fix SSL on macOS - certifi provides Mozilla's CA bundle
os.environ['SSL_CERT_FILE'] = certifi.where()

# Constants
BASE_URL = "https://www.sachsen-anhalt.de"
LISTING_PATH = "/bs/pressemitteilungen/polizei"
USER_AGENT = "adlerlicht/1.0 (+contact: scraper@adlerlicht.de)"

# Async configuration
CONCURRENT_REQUESTS = 10  # Conservative for government site
DELAY_BETWEEN_BATCHES = 0.5  # Polite delay for government infrastructure
REQUEST_TIMEOUT_SECONDS = 45  # Government sites can be slow
MAX_RETRIES = 3

# Feuerwehr filter pattern - drop fire department articles
FEUERWEHR_PATTERN = re.compile(
    r'Feuerwehr|^FW[ -]|Berufsfeuerwehr|Freiwillige Feuerwehr',
    re.IGNORECASE,
)

# City extraction from title pattern: "Polizeimeldungen Polizeirevier {City}"
REVIER_PATTERN = re.compile(
    r'Polizei(?:meldungen|bericht|revier|inspektion|kommissariat|direktion)'
    r'\s+(?:Polizeirevier\s+|Polizeiinspektion\s+|Polizeidirektion\s+)?'
    r'(.+?)(?:\s*[-/]\s*|\s*$)',
    re.IGNORECASE,
)

# Alternative city patterns in body text
CITY_BODY_PATTERNS = [
    re.compile(r'(?:Ort|Tatort|Einsatzort)\s*:\s*(\d+\s+)?([A-ZAOU][a-z\u00e4\u00f6\u00fc\u00df-]+(?:\s+[A-ZAOU][a-z\u00e4\u00f6\u00fc\u00df-]+)*)'),
    re.compile(r'in\s+(\d+\s+)?([A-ZAOU][a-z\u00e4\u00f6\u00fc\u00df-]+(?:\s+an\s+der\s+[A-ZAOU][a-z\u00e4\u00f6\u00fc\u00df-]+)?)\s+(?:kam es|wurde|ereignete|meldete)'),
]


@dataclass
class Article:
    """Represents a scraped press release article."""
    title: str
    date: str
    city: Optional[str]
    bundesland: str
    agency_code: Optional[str]
    source: str
    url: str
    body: str
    places: list[str] = field(default_factory=list)
    themes: list[str] = field(default_factory=list)


class ScrapedUrlsCache:
    """Persistent cache for tracking already-scraped article URLs.

    Prevents re-scraping articles across scraper runs by storing URLs
    with their scrape timestamp.
    """

    def __init__(self, cache_dir: str = ".cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / "scraped_urls_sachsen_anhalt.json"
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


def build_listing_url(page: int = 1) -> str:
    """Build the paginated listing URL for Sachsen-Anhalt police press releases."""
    url = f"{BASE_URL}{LISTING_PATH}"
    if page > 1:
        url += f"?tx_tsarssinclude_pi1%5Bpage%5D={page}"
    return url


def parse_german_date(date_str: str) -> Optional[str]:
    """Convert DD.MM.YYYY to ISO YYYY-MM-DD format."""
    if not date_str:
        return None

    # Already ISO
    if re.match(r"\d{4}-\d{2}-\d{2}", date_str):
        return date_str[:10]

    # German format: DD.MM.YYYY
    match = re.match(r"(\d{2})\.(\d{2})\.(\d{4})", date_str.strip())
    if match:
        day, month, year = match.groups()
        return f"{year}-{month}-{day}"

    return None


def parse_listing_page(html: str) -> list[dict]:
    """
    Parse a listing page from the Sachsen-Anhalt TYPO3 portal.

    Extracts article links, titles, dates, and preview text from the
    paginated listing. The HTML structure uses plain divs with date text,
    reference numbers, and anchor links.

    Returns list of dicts with 'url', 'title', 'date', 'preview' keys.
    """
    soup = BeautifulSoup(html, "html.parser")
    articles = []

    # Find all links matching the single-article URL pattern.
    # Brackets may be literal [] or percent-encoded %5B %5D depending on
    # how the CMS renders the href attributes.
    article_links = soup.find_all(
        "a",
        href=re.compile(r'tx_tsarssinclude_pi1(?:\[|%5B)action(?:\]|%5D)=single', re.IGNORECASE),
    )

    for link in article_links:
        href = link.get("href", "")
        if not href:
            continue

        # Skip [weiterlesen] duplicate links - they point to the same article
        link_text = link.get_text(strip=True)
        if link_text == "[weiterlesen]":
            continue

        # Build full URL
        full_url = urljoin(BASE_URL, href)

        # Title from link text
        title = link_text or "Ohne Titel"

        # Walk up to find the parent container div to extract date and preview
        # The structure is: <div> date_text ref_number <a>title</a> <p>desc</p> <p>preview</p> <a>[weiterlesen]</a> </div>
        container = link.parent
        date_str = None
        preview = ""

        if container:
            container_text = container.get_text()
            # Extract date (DD.MM.YYYY)
            date_match = re.search(r"(\d{2}\.\d{2}\.\d{4})", container_text)
            if date_match:
                date_str = date_match.group(1)

            # Extract preview from <p> tags after the link
            paragraphs = container.find_all("p")
            if paragraphs:
                # Last <p> before [weiterlesen] is usually the preview
                preview_parts = []
                for p in paragraphs:
                    p_text = p.get_text(strip=True)
                    if p_text:
                        preview_parts.append(p_text)
                preview = " ".join(preview_parts)

        articles.append({
            "url": full_url,
            "title": title,
            "date": date_str,
            "preview": preview,
        })

    return articles


def extract_city_from_title(title: str) -> Optional[str]:
    """
    Extract city name from title patterns common in Sachsen-Anhalt police reports.

    Common patterns:
    - "Polizeimeldungen Polizeirevier Stendal"
    - "Polizeibericht Polizeiinspektion Magdeburg"
    - "Polizeirevier Halle (Saale) - Tagesbericht"
    """
    if not title:
        return None

    match = REVIER_PATTERN.search(title)
    if match:
        city = match.group(1).strip()
        # Clean up trailing noise
        city = re.sub(r'\s*[-/]\s*(?:Tagesbericht|Wochenbericht|Pressemitteilung).*', '', city, flags=re.IGNORECASE)
        city = city.strip(" -/")
        if city and len(city) > 1:
            return city

    return None


def extract_city_from_body(body: str) -> Optional[str]:
    """Extract city from body text using common location patterns."""
    if not body:
        return None

    for pattern in CITY_BODY_PATTERNS:
        match = pattern.search(body)
        if match:
            # The city is in the last captured group
            city = match.group(match.lastindex).strip()
            if city and len(city) > 1:
                return city

    return None


def is_feuerwehr(title: Optional[str], body: Optional[str] = None) -> bool:
    """Check if article is from a fire department (not police)."""
    if title and FEUERWEHR_PATTERN.search(title):
        return True
    if body and FEUERWEHR_PATTERN.search(body[:200]):
        return True
    return False


def parse_article_page(html: str, url: str, listing_info: dict) -> Optional[dict]:
    """
    Parse a single article page from the Sachsen-Anhalt portal.

    Extracts title, date, body text, and city from the article page.
    Falls back to listing-page metadata when the article page is sparse.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Title: try <h1> first, then fall back to listing title
    title = None
    h1 = soup.find("h1")
    if h1:
        title = h1.get_text(strip=True)
    if not title:
        title = listing_info.get("title", "Ohne Titel")

    # Date: search the page for DD.MM.YYYY, fall back to listing date
    date_str = None

    # Try meta tags first
    for meta_name in ["date", "DC.date", "DC.Date"]:
        meta = soup.find("meta", attrs={"name": meta_name})
        if meta and meta.get("content"):
            date_str = meta["content"]
            break

    # Try finding date in page text near the title
    if not date_str:
        page_text = soup.get_text()
        date_match = re.search(r"(\d{2}\.\d{2}\.\d{4})", page_text)
        if date_match:
            date_str = date_match.group(1)

    # Fall back to listing date
    if not date_str:
        date_str = listing_info.get("date")

    # Convert to ISO
    iso_date = parse_german_date(date_str) if date_str else None

    # Body: extract article content paragraphs
    # TYPO3 typically wraps content in specific content elements
    body_parts = []

    # Strategy 1: Look for main content area
    content_area = (
        soup.find("div", class_="ce-bodytext")
        or soup.find("div", class_="frame-default")
        or soup.find("div", id="content")
        or soup.find("main")
        or soup.find("article")
    )

    if content_area:
        for p in content_area.find_all(["p", "li"]):
            text = p.get_text(strip=True)
            if text and len(text) > 5:
                body_parts.append(text)

    # Strategy 2: Fallback - collect all non-navigation paragraphs
    if not body_parts:
        for p in soup.find_all("p"):
            text = p.get_text(strip=True)
            # Skip very short or navigation-like text
            if text and len(text) > 20:
                # Skip if inside nav, header, footer
                parent_tags = [parent.name for parent in p.parents]
                if not any(tag in parent_tags for tag in ["nav", "header", "footer"]):
                    body_parts.append(text)

    body = "\n\n".join(body_parts)

    # If body is still empty, use listing preview
    if not body:
        body = listing_info.get("preview", "")

    # City extraction
    city = extract_city_from_title(title)
    if not city:
        city = extract_city_from_body(body)

    return {
        "title": title,
        "date": iso_date or "",
        "city": city,
        "body": body,
        "url": url,
    }


class AsyncSachsenAnhaltScraper:
    """
    Async scraper for Polizei Sachsen-Anhalt press releases.

    Handles the massive archive (4,651+ pages) efficiently by:
    1. Paginating newest-first and stopping at --start-date boundary
    2. Concurrent fetching with semaphore-controlled concurrency
    3. Persistent URL cache to avoid re-scraping
    """

    def __init__(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        max_pages: int = 0,
        output: str = "sachsen_anhalt_polizei.json",
        verbose: bool = False,
        concurrent_requests: int = CONCURRENT_REQUESTS,
        cache_dir: str = ".cache",
    ):
        self.start_date = datetime.fromisoformat(start_date) if start_date else None
        self.end_date = datetime.fromisoformat(end_date) if end_date else None
        self.max_pages = max_pages
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

        # Metadata tracking
        self.pages_visited = 0
        self.pages_with_content = 0
        self.stop_reason = "unknown"

    def _is_in_date_range(self, date_str: Optional[str]) -> Optional[bool]:
        """
        Check if article date falls within configured range.

        Returns:
            True  - article is within range
            False - article is outside range
            None  - date could not be parsed (treat as included)
        """
        if not date_str:
            return None

        if not self.start_date and not self.end_date:
            return True

        iso = parse_german_date(date_str)
        if not iso:
            return None

        try:
            article_date = datetime.fromisoformat(iso).date()

            if self.start_date and article_date < self.start_date.date():
                return False
            if self.end_date and article_date > self.end_date.date():
                return False

            return True
        except (ValueError, AttributeError):
            return None

    def _is_before_start_date(self, date_str: Optional[str]) -> bool:
        """Check if article date is strictly before start_date (for early-stop logic)."""
        if not date_str or not self.start_date:
            return False

        iso = parse_german_date(date_str)
        if not iso:
            return False

        try:
            article_date = datetime.fromisoformat(iso).date()
            return article_date < self.start_date.date()
        except (ValueError, AttributeError):
            return False

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
                            wait_time = 2 ** (attempt + 1)
                            if self.verbose:
                                print(f"  Rate limited, waiting {wait_time}s...")
                            await asyncio.sleep(wait_time)
                        elif response.status >= 500:
                            # Server error, retry with backoff
                            wait_time = 2 ** attempt
                            if self.verbose:
                                print(f"  HTTP {response.status} for {url}, retrying in {wait_time}s...")
                            await asyncio.sleep(wait_time)
                        else:
                            if self.verbose:
                                print(f"  HTTP {response.status} for {url}")
                            return None
                except asyncio.TimeoutError:
                    if self.verbose:
                        print(f"  Timeout for {url} (attempt {attempt + 1})")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(2)
                except aiohttp.ClientError as e:
                    if self.verbose:
                        print(f"  Error fetching {url}: {e}")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(2)

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
        """
        Paginate through listing pages and collect article URLs.

        Processes one listing page at a time (sequentially) because we need to
        detect the date boundary for early stopping. The archive is ordered
        newest-first, so once all articles on a page are older than start_date,
        we can stop.
        """
        all_articles = []
        page = 1
        consecutive_empty = 0

        print(f"Discovering articles from listing pages...")
        if self.start_date:
            print(f"  Date range: {self.start_date.date()} to {self.end_date.date() if self.end_date else 'now'}")
        if self.max_pages:
            print(f"  Max pages: {self.max_pages}")

        while True:
            if self.max_pages > 0 and page > self.max_pages:
                print(f"  Reached max pages limit ({self.max_pages})")
                self.stop_reason = "max_pages"
                break

            url = build_listing_url(page)

            html = await self._fetch_url(session, url, semaphore)
            self.pages_visited += 1
            if not html:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    print(f"  {consecutive_empty} consecutive failed pages, stopping")
                    self.stop_reason = "3_empty_pages"
                    break
                page += 1
                continue
            consecutive_empty = 0

            articles = parse_listing_page(html)
            if not articles:
                print(f"  Page {page}: no articles found, stopping")
                self.stop_reason = "empty_page"
                break

            self.pages_with_content += 1

            page_added = 0
            page_too_old = 0
            page_too_new = 0

            for article in articles:
                article_url = article["url"]
                article_date = article.get("date")

                # Skip duplicates
                if article_url in self.seen_urls:
                    continue

                # Skip cached
                if self.url_cache.is_scraped(article_url):
                    self.skipped_cached_count += 1
                    self.seen_urls.add(article_url)
                    continue

                # Date filtering
                in_range = self._is_in_date_range(article_date)

                if in_range is False:
                    if self._is_before_start_date(article_date):
                        page_too_old += 1
                    else:
                        page_too_new += 1
                    self.seen_urls.add(article_url)
                    continue

                # Article is in range (or date unknown)
                all_articles.append(article)
                self.seen_urls.add(article_url)
                page_added += 1

            if self.verbose:
                print(f"  Page {page}: +{page_added} articles, {page_too_old} too old, {page_too_new} too new (total: {len(all_articles)})")
            elif page % 10 == 0 or page_added > 0:
                print(f"  Page {page}: +{page_added} (total: {len(all_articles)})")

            # Early stop: if all dated articles on this page are before start_date,
            # the rest of the archive will also be older (newest-first ordering)
            if self.start_date and page_too_old > 0 and page_added == 0 and page_too_new == 0:
                print(f"  All articles on page {page} are before {self.start_date.date()}, stopping")
                self.stop_reason = "date_boundary"
                break

            page += 1

            # Polite delay between listing page requests
            await asyncio.sleep(DELAY_BETWEEN_BATCHES)

        if self.skipped_cached_count > 0:
            print(f"  Skipped {self.skipped_cached_count} already-scraped articles")
        print(f"  Found {len(all_articles)} new articles to scrape")
        return all_articles

    async def _scrape_articles(
        self,
        session: aiohttp.ClientSession,
        article_infos: list[dict],
        semaphore: asyncio.Semaphore,
    ) -> list[Article]:
        """Fetch and parse article pages concurrently in batches."""
        articles = []
        total = len(article_infos)
        batch_size = self.concurrent_requests

        for i in range(0, total, batch_size):
            batch = article_infos[i:i + batch_size]
            urls = [a["url"] for a in batch]

            results = await self._fetch_batch(session, urls, semaphore)

            for (url, html), info in zip(results, batch):
                if not html:
                    continue

                parsed = parse_article_page(html, url, info)
                if not parsed:
                    continue

                # Drop Feuerwehr articles
                if is_feuerwehr(parsed.get("title"), parsed.get("body")):
                    self.feuerwehr_dropped_count += 1
                    self.url_cache.mark_scraped(url)
                    continue

                article = Article(
                    title=parsed["title"],
                    date=parsed["date"],
                    city=parsed["city"],
                    bundesland="Sachsen-Anhalt",
                    agency_code=None,
                    source="Polizei Sachsen-Anhalt",
                    url=parsed["url"],
                    body=parsed["body"],
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
        print("Async Polizei Sachsen-Anhalt Scraper")
        print("=" * 60)
        print(f"Source: {BASE_URL}{LISTING_PATH}")
        print(f"Concurrent requests: {self.concurrent_requests}")
        if self.start_date:
            print(f"Start date: {self.start_date.date()}")
        if self.end_date:
            print(f"End date: {self.end_date.date()}")
        print()

        start_time = time.time()

        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
        }

        ssl_context = ssl.create_default_context(cafile=certifi.where())
        connector = aiohttp.TCPConnector(ssl=ssl_context, limit=self.concurrent_requests)
        semaphore = asyncio.Semaphore(self.concurrent_requests)

        async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
            # Phase 1: Discover article URLs from listing pages
            article_infos = await self._discover_articles(session, semaphore)

            if not article_infos:
                print("No articles found to scrape")
                self.url_cache.save()
                return

            # Phase 2: Fetch and parse article pages concurrently
            print(f"\nScraping {len(article_infos)} articles with {self.concurrent_requests} concurrent requests...")
            self.articles = await self._scrape_articles(session, article_infos, semaphore)

        elapsed = time.time() - start_time

        # Save URL cache
        self.url_cache.save()

        # Write scrape metadata
        meta = {
            "source": "sachsen_anhalt",
            "pages_visited": self.pages_visited,
            "pages_with_content": self.pages_with_content,
            "articles_per_page": 20,
            "source_total": None,
            "estimated_total": self.pages_with_content * 20,
            "articles_scraped": len(self.articles),
            "articles_cached_skip": self.skipped_cached_count,
            "articles_feuerwehr_skip": self.feuerwehr_dropped_count,
            "stop_reason": self.stop_reason,
            "fetch_count": self.fetch_count,
            "fetch_errors": self.fetch_errors,
            "scrape_duration_s": round(elapsed, 1),
        }
        meta_path = self.output.rsplit('.json', 1)[0] + '.meta.json'
        Path(meta_path).parent.mkdir(parents=True, exist_ok=True)
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

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
        description="Async scrape police press releases from Polizei Sachsen-Anhalt",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 scripts/scrapers/scrape_sachsen_anhalt.py --start-date 2026-01-01 --end-date 2026-01-31
  python3 scripts/scrapers/scrape_sachsen_anhalt.py --max-pages 5 --verbose
  python3 scripts/scrapers/scrape_sachsen_anhalt.py --start-date 2026-02-01 -o data/sa_feb.json
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
        help="Maximum number of listing pages to scrape (0 = no limit)",
    )

    parser.add_argument(
        "--output", "-o",
        type=str,
        default="sachsen_anhalt_polizei.json",
        help="Output JSON file path (default: sachsen_anhalt_polizei.json)",
    )

    parser.add_argument(
        "--verbose", "-v",
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
        help="Directory for URL cache (default: .cache)",
    )

    args = parser.parse_args()

    # Validate dates
    for date_arg, label in [(args.start_date, "start"), (args.end_date, "end")]:
        if date_arg:
            try:
                datetime.fromisoformat(date_arg)
            except ValueError:
                print(f"Error: Invalid {label} date format: {date_arg}")
                print("Use ISO format: YYYY-MM-DD")
                sys.exit(1)

    scraper = AsyncSachsenAnhaltScraper(
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


async def scrape_new(start_date: str, end_date: str,
                     cache_dir: str = ".cache", concurrent: int = 5) -> list[dict]:
    """Return new articles as dicts. Used by live pipeline."""
    out = os.path.join(cache_dir, "_live_sachsen_anhalt.json")
    scraper = AsyncSachsenAnhaltScraper(
        start_date=start_date,
        end_date=end_date,
        output=out,
        cache_dir=cache_dir,
        concurrent_requests=concurrent,
    )
    await scraper.run_async()
    return [asdict(a) for a in scraper.articles]


if __name__ == "__main__":
    main()
