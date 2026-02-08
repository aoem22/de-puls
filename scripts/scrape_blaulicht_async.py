#!/usr/bin/env python3
"""
Async Presseportal Blaulicht Scraper - 10-20x faster than sync version.

Uses aiohttp with semaphore-controlled concurrency to fetch 20 pages/articles
simultaneously, dramatically reducing scrape time from ~30 min to ~2-3 min per month.

Usage:
    python scripts/scrape_blaulicht_async.py --bundesland hessen --start-date 2024-01-01 --end-date 2024-01-31
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
from urllib.parse import urljoin

import aiohttp
import certifi
from bs4 import BeautifulSoup

# Fix SSL on macOS - certifi provides Mozilla's CA bundle
os.environ['SSL_CERT_FILE'] = certifi.where()

# Constants
BASE_URL = "https://www.presseportal.de"
BLAULICHT_URL = f"{BASE_URL}/blaulicht/"
USER_AGENT = "de-puls/1.0 (+contact: scraper@example.com)"

# Async configuration - the key to 10-20x speedup
CONCURRENT_REQUESTS = 20  # Fetch 20 pages/articles at once
DELAY_BETWEEN_BATCHES = 0.3  # Small delay between batches to avoid rate limits
REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3

# Bundesland slug to display name mapping
BUNDESLAND_SLUGS = {
    "baden-wuerttemberg": "Baden-Württemberg",
    "bayern": "Bayern",
    "berlin": "Berlin",
    "brandenburg": "Brandenburg",
    "bremen": "Bremen",
    "hamburg": "Hamburg",
    "hessen": "Hessen",
    "mecklenburg-vorpommern": "Mecklenburg-Vorpommern",
    "niedersachsen": "Niedersachsen",
    "nordrhein-westfalen": "Nordrhein-Westfalen",
    "rheinland-pfalz": "Rheinland-Pfalz",
    "saarland": "Saarland",
    "sachsen": "Sachsen",
    "sachsen-anhalt": "Sachsen-Anhalt",
    "schleswig-holstein": "Schleswig-Holstein",
    "thueringen": "Thüringen",
}


@dataclass
class Article:
    """Represents a scraped press release article."""
    title: str
    date: str
    city: Optional[str]
    bundesland: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    source: Optional[str]
    url: str
    body: str


class ScrapedUrlsCache:
    """Persistent cache for tracking already-scraped article URLs.

    Prevents re-scraping articles across scraper runs by storing URLs
    with their scrape timestamp.
    """

    def __init__(self, cache_dir: str = ".cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / "scraped_urls.json"
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


def parse_listing_page(html: str) -> list[dict]:
    """
    Parse a listing page to extract article links and metadata.
    Returns list of dicts with 'url', 'title', 'date' keys.
    """
    soup = BeautifulSoup(html, "html.parser")
    articles = []

    # Find article containers - try multiple selectors
    article_containers = soup.select('[itemtype*="NewsArticle"], article, .news-item, .story')

    if not article_containers:
        # Fallback: find all links to /blaulicht/pm/
        links = soup.select('a[href*="/blaulicht/pm/"]')
        for link in links:
            href = link.get("href", "")
            if href and "/blaulicht/pm/" in href:
                full_url = urljoin(BASE_URL, href)
                title = link.get_text(strip=True) or "Ohne Titel"
                articles.append({
                    "url": full_url,
                    "title": title,
                    "date": None,
                })
        return articles

    for container in article_containers:
        # Find article link
        link = container.select_one('a[href*="/blaulicht/pm/"]')
        if not link:
            continue

        href = link.get("href", "")
        if not href:
            continue

        full_url = urljoin(BASE_URL, href)

        # Extract title
        title_elem = container.select_one("h2, h3, .headline, [itemprop='headline']")
        title = title_elem.get_text(strip=True) if title_elem else link.get_text(strip=True)
        if not title:
            title = "Ohne Titel"

        # Extract date
        date_elem = container.select_one("time, .date, .timestamp, [itemprop='datePublished']")
        date_str = None
        if date_elem:
            date_str = date_elem.get("datetime") or date_elem.get_text(strip=True)

        # Try regex for German date format if not found
        if not date_str:
            container_text = container.get_text()
            date_match = re.search(r"\d{2}\.\d{2}\.\d{4}", container_text)
            if date_match:
                date_str = date_match.group()

        articles.append({
            "url": full_url,
            "title": title,
            "date": date_str,
        })

    return articles


def parse_german_date(date_str: str) -> Optional[str]:
    """Convert German date formats to ISO format."""
    if not date_str:
        return None

    # Already ISO format
    if re.match(r"\d{4}-\d{2}-\d{2}", date_str):
        return date_str[:10]

    # German format: DD.MM.YYYY
    match = re.match(r"(\d{2})\.(\d{2})\.(\d{4})", date_str)
    if match:
        day, month, year = match.groups()
        return f"{year}-{month}-{day}"

    return None


def parse_article_page(html: str, url: str) -> Optional[dict]:
    """
    Parse an article page to extract full details.
    Returns dict with article data or None on parse failure.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Find the main story article
    story = soup.select_one("article.story")
    card = story.select_one(".card") if story else None

    # Title - try card h1, then og:title, then any h1
    title = None
    if card:
        h1 = card.select_one("h1")
        if h1:
            title = h1.get_text(strip=True)
    if not title:
        og_title = soup.select_one('meta[property="og:title"]')
        if og_title:
            title = og_title.get("content", "").strip()
    if not title:
        h1 = soup.select_one("h1")
        title = h1.get_text(strip=True) if h1 else None
    if not title:
        title = "Ohne Titel"

    # Date - try multiple sources
    date_str = None

    # Try Schema.org JSON-LD first (most reliable)
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.string or "")
            if isinstance(data, dict) and "datePublished" in data:
                date_str = data["datePublished"]
                break
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and "datePublished" in item:
                        date_str = item["datePublished"]
                        break
        except json.JSONDecodeError:
            continue

    # Try card p.date
    if not date_str and card:
        date_elem = card.select_one("p.date")
        if date_elem:
            date_text = date_elem.get_text(strip=True)
            # Format: "04.02.2026 – 05:55"
            date_match = re.match(r"(\d{2})\.(\d{2})\.(\d{4})\s*[–-]\s*(\d{2}):(\d{2})", date_text)
            if date_match:
                day, month, year, hour, minute = date_match.groups()
                date_str = f"{year}-{month}-{day}T{hour}:{minute}:00"

    # Try meta tags
    if not date_str:
        for selector in ['meta[property="article:published_time"]', 'meta[name="date"]']:
            elem = soup.select_one(selector)
            if elem:
                date_str = elem.get("content", "").strip()
                if date_str:
                    break

    # Source/Agency - try card p.customer first
    source = None
    if card:
        customer = card.select_one("p.customer")
        if customer:
            source = customer.get_text(strip=True)

    if not source:
        for selector in [".article__office", "[itemprop='author']", ".newsroom", ".author"]:
            elem = soup.select_one(selector)
            if elem:
                source = elem.get_text(strip=True)
                if source:
                    break

    # Try meta author
    if not source:
        author_meta = soup.select_one('meta[property="article:author"]')
        if author_meta:
            source = author_meta.get("content", "").strip()

    # Body text - collect paragraphs from card
    body = ""
    city = None

    if card:
        # Get all paragraphs that are content (not .date, .customer, .contact-*, .originator)
        paragraphs = []
        for p in card.select("p"):
            classes = p.get("class", [])
            # Skip meta paragraphs
            if any(c in classes for c in ["date", "customer", "contact-headline", "contact-text", "originator"]):
                continue
            text = p.get_text(strip=True)
            if text:
                paragraphs.append(text)

        # First paragraph often contains "Stadtname(ots)" - extract city
        if paragraphs:
            first_para = paragraphs[0]
            # Pattern: "Hainburg(ots)" or "Frankfurt am Main (ots)"
            city_match = re.match(r"([A-ZÄÖÜa-zäöüß][A-ZÄÖÜa-zäöüß\s-]+?)\s*\(ots\)", first_para)
            if city_match:
                city = city_match.group(1).strip()

        body = "\n\n".join(paragraphs)

    # Fallback body extraction
    if not body:
        for selector in ['[itemprop="articleBody"]', ".article__content", ".story-text", ".text"]:
            elem = soup.select_one(selector)
            if elem:
                body = elem.get_text(separator="\n", strip=True)
                if body:
                    break

    # City extraction fallbacks
    if not city:
        # Try location element
        for selector in [".location", ".article__location", ".article-location"]:
            elem = soup.select_one(selector)
            if elem:
                city = elem.get_text(strip=True)
                if city:
                    break

    # Try to extract from title (common format: "POL-XX: ... - Stadtname")
    if not city and title:
        title_match = re.search(r"[-–]\s*([A-ZÄÖÜa-zäöüß][a-zäöüß]+(?:\s+[A-ZÄÖÜa-zäöüß][a-zäöüß]+)?)\s*$", title)
        if title_match:
            city = title_match.group(1).strip()

    # Try to extract from body (common: "Ort: Stadtname")
    if not city and body:
        loc_match = re.search(r"(?:Ort|Tatort|Einsatzort)\s*:\s*([A-ZÄÖÜa-zäöüß][a-zäöüß-]+(?:\s+[A-ZÄÖÜa-zäöüß][a-zäöüß-]+)?)", body)
        if loc_match:
            city = loc_match.group(1).strip()

    return {
        "title": title,
        "date": date_str,
        "city": city,
        "source": source,
        "url": url,
        "body": body,
    }


