#!/usr/bin/env python3
"""
LLM-Powered Article Enrichment Pipeline

Enriches scraped Presseportal articles with:
- Street-level location extraction
- Precise incident time parsing
- PKS crime category classification
- Nominatim geocoding

Usage:
    python scripts/enrich_blaulicht.py --input blaulicht_reports.json --output blaulicht_enriched.json
    python scripts/enrich_blaulicht.py --input blaulicht_reports.json --limit 5 -v
    python scripts/enrich_blaulicht.py --model google/gemini-2.0-flash-exp:free  # Free tier
"""

import argparse
import hashlib
import json
import os
import ssl
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional, Any

from dotenv import load_dotenv
from openai import OpenAI

# Load .env file from project root
load_dotenv()

# Fix SSL certificate verification on macOS
import certifi
os.environ['SSL_CERT_FILE'] = certifi.where()

from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

# Constants
DEFAULT_MODEL = "google/gemini-3-flash-preview"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
USER_AGENT = "de-puls/1.0 (+contact: scraper@example.com)"
API_DELAY_SECONDS = 0.5
GEOCODE_DELAY_SECONDS = 1.1
MAX_RETRIES = 3
RETRY_DELAYS = [1, 2, 4]

# PKS Crime Categories (German Police Standard)
PKS_CATEGORIES = {
    # Straftaten gegen das Leben
    "0100": "Mord",
    "0200": "Totschlag",
    "0300": "Tötung auf Verlangen",

    # Straftaten gegen sexuelle Selbstbestimmung
    "1100": "Vergewaltigung",
    "1300": "Sexueller Missbrauch",

    # Rohheitsdelikte
    "2100": "Raub",
    "2200": "Körperverletzung",
    "2320": "Freiheitsberaubung",
    "2330": "Nötigung",
    "2340": "Bedrohung",

    # Diebstahl
    "3000": "Diebstahl ohne erschwerende Umstände",
    "4000": "Diebstahl unter erschwerenden Umständen",
    "4350": "Wohnungseinbruchdiebstahl",
    "4730": "Taschendiebstahl",
    "4780": "Kfz-Diebstahl",

    # Vermögensdelikte
    "5100": "Betrug",
    "5180": "Leistungserschleichung",
    "5200": "Unterschlagung",

    # Sonstige
    "6200": "Widerstand gegen Vollstreckungsbeamte",
    "6740": "Brandstiftung",
    "6750": "Sachbeschädigung",

    # Straßenverkehrsdelikte
    "7100": "Verkehrsunfall mit Personenschaden",
    "7200": "Unerlaubtes Entfernen vom Unfallort",
    "7300": "Trunkenheit im Verkehr",

    # Drogen
    "8910": "Allgemeine Verstöße BtMG",
    "8920": "Illegaler Handel BtMG",
}

# Build reverse lookup for category names
PKS_NAMES_TO_CODES = {v: k for k, v in PKS_CATEGORIES.items()}

