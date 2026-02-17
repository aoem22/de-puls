#!/usr/bin/env python3
"""
Async scraper for Bavarian police press releases (polizei.bayern.de).

Uses the Elasticsearch-backed Pressearchiv API (POST /es/search) to discover
articles by date range, then fetches individual article pages for full body text.
Falls back to window.montagedata from the listing page when no date range is given.

The API returns max 1,000 results per request, so date-range queries are chunked
into monthly intervals (~480 articles/month on average).

Many Bayern press releases contain multiple incidents in a single article
(numbered like "0207 - Description"). The pipeline's fast_enricher handles
splitting these, so we scrape the full body text without splitting.

Usage:
    python3 scripts/scrapers/scrape_bayern_polizei.py --start-date 2024-03-01 --end-date 2026-02-15
    python3 scripts/scrapers/scrape_bayern_polizei.py --max-pages 10 --verbose
"""

import argparse
import asyncio
import base64
import calendar
import json
import os
import re
import ssl
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, date, timezone
from pathlib import Path
from typing import Optional

import aiohttp
import certifi
from bs4 import BeautifulSoup

# Fix SSL on macOS - certifi provides Mozilla's CA bundle
os.environ['SSL_CERT_FILE'] = certifi.where()

# Constants
BASE_URL = "https://www.polizei.bayern.de"
LISTING_URL = f"{BASE_URL}/aktuelles/pressemitteilungen/"
ES_SEARCH_URL = f"{BASE_URL}/es/search"
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
    return datetime.fromtimestamp(ms_timestamp / 1000, tz=timezone.utc).replace(tzinfo=None)


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


def monthly_chunks(start: date, end: date) -> list[tuple[date, date]]:
    """Split a date range into monthly (first-day, last-day) pairs.

    Each chunk covers a full calendar month, clamped to [start, end].
    This keeps every ES search request under the 1,000-result API cap
    (~480 articles/month average).
    """
    chunks = []
    current = start.replace(day=1)
    while current <= end:
        month_start = max(current, start)
        last_day = calendar.monthrange(current.year, current.month)[1]
        month_end = min(date(current.year, current.month, last_day), end)
        chunks.append((month_start, month_end))
        # Advance to first of next month
        if current.month == 12:
            current = date(current.year + 1, 1, 1)
        else:
            current = date(current.year, current.month + 1, 1)
    return chunks


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


def _decode_bp_item(bp_item) -> Optional[dict]:
    """Decode a <bp-item> accordion element into title + body text.

    Each <bp-item> has a `json` attribute containing:
        {"title": "Landkreis ...", "data": {"iwe2": "<base64-encoded HTML>"}}
    The iwe2 value is base64-encoded HTML with <p> tags for each incident.
    """
    json_attr = bp_item.get("json", "")
    if not json_attr:
        return None

    try:
        item_data = json.loads(json_attr)
    except json.JSONDecodeError:
        return None

    section_title = item_data.get("title", "")
    iwe2_b64 = (item_data.get("data") or {}).get("iwe2", "")
    if not iwe2_b64:
        return None

    try:
        inner_html = base64.b64decode(iwe2_b64).decode("utf-8")
    except Exception:
        return None

    # Parse the decoded HTML to extract text
    inner_soup = BeautifulSoup(inner_html, "html.parser")
    paragraphs = []
    for p in inner_soup.find_all("p"):
        text = p.get_text(strip=True)
        if text and text != "-":  # Skip dash separators
            paragraphs.append(text)

    body = "\n\n".join(paragraphs)
    if not body:
        return None

    return {
        "section_title": section_title,
        "body": body,
    }


