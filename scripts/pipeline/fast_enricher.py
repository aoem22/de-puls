#!/usr/bin/env python3
"""
Fast batched LLM enrichment for Blaulicht articles.

Key optimizations:
- Batch 10 articles per LLM call (10x fewer API calls)
- Google Maps API for geocoding (50x faster than Nominatim)
- Shared caching with existing enricher

Usage:
    python -m scripts.pipeline.fast_enricher --input data.json --output enriched.json
"""

import hashlib
import json
import os
import sys
import time
from pathlib import Path

import certifi
import requests
from dotenv import load_dotenv
from openai import OpenAI

# Load .env
load_dotenv()

# Fix SSL on macOS
os.environ['SSL_CERT_FILE'] = certifi.where()

# Settings
BATCH_SIZE = 10  # Articles per LLM call
API_DELAY = 0.2  # Seconds between batches
MODEL = "google/gemini-3-flash-preview"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


# Batch extraction prompt - processes multiple articles at once
BATCH_PROMPT = """
Analysiere diese {count} deutschen Polizeiberichte und extrahiere strukturierte Daten.

Für JEDEN Artikel, extrahiere:
1. STANDORT: street, house_number, district, city, confidence (0-1)
2. TATZEIT: date (YYYY-MM-DD), time (HH:MM), precision (exact/approximate/unknown)
3. DELIKT (PKS): pks_code (4-stellig), pks_category, sub_type, confidence (0-1)

PKS-Kategorien:
- 2100: Raub, 2200: Körperverletzung, 2340: Bedrohung
- 3000/4000: Diebstahl, 4350: Wohnungseinbruch, 4780: Kfz-Diebstahl
- 5100: Betrug, 6740: Brandstiftung, 6750: Sachbeschädigung
- 7100: Verkehrsunfall, 7200: Fahrerflucht, 7300: Trunkenheit
- 8910: Drogen

ARTIKEL:
{articles_json}

Antworte mit JSON-Array, ein Objekt pro Artikel (gleiche Reihenfolge):
[
  {{
    "article_index": 0,
    "location": {{"street": "...", "house_number": null, "district": null, "city": "...", "confidence": 0.8}},
    "incident_time": {{"date": "YYYY-MM-DD", "time": "HH:MM", "precision": "exact"}},
    "crime": {{"pks_code": "XXXX", "pks_category": "...", "sub_type": "...", "confidence": 0.9}}
  }},
  ...
]
"""