EXTRACTION_PROMPT = """
Analysiere diesen deutschen Polizeibericht und extrahiere strukturierte Daten.

WICHTIG: Manche Artikel beschreiben MEHRERE separate Vorfälle (z.B. mehrere
Pressemitteilungen in einem Artikel). Extrahiere JEDEN Vorfall als separates
Objekt im "crimes" Array.

ARTIKEL:
{article_body}

VERÖFFENTLICHUNGSDATUM: {publish_date}

Extrahiere folgende Informationen im JSON-Format:

1. DELIKTE (crimes) - ARRAY von Vorfällen:
   Für JEDEN separaten Vorfall im Artikel, extrahiere:

   PKS-Kategorie (wähle aus):
   - 0100: Mord
   - 0200: Totschlag
   - 1100: Vergewaltigung
   - 1300: Sexueller Missbrauch
   - 2100: Raub
   - 2200: Körperverletzung
   - 2320: Freiheitsberaubung
   - 2330: Nötigung
   - 2340: Bedrohung
   - 3000: Diebstahl ohne erschwerende Umstände
   - 4000: Diebstahl unter erschwerenden Umständen
   - 4350: Wohnungseinbruchdiebstahl
   - 4730: Taschendiebstahl
   - 4780: Kfz-Diebstahl
   - 5100: Betrug
   - 5180: Leistungserschleichung
   - 5200: Unterschlagung
   - 6200: Widerstand gegen Vollstreckungsbeamte
   - 6740: Brandstiftung
   - 6750: Sachbeschädigung
   - 7100: Verkehrsunfall mit Personenschaden
   - 7200: Unerlaubtes Entfernen vom Unfallort (Fahrerflucht)
   - 7300: Trunkenheit im Verkehr
   - 8910: Allgemeine Verstöße BtMG (Drogen)
   - 8920: Illegaler Handel BtMG

   Für jeden Vorfall extrahiere:
   - pks_code: 4-stelliger PKS-Schlüssel
   - pks_category: Kategorie-Name
   - sub_type: Genauere Beschreibung des Vorfalls
   - confidence: 0.0-1.0
   - keywords_matched: Liste der Schlüsselwörter aus dem Text
   - location: Standort für DIESEN spezifischen Vorfall
     - street: Straßenname (ohne Hausnummer)
     - house_number: Hausnummer falls vorhanden
     - district: Stadtteil/Ortsteil falls genannt
     - city: Stadt/Gemeinde
     - confidence: 0.0-1.0
   - incident_time: Tatzeit für DIESEN spezifischen Vorfall
     - date: YYYY-MM-DD (berechne aus Artikel-Datum und relativen Angaben)
     - time: HH:MM (24h Format) oder null wenn unbekannt
     - precision: "exact" | "approximate" | "range" | "unknown"
     - original_text: Original-Formulierung aus dem Text

2. WAFFE (weapon) - falls eine Waffe erwähnt wird (für den gesamten Artikel):
   Wähle aus diesen Waffentypen:
   - messer: Messer, Küchenmesser, Klappmesser, Stichwaffe
   - schusswaffe: Pistole, Revolver, Gewehr, Schusswaffe
   - machete: Machete
   - axt: Axt, Beil
   - schlagwaffe: Baseballschläger, Schlagstock, Knüppel, Hammer
   - reizgas: Pfefferspray, Reizgas, CS-Gas
   - other: Sonstige Waffen

   Extrahiere:
   - type: Waffentyp (einer der obigen oder null)
   - mentioned_text: Original-Formulierung aus dem Text (oder null)

Antworte NUR mit validem JSON, keine Erklärungen. Format:
{{
  "crimes": [
    {{
      "pks_code": "2200",
      "pks_category": "Körperverletzung",
      "sub_type": "Schlägerei vor Diskothek",
      "confidence": 0.9,
      "keywords_matched": ["geschlagen", "verletzt"],
      "location": {{
        "street": "Hauptstraße",
        "house_number": "12",
        "district": "Altstadt",
        "city": "Frankfurt",
        "confidence": 0.8
      }},
      "incident_time": {{
        "date": "2024-01-15",
        "time": "02:30",
        "precision": "exact",
        "original_text": "am Sonntag gegen 02:30 Uhr"
      }}
    }}
  ],
  "weapon": {{
    "type": "messer",
    "mentioned_text": "mit einem Messer"
  }}
}}

Wenn es nur einen Vorfall gibt, enthält das Array nur ein Element.
Wenn keine Waffe erwähnt wird, setze weapon auf null.
"""


@dataclass
class EnrichedLocation:
    """Extracted location data."""
    street: Optional[str] = None
    house_number: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    bundesland: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    precision: Optional[str] = None  # "street", "city", "district"
    confidence: float = 0.0


@dataclass
class EnrichedIncidentTime:
    """Extracted incident time data."""
    date: Optional[str] = None
    time: Optional[str] = None
    precision: Optional[str] = None  # "exact", "approximate", "range", "unknown"
    original_text: Optional[str] = None


@dataclass
class EnrichedCrime:
    """Extracted crime classification."""
    pks_code: Optional[str] = None
    pks_category: Optional[str] = None
    sub_type: Optional[str] = None
    confidence: float = 0.0
    keywords_matched: list = None

    def __post_init__(self):
        if self.keywords_matched is None:
            self.keywords_matched = []