# Feuerwehr source filter — drop fire dept articles before enrichment
FEUERWEHR_PATTERN = re.compile(
    r'Feuerwehr|^FW[ -]|Berufsfeuerwehr|Freiwillige Feuerwehr',
    re.IGNORECASE,
)


def is_feuerwehr_source(source: Optional[str], title: Optional[str] = None) -> bool:
    """Check if article is from a fire department (not police)."""
    if source and FEUERWEHR_PATTERN.search(source):
        return True
    # Also check title prefix (e.g. "FW-HH: ...")
    if title and re.match(r'^FW[ -]', title):
        return True
    return False


class AsyncPresseportalScraper:
    """
    Async scraper for Presseportal Blaulicht - 10-20x faster than sync version.

    Key optimizations:
    1. Concurrent page fetching with semaphore control
    2. Batch processing to avoid rate limits
    3. No per-request delays (controlled by semaphore instead)
    """

    def __init__(
        self,
        bundesland: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        max_pages: int = 0,
        output: str = "blaulicht_reports.json",
        verbose: bool = False,
        concurrent_requests: int = CONCURRENT_REQUESTS,
        cache_dir: str = ".cache",
    ):
        self.bundesland = bundesland
        self.bundesland_display = BUNDESLAND_SLUGS.get(bundesland) if bundesland else None
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

    def _build_listing_url(self, page: int = 1) -> str:
        """Build the listing page URL with optional Bundesland and date filters."""
        if self.bundesland:
            if page == 1:
                base = f"{BASE_URL}/blaulicht/l/{self.bundesland}"
            else:
                base = f"{BASE_URL}/blaulicht/l/{self.bundesland}/{page}"
        else:
            if page == 1:
                base = f"{BASE_URL}/blaulicht/"
            else:
                base = f"{BASE_URL}/blaulicht/{page}"

        params = []
        if self.start_date:
            params.append(f"startDate={self.start_date.strftime('%Y-%m-%d')}")
        if self.end_date:
            params.append(f"endDate={self.end_date.strftime('%Y-%m-%d')}")

        if params:
            return f"{base}?{'&'.join(params)}"
        return base

    def _is_in_date_range(self, date_str: Optional[str]) -> bool:
        """Check if article date falls within configured range."""
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
                        timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_SECONDS)
                    ) as response:
                        if response.status == 200:
                            self.fetch_count += 1
                            return await response.text()
                        elif response.status == 429:  # Rate limited
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

    async def _discover_listing_pages(
        self,
        session: aiohttp.ClientSession,
        semaphore: asyncio.Semaphore,
    ) -> list[dict]:
        """
        Discover all listing pages and extract article URLs.

        Strategy: Fetch listing pages in batches of CONCURRENT_REQUESTS for
        massive speedup. Stop when we hit consecutive empty pages or find
        no new articles in range.
        """
        all_articles = []
        page = 1
        consecutive_no_new = 0  # Track batches with 0 new articles
        batch_size = self.concurrent_requests  # Fetch this many pages at once

        print(f"Discovering listing pages (batch size: {batch_size})...")
        if self.bundesland:
            print(f"  Bundesland: {self.bundesland_display}")
        if self.start_date:
            print(f"  Date range: {self.start_date.date()} to {self.end_date.date() if self.end_date else 'now'}")

        while True:
            if self.max_pages > 0 and page > self.max_pages:
                print(f"  Reached max pages limit ({self.max_pages})")
                break

            # Build batch of URLs
            batch_urls = []
            for i in range(batch_size):
                p = page + i
                if self.max_pages > 0 and p > self.max_pages:
                    break
                batch_urls.append(self._build_listing_url(p))

            if not batch_urls:
                break

            # Fetch all pages in batch concurrently
            results = await self._fetch_batch(session, batch_urls, semaphore)

            batch_added = 0
            empty_pages = 0
            all_too_old_batch = True

            for url, html in results:
                if not html:
                    empty_pages += 1
                    continue

                articles = parse_listing_page(html)
                if not articles:
                    empty_pages += 1
                    continue

                for article in articles:
                    article_date_str = article.get("date")
                    in_range = self._is_in_date_range(article_date_str)

                    # Check if still in date range
                    if article_date_str and self.start_date:
                        try:
                            if "T" in article_date_str:
                                article_date = datetime.fromisoformat(
                                    article_date_str.replace("Z", "+00:00")
                                ).replace(tzinfo=None)
                            else:
                                parsed = parse_german_date(article_date_str)
                                article_date = datetime.fromisoformat(parsed) if parsed else None

                            if article_date and article_date.date() >= self.start_date.date():
                                all_too_old_batch = False
                        except (ValueError, AttributeError):
                            all_too_old_batch = False
                    else:
                        all_too_old_batch = False

                    if article["url"] not in self.seen_urls:
                        # Skip if already in persistent cache
                        if self.url_cache.is_scraped(article["url"]):
                            self.skipped_cached_count += 1
                            self.seen_urls.add(article["url"])
                            continue

                        if in_range:
                            all_articles.append(article)
                            self.seen_urls.add(article["url"])
                            batch_added += 1

            print(f"  Pages {page}-{page + len(batch_urls) - 1}: +{batch_added} articles (total: {len(all_articles)})")

            # Stop conditions
            if empty_pages == len(batch_urls):
                print(f"  All pages in batch empty, stopping")
                break

            if self.start_date and all_too_old_batch:
                print(f"  All articles older than {self.start_date.date()}, stopping")
                break

            # Track consecutive batches with 0 new articles
            if batch_added == 0:
                consecutive_no_new += 1
                if consecutive_no_new >= 3:  # 3 batches = 60 pages with 0 new articles
                    print(f"  No new articles for {consecutive_no_new} batches, stopping")
                    break
            else:
                consecutive_no_new = 0

            page += len(batch_urls)

            # Small delay between batches
            await asyncio.sleep(DELAY_BETWEEN_BATCHES)

        if self.skipped_cached_count > 0:
            print(f"  Skipped {self.skipped_cached_count} already-scraped articles")
        print(f"  Found {len(all_articles)} new articles to scrape")
        return all_articles

    async def _scrape_articles_batch(
        self,
        session: aiohttp.ClientSession,
        article_infos: list[dict],
        semaphore: asyncio.Semaphore,
    ) -> list[Article]:
        """Scrape article pages concurrently in batches."""
        articles = []
        total = len(article_infos)

        # Process in batches for progress reporting
        batch_size = self.concurrent_requests

        for i in range(0, total, batch_size):
            batch = article_infos[i:i + batch_size]
            urls = [a["url"] for a in batch]

            # Fetch all URLs in batch concurrently
            results = await self._fetch_batch(session, urls, semaphore)

            # Parse results
            for (url, html), info in zip(results, batch):
                if html:
                    parsed = parse_article_page(html, url)
                    if parsed:
                        # Drop Feuerwehr (fire dept) articles
                        if is_feuerwehr_source(parsed.get("source"), parsed.get("title")):
                            self.feuerwehr_dropped_count += 1
                            self.url_cache.mark_scraped(url)
                            continue

                        # Use listing date as fallback
                        if not parsed["date"] and info.get("date"):
                            parsed["date"] = info["date"]

                        # Format date to ISO
                        if parsed["date"]:
                            date_str = parsed["date"]
                            if "T" in date_str:
                                parsed["date"] = date_str[:19]
                            else:
                                iso_date = parse_german_date(date_str)
                                if iso_date:
                                    parsed["date"] = iso_date

                        article = Article(
                            title=parsed["title"],
                            date=parsed["date"] or "",
                            city=parsed["city"],
                            bundesland=self.bundesland_display,
                            lat=None,  # Geocoding disabled for speed
                            lon=None,
                            source=parsed["source"],
                            url=parsed["url"],
                            body=parsed["body"],
                        )
                        articles.append(article)
                        # Mark URL as scraped in persistent cache
                        self.url_cache.mark_scraped(url)

            # Progress update
            progress = min(i + batch_size, total)
            print(f"  Scraped {progress}/{total} articles ({len(articles)} success)")

            # Small delay between batches
            if i + batch_size < total:
                await asyncio.sleep(DELAY_BETWEEN_BATCHES)

        return articles

    async def run_async(self) -> None:
        """Execute the async scraping pipeline."""
        print("=" * 60)
        print("Async Presseportal Blaulicht Scraper")
        print("=" * 60)
        print(f"Concurrent requests: {self.concurrent_requests}")

        if self.start_date:
            print(f"Start date: {self.start_date.date()}")
        if self.end_date:
            print(f"End date: {self.end_date.date()}")
        print()

        start_time = time.time()

        # Create HTTP headers
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
        }

        # Create SSL context with certifi certificates (fixes macOS SSL issues)
        ssl_context = ssl.create_default_context(cafile=certifi.where())

        # Create semaphore for concurrency control
        semaphore = asyncio.Semaphore(self.concurrent_requests)

        # Create connector with custom SSL context
        connector = aiohttp.TCPConnector(ssl=ssl_context)

        async with aiohttp.ClientSession(headers=headers, connector=connector) as session:
            # Phase 1: Discover all article URLs from listing pages
            article_infos = await self._discover_listing_pages(session, semaphore)

            if not article_infos:
                print("No articles found to scrape")
                return

            # Phase 2: Scrape all articles concurrently
            print(f"\nScraping {len(article_infos)} articles with {self.concurrent_requests} concurrent requests...")
            self.articles = await self._scrape_articles_batch(session, article_infos, semaphore)

        elapsed = time.time() - start_time

        # Save URL cache
        self.url_cache.save()

        # Write output
        output_data = [asdict(article) for article in self.articles]

        # Ensure output directory exists
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


