#!/usr/bin/env python3
"""
Presseportal Blaulicht Scraper

Scrapes police press releases from https://www.presseportal.de/blaulicht/
Geocodes locations and outputs structured JSON for map visualization.

Usage:
    python scripts/scrape_blaulicht.py --bundesland hessen --max-pages 10
    python scripts/scrape_blaulicht.py --start-date 2026-01-01 --end-date 2026-01-31
"""

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

# Constants
BASE_URL = "https://www.presseportal.de"
BLAULICHT_URL = f"{BASE_URL}/blaulicht/"
USER_AGENT = "de-puls/1.0 (+contact: scraper@example.com)"
PAGE_DELAY_SECONDS = 0.8  # Reduced from 1.5 for faster scraping
GEOCODE_DELAY_SECONDS = 1.1
REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 3
RETRY_DELAYS = [1, 2, 4]  # Exponential backoff

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


class GeocodeCache:
    """JSON-based caching for geocode results."""

    def __init__(self, cache_dir: str = ".cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / "geocode_cache.json"
        self.cache: dict = {}
        self._load()

    def _load(self) -> None:
        """Load cache from disk if exists."""
        if self.cache_file.exists():
            try:
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    self.cache = json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Could not load geocode cache: {e}")
                self.cache = {}

    def save(self) -> None:
        """Persist cache to disk."""
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        with open(self.cache_file, "w", encoding="utf-8") as f:
            json.dump(self.cache, f, ensure_ascii=False, indent=2)

    def get(self, key: str) -> Optional[dict]:
        """Get cached geocode result. Returns None if not cached."""
        return self.cache.get(key)

    def set(self, key: str, value: Optional[dict]) -> None:
        """Cache a geocode result (including None for failed lookups)."""
        self.cache[key] = value


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


class RequestSession:
    """HTTP session with rate limiting and retry logic."""

    def __init__(self, delay: float = PAGE_DELAY_SECONDS, verbose: bool = False):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
        })
        self.delay = delay
        self.verbose = verbose
        self.last_request_time = 0.0

    def _wait_for_rate_limit(self) -> None:
        """Ensure minimum delay between requests."""
        elapsed = time.time() - self.last_request_time
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self.last_request_time = time.time()

    def get(self, url: str) -> Optional[str]:
        """Fetch URL with retry logic. Returns HTML text or None on failure."""
        self._wait_for_rate_limit()

        for attempt, retry_delay in enumerate(RETRY_DELAYS):
            try:
                if self.verbose:
                    print(f"  Fetching: {url}")
                response = self.session.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
                response.raise_for_status()
                return response.text
            except requests.RequestException as e:
                if attempt < len(RETRY_DELAYS) - 1:
                    if self.verbose:
                        print(f"  Retry {attempt + 1}/{MAX_RETRIES} after error: {e}")
                    time.sleep(retry_delay)
                else:
                    print(f"  Failed to fetch {url}: {e}")
                    return None
        return None


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

    Page structure (as of 2026):
    - article.story > .card contains the main content
    - .card > p.date for date
    - .card > p.customer for source agency
    - .card > h1 for title
    - .card > p (without special class) for body paragraphs
    - First body paragraph often contains "Stadtname(ots)"
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
                # Remove the "(ots)" line from body or keep just the city mention
                paragraphs[0] = first_para

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
        # Pattern: city often appears after last dash
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


