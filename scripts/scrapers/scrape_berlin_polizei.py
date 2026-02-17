#!/usr/bin/env python3
"""
Async Berlin Polizei Pressemeldungen Scraper.

Scrapes police press releases from the Berlin police archive at
berlin.de/polizei/polizeimeldungen/archiv/{YEAR}/.

Uses aiohttp with semaphore-controlled concurrency, matching the pattern of
the main presseportal scraper for pipeline compatibility.

Usage:
    python3 scripts/scrapers/scrape_berlin_polizei.py --start-date 2026-01-01 --end-date 2026-01-31
    python3 scripts/scrapers/scrape_berlin_polizei.py --start-date 2025-06-01 --end-date 2026-01-31 -o data/berlin_polizei.json
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
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import aiohttp
import certifi
from bs4 import BeautifulSoup

# Fix SSL on macOS - certifi provides Mozilla's CA bundle
os.environ['SSL_CERT_FILE'] = certifi.where()

# Constants
BASE_URL = "https://www.berlin.de"
ARCHIVE_URL_TEMPLATE = BASE_URL + "/polizei/polizeimeldungen/archiv/{year}/"
USER_AGENT = "de-puls/1.0 (+contact: scraper@example.com)"

# Async configuration
CONCURRENT_REQUESTS = 15
DELAY_BETWEEN_BATCHES = 0.5  # Berlin.de is slower; be a bit more polite
REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3

# Feuerwehr filter pattern (shared with presseportal scraper)
FEUERWEHR_PATTERN = re.compile(
    r'Feuerwehr|^FW[ -]|Berufsfeuerwehr|Freiwillige Feuerwehr',
    re.IGNORECASE,
)


@dataclass
class Article:
    """Represents a scraped press release article (same schema as presseportal scraper)."""
    title: str
    date: str
    city: Optional[str]
    bundesland: Optional[str]
    agency_code: Optional[str]
    source: Optional[str]
    url: str
    body: str
    places: list[str]
    themes: list[str]


class ScrapedUrlsCache:
    """Persistent cache for tracking already-scraped article URLs.

    Prevents re-scraping articles across scraper runs by storing URLs
    with their scrape timestamp. Uses a separate cache file from the
    presseportal scraper.
    """

    def __init__(self, cache_dir: str = ".cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / "scraped_urls_berlin.json"
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
        return len(self.urls)


def is_feuerwehr_article(title: Optional[str], body: Optional[str] = None) -> bool:
    """Check if article is from a fire department (not police)."""
    if title and FEUERWEHR_PATTERN.search(title):
        return True
    if body and FEUERWEHR_PATTERN.search(body[:200]):
        return True
    return False


def parse_german_datetime(text: str) -> Optional[str]:
    """Parse German date/time strings into ISO format.

    Handles:
        '19.01.2026 11:40 Uhr'  -> '2026-01-19T11:40:00'
        'Polizeimeldung vom 10.01.2026' -> '2026-01-10'
        '10.01.2026' -> '2026-01-10'
    """
    if not text:
        return None

    # Full datetime: DD.MM.YYYY HH:MM Uhr
    m = re.search(r'(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})', text)
    if m:
        day, month, year, hour, minute = m.groups()
        return f"{year}-{month}-{day}T{hour}:{minute}:00"

    # Date only: DD.MM.YYYY
    m = re.search(r'(\d{2})\.(\d{2})\.(\d{4})', text)
    if m:
        day, month, year = m.groups()
        return f"{year}-{month}-{day}"

    return None


def parse_date_to_date_obj(date_str: str) -> Optional[date]:
    """Convert an ISO date string to a date object for comparison."""
    if not date_str:
        return None
    try:
        # Handle both 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:MM:SS'
        return datetime.fromisoformat(date_str[:10]).date()
    except (ValueError, AttributeError):
        return None


def years_in_range(start_date: date, end_date: date) -> list[int]:
    """Return list of years that a date range spans."""
    return list(range(start_date.year, end_date.year + 1))


def parse_listing_page(html: str, year: int) -> list[dict]:
    """Parse a Berlin Polizei archive listing page.

    Each article appears as an <li> containing:
        <strong>DD.MM.YYYY HH:MM Uhr</strong>
        <a href="...">Title</a>
        <strong>Ereignisort:</strong> District

    Returns list of dicts with 'url', 'title', 'date', 'city' keys.
    """
    soup = BeautifulSoup(html, "html.parser")
    articles = []

    # The listing is typically inside a <ul> with <li> elements
    # Each <li> contains the date, link, and optionally the Ereignisort
    for li in soup.select("li"):
        # Must contain an article link to the pressemitteilung
        link = li.select_one('a[href*="pressemitteilung"]')
        if not link:
            continue

        href = link.get("href", "")
        if not href:
            continue

        # Build absolute URL
        if href.startswith("/"):
            full_url = BASE_URL + href
        elif href.startswith("http"):
            full_url = href
        else:
            full_url = BASE_URL + "/polizei/polizeimeldungen/" + href

        title = link.get_text(strip=True)
        if not title:
            title = "Ohne Titel"

        # Extract date from the <strong> before the link
        date_str = None
        li_text = li.get_text(" ", strip=True)
        date_str = parse_german_datetime(li_text)

        # Extract Ereignisort (district) - appears after "Ereignisort:" label
        city = None
        ereignisort_match = re.search(r'Ereignisort:\s*(.+)', li_text)
        if ereignisort_match:
            city = ereignisort_match.group(1).strip()
            # Clean up: remove trailing artifacts
            city = re.sub(r'\s+', ' ', city).strip()

        articles.append({
            "url": full_url,
            "title": title,
            "date": date_str,
            "city": city,
        })

    return articles


def parse_article_page(html: str, url: str) -> Optional[dict]:
    """Parse a Berlin Polizei article page.

    Current structure (2026):
        <h1>Headline</h1>
        <p class="polizeimeldung">Polizeimeldung vom DD.MM.YYYY</p>
        <p class="polizeimeldung">District</p>
        <section class="modul-text_bild">
          <div class="text"><div class="textile">
            <p><strong>Nr. NNNN</strong><br/>Body text...</p>
            <p>More body text...</p>
          </div></div>
        </section>

    The Nr. reference and body text are often combined in a single <p>.
    District may appear as a <br/>-separated line before Nr. in the same <p>.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Title from <h1>
    h1 = soup.select_one("h1")
    title = h1.get_text(strip=True) if h1 else "Ohne Titel"

    # --- Extract date from <p class="polizeimeldung"> ---
    date_str = None
    for p in soup.select("p.polizeimeldung"):
        text = p.get_text(strip=True)
        if "Polizeimeldung vom" in text:
            date_str = parse_german_datetime(text)
            break

    # --- Extract district from <p class="polizeimeldung"> ---
    city = None
    berlin_districts = [
        "Charlottenburg-Wilmersdorf", "Friedrichshain-Kreuzberg",
        "Lichtenberg", "Marzahn-Hellersdorf", "Mitte",
        "Neukoelln", "Neukolln", "Pankow", "Reinickendorf",
        "Spandau", "Steglitz-Zehlendorf", "Tempelhof-Schoeneberg",
        "Tempelhof-Schoneberg", "Treptow-Koepenick", "Treptow-Kopenick",
        "Neukölln", "Tempelhof-Schöneberg", "Treptow-Köpenick",
    ]
    berlin_districts_lower = [d.lower() for d in berlin_districts]
    for p in soup.select("p.polizeimeldung"):
        text = p.get_text(strip=True).rstrip(".")
        if text.lower() in berlin_districts_lower:
            city = text
            break

    # --- Find main content area ---
    content_area = (
        soup.select_one("section.modul-text_bild .textile")
        or soup.select_one(".body")
        or soup.select_one("article .textile")
        or soup.select_one("article")
        or soup.select_one("#layout-grid__area--maincontent")
        or soup
    )

    # Collect all <p> tags in the content area
    paragraphs = content_area.select("p") if content_area else []

    ref_number = None
    body_parts = []

    for p in paragraphs:
        # Use <br/>-aware text extraction: replace <br/> with newline
        for br in p.find_all("br"):
            br.replace_with("\n")
        text = p.get_text("\n")
        if not text.strip():
            continue

        # Split by newlines (from <br/> tags) to handle multi-part <p>
        lines = [line.strip() for line in text.split("\n") if line.strip()]

        for line in lines:
            # Extract reference number (Nr. 0169) — may have trailing text
            nr_match = re.match(r'^(Nr\.\s*\d+)\s*(.*)', line)
            if nr_match:
                ref_number = nr_match.group(1).strip()
                remainder = nr_match.group(2).strip()
                if remainder:
                    # Keep text after the Nr. as body content
                    body_parts.append(remainder)
                continue

            # Skip district names that appear inline
            if not city and line.rstrip(".").lower() in berlin_districts_lower:
                city = line.rstrip(".")
                continue
            if line.rstrip(".").lower() in berlin_districts_lower:
                continue

            # Skip "bezirksübergreifend" (cross-district label)
            if line.lower().startswith("bezirksübergreifend"):
                continue

            # Skip "Polizeimeldung vom" if it leaked into content
            if "Polizeimeldung vom" in line:
                if not date_str:
                    date_str = parse_german_datetime(line)
                continue

            # Skip navigation/footer text
            if line.startswith("Seite") and "von" in line:
                continue

            # Accumulate body text
            body_parts.append(line)

    body = "\n\n".join(body_parts)

    # Fallback: if no date found, try to extract from any text
    if not date_str:
        page_text = content_area.get_text(" ", strip=True) if content_area else ""
        date_str = parse_german_datetime(page_text)

    # Agency code: extract from title if present (e.g. "POL-B: ...")
    agency_code = None
    if title:
        agency_match = re.match(r'^([A-Z][A-Z0-9 -]+?):\s', title)
        if agency_match:
            agency_code = agency_match.group(1).strip()

    return {
        "title": title,
        "date": date_str,
        "city": city,
        "agency_code": agency_code,
        "url": url,
        "body": body,
        "ref_number": ref_number,
    }