def main():
    parser = argparse.ArgumentParser(
        description="Async scrape police press releases from Presseportal Blaulicht (10-20x faster)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/scrape_blaulicht_async.py --bundesland hessen --start-date 2024-01-01 --end-date 2024-01-31
  python scripts/scrape_blaulicht_async.py --bundesland bayern --max-pages 5
        """
    )

    parser.add_argument(
        "--bundesland",
        type=str,
        choices=list(BUNDESLAND_SLUGS.keys()),
        help="Filter by Bundesland (use slug, e.g., 'hessen', 'bayern')"
    )

    parser.add_argument(
        "--start-date",
        type=str,
        help="Start date filter (ISO format: YYYY-MM-DD)"
    )

    parser.add_argument(
        "--end-date",
        type=str,
        help="End date filter (ISO format: YYYY-MM-DD)"
    )

    parser.add_argument(
        "--max-pages",
        type=int,
        default=0,
        help="Maximum number of listing pages to scrape (0 = no limit)"
    )

    parser.add_argument(
        "--output", "-o",
        type=str,
        default="blaulicht_reports.json",
        help="Output JSON file path (default: blaulicht_reports.json)"
    )

    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output"
    )

    parser.add_argument(
        "--concurrent",
        type=int,
        default=CONCURRENT_REQUESTS,
        help=f"Number of concurrent requests (default: {CONCURRENT_REQUESTS})"
    )

    parser.add_argument(
        "--cache-dir",
        type=str,
        default=".cache",
        help="Directory for caches (default: .cache)"
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

    scraper = AsyncPresseportalScraper(
        bundesland=args.bundesland,
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