class PresseportalScraper:
    """Main orchestrator for scraping Presseportal Blaulicht."""

    def __init__(
        self,
        bundesland: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        max_pages: int = 0,
        output: str = "blaulicht_reports.json",
        no_geocode: bool = False,
        verbose: bool = False,
        cache_dir: str = ".cache",
    ):
        self.bundesland = bundesland
        self.bundesland_display = BUNDESLAND_SLUGS.get(bundesland) if bundesland else None
        self.start_date = datetime.fromisoformat(start_date) if start_date else None
        self.end_date = datetime.fromisoformat(end_date) if end_date else None
        self.max_pages = max_pages
        self.output = output
        self.no_geocode = no_geocode
        self.verbose = verbose

        self.session = RequestSession(verbose=verbose)
        self.geocode_cache = GeocodeCache(cache_dir) if not no_geocode else None
        self.url_cache = ScrapedUrlsCache(cache_dir)
        self.geocoder = None
        if not no_geocode:
            self.geocoder = Nominatim(user_agent=USER_AGENT)

        self.articles: list[Article] = []
        self.seen_urls: set[str] = set()
        self.skipped_cached_count = 0

    def _build_listing_url(self, page: int = 1) -> str:
        """Build the listing page URL with optional Bundesland and date filters."""
        # Build base URL
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

        # Add date parameters if specified (much faster than pagination!)
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
            return True  # Include if no date

        if not self.start_date and not self.end_date:
            return True

        try:
            # Parse ISO format
            if "T" in date_str:
                article_date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            else:
                # Try to parse just the date part
                parsed = parse_german_date(date_str)
                if parsed:
                    article_date = datetime.fromisoformat(parsed)
                else:
                    return True  # Include if can't parse

            # Make comparison timezone-naive
            article_date = article_date.replace(tzinfo=None)

            if self.start_date and article_date.date() < self.start_date.date():
                return False
            if self.end_date and article_date.date() > self.end_date.date():
                return False

            return True
        except (ValueError, AttributeError):
            return True

    def _geocode_location(self, city: str, bundesland: Optional[str] = None) -> tuple[Optional[float], Optional[float]]:
        """Geocode a city name. Returns (lat, lon) or (None, None)."""
        if self.no_geocode or not city or not self.geocoder:
            return None, None

        # Build cache key
        if bundesland:
            cache_key = f"{city}, {bundesland}, Germany"
        else:
            cache_key = f"{city}, Germany"

        # Check cache
        cached = self.geocode_cache.get(cache_key)
        if cached is not None:
            if cached == {}:  # Failed lookup
                return None, None
            return cached.get("lat"), cached.get("lon")

        # Rate limit for Nominatim
        time.sleep(GEOCODE_DELAY_SECONDS)

        try:
            if self.verbose:
                print(f"  Geocoding: {cache_key}")
            location = self.geocoder.geocode(cache_key, timeout=10)

            if location:
                result = {"lat": location.latitude, "lon": location.longitude}
                self.geocode_cache.set(cache_key, result)
                return location.latitude, location.longitude
            else:
                self.geocode_cache.set(cache_key, {})  # Cache failed lookup
                return None, None

        except (GeocoderTimedOut, GeocoderServiceError) as e:
            print(f"  Geocoding error for {cache_key}: {e}")
            return None, None

    def scrape_listing_pages(self) -> list[dict]:
        """Scrape listing pages to collect article URLs."""
        all_articles = []
        page = 1
        consecutive_empty = 0

        print(f"Scraping listing pages...")
        if self.bundesland:
            print(f"  Bundesland filter: {self.bundesland_display}")

        while True:
            if self.max_pages > 0 and page > self.max_pages:
                print(f"  Reached max pages limit ({self.max_pages})")
                break

            url = self._build_listing_url(page)
            if page <= 3:  # Log first few URLs for debugging
                print(f"\n  URL: {url}")
            print(f"  Fetching page {page}...", end=" ", flush=True)
            html = self.session.get(url)

            if not html:
                print(f"  Failed to fetch page {page}, stopping")
                break

            articles = parse_listing_page(html)

            if not articles:
                consecutive_empty += 1
                print(f"(empty)", end=" ", flush=True)
                if consecutive_empty >= 2:
                    print(f"\n  No more articles found after page {page - 1}")
                    break
            else:
                consecutive_empty = 0
                # Filter by date and track if we've passed the start_date
                added_this_page = 0
                all_too_old = True  # Track if all articles are older than start_date

                for article in articles:
                    article_date_str = article.get("date")
                    in_range = self._is_in_date_range(article_date_str)

                    # Check if article is newer than or equal to start_date
                    if article_date_str and self.start_date:
                        try:
                            if "T" in article_date_str:
                                article_date = datetime.fromisoformat(article_date_str.replace("Z", "+00:00")).replace(tzinfo=None)
                            else:
                                parsed = parse_german_date(article_date_str)
                                if parsed:
                                    article_date = datetime.fromisoformat(parsed)
                                else:
                                    article_date = None
                            if article_date and article_date.date() >= self.start_date.date():
                                all_too_old = False
                        except (ValueError, AttributeError):
                            all_too_old = False  # Keep going if can't parse
                    else:
                        all_too_old = False  # No date filter or no article date

                    if article["url"] not in self.seen_urls:
                        # Skip if already in persistent cache
                        if self.url_cache.is_scraped(article["url"]):
                            self.skipped_cached_count += 1
                            self.seen_urls.add(article["url"])
                            continue

                        if in_range:
                            all_articles.append(article)
                            self.seen_urls.add(article["url"])
                            added_this_page += 1

                print(f"({added_this_page}/{len(articles)})", end=" ", flush=True)
                if self.verbose:
                    print(f"\n  Page {page}: found {len(articles)} articles, added {added_this_page}, {len(all_articles)} total")

                # Early exit: if no articles matched for several consecutive pages, stop
                if added_this_page == 0:
                    consecutive_no_match = getattr(self, '_consecutive_no_match', 0) + 1
                    self._consecutive_no_match = consecutive_no_match
                    if consecutive_no_match >= 5:  # 5 pages with 0 matches = done
                        print(f"\n  No matching articles for {consecutive_no_match} pages, stopping")
                        break
                else:
                    self._consecutive_no_match = 0

                # Also stop if all articles are clearly older than start_date
                if self.start_date and all_too_old and len(articles) > 0:
                    print(f"\n  Reached articles older than {self.start_date.date()}, stopping pagination")
                    break

            page += 1

        if self.skipped_cached_count > 0:
            print(f"  Skipped {self.skipped_cached_count} already-scraped articles")
        print(f"  Collected {len(all_articles)} new article URLs")
        return all_articles

    def scrape_article(self, article_info: dict) -> Optional[Article]:
        """Scrape a single article page and return Article object."""
        url = article_info["url"]
        html = self.session.get(url)

        if not html:
            return None

        parsed = parse_article_page(html, url)
        if not parsed:
            return None

        # Mark URL as scraped in persistent cache
        self.url_cache.mark_scraped(url)

        # Use listing date as fallback
        if not parsed["date"] and article_info.get("date"):
            parsed["date"] = article_info["date"]

        # Format date to ISO
        if parsed["date"]:
            # Clean up timezone info if present
            date_str = parsed["date"]
            if "T" in date_str:
                parsed["date"] = date_str[:19]  # Keep YYYY-MM-DDTHH:MM:SS
            else:
                iso_date = parse_german_date(date_str)
                if iso_date:
                    parsed["date"] = iso_date

        # Geocode
        lat, lon = self._geocode_location(
            parsed["city"],
            self.bundesland_display
        )

        return Article(
            title=parsed["title"],
            date=parsed["date"] or "",
            city=parsed["city"],
            bundesland=self.bundesland_display,
            lat=lat,
            lon=lon,
            source=parsed["source"],
            url=parsed["url"],
            body=parsed["body"],
        )

    def run(self) -> None:
        """Execute the full scraping pipeline."""
        print("=" * 60)
        print("Presseportal Blaulicht Scraper")
        print("=" * 60)

        if self.start_date:
            print(f"Start date: {self.start_date.date()}")
        if self.end_date:
            print(f"End date: {self.end_date.date()}")
        print(f"Geocoding: {'disabled' if self.no_geocode else 'enabled'}")
        print()

        # Scrape listing pages
        article_infos = self.scrape_listing_pages()

        if not article_infos:
            print("No articles found to scrape")
            return

        # Scrape each article
        print(f"\nScraping {len(article_infos)} articles...")
        success_count = 0
        failed_count = 0

        for i, info in enumerate(article_infos, 1):
            article = self.scrape_article(info)

            if article:
                self.articles.append(article)
                success_count += 1
            else:
                failed_count += 1

            if i % 10 == 0 or i == len(article_infos):
                print(f"  Progress: {i}/{len(article_infos)} (success: {success_count}, failed: {failed_count})")

        # Save caches
        self.url_cache.save()
        print(f"  Saved URL cache ({len(self.url_cache)} URLs) to {self.url_cache.cache_file}")
        if self.geocode_cache:
            self.geocode_cache.save()
            print(f"  Saved geocode cache to {self.geocode_cache.cache_file}")

        # Write output
        output_data = [asdict(article) for article in self.articles]

        with open(self.output, "w", encoding="utf-8") as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)

        print()
        print("=" * 60)
        print(f"Saved {len(self.articles)} articles to {self.output}")
        print("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Scrape police press releases from Presseportal Blaulicht",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/scrape_blaulicht.py --max-pages 2 --no-geocode -v
  python scripts/scrape_blaulicht.py --bundesland hessen --max-pages 10
  python scripts/scrape_blaulicht.py --start-date 2026-01-01 --end-date 2026-01-31
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
        "--no-geocode",
        action="store_true",
        help="Skip geocoding of locations"
    )

    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output"
    )

    parser.add_argument(
        "--cache-dir",
        type=str,
        default=".cache",
        help="Directory for geocode cache (default: .cache)"
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

    scraper = PresseportalScraper(
        bundesland=args.bundesland,
        start_date=args.start_date,
        end_date=args.end_date,
        max_pages=args.max_pages,
        output=args.output,
        no_geocode=args.no_geocode,
        verbose=args.verbose,
        cache_dir=args.cache_dir,
    )

    try:
        scraper.run()
    except KeyboardInterrupt:
        print("\nInterrupted by user")
        scraper.url_cache.save()
        if scraper.geocode_cache:
            scraper.geocode_cache.save()
        sys.exit(1)


if __name__ == "__main__":
    main()