class FastEnricher:
    """Batched article enricher with Google Maps geocoding."""

    def __init__(self, cache_dir: str = ".cache", no_geocode: bool = False):
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY required")

        self.google_maps_key = os.environ.get("GOOGLE_MAPS_API_KEY")
        if not no_geocode and not self.google_maps_key:
            raise ValueError("GOOGLE_MAPS_API_KEY required for geocoding")

        self.client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / "enrichment_cache.json"
        self.geocode_file = self.cache_dir / "geocode_cache.json"
        self.cache = self._load_cache(self.cache_file)
        self.geocode_cache = self._load_cache(self.geocode_file) if not no_geocode else {}
        self.no_geocode = no_geocode

    def _load_cache(self, path: Path) -> dict:
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_cache(self, cache: dict, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)

    def _cache_key(self, url: str, body: str) -> str:
        return hashlib.sha256(f"{url}:{body}".encode()).hexdigest()[:16]

    def _call_llm_batch(self, articles: list[dict]) -> list[dict]:
        """Call LLM with a batch of articles."""
        # Prepare article summaries for the prompt
        articles_data = []
        for i, art in enumerate(articles):
            articles_data.append({
                "index": i,
                "title": art.get("title", "")[:100],
                "body": art.get("body", "")[:2000],  # Truncate long bodies
                "date": art.get("date", ""),
                "city": art.get("city", ""),
            })

        prompt = BATCH_PROMPT.format(
            count=len(articles),
            articles_json=json.dumps(articles_data, ensure_ascii=False, indent=2)
        )

        try:
            response = self.client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=4000,
            )
            text = response.choices[0].message.content

            # Parse JSON response
            text = text.strip()
            if "```json" in text:
                text = text.split("```json", 1)[1]
            if "```" in text:
                text = text.split("```")[0]

            # Find the array
            import re
            match = re.search(r'\[[\s\S]*\]', text)
            if match:
                return json.loads(match.group())
            return []

        except Exception as e:
            print(f"    LLM batch error: {e}")
            return []

    def _geocode(self, street: str, city: str, district: str = None, bundesland: str = None) -> tuple[float, float, str]:
        """
        Geocode an address using Google Maps API.

        Returns:
            (latitude, longitude, precision) where precision is:
            - "rooftop": Exact address match
            - "range": Interpolated between known points
            - "center": Geometric center of area
            - "approximate": Approximate location
            - "none": No result found
        """
        if self.no_geocode:
            return None, None, "none"

        # Build address string
        parts = [p for p in [street, district, city, bundesland, "Germany"] if p]
        address = ", ".join(parts)

        # Check cache
        if address in self.geocode_cache:
            cached = self.geocode_cache[address]
            if not cached:
                return None, None, "none"
            return cached.get("lat"), cached.get("lon"), cached.get("precision", "cached")

        # Call Google Maps Geocoding API
        url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {
            "address": address,
            "key": self.google_maps_key,
            "region": "de",
            "language": "de",
        }

        try:
            response = requests.get(url, params=params, timeout=10)
            data = response.json()

            if data["status"] == "OK" and data["results"]:
                result = data["results"][0]
                location = result["geometry"]["location"]
                location_type = result["geometry"]["location_type"]

                # Map Google's location types to precision levels
                precision_map = {
                    "ROOFTOP": "rooftop",
                    "RANGE_INTERPOLATED": "range",
                    "GEOMETRIC_CENTER": "center",
                    "APPROXIMATE": "approximate",
                }
                precision = precision_map.get(location_type, "approximate")

                # Cache the result
                self.geocode_cache[address] = {
                    "lat": location["lat"],
                    "lon": location["lng"],
                    "precision": precision,
                }
                return location["lat"], location["lng"], precision

            # Cache the miss
            self.geocode_cache[address] = {}
            return None, None, "none"

        except Exception as e:
            print(f"    Geocoding error: {e}")
            return None, None, "none"

    def enrich_batch(self, articles: list[dict]) -> list[dict]:
        """Enrich a batch of articles."""
        # Split into cached and uncached
        uncached = []
        uncached_indices = []
        results = [None] * len(articles)

        for i, art in enumerate(articles):
            key = self._cache_key(art.get("url", ""), art.get("body", ""))
            if key in self.cache:
                results[i] = {**art, **self.cache[key]}
            else:
                uncached.append(art)
                uncached_indices.append(i)

        if not uncached:
            return results

        # Call LLM for uncached articles
        llm_results = self._call_llm_batch(uncached)

        # Match results back to articles
        for llm_result in llm_results:
            idx = llm_result.get("article_index", -1)
            if 0 <= idx < len(uncached):
                art = uncached[idx]
                orig_idx = uncached_indices[idx]

                # Extract enrichment data
                loc = llm_result.get("location", {})
                enrichment = {
                    "location": loc,
                    "incident_time": llm_result.get("incident_time", {}),
                    "crime": llm_result.get("crime", {}),
                }

                # Geocode if we have location data
                if loc.get("street") or loc.get("city") or loc.get("district"):
                    lat, lon, precision = self._geocode(
                        street=loc.get("street"),
                        city=loc.get("city") or art.get("city"),
                        district=loc.get("district"),
                        bundesland=art.get("bundesland"),
                    )
                    enrichment["location"]["lat"] = lat
                    enrichment["location"]["lon"] = lon
                    enrichment["location"]["precision"] = precision
                    enrichment["location"]["bundesland"] = art.get("bundesland")

                # Cache and store
                key = self._cache_key(art.get("url", ""), art.get("body", ""))
                self.cache[key] = enrichment
                results[orig_idx] = {**art, **enrichment}

        # Fill any missing results with original articles
        for i, r in enumerate(results):
            if r is None:
                results[i] = articles[i]

        return results

    def enrich_all(self, articles: list[dict]) -> list[dict]:
        """Enrich all articles with batching and progress."""
        total = len(articles)
        results = []
        batches = [articles[i:i + BATCH_SIZE] for i in range(0, total, BATCH_SIZE)]

        print(f"Processing {total} articles in {len(batches)} batches...", flush=True)

        for batch_num, batch in enumerate(batches, 1):
            batch_results = self.enrich_batch(batch)
            results.extend(batch_results)

            # Progress
            done = min(batch_num * BATCH_SIZE, total)
            geocoded = sum(1 for r in results if r.get("location", {}).get("lat"))
            print(f"  Batch {batch_num}/{len(batches)}: {done}/{total} articles, {geocoded} geocoded", flush=True)

            # Small delay between batches
            if batch_num < len(batches):
                time.sleep(API_DELAY)

        return results

    def save_caches(self):
        self._save_cache(self.cache, self.cache_file)
        if not self.no_geocode:
            self._save_cache(self.geocode_cache, self.geocode_file)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Fast batched article enrichment")
    parser.add_argument("--input", "-i", required=True, help="Input JSON file")
    parser.add_argument("--output", "-o", required=True, help="Output JSON file")
    parser.add_argument("--no-geocode", action="store_true", help="Skip geocoding")
    parser.add_argument("--cache-dir", default=".cache", help="Cache directory")

    args = parser.parse_args()

    # Load articles
    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Handle both list and dict with "articles" key
    if isinstance(data, list):
        articles = data
    else:
        articles = data.get("articles", [])

    if not articles:
        print("No articles found")
        sys.exit(1)

    print(f"Loaded {len(articles)} articles from {args.input}", flush=True)

    # Enrich
    enricher = FastEnricher(cache_dir=args.cache_dir, no_geocode=args.no_geocode)

    try:
        results = enricher.enrich_all(articles)
    except KeyboardInterrupt:
        print("\nInterrupted")
        enricher.save_caches()
        sys.exit(1)

    enricher.save_caches()

    # Save output
    output_data = {"articles": results} if isinstance(data, dict) else results
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    # Stats
    geocoded = sum(1 for r in results if r.get("location", {}).get("lat"))
    classified = sum(1 for r in results if r.get("crime", {}).get("pks_code"))
    print(f"\nSaved {len(results)} articles to {args.output}")
    print(f"  Geocoded: {geocoded}")
    print(f"  Classified: {classified}")


if __name__ == "__main__":
    main()
