#!/usr/bin/env python3
"""
Async Sachsen Polizeidirektion Scraper — medienservice.sachsen.de

Scrapes police press releases from all 5 Sachsen Polizeidirektionen via the
medienservice.sachsen.de JSON search API (/medien/news/search.json).

The portal uses a Rails backend with a JSON API that returns HTML teasers.
Pagination uses `page=N` (6 items per page). Date filtering via
`search[from]` and `search[to]` (DD.MM.YYYY format).

Polizeidirektionen and their institution IDs:
  Chemnitz  = 10996
  Dresden   = 10997
  Goerlitz  = 10998
  Leipzig   = 10976
  Zwickau   = 10999

Usage:
    python3 scripts/scrapers/scrape_sachsen_polizei.py --start-date 2026-01-01 --end-date 2026-01-31
    python3 scripts/scrapers/scrape_sachsen_polizei.py --max-pages 5 --verbose
    python3 scripts/scrapers/scrape_sachsen_polizei.py --test  # dump raw HTML for debugging
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
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urlencode, urljoin

import aiohttp
import certifi
from bs4 import BeautifulSoup

# Fix SSL on macOS — certifi provides Mozilla's CA bundle
os.environ["SSL_CERT_FILE"] = certifi.where()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
BASE_URL = "https://medienservice.sachsen.de"
SEARCH_API = f"{BASE_URL}/medien/news/search.json"
ARTICLE_URL_TPL = f"{BASE_URL}/medien/news/{{id}}"
USER_AGENT = "kanakmap-scraper/1.0 (+https://github.com/kanakmap)"

# Polizeidirektionen — institution_id -> (display name, primary city)
POLIZEIDIREKTIONEN = {
    10996: ("Polizeidirektion Chemnitz", "Chemnitz"),
    10997: ("Polizeidirektion Dresden", "Dresden"),
    10998: ("Polizeidirektion Görlitz", "Görlitz"),
    10976: ("Polizeidirektion Leipzig", "Leipzig"),
    10999: ("Polizeidirektion Zwickau", "Zwickau"),
}

# Items per page (fixed by the API)
ITEMS_PER_PAGE = 6

# Async settings
DEFAULT_CONCURRENT = 15
DELAY_BETWEEN_BATCHES = 0.3
REQUEST_TIMEOUT = 30
MAX_RETRIES = 3

# Feuerwehr filter — drop fire dept articles
FEUERWEHR_PATTERN = re.compile(
    r"Feuerwehr|^FW[ -]|Berufsfeuerwehr|Freiwillige Feuerwehr",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------
@dataclass
class Article:
    """Scraped press release from Sachsen Polizei."""

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


# ---------------------------------------------------------------------------
# URL cache (same pattern as presseportal scraper)
# ---------------------------------------------------------------------------
class ScrapedUrlsCache:
    """Persistent cache tracking already-scraped article URLs."""

    def __init__(self, cache_dir: str = ".cache", filename: str = "scraped_urls_sachsen.json"):
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / filename
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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def is_feuerwehr(source: Optional[str], title: Optional[str] = None) -> bool:
    """Return True if article is from a fire department (not police)."""
    if source and FEUERWEHR_PATTERN.search(source):
        return True
    if title and re.match(r"^FW[ -]", title):
        return True
    return False


def parse_german_datetime(date_str: str) -> Optional[str]:
    """Convert 'DD.MM.YYYY HH:MM' or 'DD.MM.YYYY, HH:MM Uhr' to ISO."""
    if not date_str:
        return None
    # Already ISO
    if re.match(r"\d{4}-\d{2}-\d{2}", date_str):
        return date_str[:10]
    # German: "08.02.2026 09:06" or "08.02.2026, 09:06 Uhr"
    m = re.match(r"(\d{2})\.(\d{2})\.(\d{4})[,\s]+(\d{2}):(\d{2})", date_str)
    if m:
        day, month, year, hour, minute = m.groups()
        return f"{year}-{month}-{day}T{hour}:{minute}:00"
    # Date only: "08.02.2026"
    m = re.match(r"(\d{2})\.(\d{2})\.(\d{4})", date_str)
    if m:
        day, month, year = m.groups()
        return f"{year}-{month}-{day}"
    return None


def extract_date_only(iso_str: Optional[str]) -> Optional[str]:
    """Return just the YYYY-MM-DD portion."""
    if not iso_str:
        return None
    return iso_str[:10]


def parse_teaser_html(teaser_html: str) -> Optional[dict]:
    """
    Parse a single teaser HTML snippet from the search API.

    Returns dict with keys: id, title, date_str, source_name, url
    """
    soup = BeautifulSoup(teaser_html, "html.parser")

    # Article ID from box div: <div class="box teaser" id="box-1094810">
    box = soup.select_one(".box.teaser")
    if not box:
        return None
    box_id = box.get("id", "")
    article_id = box_id.replace("box-", "") if box_id.startswith("box-") else None
    if not article_id:
        return None

    # Title from the link: <a title="Lesen Sie den Artikel ...">
    link = soup.select_one(".box-footer a[href*='/medien/news/']")
    if not link:
        return None
    href = link.get("href", "")
    url = urljoin(BASE_URL, href) if href else None

    # Title is in the teaser-text div (not the link title attribute which is verbose)
    teaser_text = soup.select_one(".teaser-text")
    title = ""
    if teaser_text:
        # Title text is the direct text content (not inside <p class="time">)
        time_elem = teaser_text.select_one("p.time")
        if time_elem:
            time_elem.extract()
        title = teaser_text.get_text(strip=True)

    # Date from <p class="time">08.02.2026, 09:06 Uhr</p>
    # (we already extracted it, re-parse)
    soup2 = BeautifulSoup(teaser_html, "html.parser")
    time_p = soup2.select_one("p.time")
    date_str = time_p.get_text(strip=True) if time_p else None

    # Source from overlay: <div class="box-media-overlay"><p>Polizeidirektion Dresden</p></div>
    overlay = soup2.select_one(".box-media-overlay p")
    source_name = overlay.get_text(strip=True) if overlay else None

    return {
        "id": article_id,
        "title": title or "Ohne Titel",
        "date_str": date_str,
        "source_name": source_name,
        "url": url,
    }


def parse_article_page(html: str, url: str) -> Optional[dict]:
    """
    Parse a full article page to extract title, date, body, source.

    The article page structure (medienservice.sachsen.de):
      <h1 id="page-title">Title</h1>
      <p class="publish-info">08.02.2026, 09:06 Uhr -- Erstveröffentlichung</p>
      <div class="content-col-wide">
        <h2>Medieninformation Polizeidirektion Dresden Nr. 65|26</h2>
        <h2>Landeshauptstadt Dresden</h2>
        <h3>Incident Title</h3>
        <p>Zeit: ... Ort: ...</p>
        <p>Body text...</p>
        ...
      </div>

    Meta tags (second occurrence is the article-specific one):
      <meta name="title" content="..."/>
      <meta name="subtitle" content="Medieninformation Polizeidirektion Dresden Nr. 65|26"/>
      <meta name="date" content="08.02.2026 09:06"/>
      <meta name="author" content="Polizeidirektion Dresden"/>
    """
    soup = BeautifulSoup(html, "html.parser")

    # --- Title ---
    title = None
    h1 = soup.select_one("h1#page-title")
    if h1:
        title = h1.get_text(strip=True)
    if not title:
        # Fallback to meta title (take the last one, which is article-specific)
        title_metas = soup.select('meta[name="title"]')
        if title_metas:
            title = title_metas[-1].get("content", "").strip()
    if not title:
        title = "Ohne Titel"

    # --- Date ---
    date_str = None
    # Prefer meta date (the second one is article-specific)
    date_metas = soup.select('meta[name="date"]')
    if len(date_metas) >= 2:
        date_str = date_metas[-1].get("content", "").strip()
    elif date_metas:
        date_str = date_metas[-1].get("content", "").strip()

    # Fallback: publish-info element
    if not date_str:
        pub_info = soup.select_one("p.publish-info")
        if pub_info:
            text = pub_info.get_text(strip=True)
            m = re.match(r"(\d{2}\.\d{2}\.\d{4}[,\s]+\d{2}:\d{2})", text)
            if m:
                date_str = m.group(1)

    iso_date = parse_german_datetime(date_str) if date_str else None

    # --- Source (author) ---
    source = None
    author_metas = soup.select('meta[name="author"]')
    for meta in reversed(author_metas):
        content = meta.get("content", "").strip()
        if "Polizeidirektion" in content or "Polizei" in content:
            source = content
            break
    # If no police-specific author, take last author meta
    if not source and author_metas:
        source = author_metas[-1].get("content", "").strip()

    # --- Subtitle (contains PD info and release number) ---
    subtitle = None
    subtitle_metas = soup.select('meta[name="subtitle"]')
    if subtitle_metas:
        subtitle = subtitle_metas[-1].get("content", "").strip()

    # --- Body ---
    body = ""
    content_col = soup.select_one(".content-col-wide")
    if content_col:
        # Get all text content, preserving paragraph structure
        paragraphs = []
        for elem in content_col.find_all(["p", "h2", "h3", "h4"]):
            text = elem.get_text(strip=True)
            if text:
                paragraphs.append(text)
        body = "\n\n".join(paragraphs)
    else:
        # Fallback: get text from main content
        main = soup.select_one("#main-content")
        if main:
            body = main.get_text(separator="\n", strip=True)

    # --- City extraction ---
    city = None

    # Try to extract from h2 headings in the body (e.g., "Landeshauptstadt Dresden",
    # "Landkreis Meissen", "Stadt Chemnitz")
    if content_col:
        h2s = content_col.select("h2")
        for h2 in h2s:
            text = h2.get_text(strip=True)
            # Skip the "Medieninformation PD..." header
            if text.startswith("Medieninformation"):
                continue
            # "Landeshauptstadt Dresden" -> "Dresden"
            m = re.match(r"(?:Landeshauptstadt|Stadt)\s+(.+)", text)
            if m:
                city = m.group(1).strip()
                break
            # "Landkreis Meissen" -> keep as-is for now
            m = re.match(r"Landkreis\s+(.+)", text)
            if m:
                city = m.group(1).strip()
                break

    # Try "Ort:" pattern in body
    if not city and body:
        m = re.search(
            r"(?:Ort|Tatort|Einsatzort)\s*:\s*([A-ZÄÖÜ][a-zäöüß-]+(?:\s+[A-ZÄÖÜ][a-zäöüß-]+)*)",
            body,
        )
        if m:
            city = m.group(1).strip()

    return {
        "title": title,
        "date": iso_date,
        "city": city,
        "source": source,
        "subtitle": subtitle,
        "url": url,
        "body": body,
    }


# ---------------------------------------------------------------------------
# Scraper
# ---------------------------------------------------------------------------
class AsyncSachsenPolizeiScraper:
    """
    Async scraper for Sachsen Polizeidirektionen press releases.

    Uses the medienservice.sachsen.de JSON search API for listing discovery,
    then fetches individual article pages for full content.
    """

    def __init__(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        max_pages: int = 0,
        output: str = "sachsen_polizei_reports.json",
        verbose: bool = False,
        concurrent: int = DEFAULT_CONCURRENT,
        cache_dir: str = ".cache",
        institution_ids: Optional[list[int]] = None,
    ):
        self.start_date = datetime.fromisoformat(start_date) if start_date else None
        self.end_date = datetime.fromisoformat(end_date) if end_date else None
        self.max_pages = max_pages
        self.output = output
        self.verbose = verbose
        self.concurrent = concurrent
        self.institution_ids = institution_ids or list(POLIZEIDIREKTIONEN.keys())

        self.articles: list[Article] = []
        self.seen_urls: set[str] = set()
        self.url_cache = ScrapedUrlsCache(cache_dir)
        self.skipped_cached = 0
        self.feuerwehr_dropped = 0

        # Stats
        self.fetch_count = 0
        self.fetch_errors = 0

    def _build_search_url(self, page: int = 1) -> str:
        """Build the search API URL with institution and date filters."""
        params: list[tuple[str, str]] = []

        # Institution IDs
        for iid in self.institution_ids:
            params.append(("search[institution_ids][]", str(iid)))

        # Filter for press releases only (no social media)
        params.append(("search[filter][]", "press_releases"))

        # Date range
        if self.start_date:
            params.append(("search[from]", self.start_date.strftime("%d.%m.%Y")))
        if self.end_date:
            params.append(("search[to]", self.end_date.strftime("%d.%m.%Y")))

        # Pagination
        params.append(("page", str(page)))

        return f"{SEARCH_API}?{urlencode(params)}"

    def _is_in_date_range(self, iso_date: Optional[str]) -> bool:
        """Check if article date falls within configured range."""
        if not iso_date:
            return True
        if not self.start_date and not self.end_date:
            return True
        try:
            article_date = datetime.fromisoformat(iso_date.replace("Z", "+00:00")).replace(
                tzinfo=None
            )
            if self.start_date and article_date.date() < self.start_date.date():
                return False
            if self.end_date and article_date.date() > self.end_date.date():
                return False
            return True
        except (ValueError, AttributeError):
            return True

    async def _fetch(
        self,
        session: aiohttp.ClientSession,
        url: str,
        semaphore: asyncio.Semaphore,
        expect_json: bool = False,
    ) -> Optional[str | dict]:
        """Fetch a URL with retries and semaphore concurrency control."""
        async with semaphore:
            for attempt in range(MAX_RETRIES):
                try:
                    async with session.get(
                        url,
                        timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT),
                    ) as resp:
                        if resp.status == 200:
                            self.fetch_count += 1
                            if expect_json:
                                return await resp.json(content_type=None)
                            return await resp.text()
                        elif resp.status == 429:
                            wait = 2**attempt
                            if self.verbose:
                                print(f"  Rate limited on {url}, waiting {wait}s...")
                            await asyncio.sleep(wait)
                        else:
                            if self.verbose:
                                print(f"  HTTP {resp.status} for {url}")
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

    async def _discover_articles(
        self,
        session: aiohttp.ClientSession,
        semaphore: asyncio.Semaphore,
    ) -> list[dict]:
        """
        Paginate through the search API to discover all article URLs.

        The search API returns JSON with a `teaser` list (HTML snippets)
        and `disable: true` when there are no more results.
        """
        all_articles: list[dict] = []
        page = 1
        consecutive_empty = 0

        print(f"Discovering articles from {len(self.institution_ids)} Polizeidirektionen...")
        if self.start_date:
            print(
                f"  Date range: {self.start_date.date()} to "
                f"{self.end_date.date() if self.end_date else 'now'}"
            )

        while True:
            if self.max_pages > 0 and page > self.max_pages:
                print(f"  Reached max pages limit ({self.max_pages})")
                break

            url = self._build_search_url(page)
            data = await self._fetch(session, url, semaphore, expect_json=True)

            if not data or not isinstance(data, dict):
                print(f"  Page {page}: failed to fetch or invalid response")
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    break
                page += 1
                await asyncio.sleep(DELAY_BETWEEN_BATCHES)
                continue

            teasers = data.get("teaser", [])
            disabled = data.get("disable", False)

            if not teasers or disabled:
                if self.verbose:
                    print(f"  Page {page}: no teasers (disable={disabled}), stopping")
                break

            page_added = 0
            for teaser_html in teasers:
                info = parse_teaser_html(teaser_html)
                if not info or not info["url"]:
                    continue

                url_str = info["url"]

                # Deduplicate
                if url_str in self.seen_urls:
                    continue
                self.seen_urls.add(url_str)

                # Check persistent cache
                if self.url_cache.is_scraped(url_str):
                    self.skipped_cached += 1
                    continue

                # Check date range from teaser date
                if info["date_str"]:
                    iso = parse_german_datetime(info["date_str"])
                    if iso and not self._is_in_date_range(iso):
                        continue

                all_articles.append(info)
                page_added += 1

            if self.verbose or page % 10 == 0 or page <= 3:
                print(
                    f"  Page {page}: +{page_added} articles (total: {len(all_articles)})"
                )

            if page_added == 0:
                consecutive_empty += 1
                if consecutive_empty >= 3:
                    print(f"  No new articles for {consecutive_empty} consecutive pages, stopping")
                    break
            else:
                consecutive_empty = 0

            page += 1
            await asyncio.sleep(DELAY_BETWEEN_BATCHES)

        if self.skipped_cached > 0:
            print(f"  Skipped {self.skipped_cached} already-scraped articles (cached)")
        print(f"  Found {len(all_articles)} new articles to scrape")
        return all_articles

    async def _scrape_article(
        self,
        session: aiohttp.ClientSession,
        info: dict,
        semaphore: asyncio.Semaphore,
    ) -> Optional[Article]:
        """Fetch and parse a single article page."""
        html = await self._fetch(session, info["url"], semaphore)
        if not html:
            return None

        parsed = parse_article_page(html, info["url"])
        if not parsed:
            return None

        # Determine source — prefer article meta, fall back to teaser overlay
        source = parsed.get("source") or info.get("source_name")

        # Drop Feuerwehr articles
        if is_feuerwehr(source, parsed.get("title")):
            self.feuerwehr_dropped += 1
            self.url_cache.mark_scraped(info["url"])
            return None

        # Determine city — prefer article extraction, fall back to PD primary city
        city = parsed.get("city")
        if not city and source:
            # Map source name to primary city
            for iid, (pd_name, pd_city) in POLIZEIDIREKTIONEN.items():
                if pd_name in source:
                    city = pd_city
                    break

        # Date — prefer article date, fall back to teaser date
        date = parsed.get("date")
        if not date and info.get("date_str"):
            date = parse_german_datetime(info["date_str"])

        date_display = extract_date_only(date) or (date if date else "")

        return Article(
            title=parsed["title"],
            date=date_display,
            city=city,
            bundesland="Sachsen",
            agency_code=None,
            source=source,
            url=info["url"],
            body=parsed.get("body", ""),
            places=[],
            themes=[],
        )

    async def _scrape_articles_batch(
        self,
        session: aiohttp.ClientSession,
        article_infos: list[dict],
        semaphore: asyncio.Semaphore,
    ) -> list[Article]:
        """Scrape article pages concurrently in batches."""
        articles: list[Article] = []
        total = len(article_infos)
        batch_size = self.concurrent

        for i in range(0, total, batch_size):
            batch = article_infos[i : i + batch_size]
            tasks = [
                self._scrape_article(session, info, semaphore) for info in batch
            ]
            results = await asyncio.gather(*tasks)

            for result, info in zip(results, batch):
                if result is not None:
                    articles.append(result)
                    self.url_cache.mark_scraped(info["url"])
                # If fetch failed, don't mark as scraped so we retry next time

            progress = min(i + batch_size, total)
            print(f"  Scraped {progress}/{total} articles ({len(articles)} success)")

            if i + batch_size < total:
                await asyncio.sleep(DELAY_BETWEEN_BATCHES)

        return articles

    async def run_async(self) -> None:
        """Execute the full async scraping pipeline."""
        print("=" * 60)
        print("Sachsen Polizeidirektion Scraper")
        print("=" * 60)
        print(f"Source: medienservice.sachsen.de")
        print(f"Polizeidirektionen: {len(self.institution_ids)}")
        for iid in self.institution_ids:
            name, city = POLIZEIDIREKTIONEN.get(iid, (f"ID {iid}", "?"))
            print(f"  - {name} ({city})")
        print(f"Concurrent requests: {self.concurrent}")
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
        connector = aiohttp.TCPConnector(ssl=ssl_context)
        semaphore = asyncio.Semaphore(self.concurrent)

        async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
            # Phase 1: discover article URLs via the search API
            article_infos = await self._discover_articles(session, semaphore)

            if not article_infos:
                print("\nNo articles found to scrape")
                return

            # Phase 2: scrape individual article pages concurrently
            print(
                f"\nScraping {len(article_infos)} articles with "
                f"{self.concurrent} concurrent requests..."
            )
            self.articles = await self._scrape_articles_batch(
                session, article_infos, semaphore
            )

        elapsed = time.time() - start_time
        self.url_cache.save()

        # Write output
        output_data = [asdict(a) for a in self.articles]
        Path(self.output).parent.mkdir(parents=True, exist_ok=True)
        with open(self.output, "w", encoding="utf-8") as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)

        print()
        print("=" * 60)
        print(f"Saved {len(self.articles)} articles to {self.output}")
        if self.feuerwehr_dropped:
            print(f"Dropped {self.feuerwehr_dropped} Feuerwehr (fire dept) articles")
        print(f"URL cache: {len(self.url_cache)} total URLs in {self.url_cache.cache_file}")
        print(f"Elapsed: {elapsed:.1f}s ({elapsed / 60:.1f} min)")
        print(f"Fetches: {self.fetch_count} requests, {self.fetch_errors} errors")
        if self.articles:
            print(f"Speed: {len(self.articles) / elapsed:.1f} articles/sec")
        print("=" * 60)

    def run(self) -> None:
        asyncio.run(self.run_async())


# ---------------------------------------------------------------------------
# Test mode — fetch a listing page and dump raw HTML for debugging
# ---------------------------------------------------------------------------
async def run_test(verbose: bool = False) -> None:
    """Fetch the listing page and a sample article, print diagnostics."""
    print("=" * 60)
    print("TEST MODE — Diagnostic dump of medienservice.sachsen.de")
    print("=" * 60)

    ssl_context = ssl.create_default_context(cafile=certifi.where())
    connector = aiohttp.TCPConnector(ssl=ssl_context)
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "de-DE,de;q=0.9"}

    async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
        # 1. Fetch listing page (HTML)
        listing_url = f"{BASE_URL}/medien/news?institutionId=10997"
        print(f"\n[1] Fetching listing page: {listing_url}")
        try:
            async with session.get(listing_url, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                html = await resp.text()
                print(f"    Status: {resp.status}")
                print(f"    Content-Type: {resp.headers.get('Content-Type', '?')}")
                print(f"    HTML length: {len(html)} chars")

                # Check for key structural elements
                soup = BeautifulSoup(html, "html.parser")
                grid = soup.select_one("#teaser-grid")
                if grid:
                    api_url = grid.get("data-filter-request-uri", "NOT FOUND")
                    count = grid.get("data-teaser-count", "NOT FOUND")
                    print(f"    Teaser grid found: API={api_url}, count={count}")
                else:
                    print("    WARNING: #teaser-grid not found!")

                news_links = soup.select('a[href*="/medien/news/"]')
                print(f"    News links on page: {len(news_links)}")
                for link in news_links[:3]:
                    print(f"      - {link.get('href')}: {link.get('title', '')[:60]}")

                if verbose:
                    print(f"\n    --- Raw HTML (first 3000 chars) ---")
                    print(html[:3000])
                    print(f"    --- End ---")
        except Exception as e:
            print(f"    ERROR: {e}")

        # 2. Fetch search API (JSON)
        search_url = (
            f"{SEARCH_API}?search%5Binstitution_ids%5D%5B%5D=10997"
            f"&search%5Bfilter%5D%5B%5D=press_releases&page=1"
        )
        print(f"\n[2] Fetching search API: {search_url}")
        try:
            async with session.get(
                search_url,
                headers={"X-Requested-With": "XMLHttpRequest"},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                print(f"    Status: {resp.status}")
                data = await resp.json(content_type=None)
                teasers = data.get("teaser", [])
                print(f"    Keys: {list(data.keys())}")
                print(f"    Teasers: {len(teasers)}")
                print(f"    disable: {data.get('disable')}")
                print(f"    up_to_date: {data.get('up_to_date')}")

                for i, th in enumerate(teasers[:3]):
                    info = parse_teaser_html(th)
                    if info:
                        print(
                            f"    [{i}] ID={info['id']} "
                            f"date={info['date_str']} "
                            f"src={info['source_name']} "
                            f"title={info['title'][:50]}"
                        )

                if verbose and teasers:
                    print(f"\n    --- First teaser HTML ---")
                    print(teasers[0][:1000])
                    print(f"    --- End ---")
        except Exception as e:
            print(f"    ERROR: {e}")

        # 3. Fetch a sample article
        # Get the first article ID from the search results
        sample_id = None
        if teasers:
            info = parse_teaser_html(teasers[0])
            if info:
                sample_id = info["id"]

        if sample_id:
            article_url = f"{BASE_URL}/medien/news/{sample_id}"
            print(f"\n[3] Fetching sample article: {article_url}")
            try:
                async with session.get(
                    article_url, timeout=aiohttp.ClientTimeout(total=30)
                ) as resp:
                    html = await resp.text()
                    print(f"    Status: {resp.status}")
                    print(f"    HTML length: {len(html)} chars")

                    parsed = parse_article_page(html, article_url)
                    if parsed:
                        print(f"    Title: {parsed['title'][:80]}")
                        print(f"    Date: {parsed['date']}")
                        print(f"    Source: {parsed['source']}")
                        print(f"    City: {parsed['city']}")
                        print(f"    Subtitle: {parsed.get('subtitle', '')[:80]}")
                        print(f"    Body length: {len(parsed.get('body', ''))} chars")
                        if parsed.get("body"):
                            print(f"    Body preview: {parsed['body'][:300]}...")
                    else:
                        print("    WARNING: Failed to parse article!")

                    if verbose:
                        print(f"\n    --- Article HTML (first 3000 chars of main) ---")
                        soup = BeautifulSoup(html, "html.parser")
                        main = soup.select_one("#main-content")
                        if main:
                            print(str(main)[:3000])
                        else:
                            print(html[:3000])
                        print(f"    --- End ---")
            except Exception as e:
                print(f"    ERROR: {e}")

    print(f"\n{'=' * 60}")
    print("Test complete. If structure looks wrong, the site may have changed.")
    print(
        "Check the URLs above in a browser and compare with expected structure."
    )
    print("=" * 60)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Scrape Sachsen Polizeidirektion press releases from medienservice.sachsen.de",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 scripts/scrapers/scrape_sachsen_polizei.py --start-date 2026-01-01 --end-date 2026-01-31
  python3 scripts/scrapers/scrape_sachsen_polizei.py --max-pages 5 --verbose
  python3 scripts/scrapers/scrape_sachsen_polizei.py --test            # diagnostic dump
  python3 scripts/scrapers/scrape_sachsen_polizei.py --test --verbose  # dump with raw HTML

Institution IDs (Polizeidirektionen):
  10996 = Chemnitz
  10997 = Dresden
  10998 = Goerlitz
  10976 = Leipzig
  10999 = Zwickau
        """,
    )

    parser.add_argument(
        "--start-date",
        type=str,
        help="Start date (ISO format: YYYY-MM-DD)",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        help="End date (ISO format: YYYY-MM-DD)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=0,
        help="Max listing pages per search request (0 = no limit, default: 0)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default="sachsen_polizei_reports.json",
        help="Output JSON file (default: sachsen_polizei_reports.json)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Verbose output",
    )
    parser.add_argument(
        "--concurrent",
        type=int,
        default=DEFAULT_CONCURRENT,
        help=f"Concurrent requests (default: {DEFAULT_CONCURRENT})",
    )
    parser.add_argument(
        "--cache-dir",
        type=str,
        default=".cache",
        help="Cache directory (default: .cache)",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Test mode: fetch listing + sample article and print diagnostics",
    )
    parser.add_argument(
        "--pd",
        type=int,
        nargs="+",
        choices=list(POLIZEIDIREKTIONEN.keys()),
        help="Limit to specific Polizeidirektion IDs (default: all 5)",
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

    if args.test:
        asyncio.run(run_test(verbose=args.verbose))
        return

    scraper = AsyncSachsenPolizeiScraper(
        start_date=args.start_date,
        end_date=args.end_date,
        max_pages=args.max_pages,
        output=args.output,
        verbose=args.verbose,
        concurrent=args.concurrent,
        cache_dir=args.cache_dir,
        institution_ids=args.pd,
    )

    try:
        scraper.run()
    except KeyboardInterrupt:
        print("\nInterrupted by user")
        scraper.url_cache.save()
        sys.exit(1)


if __name__ == "__main__":
    main()