class EnrichmentCache:
    """JSON-based caching for enrichment results."""

    def __init__(self, cache_dir: str = ".cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / "enrichment_cache.json"
        self.cache: dict = {}
        self._load()

    def _load(self) -> None:
        """Load cache from disk if exists."""
        if self.cache_file.exists():
            try:
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    self.cache = json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Could not load enrichment cache: {e}")
                self.cache = {}

    def save(self) -> None:
        """Persist cache to disk."""
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        with open(self.cache_file, "w", encoding="utf-8") as f:
            json.dump(self.cache, f, ensure_ascii=False, indent=2)

    def _make_key(self, url: str, body: str) -> str:
        """Create cache key from article URL and body hash."""
        content = f"{url}:{body}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def get(self, url: str, body: str) -> Optional[dict]:
        """Get cached enrichment result. Returns None if not cached."""
        key = self._make_key(url, body)
        return self.cache.get(key)

    def set(self, url: str, body: str, value: dict) -> None:
        """Cache an enrichment result."""
        key = self._make_key(url, body)
        self.cache[key] = value


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


class ArticleEnricher:
    """Main orchestrator for LLM-based article enrichment."""

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        api_delay: float = API_DELAY_SECONDS,
        batch_size: int = 1,
        verbose: bool = False,
        cache_dir: str = ".cache",
        no_geocode: bool = False,
    ):
        self.model = model
        self.api_delay = api_delay
        self.batch_size = batch_size
        self.verbose = verbose
        self.no_geocode = no_geocode

        # Initialize OpenRouter client
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY environment variable is required")

        self.client = OpenAI(
            base_url=OPENROUTER_BASE_URL,
            api_key=api_key,
        )

        # Initialize caches
        self.enrichment_cache = EnrichmentCache(cache_dir)
        self.geocode_cache = GeocodeCache(cache_dir) if not no_geocode else None

        # Initialize geocoder
        self.geocoder = None
        if not no_geocode:
            self.geocoder = Nominatim(user_agent=USER_AGENT, timeout=10)

        self.last_api_time = 0.0
        self.last_geocode_time = 0.0

    def _wait_for_api_rate_limit(self) -> None:
        """Ensure minimum delay between API requests."""
        elapsed = time.time() - self.last_api_time
        if elapsed < self.api_delay:
            time.sleep(self.api_delay - elapsed)
        self.last_api_time = time.time()

    def _wait_for_geocode_rate_limit(self) -> None:
        """Ensure minimum delay between geocode requests."""
        elapsed = time.time() - self.last_geocode_time
        if elapsed < GEOCODE_DELAY_SECONDS:
            time.sleep(GEOCODE_DELAY_SECONDS - elapsed)
        self.last_geocode_time = time.time()

    def _call_llm(self, prompt: str) -> Optional[str]:
        """Call the LLM API with retry logic."""
        self._wait_for_api_rate_limit()

        for attempt, retry_delay in enumerate(RETRY_DELAYS):
            try:
                if self.verbose:
                    print(f"    Calling {self.model}...")

                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "user", "content": prompt}
                    ],
                    temperature=0.1,  # Low temperature for consistent extraction
                    max_tokens=1500,
                )

                return response.choices[0].message.content

            except Exception as e:
                if attempt < len(RETRY_DELAYS) - 1:
                    if self.verbose:
                        print(f"    Retry {attempt + 1}/{MAX_RETRIES} after error: {e}")
                    time.sleep(retry_delay)
                else:
                    print(f"    LLM API failed: {e}")
                    return None

        return None

    def _parse_llm_response(self, response: str) -> Optional[dict]:
        """Parse LLM JSON response, handling common issues."""
        if not response:
            return None

        # Clean up response - extract JSON if wrapped in markdown
        text = response.strip()

        # Remove markdown code blocks
        if "```json" in text:
            text = text.split("```json", 1)[1]
        if "```" in text:
            text = text.split("```")[0]

        text = text.strip()

        # Try to find JSON object in the response (handles text before/after)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to extract JSON object from anywhere in the text
            import re
            json_match = re.search(r'\{[\s\S]*\}', text)
            if json_match:
                try:
                    return json.loads(json_match.group())
                except json.JSONDecodeError as e:
                    if self.verbose:
                        print(f"    JSON parse error: {e}")
                        print(f"    Response was: {text[:200]}...")
                    return None
            else:
                if self.verbose:
                    print(f"    No JSON object found in response")
                    print(f"    Response was: {text[:200]}...")
                return None

    def _geocode_address(
        self,
        street: Optional[str],
        house_number: Optional[str],
        city: Optional[str],
        bundesland: Optional[str] = None,
    ) -> tuple[Optional[float], Optional[float], str]:
        """
        Geocode an address. Returns (lat, lon, precision).
        Precision is "street" if street was used, "city" otherwise.
        """
        if self.no_geocode or not self.geocoder:
            return None, None, "none"

        # Build address string
        parts = []

        if street:
            if house_number:
                parts.append(f"{street} {house_number}")
            else:
                parts.append(street)

        if city:
            parts.append(city)

        if bundesland:
            parts.append(bundesland)

        parts.append("Germany")

        if not parts or (not street and not city):
            return None, None, "none"

        address = ", ".join(parts)
        precision = "street" if street else "city"

        # Check cache
        cached = self.geocode_cache.get(address)
        if cached is not None:
            if cached == {}:  # Failed lookup
                return None, None, "none"
            return cached.get("lat"), cached.get("lon"), precision

        # Rate limit
        self._wait_for_geocode_rate_limit()

        try:
            if self.verbose:
                print(f"    Geocoding: {address}")

            location = self.geocoder.geocode(address, timeout=10)

            if location:
                result = {"lat": location.latitude, "lon": location.longitude}
                self.geocode_cache.set(address, result)
                return location.latitude, location.longitude, precision
            else:
                # Try fallback without street
                if street and city:
                    fallback_address = f"{city}, {bundesland}, Germany" if bundesland else f"{city}, Germany"
                    cached_fallback = self.geocode_cache.get(fallback_address)
                    if cached_fallback is not None:
                        if cached_fallback == {}:
                            self.geocode_cache.set(address, {})
                            return None, None, "none"
                        self.geocode_cache.set(address, cached_fallback)
                        return cached_fallback.get("lat"), cached_fallback.get("lon"), "city"

                    self._wait_for_geocode_rate_limit()
                    location = self.geocoder.geocode(fallback_address, timeout=10)
                    if location:
                        result = {"lat": location.latitude, "lon": location.longitude}
                        self.geocode_cache.set(fallback_address, result)
                        self.geocode_cache.set(address, result)
                        return location.latitude, location.longitude, "city"

                self.geocode_cache.set(address, {})
                return None, None, "none"

        except (GeocoderTimedOut, GeocoderServiceError) as e:
            print(f"    Geocoding error for {address}: {e}")
            return None, None, "none"

    def enrich_article(self, article: dict) -> dict:
        """
        Enrich a single article with LLM-extracted data.
        Returns the enriched article dict.

        The new format supports multiple crimes per article via the "crimes" array.
        Each crime has its own location and incident_time.
        """
        url = article.get("url", "")
        body = article.get("body", "")
        publish_date = article.get("date", "")

        # Check cache first
        cached = self.enrichment_cache.get(url, body)
        if cached:
            if self.verbose:
                print(f"  Using cached enrichment for: {url}")
            return {**article, **cached}

        if self.verbose:
            title = article.get("title", "")[:50]
            print(f"  Enriching: {title}...")

        # Build prompt
        prompt = EXTRACTION_PROMPT.format(
            article_body=body,
            publish_date=publish_date,
        )

        # Call LLM
        response = self._call_llm(prompt)
        parsed = self._parse_llm_response(response)

        if not parsed:
            if self.verbose:
                print("    Failed to parse LLM response")
            # Return article with empty enrichment
            return article

        # Handle new multi-crime format
        crimes_data = parsed.get("crimes", [])

        # Fallback: if old single-crime format, convert to array
        if not crimes_data and parsed.get("crime"):
            # Old format had separate location, incident_time, crime objects
            old_crime = parsed.get("crime", {})
            old_location = parsed.get("location", {})
            old_time = parsed.get("incident_time", {})
            crimes_data = [{
                **old_crime,
                "location": old_location,
                "incident_time": old_time,
            }]

        # Process each crime with geocoding
        enriched_crimes = []
        bundesland = article.get("bundesland")

        for crime_data in crimes_data:
            # Extract location for this crime
            loc_data = crime_data.get("location", {})
            street = loc_data.get("street")
            house_number = loc_data.get("house_number")
            district = loc_data.get("district")
            city = loc_data.get("city") or article.get("city")
            loc_confidence = loc_data.get("confidence", 0.0)

            # Geocode the extracted address
            lat, lon, precision = self._geocode_address(
                street=street,
                house_number=house_number,
                city=city,
                bundesland=bundesland,
            )

            location = {
                "street": street,
                "house_number": house_number,
                "district": district,
                "city": city,
                "bundesland": bundesland,
                "lat": lat,
                "lon": lon,
                "precision": precision,
                "confidence": loc_confidence,
            }

            # Extract incident time for this crime
            time_data = crime_data.get("incident_time", {})
            incident_time = {
                "date": time_data.get("date"),
                "time": time_data.get("time"),
                "precision": time_data.get("precision", "unknown"),
                "original_text": time_data.get("original_text"),
            }

            # Extract crime classification
            pks_code = crime_data.get("pks_code")
            pks_category = crime_data.get("pks_category")

            # Validate PKS code
            if pks_code and pks_code not in PKS_CATEGORIES:
                if self.verbose:
                    print(f"    Warning: Unknown PKS code {pks_code}")
                # Try to look up by category name
                if pks_category and pks_category in PKS_NAMES_TO_CODES:
                    pks_code = PKS_NAMES_TO_CODES[pks_category]

            enriched_crime = {
                "pks_code": pks_code,
                "pks_category": pks_category or PKS_CATEGORIES.get(pks_code),
                "sub_type": crime_data.get("sub_type"),
                "confidence": crime_data.get("confidence", 0.0),
                "keywords_matched": crime_data.get("keywords_matched", []),
                "location": location,
                "incident_time": incident_time,
            }
            enriched_crimes.append(enriched_crime)

        # If no crimes extracted, add a default empty one
        if not enriched_crimes:
            enriched_crimes = [{}]

        # Build enriched result with new format
        enrichment = {
            "crimes": enriched_crimes,
            "weapon": parsed.get("weapon"),
        }

        # For backwards compatibility, also include top-level location/crime/incident_time
        # from the first crime (used by older code that expects single crime)
        if enriched_crimes and enriched_crimes[0]:
            first = enriched_crimes[0]
            enrichment["location"] = first.get("location", {})
            enrichment["incident_time"] = first.get("incident_time", {})
            enrichment["crime"] = {
                "pks_code": first.get("pks_code"),
                "pks_category": first.get("pks_category"),
                "sub_type": first.get("sub_type"),
                "confidence": first.get("confidence", 0.0),
                "keywords_matched": first.get("keywords_matched", []),
            }

        # Cache the result
        self.enrichment_cache.set(url, body, enrichment)

        # Merge with original article
        return {**article, **enrichment}

    def enrich_articles(self, articles: list[dict], limit: int = 0) -> list[dict]:
        """
        Enrich multiple articles.
        Returns list of enriched articles.
        """
        if limit > 0:
            articles = articles[:limit]

        total = len(articles)
        enriched = []
        success_count = 0
        cached_count = 0
        failed_count = 0

        print(f"Enriching {total} articles with {self.model}...")

        for i, article in enumerate(articles, 1):
            url = article.get("url", "")
            body = article.get("body", "")

            # Check if cached
            is_cached = self.enrichment_cache.get(url, body) is not None

            try:
                result = self.enrich_article(article)
                enriched.append(result)

                if is_cached:
                    cached_count += 1
                elif result.get("location") or result.get("crime"):
                    success_count += 1
                else:
                    failed_count += 1

            except Exception as e:
                print(f"  Error enriching article {i}: {e}")
                enriched.append(article)
                failed_count += 1

            # Progress update
            if i % 5 == 0 or i == total:
                print(f"  Progress: {i}/{total} (success: {success_count}, cached: {cached_count}, failed: {failed_count})")

        return enriched

    def save_caches(self) -> None:
        """Save all caches to disk."""
        self.enrichment_cache.save()
        if self.geocode_cache:
            self.geocode_cache.save()


