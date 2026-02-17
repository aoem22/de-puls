#!/usr/bin/env python3
"""
Async scraper for Hamburg Police press releases (polizei.hamburg).

Fetches press releases from the Hamburg police portal, extracts article
metadata and body text, and outputs structured JSON matching the pipeline
format used by the rest of the KanakMap pipeline.

The parser is built defensively with multiple CSS selector fallbacks since
the exact HTML structure may change over time.

Usage:
    python3 scripts/scrapers/scrape_hamburg_polizei.py --max-pages 3 --output data/hamburg_raw.json
    python3 scripts/scrapers/scrape_hamburg_polizei.py --start-date 2026-01-01 --end-date 2026-01-31
    python3 scripts/scrapers/scrape_hamburg_polizei.py --test
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
from urllib.parse import urljoin, urlencode, urlparse

import aiohttp
import certifi
from bs4 import BeautifulSoup, Tag

# Fix SSL on macOS - certifi provides Mozilla's CA bundle
os.environ["SSL_CERT_FILE"] = certifi.where()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
BASE_URL = "https://www.polizei.hamburg"
LISTING_PATH = "/pressemeldungen/"
USER_AGENT = "kanakmap-scraper/1.0 (+contact: scraper@example.com)"

# Async configuration
DEFAULT_CONCURRENT = 10  # polizei.hamburg is smaller, be gentler
DELAY_BETWEEN_BATCHES = 0.5
REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 2  # seconds, exponential backoff multiplier

# Feuerwehr filter - drop fire department articles
FEUERWEHR_PATTERN = re.compile(
    r"Feuerwehr|^FW[ -]|Berufsfeuerwehr|Freiwillige Feuerwehr",
    re.IGNORECASE,
)

# German month names for date parsing
GERMAN_MONTHS = {
    "Januar": 1, "Februar": 2, "März": 3, "April": 4,
    "Mai": 5, "Juni": 6, "Juli": 7, "August": 8,
    "September": 9, "Oktober": 10, "November": 11, "Dezember": 12,
    "Jan": 1, "Feb": 2, "Mär": 3, "Apr": 4,
    "Jun": 6, "Jul": 7, "Aug": 8, "Sep": 9,
    "Okt": 10, "Nov": 11, "Dez": 12,
}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------
@dataclass
class Article:
    """Represents a scraped Hamburg police press release."""
    title: str
    date: str
    city: str = "Hamburg"
    bundesland: str = "Hamburg"
    agency_code: Optional[str] = None
    source: str = "Polizei Hamburg"
    url: str = ""
    body: str = ""
    places: list[str] = field(default_factory=list)
    themes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# URL cache
# ---------------------------------------------------------------------------
class ScrapedUrlsCache:
    """Persistent cache for tracking already-scraped article URLs.

    Prevents re-scraping articles across scraper runs by storing URLs
    with their scrape timestamp.
    """

    def __init__(self, cache_dir: str = ".cache", cache_filename: str = "scraped_urls_hamburg.json"):
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / cache_filename
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
# Date parsing helpers
# ---------------------------------------------------------------------------
def parse_german_date(text: str) -> Optional[str]:
    """Parse various German date formats into ISO datetime strings.

    Supported formats:
        DD.MM.YYYY
        DD.MM.YYYY HH:MM
        DD.MM.YYYY - HH:MM
        DD. Monat YYYY
        YYYY-MM-DD (passthrough)
        YYYY-MM-DDTHH:MM:SS (passthrough)
    """
    if not text:
        return None

    text = text.strip()

    # Already ISO format
    if re.match(r"\d{4}-\d{2}-\d{2}T", text):
        return text[:19]
    if re.match(r"\d{4}-\d{2}-\d{2}$", text):
        return f"{text}T00:00:00"

    # DD.MM.YYYY with optional time
    m = re.match(
        r"(\d{1,2})\.(\d{1,2})\.(\d{4})"
        r"(?:\s*[–\-,]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?",
        text,
    )
    if m:
        day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        hour = int(m.group(4)) if m.group(4) else 0
        minute = int(m.group(5)) if m.group(5) else 0
        second = int(m.group(6)) if m.group(6) else 0
        return f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:{second:02d}"

    # DD. Monat YYYY
    m = re.match(
        r"(\d{1,2})\.\s*(" + "|".join(GERMAN_MONTHS.keys()) + r")\s+(\d{4})",
        text,
    )
    if m:
        day = int(m.group(1))
        month = GERMAN_MONTHS[m.group(2)]
        year = int(m.group(3))
        return f"{year:04d}-{month:02d}-{day:02d}T00:00:00"

    return None


def extract_date_from_text(text: str) -> Optional[str]:
    """Try to find a date string anywhere in free text."""
    # DD.MM.YYYY with optional time
    m = re.search(
        r"(\d{1,2}\.\d{1,2}\.\d{4}(?:\s*[–\-,]\s*\d{1,2}:\d{2})?)",
        text,
    )
    if m:
        return parse_german_date(m.group(1))

    # German long date: 6. Februar 2026
    m = re.search(
        r"(\d{1,2})\.\s*(" + "|".join(GERMAN_MONTHS.keys()) + r")\s+(\d{4})",
        text,
    )
    if m:
        day = int(m.group(1))
        month = GERMAN_MONTHS[m.group(2)]
        year = int(m.group(3))
        return f"{year:04d}-{month:02d}-{day:02d}T00:00:00"

    return None


# ---------------------------------------------------------------------------
# Feuerwehr filter
# ---------------------------------------------------------------------------
def is_feuerwehr_source(source: Optional[str], title: Optional[str] = None) -> bool:
    """Check if article is from a fire department (not police)."""
    if source and FEUERWEHR_PATTERN.search(source):
        return True
    if title and re.match(r"^FW[ -]", title):
        return True
    return False


# ---------------------------------------------------------------------------
# HTML parsing — listing page
# ---------------------------------------------------------------------------
def parse_listing_page(html: str, base_url: str = BASE_URL) -> list[dict]:
    """Parse a listing page and extract article link/date/title dicts.

    Tries multiple CSS selector strategies for robustness against
    markup changes on the Hamburg police portal.
    """
    soup = BeautifulSoup(html, "html.parser")
    articles: list[dict] = []
    seen_urls: set[str] = set()

    def _add(url: str, title: str, date_str: Optional[str]) -> None:
        full_url = urljoin(base_url, url)
        if full_url in seen_urls:
            return
        seen_urls.add(full_url)
        articles.append({"url": full_url, "title": title, "date": date_str})

    # Strategy 1: structured article containers
    # Typical government CMS: <article>, <div class="teaser">, <li class="list-item">
    containers = soup.select(
        "article, .teaser, .list-item, .news-item, .press-item, "
        ".pressemeldung, .result-item, .search-result, .content-item, "
        "[itemtype*='NewsArticle'], [itemtype*='Article']"
    )

    for container in containers:
        link = container.select_one("a[href]")
        if not link:
            continue
        href = link.get("href", "")
        if not href or href == "#":
            continue

        # Title
        title_el = container.select_one(
            "h2, h3, h4, .headline, .title, [itemprop='headline'], a"
        )
        title = title_el.get_text(strip=True) if title_el else link.get_text(strip=True)
        if not title:
            title = "Ohne Titel"

        # Date
        date_str = None
        date_el = container.select_one(
            "time, .date, .timestamp, .meta-date, [itemprop='datePublished'], "
            "[datetime], .publish-date, span.date"
        )
        if date_el:
            date_str = (
                date_el.get("datetime")
                or date_el.get("content")
                or date_el.get_text(strip=True)
            )
        if not date_str:
            date_str = extract_date_from_text(container.get_text(" ", strip=True))

        parsed_date = parse_german_date(date_str) if date_str else None
        _add(href, title, parsed_date)

    if articles:
        return articles

    # Strategy 2: look for any links pointing to pressemeldungen detail pages
    # Common patterns: /pressemeldungen/YYYY/MM/..., /pressemeldungen/detail/...
    link_patterns = [
        re.compile(r"/pressemeldungen/\d{4}/"),
        re.compile(r"/pressemeldungen/detail/"),
        re.compile(r"/pressemeldung/"),
        re.compile(r"/meldung/"),
        re.compile(r"/aktuelles/\d{4}/"),
    ]

    for a in soup.select("a[href]"):
        href = a.get("href", "")
        if any(pat.search(href) for pat in link_patterns):
            title = a.get_text(strip=True) or "Ohne Titel"

            # Try to get date from surrounding context
            parent = a.parent
            date_str = None
            if parent:
                date_str = extract_date_from_text(parent.get_text(" ", strip=True))

            parsed_date = parse_german_date(date_str) if date_str else None
            _add(href, title, parsed_date)

    if articles:
        return articles

    # Strategy 3: broad fallback - any internal link that is not a nav/menu link
    nav_patterns = re.compile(
        r"(impressum|datenschutz|kontakt|karriere|sitemap|suche|login|cookie"
        r"|barrierefreiheit|#|javascript:|mailto:)",
        re.IGNORECASE,
    )
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        if not href or nav_patterns.search(href):
            continue
        # Only internal links
        parsed = urlparse(urljoin(base_url, href))
        if parsed.netloc and parsed.netloc not in ("www.polizei.hamburg", "polizei.hamburg"):
            continue
        # Must look like a detail page (has some path depth)
        if href.count("/") < 2 and not href.startswith("/pressemeldungen"):
            continue

        title = a.get_text(strip=True)
        if not title or len(title) < 10:
            continue

        _add(href, title, None)

    return articles


def discover_pagination(html: str, base_url: str = BASE_URL) -> list[str]:
    """Try to discover pagination links from a listing page.

    Returns list of discovered next-page URLs (may be empty if
    pagination cannot be determined from the markup).
    """
    soup = BeautifulSoup(html, "html.parser")
    pages: list[str] = []

    # Strategy 1: explicit pagination nav
    pag_selectors = [
        ".pagination a[href]",
        ".pager a[href]",
        "nav.pages a[href]",
        ".page-navigation a[href]",
        "ul.pagination a[href]",
        '[role="navigation"] a[href]',
        ".paginator a[href]",
    ]
    for selector in pag_selectors:
        links = soup.select(selector)
        if links:
            for a in links:
                href = a.get("href", "")
                if href and href != "#":
                    pages.append(urljoin(base_url, href))
            if pages:
                return list(dict.fromkeys(pages))  # dedupe, preserve order

    # Strategy 2: "next" / "weiter" / ">" link
    for a in soup.select("a[href]"):
        text = a.get_text(strip=True).lower()
        rel = (a.get("rel") or [])
        classes = a.get("class", [])
        aria = (a.get("aria-label") or "").lower()

        is_next = (
            text in ("next", "weiter", ">", "\u203a", "\u00bb", "nächste seite")
            or "next" in rel
            or "next" in classes
            or "next" in aria
            or "weiter" in aria
        )
        if is_next:
            href = a.get("href", "")
            if href and href != "#":
                pages.append(urljoin(base_url, href))

    # Strategy 3: URL pattern guessing for ?page=N or /page/N
    # (look at current URL structure and try incrementing)
    # This is handled by the scraper class instead.

    return list(dict.fromkeys(pages))


# ---------------------------------------------------------------------------
# HTML parsing — article detail page
# ---------------------------------------------------------------------------
def parse_article_page(html: str, url: str) -> Optional[dict]:
    """Parse a single article detail page.

    Returns a dict with: title, date, body, agency_code
    or None if parsing fails completely.
    """
    soup = BeautifulSoup(html, "html.parser")

    # ----- Title -----
    title = None
    for selector in [
        "h1.headline", "h1.title", "article h1", ".article-header h1",
        ".content h1", "main h1", "[itemprop='headline']",
        'meta[property="og:title"]',
    ]:
        el = soup.select_one(selector)
        if el:
            if el.name == "meta":
                title = el.get("content", "").strip()
            else:
                title = el.get_text(strip=True)
            if title:
                break

    # Broadest fallback
    if not title:
        h1 = soup.select_one("h1")
        title = h1.get_text(strip=True) if h1 else None
    if not title:
        title = "Ohne Titel"

    # ----- Date -----
    date_str = None

    # Try JSON-LD
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.string or "")
            items = data if isinstance(data, list) else [data]
            for item in items:
                if isinstance(item, dict):
                    dp = item.get("datePublished") or item.get("dateCreated")
                    if dp:
                        date_str = parse_german_date(dp) or dp
                        break
            if date_str:
                break
        except (json.JSONDecodeError, TypeError):
            continue

    # Try meta tags
    if not date_str:
        for sel in [
            'meta[property="article:published_time"]',
            'meta[name="date"]',
            'meta[name="DC.date"]',
            'meta[name="dcterms.date"]',
        ]:
            el = soup.select_one(sel)
            if el:
                raw = el.get("content", "").strip()
                if raw:
                    date_str = parse_german_date(raw) or raw[:19]
                    break

    # Try HTML date elements
    if not date_str:
        for sel in [
            "time[datetime]", ".date", ".publish-date", ".article-date",
            ".meta-date", "[itemprop='datePublished']", "span.date",
        ]:
            el = soup.select_one(sel)
            if el:
                raw = el.get("datetime") or el.get("content") or el.get_text(strip=True)
                if raw:
                    date_str = parse_german_date(raw)
                    if date_str:
                        break

    # Try scanning visible text near the title for a date
    if not date_str:
        header_area = soup.select_one(
            "article header, .article-header, .content-header, main header"
        )
        if header_area:
            date_str = extract_date_from_text(header_area.get_text(" ", strip=True))
        if not date_str:
            # Scan top portion of body text
            main = soup.select_one("main, article, .content, #content, #main")
            if main:
                top_text = main.get_text(" ", strip=True)[:500]
                date_str = extract_date_from_text(top_text)

    # ----- Body -----
    body = ""

    # Try specific content selectors
    content_selectors = [
        "article .article-body", "article .content", "article .text",
        ".article-body", ".article-content", ".press-text",
        ".field-name-body", '[itemprop="articleBody"]',
        ".richtext", ".bodytext", ".ce-bodytext",
        "main .content", "#content .text",
    ]

    for sel in content_selectors:
        el = soup.select_one(sel)
        if el:
            # Collect paragraphs for cleaner output
            paragraphs = el.select("p")
            if paragraphs:
                texts = [p.get_text(strip=True) for p in paragraphs if p.get_text(strip=True)]
                body = "\n\n".join(texts)
            else:
                body = el.get_text(separator="\n", strip=True)
            if body:
                break

    # Fallback: get all paragraphs from <article> or <main>
    if not body:
        container = soup.select_one("article, main, #content, .content, #main")
        if container:
            paragraphs = container.select("p")
            texts = []
            for p in paragraphs:
                text = p.get_text(strip=True)
                # Skip very short or boilerplate-looking text
                if text and len(text) > 20:
                    texts.append(text)
            body = "\n\n".join(texts)

    # Last resort: just get all <p> tags
    if not body:
        paragraphs = soup.select("p")
        texts = [p.get_text(strip=True) for p in paragraphs if len(p.get_text(strip=True)) > 30]
        body = "\n\n".join(texts)

    # If we got absolutely nothing useful, return None
    if not body and title == "Ohne Titel":
        return None

    # ----- Agency code -----
    agency_code = None
    if title:
        m = re.match(r"^([A-Z][A-Z0-9 -]+?):\s", title)
        if m:
            agency_code = m.group(1).strip()

    return {
        "title": title,
        "date": date_str,
        "body": body,
        "agency_code": agency_code,
    }


def analyze_html_structure(html: str) -> str:
    """Return a human-readable summary of the HTML structure for --test mode."""
    soup = BeautifulSoup(html, "html.parser")
    lines: list[str] = []

    lines.append(f"Page title: {soup.title.string if soup.title else '(none)'}")

    # Meta info
    for meta_name in ["description", "keywords", "generator"]:
        el = soup.select_one(f'meta[name="{meta_name}"]')
        if el:
            lines.append(f"meta[{meta_name}]: {el.get('content', '')[:120]}")

    og_title = soup.select_one('meta[property="og:title"]')
    if og_title:
        lines.append(f"og:title: {og_title.get('content', '')[:120]}")

    # Count main structural elements
    for tag in ["article", "section", "main", "nav", "header", "footer", "aside"]:
        count = len(soup.select(tag))
        if count:
            lines.append(f"<{tag}>: {count} element(s)")

    # Look for typical listing containers
    for sel in [".teaser", ".list-item", ".news-item", ".press-item",
                ".pressemeldung", ".result-item", ".search-result"]:
        count = len(soup.select(sel))
        if count:
            lines.append(f"{sel}: {count} element(s)")

    # Links analysis
    all_links = soup.select("a[href]")
    internal_links = []
    for a in all_links:
        href = a.get("href", "")
        if href.startswith("/") or "polizei.hamburg" in href:
            internal_links.append(href)

    lines.append(f"\nTotal links: {len(all_links)}, internal: {len(internal_links)}")

    # Show first 30 internal links for pattern discovery
    if internal_links:
        lines.append("\nFirst 30 internal links:")
        for link in internal_links[:30]:
            lines.append(f"  {link}")

    # Pagination indicators
    pag_links = discover_pagination(html)
    if pag_links:
        lines.append(f"\nPagination links found: {len(pag_links)}")
        for p in pag_links[:10]:
            lines.append(f"  {p}")
    else:
        lines.append("\nNo pagination links detected")

    # JSON-LD
    ld_scripts = soup.select('script[type="application/ld+json"]')
    if ld_scripts:
        lines.append(f"\nJSON-LD scripts: {len(ld_scripts)}")
        for i, s in enumerate(ld_scripts[:3]):
            try:
                data = json.loads(s.string or "")
                if isinstance(data, dict):
                    lines.append(f"  [{i}] @type={data.get('@type', '?')}, keys={list(data.keys())[:8]}")
                elif isinstance(data, list):
                    lines.append(f"  [{i}] array of {len(data)} items")
            except json.JSONDecodeError:
                lines.append(f"  [{i}] (invalid JSON)")

    # Try parsing with our listing parser and show results
    articles = parse_listing_page(html)
    lines.append(f"\nParsed articles from listing: {len(articles)}")
    for art in articles[:10]:
        lines.append(f"  {art.get('date', '(no date)')} | {art['title'][:80]}")
        lines.append(f"    -> {art['url']}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main scraper class
# ---------------------------------------------------------------------------
class AsyncHamburgPolizeiScraper:
    """Async scraper for polizei.hamburg press releases."""

    def __init__(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        max_pages: int = 0,
        output: str = "data/hamburg_polizei_raw.json",
        verbose: bool = False,
        concurrent: int = DEFAULT_CONCURRENT,
        cache_dir: str = ".cache",
        test_mode: bool = False,
    ):
        self.start_date = datetime.fromisoformat(start_date) if start_date else None
        self.end_date = datetime.fromisoformat(end_date) if end_date else None
        self.max_pages = max_pages
        self.output = output
        self.verbose = verbose
        self.concurrent = concurrent
        self.test_mode = test_mode

        self.articles: list[Article] = []
        self.seen_urls: set[str] = set()
        self.url_cache = ScrapedUrlsCache(cache_dir, "scraped_urls_hamburg.json")

        # Stats
        self.fetch_count = 0
        self.fetch_errors = 0
        self.skipped_cached = 0
        self.feuerwehr_dropped = 0

        # Metadata tracking
        self.pages_visited = 0
        self.pages_with_content = 0
        self.stop_reason = "unknown"

    # ---- HTTP helpers ----
    def _create_ssl_context(self) -> ssl.SSLContext:
        ctx = ssl.create_default_context(cafile=certifi.where())
        return ctx

    def _create_headers(self) -> dict[str, str]:
        return {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
        }

    async def _fetch(
        self,
        session: aiohttp.ClientSession,
        url: str,
        semaphore: asyncio.Semaphore,
    ) -> Optional[str]:
        """Fetch a URL with retries, semaphore concurrency control."""
        async with semaphore:
            for attempt in range(MAX_RETRIES):
                try:
                    async with session.get(
                        url,
                        timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_SECONDS),
                        allow_redirects=True,
                    ) as resp:
                        if resp.status == 200:
                            self.fetch_count += 1
                            return await resp.text()
                        elif resp.status == 429:
                            wait = RETRY_BACKOFF_BASE ** (attempt + 1)
                            if self.verbose:
                                print(f"  Rate limited on {url}, waiting {wait}s...")
                            await asyncio.sleep(wait)
                        elif resp.status in (301, 302, 303, 307, 308):
                            # aiohttp follows redirects by default, but log it
                            if self.verbose:
                                print(f"  Redirect {resp.status} for {url}")
                            return None
                        else:
                            if self.verbose:
                                print(f"  HTTP {resp.status} for {url}")
                            # 404 = don't retry
                            if resp.status == 404:
                                break
                            return None
                except asyncio.TimeoutError:
                    if self.verbose:
                        print(f"  Timeout (attempt {attempt+1}/{MAX_RETRIES}) for {url}")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(RETRY_BACKOFF_BASE)
                except aiohttp.ClientError as e:
                    if self.verbose:
                        print(f"  Client error (attempt {attempt+1}/{MAX_RETRIES}) for {url}: {e}")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(RETRY_BACKOFF_BASE)

            self.fetch_errors += 1
            return None

    async def _fetch_batch(
        self,
        session: aiohttp.ClientSession,
        urls: list[str],
        semaphore: asyncio.Semaphore,
    ) -> list[tuple[str, Optional[str]]]:
        """Fetch multiple URLs concurrently."""
        tasks = [self._fetch(session, url, semaphore) for url in urls]
        results = await asyncio.gather(*tasks)
        return list(zip(urls, results))

    # ---- Date range check ----
    def _is_in_date_range(self, date_str: Optional[str]) -> bool:
        if not date_str:
            return True
        if not self.start_date and not self.end_date:
            return True

        try:
            if "T" in date_str:
                article_date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            else:
                parsed = parse_german_date(date_str)
                if parsed:
                    article_date = datetime.fromisoformat(parsed)
                else:
                    return True

            article_date = article_date.replace(tzinfo=None)

            if self.start_date and article_date.date() < self.start_date.date():
                return False
            if self.end_date and article_date.date() > self.end_date.date():
                return False
            return True
        except (ValueError, AttributeError):
            return True

    # ---- Pagination URL guessing ----
    def _guess_pagination_urls(self, page_count: int) -> list[str]:
        """Generate candidate pagination URLs using common patterns.

        Since the exact URL scheme is unknown, we try multiple patterns
        that German government sites commonly use:
            ?page=N, ?p=N, ?seite=N, /page/N, /seite/N, /N
        """
        base = BASE_URL + LISTING_PATH
        patterns: list[str] = []

        for p in range(2, page_count + 1):
            # Query parameter patterns (most common for CMS-based sites)
            patterns.append(f"{base}?page={p}")
            patterns.append(f"{base}?p={p}")
            patterns.append(f"{base}?seite={p}")
            # Path-based patterns
            patterns.append(f"{base}{p}")
            patterns.append(f"{base}page/{p}")
            patterns.append(f"{base}seite/{p}")

        return patterns

    # ---- Listing page discovery ----
    async def _discover_articles(
        self,
        session: aiohttp.ClientSession,
        semaphore: asyncio.Semaphore,
    ) -> list[dict]:
        """Discover article URLs from listing pages."""
        all_articles: list[dict] = []

        print("Phase 1: Fetching listing page...")
        listing_url = BASE_URL + LISTING_PATH
        first_html = await self._fetch(session, listing_url, semaphore)
        self.pages_visited += 1

        if not first_html:
            print(f"  ERROR: Could not fetch listing page at {listing_url}")
            print("  The site may be down, blocking scrapers, or the URL may have changed.")
            print("  Try running with --test to debug.")
            self.stop_reason = "listing_failed"
            return []

        # Test mode: just dump structure and exit
        if self.test_mode:
            print("\n" + "=" * 70)
            print("HTML STRUCTURE ANALYSIS")
            print("=" * 70)
            print(analyze_html_structure(first_html))
            print("=" * 70)
            return []

        # Parse first page
        articles_p1 = parse_listing_page(first_html)
        print(f"  Page 1: found {len(articles_p1)} article links")
        if articles_p1:
            self.pages_with_content += 1

        for art in articles_p1:
            url = art["url"]
            if url in self.seen_urls:
                continue
            if self.url_cache.is_scraped(url):
                self.skipped_cached += 1
                self.seen_urls.add(url)
                continue
            if self._is_in_date_range(art.get("date")):
                all_articles.append(art)
                self.seen_urls.add(url)

        if not articles_p1:
            print("  WARNING: No articles found on listing page.")
            print("  The page structure may have changed. Run with --test to inspect.")
            return all_articles

        # Discover pagination
        pag_urls = discover_pagination(first_html)
        if self.verbose:
            print(f"  Discovered {len(pag_urls)} pagination links")

        # If no pagination detected, try guessing common patterns
        if not pag_urls and self.max_pages > 1:
            # Try page 2 with common patterns to find which one works
            guess_urls = self._guess_pagination_urls(2)
            if self.verbose:
                print(f"  No pagination detected, probing {len(guess_urls)} URL patterns...")

            probe_results = await self._fetch_batch(session, guess_urls, semaphore)
            working_pattern = None

            for probe_url, probe_html in probe_results:
                if probe_html:
                    probe_articles = parse_listing_page(probe_html)
                    if probe_articles:
                        # This pattern works! Use it for remaining pages
                        working_pattern = probe_url
                        if self.verbose:
                            print(f"  Found working pagination pattern: {probe_url}")
                        break

            if working_pattern:
                # Determine which pattern matched and generate URLs for remaining pages
                pag_urls = []
                for p in range(2, (self.max_pages or 50) + 1):
                    # Reconstruct URL with page number
                    if "?page=" in working_pattern:
                        pag_urls.append(f"{BASE_URL}{LISTING_PATH}?page={p}")
                    elif "?p=" in working_pattern:
                        pag_urls.append(f"{BASE_URL}{LISTING_PATH}?p={p}")
                    elif "?seite=" in working_pattern:
                        pag_urls.append(f"{BASE_URL}{LISTING_PATH}?seite={p}")
                    elif working_pattern.endswith("/2"):
                        pag_urls.append(f"{BASE_URL}{LISTING_PATH}{p}")
                    elif "/page/2" in working_pattern:
                        pag_urls.append(f"{BASE_URL}{LISTING_PATH}page/{p}")
                    elif "/seite/2" in working_pattern:
                        pag_urls.append(f"{BASE_URL}{LISTING_PATH}seite/{p}")
                    else:
                        break

        # Fetch remaining listing pages
        if pag_urls:
            max_pag = self.max_pages - 1 if self.max_pages > 0 else len(pag_urls)
            pag_urls = pag_urls[:max_pag]

            print(f"  Fetching {len(pag_urls)} additional listing pages...")

            # Fetch in batches
            for i in range(0, len(pag_urls), self.concurrent):
                batch = pag_urls[i:i + self.concurrent]
                results = await self._fetch_batch(session, batch, semaphore)
                self.pages_visited += len(batch)

                batch_added = 0
                empty_count = 0

                for page_url, page_html in results:
                    if not page_html:
                        empty_count += 1
                        continue

                    page_articles = parse_listing_page(page_html)
                    if not page_articles:
                        empty_count += 1
                        continue

                    self.pages_with_content += 1

                    for art in page_articles:
                        url = art["url"]
                        if url in self.seen_urls:
                            continue
                        if self.url_cache.is_scraped(url):
                            self.skipped_cached += 1
                            self.seen_urls.add(url)
                            continue
                        if self._is_in_date_range(art.get("date")):
                            all_articles.append(art)
                            self.seen_urls.add(url)
                            batch_added += 1

                page_range_end = min(i + self.concurrent, len(pag_urls))
                print(f"  Pages {i+2}-{page_range_end+1}: +{batch_added} articles (total: {len(all_articles)})")

                # Stop if all pages in batch were empty (likely past last page)
                if empty_count == len(batch):
                    print("  All pages in batch empty, stopping pagination")
                    self.stop_reason = "all_empty"
                    break

                await asyncio.sleep(DELAY_BETWEEN_BATCHES)

        if self.skipped_cached:
            print(f"  Skipped {self.skipped_cached} already-scraped articles (cached)")
        print(f"  Found {len(all_articles)} new articles to scrape")
        return all_articles

    # ---- Article scraping ----
    async def _scrape_articles(
        self,
        session: aiohttp.ClientSession,
        article_infos: list[dict],
        semaphore: asyncio.Semaphore,
    ) -> list[Article]:
        """Fetch and parse individual article pages."""
        articles: list[Article] = []
        total = len(article_infos)

        for i in range(0, total, self.concurrent):
            batch = article_infos[i:i + self.concurrent]
            urls = [a["url"] for a in batch]

            results = await self._fetch_batch(session, urls, semaphore)

            for (url, html), info in zip(results, batch):
                if not html:
                    continue

                parsed = parse_article_page(html, url)
                if not parsed:
                    if self.verbose:
                        print(f"  Failed to parse article: {url}")
                    continue

                # Feuerwehr filter
                if is_feuerwehr_source(None, parsed.get("title")):
                    self.feuerwehr_dropped += 1
                    self.url_cache.mark_scraped(url)
                    continue

                # Use listing date as fallback
                if not parsed.get("date") and info.get("date"):
                    parsed["date"] = info["date"]

                # Truncate date to seconds precision
                if parsed.get("date") and "T" in parsed["date"]:
                    parsed["date"] = parsed["date"][:19]

                article = Article(
                    title=parsed["title"],
                    date=parsed.get("date") or "",
                    city="Hamburg",
                    bundesland="Hamburg",
                    agency_code=parsed.get("agency_code"),
                    source="Polizei Hamburg",
                    url=url,
                    body=parsed.get("body", ""),
                    places=[],
                    themes=[],
                )
                articles.append(article)
                self.url_cache.mark_scraped(url)

            progress = min(i + self.concurrent, total)
            print(f"  Scraped {progress}/{total} articles ({len(articles)} success)")

            if i + self.concurrent < total:
                await asyncio.sleep(DELAY_BETWEEN_BATCHES)

        return articles

    # ---- Main entrypoint ----
    async def run_async(self) -> None:
        print("=" * 60)
        print("Hamburg Police Press Release Scraper")
        print("=" * 60)
        print(f"Source: {BASE_URL}{LISTING_PATH}")
        print(f"Concurrent requests: {self.concurrent}")
        if self.start_date:
            print(f"Start date: {self.start_date.date()}")
        if self.end_date:
            print(f"End date: {self.end_date.date()}")
        if self.max_pages:
            print(f"Max pages: {self.max_pages}")
        if self.test_mode:
            print("MODE: Test (fetch listing page and analyze structure)")
        print()

        start_time = time.time()

        ssl_ctx = self._create_ssl_context()
        connector = aiohttp.TCPConnector(ssl=ssl_ctx)
        semaphore = asyncio.Semaphore(self.concurrent)

        async with aiohttp.ClientSession(
            headers=self._create_headers(),
            connector=connector,
        ) as session:
            # Phase 1: discover article URLs
            article_infos = await self._discover_articles(session, semaphore)

            if self.test_mode or not article_infos:
                if not self.test_mode:
                    print("No articles found to scrape.")
                return

            # Phase 2: scrape article detail pages
            print(f"\nPhase 2: Scraping {len(article_infos)} articles...")
            self.articles = await self._scrape_articles(session, article_infos, semaphore)

        elapsed = time.time() - start_time

        # Save URL cache
        self.url_cache.save()

        # Write scrape metadata
        meta = {
            "source": "polizei_hamburg",
            "pages_visited": self.pages_visited,
            "pages_with_content": self.pages_with_content,
            "articles_per_page": None,
            "source_total": None,
            "estimated_total": None,
            "articles_scraped": len(self.articles),
            "articles_cached_skip": self.skipped_cached,
            "articles_feuerwehr_skip": self.feuerwehr_dropped,
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

        # Summary
        print()
        print("=" * 60)
        print(f"Saved {len(self.articles)} articles to {self.output}")
        if self.feuerwehr_dropped:
            print(f"Dropped {self.feuerwehr_dropped} Feuerwehr (fire dept) articles")
        print(f"URL cache: {len(self.url_cache)} total URLs in {self.url_cache.cache_file}")
        print(f"Elapsed time: {elapsed:.1f}s ({elapsed/60:.1f} min)")
        print(f"Fetch stats: {self.fetch_count} requests, {self.fetch_errors} errors")
        if self.articles:
            print(f"Speed: {len(self.articles)/max(elapsed, 0.1):.1f} articles/sec")
        print("=" * 60)

    def run(self) -> None:
        asyncio.run(self.run_async())


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Scrape press releases from polizei.hamburg",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Test mode: inspect listing page HTML structure
  python3 scripts/scrapers/scrape_hamburg_polizei.py --test

  # Scrape first 3 pages
  python3 scripts/scrapers/scrape_hamburg_polizei.py --max-pages 3

  # Scrape January 2026
  python3 scripts/scrapers/scrape_hamburg_polizei.py --start-date 2026-01-01 --end-date 2026-01-31

  # Full scrape with custom output
  python3 scripts/scrapers/scrape_hamburg_polizei.py -o data/hamburg_raw.json -v
        """,
    )

    parser.add_argument(
        "--start-date",
        type=str,
        help="Start date filter (ISO: YYYY-MM-DD)",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        help="End date filter (ISO: YYYY-MM-DD)",
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default="data/hamburg_polizei_raw.json",
        help="Output JSON file (default: data/hamburg_polizei_raw.json)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=0,
        help="Maximum listing pages to scrape (0 = no limit, default: 0)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output",
    )
    parser.add_argument(
        "--concurrent",
        type=int,
        default=DEFAULT_CONCURRENT,
        help=f"Number of concurrent requests (default: {DEFAULT_CONCURRENT})",
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
        help="Test mode: fetch listing page, print HTML structure analysis, and exit",
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

    scraper = AsyncHamburgPolizeiScraper(
        start_date=args.start_date,
        end_date=args.end_date,
        max_pages=args.max_pages,
        output=args.output,
        verbose=args.verbose,
        concurrent=args.concurrent,
        cache_dir=args.cache_dir,
        test_mode=args.test,
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
    scraper = AsyncHamburgPolizeiScraper(
        start_date=start_date,
        end_date=end_date,
        output=os.devnull,
        cache_dir=cache_dir,
        concurrent=concurrent,
    )
    await scraper.run_async()
    return [asdict(a) for a in scraper.articles]


if __name__ == "__main__":
    main()