class AsyncBerlinPolizeiScraper:
    """
    Async scraper for Berlin Polizei Pressemeldungen.

    Fetches article listings from the yearly archive pages, then scrapes
    individual article pages concurrently.
    """

    def __init__(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        max_pages: int = 0,
        output: str = "berlin_polizei_reports.json",
        verbose: bool = False,
        concurrent_requests: int = CONCURRENT_REQUESTS,
        cache_dir: str = ".cache",
    ):
        self.start_date: Optional[date] = (
            datetime.fromisoformat(start_date).date() if start_date else None
        )
        self.end_date: Optional[date] = (
            datetime.fromisoformat(end_date).date() if end_date else None
        )
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

    def _get_years_to_scrape(self) -> list[int]:
        """Determine which archive years to scrape based on date range."""
        if self.start_date and self.end_date:
            return years_in_range(self.start_date, self.end_date)
        elif self.start_date:
            return years_in_range(self.start_date, date.today())
        elif self.end_date:
            # Default: from 2015 to end_date year
            return years_in_range(date(2015, 1, 1), self.end_date)
        else:
            # Default: current year only
            return [date.today().year]

    def _build_listing_url(self, year: int, page: int) -> str:
        """Build a paginated listing URL for a given archive year."""
        base = ARCHIVE_URL_TEMPLATE.format(year=year)
        if page <= 1:
            return base
        return f"{base}?page_at_1_0={page}"

    def _is_in_date_range(self, date_str: Optional[str]) -> bool:
        """Check if article date falls within configured range."""
        if not date_str:
            return True  # Keep articles with unknown dates
        if not self.start_date and not self.end_date:
            return True

        article_date = parse_date_to_date_obj(date_str)
        if not article_date:
            return True

        if self.start_date and article_date < self.start_date:
            return False
        if self.end_date and article_date > self.end_date:
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
                            wait_time = 2 ** (attempt + 1)
                            if self.verbose:
                                print(f"  Rate limited on {url}, waiting {wait_time}s...")
                            await asyncio.sleep(wait_time)
                        elif response.status == 404:
                            if self.verbose:
                                print(f"  404 Not Found: {url}")
                            return None
                        else:
                            if self.verbose:
                                print(f"  HTTP {response.status} for {url}")
                            if attempt < MAX_RETRIES - 1:
                                await asyncio.sleep(1)
                            else:
                                return None
                except asyncio.TimeoutError:
                    if self.verbose:
                        print(f"  Timeout ({attempt+1}/{MAX_RETRIES}): {url}")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(2 ** attempt)
                except aiohttp.ClientError as e:
                    if self.verbose:
                        print(f"  Client error ({attempt+1}/{MAX_RETRIES}): {url}: {e}")
                    if attempt < MAX_RETRIES - 1:
                        await asyncio.sleep(2 ** attempt)

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

    async def _discover_articles_for_year(
        self,
        session: aiohttp.ClientSession,
        semaphore: asyncio.Semaphore,
        year: int,
    ) -> list[dict]:
        """Discover all articles from a given archive year.

        Paginates through listing pages until no more articles are found.
        Berlin.de archive typically has ~41 pages per year.
        """
        all_articles = []
        page = 1
        consecutive_empty = 0
        max_consecutive_empty = 3  # Stop after 3 empty pages in a row
        batch_size = min(self.concurrent_requests, 10)  # Listing pages in parallel

        print(f"\n  Year {year}: discovering articles...")

        while True:
            if self.max_pages > 0 and page > self.max_pages:
                print(f"    Reached max pages limit ({self.max_pages})")
                self.stop_reason = "max_pages"
                break

            # Build batch of listing page URLs
            batch_urls = []
            for i in range(batch_size):
                p = page + i
                if self.max_pages > 0 and p > self.max_pages:
                    break
                batch_urls.append(self._build_listing_url(year, p))

            if not batch_urls:
                break

            results = await self._fetch_batch(session, batch_urls, semaphore)
            self.pages_visited += len(batch_urls)

            batch_new = 0
            empty_in_batch = 0

            for url, html in results:
                if not html:
                    empty_in_batch += 1
                    continue

                articles = parse_listing_page(html, year)
                if not articles:
                    empty_in_batch += 1
                    continue
                self.pages_with_content += 1

                for article in articles:
                    article_url = article["url"]

                    # Dedup within run
                    if article_url in self.seen_urls:
                        continue

                    # Skip if already in persistent cache
                    if self.url_cache.is_scraped(article_url):
                        self.skipped_cached_count += 1
                        self.seen_urls.add(article_url)
                        continue

                    # Date filter
                    if not self._is_in_date_range(article.get("date")):
                        continue

                    all_articles.append(article)
                    self.seen_urls.add(article_url)
                    batch_new += 1

            if self.verbose:
                print(f"    Pages {page}-{page + len(batch_urls) - 1}: "
                      f"+{batch_new} articles (total: {len(all_articles)})")

            # Stop if entire batch was empty
            if empty_in_batch == len(batch_urls):
                consecutive_empty += 1
                if consecutive_empty >= max_consecutive_empty:
                    if self.verbose:
                        print(f"    {consecutive_empty} consecutive empty batches, stopping")
                    self.stop_reason = "3_empty_pages"
                    break
            else:
                consecutive_empty = 0

            page += len(batch_urls)
            await asyncio.sleep(DELAY_BETWEEN_BATCHES)

        print(f"    Year {year}: found {len(all_articles)} articles")
        return all_articles

    async def _discover_all_articles(
        self,
        session: aiohttp.ClientSession,
        semaphore: asyncio.Semaphore,
    ) -> list[dict]:
        """Discover articles across all years in the date range."""
        target_years = self._get_years_to_scrape()
        print(f"Discovering articles from archive years: {target_years}")

        all_articles = []
        for year in target_years:
            year_articles = await self._discover_articles_for_year(
                session, semaphore, year
            )
            all_articles.extend(year_articles)

        if self.skipped_cached_count > 0:
            print(f"\n  Skipped {self.skipped_cached_count} already-scraped articles (cache)")
        print(f"\n  Total: {len(all_articles)} new articles to scrape")
        return all_articles

    async def _scrape_articles_batch(
        self,
        session: aiohttp.ClientSession,
        article_infos: list[dict],
        semaphore: asyncio.Semaphore,
    ) -> list[Article]:
        """Scrape individual article pages concurrently in batches."""
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

                parsed = parse_article_page(html, url)
                if not parsed:
                    continue

                # Drop Feuerwehr articles
                if is_feuerwehr_article(parsed.get("title"), parsed.get("body")):
                    self.feuerwehr_dropped_count += 1
                    self.url_cache.mark_scraped(url)
                    continue

                # Use listing-page date as fallback
                if not parsed["date"] and info.get("date"):
                    parsed["date"] = info["date"]

                # Use listing-page city as fallback
                article_city = parsed.get("city") or info.get("city")

                # Normalize date format
                final_date = parsed["date"] or ""
                if final_date and "T" in final_date:
                    final_date = final_date[:19]

                article = Article(
                    title=parsed["title"],
                    date=final_date,
                    city=article_city,
                    bundesland="Berlin",
                    agency_code=parsed.get("agency_code"),
                    source="Polizei Berlin",
                    url=parsed["url"],
                    body=parsed.get("body", ""),
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
        print("Async Berlin Polizei Pressemeldungen Scraper")
        print("=" * 60)
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
            # Phase 1: Discover article URLs from archive listing pages
            article_infos = await self._discover_all_articles(session, semaphore)

            if not article_infos:
                print("\nNo articles found to scrape.")
                return

            # Phase 2: Scrape individual article pages
            print(f"\nScraping {len(article_infos)} articles with "
                  f"{self.concurrent_requests} concurrent requests...")
            self.articles = await self._scrape_articles_batch(
                session, article_infos, semaphore
            )

        elapsed = time.time() - start_time

        # Save URL cache
        self.url_cache.save()

        # Write scrape metadata
        meta = {
            "source": "berlin_polizei",
            "pages_visited": self.pages_visited,
            "pages_with_content": self.pages_with_content,
            "articles_per_page": None,
            "source_total": None,
            "estimated_total": None,
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


def main():
    parser = argparse.ArgumentParser(
        description="Async scrape police press releases from Berlin Polizei archive",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 scripts/scrapers/scrape_berlin_polizei.py --start-date 2026-01-01 --end-date 2026-01-31
  python3 scripts/scrapers/scrape_berlin_polizei.py --start-date 2025-01-01 --end-date 2026-01-31 -o data/berlin.json
  python3 scripts/scrapers/scrape_berlin_polizei.py --start-date 2025-06-01 --end-date 2025-12-31 --max-pages 5 -v
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
        help="Maximum listing pages to scrape per year (0 = no limit)",
    )

    parser.add_argument(
        "--output", "-o",
        type=str,
        default="berlin_polizei_reports.json",
        help="Output JSON file path (default: berlin_polizei_reports.json)",
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
    for label, val in [("start", args.start_date), ("end", args.end_date)]:
        if val:
            try:
                datetime.fromisoformat(val)
            except ValueError:
                print(f"Error: Invalid {label} date format: {val}")
                print("Use ISO format: YYYY-MM-DD")
                sys.exit(1)

    scraper = AsyncBerlinPolizeiScraper(
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
    scraper = AsyncBerlinPolizeiScraper(
        start_date=start_date,
        end_date=end_date,
        output=os.devnull,
        cache_dir=cache_dir,
        concurrent_requests=concurrent,
    )
    await scraper.run_async()
    return [asdict(a) for a in scraper.articles]


if __name__ == "__main__":
    main()