def main():
    parser = argparse.ArgumentParser(
        description="Enrich scraped articles with LLM-extracted data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/enrich_blaulicht.py --input blaulicht_reports.json --output blaulicht_enriched.json
  python scripts/enrich_blaulicht.py --input blaulicht_reports.json --limit 5 -v
  python scripts/enrich_blaulicht.py --model google/gemini-2.0-flash-exp:free  # Free tier

Environment:
  OPENROUTER_API_KEY - Required. Get from https://openrouter.ai/keys
        """
    )

    parser.add_argument(
        "--input", "-i",
        type=str,
        default="blaulicht_reports.json",
        help="Input JSON file with scraped articles (default: blaulicht_reports.json)"
    )

    parser.add_argument(
        "--output", "-o",
        type=str,
        default="blaulicht_enriched.json",
        help="Output JSON file for enriched articles (default: blaulicht_enriched.json)"
    )

    parser.add_argument(
        "--model", "-m",
        type=str,
        default=DEFAULT_MODEL,
        help=f"LLM model to use (default: {DEFAULT_MODEL})"
    )

    parser.add_argument(
        "--batch-size",
        type=int,
        default=1,
        help="Number of articles per API call (default: 1)"
    )

    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit number of articles to process (0 = all)"
    )

    parser.add_argument(
        "--api-delay",
        type=float,
        default=API_DELAY_SECONDS,
        help=f"Delay between API calls in seconds (default: {API_DELAY_SECONDS})"
    )

    parser.add_argument(
        "--no-geocode",
        action="store_true",
        help="Skip geocoding of extracted addresses"
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
        help="Directory for caches (default: .cache)"
    )

    args = parser.parse_args()

    # Check for API key
    if not os.environ.get("OPENROUTER_API_KEY"):
        print("Error: OPENROUTER_API_KEY environment variable is required")
        print("Get your key from: https://openrouter.ai/keys")
        sys.exit(1)

    # Load input file
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: Input file not found: {args.input}")
        sys.exit(1)

    try:
        with open(input_path, "r", encoding="utf-8") as f:
            articles = json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        print(f"Error reading input file: {e}")
        sys.exit(1)

    print("=" * 60)
    print("LLM Article Enrichment Pipeline")
    print("=" * 60)
    print(f"Input: {args.input} ({len(articles)} articles)")
    print(f"Output: {args.output}")
    print(f"Model: {args.model}")
    print(f"Geocoding: {'disabled' if args.no_geocode else 'enabled'}")
    if args.limit > 0:
        print(f"Limit: {args.limit} articles")
    print()

    # Initialize enricher
    try:
        enricher = ArticleEnricher(
            model=args.model,
            api_delay=args.api_delay,
            batch_size=args.batch_size,
            verbose=args.verbose,
            cache_dir=args.cache_dir,
            no_geocode=args.no_geocode,
        )
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)

    # Process articles
    try:
        enriched = enricher.enrich_articles(articles, limit=args.limit)
    except KeyboardInterrupt:
        print("\nInterrupted by user")
        enricher.save_caches()
        sys.exit(1)

    # Save caches
    enricher.save_caches()
    print(f"  Saved enrichment cache to {enricher.enrichment_cache.cache_file}")
    if enricher.geocode_cache:
        print(f"  Saved geocode cache to {enricher.geocode_cache.cache_file}")

    # Write output
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(enriched, f, ensure_ascii=False, indent=2)

    # Summary statistics
    street_count = sum(1 for a in enriched if a.get("location", {}).get("street"))
    geocoded_count = sum(1 for a in enriched if a.get("location", {}).get("lat"))
    crime_count = sum(1 for a in enriched if a.get("crime", {}).get("pks_code"))
    time_count = sum(1 for a in enriched if a.get("incident_time", {}).get("date"))

    print()
    print("=" * 60)
    print(f"Saved {len(enriched)} enriched articles to {args.output}")
    print()
    print("Enrichment Summary:")
    print(f"  Street-level locations: {street_count}/{len(enriched)}")
    print(f"  Geocoded locations:     {geocoded_count}/{len(enriched)}")
    print(f"  PKS classifications:    {crime_count}/{len(enriched)}")
    print(f"  Incident times:         {time_count}/{len(enriched)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
