#!/usr/bin/env python3
"""
Async Brandenburg Polizei Pressemeldungen Scraper.

Scrapes police press releases from polizei.brandenburg.de using the
search API at /suche/typ/Meldungen/kategorie/... for URL discovery.

The search API supports:
  - Category pre-filtering (default: Kriminalität)
  - Date range via ?zeitraum=YYYY-MM-DD_YYYY-MM-DD
  - 50 results per page via /limit/50?fullResultList=1
  - Server-rendered HTML (no JS needed)

Individual article pages use a CMS with `data-iw-field` attributes
for reliable field extraction.

Usage:
    python3 scripts/scrapers/scrape_brandenburg_polizei.py --start-date 2026-01-01 --end-date 2026-01-31
    python3 scripts/scrapers/scrape_brandenburg_polizei.py --start-date 2025-06-01 --end-date 2026-02-01 -o data/brandenburg.json
    python3 scripts/scrapers/scrape_brandenburg_polizei.py --test --verbose  # diagnostic dump
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
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import aiohttp
import certifi
from bs4 import BeautifulSoup

# Fix SSL on macOS - certifi provides Mozilla's CA bundle
os.environ['SSL_CERT_FILE'] = certifi.where()

# Force unbuffered stdout for real-time log streaming when spawned as subprocess
import functools
print = functools.partial(print, flush=True)  # type: ignore[assignment]

# Constants
BASE_URL = "https://polizei.brandenburg.de"
USER_AGENT = "adlerlicht/1.0 (+contact: scraper@adlerlicht.de)"

# Search API URL template
# {category} is percent-encoded (e.g. Kriminalit%C3%A4t)
# {page} is 1-indexed page number
# {start} and {end} are YYYY-MM-DD
# Pagination path: /{page}/1 — the /1 is a fixed sort-order param
SEARCH_URL_TPL = (
    BASE_URL + "/suche/typ/Meldungen/kategorie/{category}"
    "/{page}/1?zeitraum={start}_{end}"
)
SEARCH_RESULTS_PER_PAGE = 10
SEARCH_DELAY_SECONDS = 1.5  # slightly slower to avoid rate limiting

# Default category filter (percent-encoded Kriminalität)
DEFAULT_CATEGORY = "Kriminalit%C3%A4t"

# Async configuration
CONCURRENT_REQUESTS = 8
DELAY_BETWEEN_BATCHES = 1.5  # polizei.brandenburg.de rate-limits aggressively
REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3
MAX_SEARCH_PAGES = 300  # safety cap — stops runaway pagination

# Feuerwehr filter pattern - drop fire department articles
FEUERWEHR_PATTERN = re.compile(
    r'Feuerwehr|^FW[ -]|Berufsfeuerwehr|Freiwillige Feuerwehr',
    re.IGNORECASE,
)


@dataclass
class Article:
    """Represents a scraped press release article (same schema as other scrapers)."""
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
    """Persistent cache for tracking already-scraped article URLs."""

    def __init__(self, cache_dir: str = ".cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / "scraped_urls_brandenburg.json"
        self.urls: dict[str, str] = {}  # url -> timestamp
        self._load()

    def _load(self) -> None:
        if self.cache_file.exists():
            try:
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    self.urls = json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Could not load scraped URLs cache: {e}")
                self.urls = {}

    def save(self) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        with open(self.cache_file, "w", encoding="utf-8") as f:
            json.dump(self.urls, f, ensure_ascii=False, indent=2)

    def is_scraped(self, url: str) -> bool:
        return url in self.urls

    def mark_scraped(self, url: str) -> None:
        self.urls[url] = datetime.now().isoformat()

    def __len__(self) -> int:
        return len(self.urls)


def is_feuerwehr(title: Optional[str], body: Optional[str] = None) -> bool:
    """Check if article is from a fire department (not police)."""
    if title and FEUERWEHR_PATTERN.search(title):
        return True
    if body and FEUERWEHR_PATTERN.search(body[:200]):
        return True
    return False


def parse_german_date(text: str) -> Optional[str]:
    """Parse DD.MM.YYYY into ISO YYYY-MM-DD format."""
    if not text:
        return None
    match = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", text.strip())
    if match:
        day, month, year = match.groups()
        return f"{year}-{month}-{day}"
    return None


def parse_search_results(html: str) -> list[dict]:
    """Parse a search result page and extract article info.

    Each search result on polizei.brandenburg.de is an <li> containing:
      - Two <a> links to the same article (image + heading)
      - Title in <strong> inside the <h4> link
      - Date text "Artikel vom DD.MM.YYYY" in a <span>
      - Landkreis as <a href="/suche/typ/Meldungen/landkreis/...">

    Returns list of dicts with 'url', 'title', 'date', 'region'.
    Returns empty list when no results found (signals end of pagination).
    """
    soup = BeautifulSoup(html, "html.parser")
    results = []
    seen_hrefs: set[str] = set()

    # Each result is in an <li> that contains links to /pressemeldung/
    for li in soup.find_all("li"):
        link = li.find("a", href=re.compile(r"/pressemeldung/"))
        if not link:
            continue

        href = link.get("href", "")
        if not href or href in seen_hrefs:
            continue
        seen_hrefs.add(href)

        # Build full URL
        if href.startswith("/"):
            url = BASE_URL + href
        else:
            url = href

        # Title: prefer <strong> inside an <h4> link (clean title without teaser)
        title = ""
        h4 = li.find("h4")
        if h4:
            strong = h4.find("strong")
            if strong:
                title = strong.get_text(strip=True)
            else:
                title = h4.get_text(strip=True)
        if not title:
            title = link.get_text(strip=True)

        # Date: "Artikel vom DD.MM.YYYY" in the <span> or <p>
        date_str = None
        li_text = li.get_text()
        date_str = parse_german_date(li_text)

        # Region/Landkreis: linked via /landkreis/ URL
        region = None
        landkreis_link = li.find("a", href=re.compile(r"/landkreis/"))
        if landkreis_link:
            region = landkreis_link.get_text(strip=True)

        results.append({
            "url": url,
            "title": title,
            "date": date_str,
            "region": region,
        })

    return results


def parse_article_page(html: str, url: str) -> Optional[dict]:
    """Parse a Brandenburg Polizei article page.

    Uses the CMS `data-iw-field` attributes for reliable extraction:
      - Title: h1.pbb-mainheadline (data-iw-field="title")
      - Date: #pbb-metadata dd[data-iw-field="datum"] — format DD.MM.YYYY
      - City: p.pbb-ort (data-iw-field="ort")
      - District: p.pbb-landkreis (data-iw-field="landkreis")
      - Body: div.pbb-article-text (data-iw-field="text")
      - Agency: p[data-iw-field="adresse"] — first text before <br/>
      - Category: #pbb-metadata dd after dt[data-iw-field="kategorie"]
    """
    soup = BeautifulSoup(html, "html.parser")

    # Title
    title_el = soup.select_one('h1.pbb-mainheadline') or soup.select_one('h1[data-iw-field="title"]') or soup.select_one('h1')
    title = title_el.get_text(strip=True) if title_el else "Ohne Titel"

    # Date
    date_str = None
    date_el = soup.select_one('dd[data-iw-field="datum"]')
    if date_el:
        date_str = parse_german_date(date_el.get_text(strip=True))

    # If not found via data-iw-field, try metadata section
    if not date_str:
        meta_section = soup.select_one('#pbb-metadata')
        if meta_section:
            text = meta_section.get_text()
            date_str = parse_german_date(text)

    # Fallback: search entire page
    if not date_str:
        page_text = soup.get_text()
        date_str = parse_german_date(page_text)

    # City (Ort)
    city = None
    city_el = soup.select_one('p.pbb-ort') or soup.select_one('[data-iw-field="ort"]')
    if city_el:
        city = city_el.get_text(strip=True)

    # District (Landkreis) — use as fallback for city
    district = None
    district_el = soup.select_one('p.pbb-landkreis') or soup.select_one('[data-iw-field="landkreis"]')
    if district_el:
        district = district_el.get_text(strip=True)

    if not city and district:
        city = district

    # Agency (Adresse) — extract source agency name
    agency = None
    agency_el = soup.select_one('[data-iw-field="adresse"]')
    if agency_el:
        # First text node before any <br/> is the agency name
        first_text = agency_el.find(string=True, recursive=False)
        if first_text:
            agency = first_text.strip()

    # Body text
    body_el = soup.select_one('div.pbb-article-text') or soup.select_one('[data-iw-field="text"]')
    body = ""
    if body_el:
        # Strip nested <span> wrappers that the CMS injects (triple <span>)
        # and extract clean paragraph text
        paragraphs = body_el.find_all(['p', 'li'])
        if paragraphs:
            body_parts = []
            for p in paragraphs:
                text = p.get_text(strip=True)
                if text:
                    body_parts.append(text)
            body = "\n\n".join(body_parts)
        else:
            # Fallback: get all text from the body div
            body = body_el.get_text("\n\n", strip=True)

    # Category
    category = None
    cat_dt = soup.select_one('dt[data-iw-field="kategorie"]')
    if cat_dt:
        cat_dd = cat_dt.find_next_sibling('dd')
        if cat_dd:
            category = cat_dd.get_text(strip=True)

    return {
        "title": title,
        "date": date_str or "",
        "city": city,
        "district": district,
        "agency": agency,
        "category": category,
        "body": body,
        "url": url,
    }


class AsyncBrandenburgPolizeiScraper:
    """
    Async scraper for Brandenburg Polizei Pressemeldungen.

    Uses the search API at /suche/typ/Meldungen/kategorie/... for
    pre-filtered URL discovery, then scrapes individual article pages
    concurrently.
    """

    def __init__(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        max_pages: int = 0,
        output: str = "brandenburg_polizei_reports.json",
        verbose: bool = False,
        concurrent_requests: int = CONCURRENT_REQUESTS,
        cache_dir: str = ".cache",
        category: str = DEFAULT_CATEGORY,
    ):
        self.start_date: Optional[date] = (
            datetime.fromisoformat(start_date).date() if start_date else None
        )
        self.end_date: Optional[date] = (
            datetime.fromisoformat(end_date).date() if end_date else None
        )
        self.max_pages = max_pages  # max search pages to paginate (not articles)
        self.output = output
        self.verbose = verbose
        self.concurrent_requests = concurrent_requests
        self.category = category

        self.articles: list[Article] = []
        self.seen_urls: set[str] = set()
        self.url_cache = ScrapedUrlsCache(cache_dir)
        self.skipped_cached_count = 0
        self.feuerwehr_dropped_count = 0

        # Stats
        self.fetch_count = 0
        self.fetch_errors = 0
        self.search_pages_fetched = 0
        self.search_results_found = 0

        # Metadata tracking
        self.pages_visited = 0
        self.stop_reason = "completed"

    def _build_search_url(self, page: int) -> str:
        """Build search API URL for a given page number."""
        start = self.start_date.isoformat() if self.start_date else "2020-01-01"
        end = self.end_date.isoformat() if self.end_date else date.today().isoformat()
        return SEARCH_URL_TPL.format(
            category=self.category,
            page=page,
            start=start,
            end=end,
        )

    def _is_article_date_in_range(self, date_str: Optional[str]) -> bool:
        """Exact date filter using the article's actual publication date."""
        if not date_str:
            return True  # Keep articles with unknown dates
        try:
            article_date = datetime.fromisoformat(date_str[:10]).date()
            if self.start_date and article_date < self.start_date:
                return False
            if self.end_date and article_date > self.end_date:
                return False
            return True
        except (ValueError, AttributeError):
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
                        elif response.status in (403, 429):
                            # 403 from this site = rate limiting, treat like 429
                            wait_time = min(2 ** (attempt + 1), 10)
                            print(f"  Rate limited ({response.status}) on attempt {attempt+1}/{MAX_RETRIES}, waiting {wait_time}s...")
                            await asyncio.sleep(wait_time)
                        elif response.status == 404:
                            print(f"  404 Not Found: {url}")
                            return None
                        elif response.status >= 500:
                            wait_time = 2 ** attempt
                            print(f"  HTTP {response.status} for {url}, retrying in {wait_time}s...")
                            await asyncio.sleep(wait_time)
                        else:
                            print(f"  HTTP {response.status} for {url}")
                            return None
                except asyncio.TimeoutError:
                    print(f"  Timeout ({attempt+1}/{MAX_RETRIES}): {url}")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(2 ** attempt)
                except aiohttp.ClientError as e:
                    print(f"  Client error ({attempt+1}/{MAX_RETRIES}): {url}: {e}")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(2 ** attempt)

            self.fetch_errors += 1
            print(f"  FAILED after {MAX_RETRIES} retries: {url}")
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

    async def _discover_from_search(
        self,
        session: aiohttp.ClientSession,
        semaphore: asyncio.Semaphore,
    ) -> list[dict]:
        """Paginate through the search API to discover article URLs.

        Fetches search result pages sequentially, parsing each for article
        links. Stops when an empty page is returned, 3 consecutive empty
        pages occur, or --max-pages limit is reached.
        """
        all_entries: list[dict] = []
        page = 1
        consecutive_empty = 0

        print(f"Discovering articles via search API (category: {self.category})...")
        if self.start_date:
            print(f"  Date range: {self.start_date} to {self.end_date or 'today'}")

        while True:
            effective_max = self.max_pages if self.max_pages > 0 else MAX_SEARCH_PAGES
            if page > effective_max:
                print(f"  Reached max pages limit ({effective_max})")
                self.stop_reason = "max_pages"
                break

            url = self._build_search_url(page)
            if self.verbose:
                print(f"  Fetching search page {page}: {url}")

            html = await self._fetch_url(session, url, semaphore)
            self.search_pages_fetched += 1

            if not html:
                print(f"  Page {page}: failed to fetch")
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    self.stop_reason = "consecutive_empty"
                    break
                page += 1
                await asyncio.sleep(SEARCH_DELAY_SECONDS)
                continue

            results = parse_search_results(html)

            if not results:
                if self.verbose:
                    print(f"  Page {page}: no results found, stopping")
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    self.stop_reason = "consecutive_empty"
                    break
                # If first page is empty, no results at all
                if page == 1:
                    self.stop_reason = "no_results"
                    break
                page += 1
                await asyncio.sleep(SEARCH_DELAY_SECONDS)
                continue

            consecutive_empty = 0
            page_added = 0

            for entry in results:
                article_url = entry["url"]

                # Dedup
                if article_url in self.seen_urls:
                    continue
                self.seen_urls.add(article_url)

                # Skip if already in persistent cache
                if self.url_cache.is_scraped(article_url):
                    self.skipped_cached_count += 1
                    continue

                all_entries.append(entry)
                page_added += 1

            self.search_results_found += len(results)

            if self.verbose or page <= 3:
                print(f"  Page {page}: {len(results)} results, {page_added} new URLs")

            # If we got fewer results than a full page, we're on the last page
            if len(results) < SEARCH_RESULTS_PER_PAGE:
                if self.verbose:
                    print(f"  Page {page}: partial page ({len(results)} < {SEARCH_RESULTS_PER_PAGE}), last page")
                break

            page += 1
            await asyncio.sleep(SEARCH_DELAY_SECONDS)

        if self.skipped_cached_count > 0:
            print(f"  Skipped {self.skipped_cached_count} already-scraped articles (cache)")
        print(f"  {len(all_entries)} articles to scrape from {self.search_pages_fetched} search pages")
        return all_entries

    async def _scrape_articles(
        self,
        session: aiohttp.ClientSession,
        article_entries: list[dict],
        semaphore: asyncio.Semaphore,
    ) -> list[Article]:
        """Fetch and parse article pages concurrently in batches."""
        articles = []
        total = len(article_entries)
        batch_size = self.concurrent_requests
        date_skipped = 0

        for i in range(0, total, batch_size):
            batch = article_entries[i:i + batch_size]
            urls = [e["url"] for e in batch]

            results = await self._fetch_batch(session, urls, semaphore)
            self.pages_visited += len(batch)

            for url, html in results:
                if not html:
                    continue

                parsed = parse_article_page(html, url)
                if not parsed:
                    continue

                # Verify exact article date is in range
                if not self._is_article_date_in_range(parsed.get("date")):
                    date_skipped += 1
                    self.url_cache.mark_scraped(url)
                    continue

                # Drop Feuerwehr articles
                if is_feuerwehr(parsed.get("title"), parsed.get("body")):
                    self.feuerwehr_dropped_count += 1
                    self.url_cache.mark_scraped(url)
                    continue

                # Build places list from city + district
                places = []
                if parsed.get("city"):
                    places.append(parsed["city"])
                if parsed.get("district") and parsed["district"] != parsed.get("city"):
                    places.append(parsed["district"])

                article = Article(
                    title=parsed["title"],
                    date=parsed["date"],
                    city=parsed.get("city"),
                    bundesland="Brandenburg",
                    agency_code=None,
                    source=parsed.get("agency") or "Polizei Brandenburg",
                    url=parsed["url"],
                    body=parsed.get("body", ""),
                    places=places,
                    themes=[parsed["category"]] if parsed.get("category") else [],
                )
                articles.append(article)
                self.url_cache.mark_scraped(url)

            progress = min(i + batch_size, total)
            print(f"  Scraped {progress}/{total} articles ({len(articles)} success)")

            if i + batch_size < total:
                await asyncio.sleep(DELAY_BETWEEN_BATCHES)

        if date_skipped > 0:
            print(f"  Skipped {date_skipped} articles outside date range (exact date check)")

        return articles

    async def run_async(self) -> None:
        """Execute the async scraping pipeline."""
        print("=" * 60)
        print("Async Brandenburg Polizei Pressemeldungen Scraper")
        print("=" * 60)
        print(f"Source: {BASE_URL}")
        print(f"Discovery: search API (category: {self.category})")
        print(f"Concurrent requests: {self.concurrent_requests}")
        if self.start_date:
            print(f"Start date: {self.start_date}")
        if self.end_date:
            print(f"End date: {self.end_date}")
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
            # Phase 1: Discover article URLs from search API
            article_entries = await self._discover_from_search(session, semaphore)

            if not article_entries:
                print("\nNo articles found to scrape.")
                self.url_cache.save()
                return

            # Phase 2: Fetch and parse article pages concurrently
            print(f"\nScraping {len(article_entries)} articles with "
                  f"{self.concurrent_requests} concurrent requests...")
            self.articles = await self._scrape_articles(
                session, article_entries, semaphore
            )

        elapsed = time.time() - start_time

        # Save URL cache
        self.url_cache.save()

        # Write scrape metadata
        meta = {
            "source": "brandenburg_polizei",
            "discovery_method": "search_api",
            "category_filter": self.category,
            "search_pages_fetched": self.search_pages_fetched,
            "search_results_found": self.search_results_found,
            "pages_visited": self.pages_visited,
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
        print(f"Elapsed time: {elapsed:.1f}s ({elapsed/60:.1f} min)")
        print(f"Fetch stats: {self.fetch_count} requests, {self.fetch_errors} errors")
        if self.articles:
            print(f"Speed: {len(self.articles)/elapsed:.1f} articles/sec")
        print("=" * 60)

    def run(self) -> None:
        """Synchronous entry point - runs the async pipeline."""
        asyncio.run(self.run_async())


async def run_test(verbose: bool = False, category: str = DEFAULT_CATEGORY) -> None:
    """Fetch a search page and a sample article, print diagnostics."""
    print("=" * 60)
    print("TEST MODE — Diagnostic dump of polizei.brandenburg.de search API")
    print("=" * 60)

    ssl_context = ssl.create_default_context(cafile=certifi.where())
    connector = aiohttp.TCPConnector(ssl=ssl_context)
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
    }

    async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
        # 1. Fetch search page
        today = date.today().isoformat()
        month_ago = date.today().replace(day=1).isoformat()
        search_url = SEARCH_URL_TPL.format(
            category=category,
            page=1,
            start=month_ago,
            end=today,
        )
        print(f"\n[1] Fetching search page: {search_url}")
        try:
            async with session.get(
                search_url,
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                html = await resp.text()
                print(f"    Status: {resp.status}")
                print(f"    Content-Type: {resp.headers.get('Content-Type', '?')}")
                print(f"    HTML length: {len(html)} chars")

                # Parse search results
                results = parse_search_results(html)
                print(f"    Parsed results: {len(results)}")

                for i, r in enumerate(results[:5]):
                    print(f"    [{i}] {r['date'] or '???'} | {r['title'][:60]} | {r['url'][-40:]}")

                if not results:
                    # Show some HTML structure to debug
                    soup = BeautifulSoup(html, "html.parser")
                    all_links = soup.find_all("a", href=True)
                    press_links = [a for a in all_links if "/pressemeldung/" in a.get("href", "")]
                    print(f"    Total links on page: {len(all_links)}")
                    print(f"    Press release links: {len(press_links)}")
                    for a in press_links[:5]:
                        print(f"      href={a['href']}")
                        print(f"      text={a.get_text(strip=True)[:60]}")

                    # Show page structure
                    headings = soup.find_all(["h1", "h2", "h3"])
                    print(f"    Headings: {len(headings)}")
                    for h in headings[:5]:
                        print(f"      <{h.name}>: {h.get_text(strip=True)[:60]}")

                if verbose:
                    print(f"\n    --- Raw HTML (first 5000 chars) ---")
                    print(html[:5000])
                    print(f"    --- End ---")
        except Exception as e:
            print(f"    ERROR: {e}")
            return

        # 2. Fetch a sample article
        if results:
            sample_url = results[0]["url"]
            print(f"\n[2] Fetching sample article: {sample_url}")
            try:
                async with session.get(
                    sample_url,
                    timeout=aiohttp.ClientTimeout(total=30),
                ) as resp:
                    html = await resp.text()
                    print(f"    Status: {resp.status}")

                    parsed = parse_article_page(html, sample_url)
                    if parsed:
                        print(f"    Title:    {parsed['title'][:70]}")
                        print(f"    Date:     {parsed['date']}")
                        print(f"    City:     {parsed['city']}")
                        print(f"    District: {parsed['district']}")
                        print(f"    Agency:   {parsed['agency']}")
                        print(f"    Category: {parsed['category']}")
                        print(f"    Body:     {len(parsed['body'])} chars")
                        if parsed['body']:
                            print(f"    Body[0:200]: {parsed['body'][:200]}")
                    else:
                        print("    WARNING: Failed to parse article!")

                    if verbose:
                        print(f"\n    --- Article HTML (first 3000 chars) ---")
                        print(html[:3000])
                        print(f"    --- End ---")
            except Exception as e:
                print(f"    ERROR: {e}")
        else:
            print("\n[2] Skipping sample article — no results found")

    print("\n" + "=" * 60)
    print("TEST COMPLETE")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Async scrape police press releases from Polizei Brandenburg",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 scripts/scrapers/scrape_brandenburg_polizei.py --start-date 2026-01-01 --end-date 2026-01-31
  python3 scripts/scrapers/scrape_brandenburg_polizei.py --start-date 2025-01-01 --end-date 2026-02-01 -o data/brandenburg.json
  python3 scripts/scrapers/scrape_brandenburg_polizei.py --test --verbose
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
        help="Maximum number of search pages to paginate (0 = no limit)",
    )

    parser.add_argument(
        "--output", "-o",
        type=str,
        default="brandenburg_polizei_reports.json",
        help="Output JSON file path (default: brandenburg_polizei_reports.json)",
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

    parser.add_argument(
        "--test",
        action="store_true",
        help="Test mode: fetch search page + sample article and print diagnostics",
    )

    parser.add_argument(
        "--category",
        type=str,
        default=DEFAULT_CATEGORY,
        help="Category filter for search API (default: Kriminalität, URL-encoded)",
    )

    args = parser.parse_args()

    # Validate dates
    for label, val in [("start", args.start_date), ("end", args.end_date)]:
        if val:
            try:
                datetime.fromisoformat(val)
            except ValueError:
                print(f"Error: Invalid {label} date format: {val}")
                print("Use ISO format: YYYY-MM-DD")
                sys.exit(1)

    # Test mode
    if args.test:
        asyncio.run(run_test(verbose=args.verbose, category=args.category))
        return

    scraper = AsyncBrandenburgPolizeiScraper(
        start_date=args.start_date,
        end_date=args.end_date,
        max_pages=args.max_pages,
        output=args.output,
        verbose=args.verbose,
        concurrent_requests=args.concurrent,
        cache_dir=args.cache_dir,
        category=args.category,
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
    out = os.path.join(cache_dir, "_live_brandenburg.json")
    scraper = AsyncBrandenburgPolizeiScraper(
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