def parse_article_page(html: str, url: str) -> list[dict]:
    """Parse a Bayern Polizei article page to extract body text.

    Handles two page layouts:
    1. Flat: all incidents in <p> tags (e.g. Munich Medieninformationen)
    2. Accordion: <bp-item> custom elements with base64-encoded HTML per
       Landkreis section (e.g. PP Schwaben Süd/West)

    For accordion pages, returns one result per section so each Landkreis
    becomes a separate article. For flat pages, returns a single result.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Title - from h1 or bp-headline
    title = None
    bp_headline = soup.select_one("bp-headline")
    if bp_headline:
        title = bp_headline.get("title", "").strip()
    if not title:
        h1 = soup.select_one("h1")
        if h1:
            title = h1.get_text(strip=True)
    if not title:
        og_title = soup.select_one('meta[property="og:title"]')
        if og_title:
            title = og_title.get("content", "").strip()
    if not title:
        title = "Ohne Titel"

    # ── Check for accordion pages (bp-item elements) ──
    bp_items = soup.find_all("bp-item")
    if bp_items:
        results = []
        for bp_item in bp_items:
            decoded = _decode_bp_item(bp_item)
            if not decoded:
                continue

            section_title = decoded["section_title"]
            body = decoded["body"]

            # Build a combined title: "PP SWS | ... — Landkreis Oberallgäu & Kempten"
            combined_title = f"{title} — {section_title}" if section_title else title

            city = extract_city_from_body(body) if body else None
            agency_code = extract_agency_code_from_title(combined_title)

            results.append({
                "title": combined_title,
                "body": body,
                "city": city,
                "agency_code": agency_code,
            })

        if results:
            return results
        # Fall through to flat extraction if all bp-items failed to decode

    # ── Flat page extraction ──
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

    body = "\n\n".join(paragraphs)

    # If no paragraphs found, try a broader extraction
    if not body:
        for tag in content_area.find_all(["nav", "header", "footer", "script", "style"]):
            tag.decompose()
        body = content_area.get_text(separator="\n", strip=True)

    city = extract_city_from_body(body) if body else None
    agency_code = extract_agency_code_from_title(title) if title else None

    return [{
        "title": title,
        "body": body,
        "city": city,
        "agency_code": agency_code,
    }]


class AsyncBayernPolizeiScraper:
    """
    Async scraper for polizei.bayern.de press releases.

    When --start-date and --end-date are given, queries the Elasticsearch
    Pressearchiv API month-by-month to discover articles, then fetches
    individual pages for full body text. Without date range, falls back
    to window.montagedata (recent ~165 articles only).
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

        # Metadata tracking
        self.pages_visited = 0
        self.pages_with_content = 0
        self.source_total = 0
        self.stop_reason = "unknown"

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

    async def _search_es(
        self,
        session: aiohttp.ClientSession,
        from_date: date,
        to_date: date,
    ) -> list[dict]:
        """Query the Pressearchiv Elasticsearch API for a date range.

        Returns raw ES hit list (each with _source containing title, teaser_text,
        created_date, sort_date_js, creating_organization, directory).
        """
        q_inner = json.dumps({
            "queryStr": "",
            "datefr": from_date.strftime("%d.%m.%Y"),
            "dateto": to_date.strftime("%d.%m.%Y"),
            "author": None,
        })
        payload = {"type": "presse", "q": q_inner}

        for attempt in range(MAX_RETRIES):
            try:
                async with session.post(
                    ES_SEARCH_URL,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_SECONDS),
                ) as response:
                    if response.status == 200:
                        self.fetch_count += 1
                        data = await response.json()
                        hits = data.get("hits", {}).get("hits", [])
                        total = data.get("hits", {}).get("total", {})
                        total_val = total.get("value", len(hits)) if isinstance(total, dict) else total
                        if total_val > 1000:
                            print(f"    WARNING: {total_val} results for {from_date}–{to_date}, "
                                  f"API capped at 1000. Narrow the date range.")
                        return hits
                    elif response.status == 429:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        if self.verbose:
                            print(f"    ES search HTTP {response.status}")
                        return []
            except (asyncio.TimeoutError, aiohttp.ClientError) as e:
                if self.verbose:
                    print(f"    ES search error: {e}")
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(1)

        self.fetch_errors += 1
        return []

    def _es_hit_to_entry(self, hit: dict) -> Optional[dict]:
        """Convert an ES hit into the same entry format used by montagedata discovery."""
        src = hit.get("_source", {})
        directory = src.get("directory", "")
        if not directory:
            return None

        url = BASE_URL + directory
        if not url.endswith("/index.html"):
            url = url.rstrip("/") + "/index.html"

        ms_ts = src.get("sort_date_js")
        iso_date = ms_timestamp_to_iso(ms_ts) if ms_ts else None

        # Parse created_date (DD.MM.YYYY) as fallback
        if not iso_date and src.get("created_date"):
            try:
                dt = datetime.strptime(src["created_date"], "%d.%m.%Y")
                iso_date = dt.strftime("%Y-%m-%dT00:00:00")
            except ValueError:
                pass

        return {
            "title": src.get("title", ""),
            "teaser": src.get("teaser_text", ""),
            "url": url,
            "iso_date": iso_date,
            "org_name": src.get("creating_organization"),
            "date": ms_ts,
        }

    async def _discover_articles(
        self,
        session: aiohttp.ClientSession,
        semaphore: asyncio.Semaphore,
    ) -> list[dict]:
        """Discover articles via ES API (date-range) or montagedata (latest).

        Returns list of article metadata dicts with keys:
            title, teaser, url, iso_date, org_name, date
        """
        entries: list[dict] = []

        # ── Path A: Elasticsearch API (when date range is given) ──
        if self.start_date and self.end_date:
            chunks = monthly_chunks(self.start_date.date(), self.end_date.date())
            print(f"Querying ES Pressearchiv API ({len(chunks)} monthly chunks)...")

            for i, (m_start, m_end) in enumerate(chunks, 1):
                print(f"  [{i}/{len(chunks)}] {m_start} → {m_end} ...", end=" ", flush=True)
                hits = await self._search_es(session, m_start, m_end)
                converted = 0
                for hit in hits:
                    entry = self._es_hit_to_entry(hit)
                    if entry:
                        entries.append(entry)
                        converted += 1
                print(f"{converted} articles")
                self.pages_visited += 1
                if converted > 0:
                    self.pages_with_content += 1

            self.source_total = len(entries)
            self.stop_reason = "es_search_complete"
            print(f"  Total from ES API: {len(entries)} articles")

        # ── Path B: montagedata (no date range — recent articles only) ──
        else:
            print("Fetching listing page (montagedata)...")
            html = await self._fetch_url(session, LISTING_URL, semaphore)
            if not html:
                print("Error: Could not fetch listing page")
                return []

            raw_entries = extract_montagedata(html)
            self.pages_visited = 1
            self.pages_with_content = 1 if raw_entries else 0
            self.source_total = len(raw_entries)
            if not raw_entries:
                print("Error: No montagedata found in listing page")
                return []

            print(f"  Found {len(raw_entries)} entries in montagedata")

            for entry in raw_entries:
                href = entry.get("href")
                if not href:
                    continue
                url = build_article_url(href)
                ms_ts = entry.get("date")
                entry["url"] = url
                entry["iso_date"] = ms_timestamp_to_iso(ms_ts) if ms_ts else None
                entry["org_name"] = (
                    entry.get("organization", {}).get("name") if entry.get("organization") else None
                )
                entries.append(entry)

            self.stop_reason = "single_page_complete"

        # ── Common filtering ──
        filtered = []
        for entry in entries:
            url = entry.get("url")
            if not url:
                continue

            # Check date range (relevant for montagedata path)
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

            filtered.append(entry)

        # Apply max_pages as article limit
        if self.max_pages > 0 and len(filtered) > self.max_pages:
            filtered = filtered[: self.max_pages]

        if self.skipped_cached_count > 0:
            print(f"  Skipped {self.skipped_cached_count} already-scraped articles")
        print(f"  {len(filtered)} new articles to scrape")

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

                parsed_list = parse_article_page(html, url)
                if not parsed_list:
                    continue

                # Source from organization name
                source = info.get("org_name")

                # Date from montagedata/ES timestamp
                date_str = info.get("iso_date", "")

                # Listing-level title (from ES/montagedata, more specific than page h1)
                listing_title = info.get("title", "").strip()

                for parsed in parsed_list:
                    page_title = parsed.get("title", "").strip()

                    # For accordion pages, parsed title already includes section
                    # name (e.g. "PP SWS | ... — Landkreis Oberallgäu & Kempten").
                    # For flat pages, prefer listing title over generic page h1.
                    is_accordion = len(parsed_list) > 1
                    if is_accordion:
                        title = page_title or listing_title or "Ohne Titel"
                    elif listing_title:
                        title = listing_title
                    elif page_title and page_title != "Ohne Titel":
                        title = page_title
                    else:
                        title = "Ohne Titel"

                    # Drop Feuerwehr articles
                    if is_feuerwehr_source(source, title):
                        self.feuerwehr_dropped_count += 1
                        continue

                    # Body: prefer parsed page body, fall back to teaser
                    body = parsed.get("body", "")
                    if not body:
                        body = info.get("teaser", "")

                    city = parsed.get("city")
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
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
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

        # Write scrape metadata
        meta = {
            "source": "polizei_bayern",
            "pages_visited": self.pages_visited,
            "pages_with_content": self.pages_with_content,
            "articles_per_page": None,
            "source_total": self.source_total,
            "estimated_total": self.source_total,
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
        description="Async scrape police press releases from polizei.bayern.de",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scrape full 2-year archive via ES API
  python3 scripts/scrapers/scrape_bayern_polizei.py --start-date 2024-03-01 --end-date 2026-02-15

  # Scrape one month
  python3 scripts/scrapers/scrape_bayern_polizei.py --start-date 2025-06-01 --end-date 2025-06-30

  # Scrape recent articles only (montagedata fallback, no date range)
  python3 scripts/scrapers/scrape_bayern_polizei.py --max-pages 10 --verbose
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
