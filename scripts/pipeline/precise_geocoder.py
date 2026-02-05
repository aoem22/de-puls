#!/usr/bin/env python3
"""
Precise geocoding for Blaulicht articles using Google Maps API.

This script re-geocodes existing articles to get street-level precision
instead of city-center coordinates.

Usage:
    python -m scripts.pipeline.precise_geocoder --input data.json --output geocoded.json
    python -m scripts.pipeline.precise_geocoder --input data.json --output geocoded.json --limit 1000
"""

import json
import os
import sys
import time
from pathlib import Path

import certifi
import requests
from dotenv import load_dotenv

# Load .env
load_dotenv()

# Fix SSL on macOS
os.environ['SSL_CERT_FILE'] = certifi.where()

# Settings
BATCH_SIZE = 50  # Geocode requests per batch (for progress reporting)
CACHE_SAVE_INTERVAL = 100  # Save cache every N geocodes


def get_google_maps_api_key() -> str:
    """Get Google Maps API key from environment."""
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key:
        print("Error: GOOGLE_MAPS_API_KEY not set in environment")
        sys.exit(1)
    return key


class PreciseGeocoder:
    """Geocoder using Google Maps API with caching."""

    def __init__(self, cache_dir: str = ".cache"):
        self.api_key = get_google_maps_api_key()
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / "google_geocode_cache.json"
        self.cache = self._load_cache()
        self.geocode_count = 0
        self.cache_hits = 0

    def _load_cache(self) -> dict:
        if self.cache_file.exists():
            try:
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def save_cache(self):
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        with open(self.cache_file, "w", encoding="utf-8") as f:
            json.dump(self.cache, f, ensure_ascii=False)

    def geocode(self, address: str) -> tuple[float, float, str]:
        """
        Geocode an address using Google Maps API.

        Returns:
            (latitude, longitude, precision)
        """
        if not address or address.strip() == "Germany":
            return None, None, "none"

        # Check cache
        if address in self.cache:
            cached = self.cache[address]
            self.cache_hits += 1
            if not cached:
                return None, None, "none"
            return cached.get("lat"), cached.get("lon"), cached.get("precision", "cached")

        # Call Google Maps API
        url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {
            "address": address,
            "key": self.api_key,
            "region": "de",
            "language": "de",
        }

        try:
            response = requests.get(url, params=params, timeout=10)
            data = response.json()

            self.geocode_count += 1

            if data["status"] == "OK" and data["results"]:
                result = data["results"][0]
                location = result["geometry"]["location"]
                location_type = result["geometry"]["location_type"]

                precision_map = {
                    "ROOFTOP": "rooftop",
                    "RANGE_INTERPOLATED": "range",
                    "GEOMETRIC_CENTER": "center",
                    "APPROXIMATE": "approximate",
                }
                precision = precision_map.get(location_type, "approximate")

                self.cache[address] = {
                    "lat": location["lat"],
                    "lon": location["lng"],
                    "precision": precision,
                }

                # Periodic cache save
                if self.geocode_count % CACHE_SAVE_INTERVAL == 0:
                    self.save_cache()

                return location["lat"], location["lng"], precision

            # Cache the miss
            self.cache[address] = {}
            return None, None, "none"

        except Exception as e:
            print(f"    Error geocoding '{address[:50]}': {e}")
            return None, None, "none"

    def build_address(self, article: dict) -> str:
        """Build geocodable address from article location data."""
        loc = article.get("location", {})

        parts = []

        # Street with house number
        street = loc.get("street")
        if street:
            house_num = loc.get("house_number")
            if house_num:
                street = f"{street} {house_num}"
            parts.append(street)

        # District
        district = loc.get("district")
        if district:
            parts.append(district)

        # City (from location or article)
        city = loc.get("city") or article.get("city")
        if city:
            parts.append(city)

        # Bundesland
        bundesland = loc.get("bundesland") or article.get("bundesland")
        if bundesland:
            parts.append(bundesland)

        # Always add Germany
        parts.append("Germany")

        return ", ".join(parts)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Precise geocoding with Google Maps")
    parser.add_argument("--input", "-i", required=True, help="Input JSON file")
    parser.add_argument("--output", "-o", required=True, help="Output JSON file")
    parser.add_argument("--limit", "-l", type=int, help="Limit number of articles to process")
    parser.add_argument("--cache-dir", default=".cache", help="Cache directory")
    parser.add_argument("--skip-geocoded", action="store_true",
                        help="Skip articles that already have street-level precision")

    args = parser.parse_args()

    # Load articles
    print(f"Loading data from {args.input}...")
    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        articles = data
    else:
        articles = data.get("articles", [])

    if not articles:
        print("No articles found")
        sys.exit(1)

    total = len(articles)
    if args.limit:
        articles = articles[:args.limit]
        print(f"Limited to {len(articles)} articles (of {total} total)")
    else:
        print(f"Processing {total} articles")

    # Initialize geocoder
    geocoder = PreciseGeocoder(cache_dir=args.cache_dir)
    print(f"Loaded {len(geocoder.cache)} cached geocodes")

    # Analyze before state
    before_coords = set()
    need_geocoding = []

    for i, art in enumerate(articles):
        loc = art.get("location", {})
        lat = loc.get("lat")
        lon = loc.get("lon")
        precision = loc.get("precision", "")

        if lat and lon:
            before_coords.add((round(lat, 4), round(lon, 4)))

        # Check if needs geocoding
        if args.skip_geocoded and precision in ["rooftop", "range", "center"]:
            continue

        # Has location data to geocode?
        if loc.get("street") or loc.get("district") or loc.get("city"):
            need_geocoding.append(i)

    print(f"\nBefore: {len(before_coords)} unique coordinates")
    print(f"Need geocoding: {len(need_geocoding)} articles")

    # Process articles
    start_time = time.time()
    geocoded_count = 0
    precision_counts = {}

    for batch_start in range(0, len(need_geocoding), BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, len(need_geocoding))
        batch_indices = need_geocoding[batch_start:batch_end]

        for idx in batch_indices:
            art = articles[idx]
            address = geocoder.build_address(art)

            lat, lon, precision = geocoder.geocode(address)

            if lat and lon:
                art["location"]["lat"] = lat
                art["location"]["lon"] = lon
                art["location"]["precision"] = precision
                geocoded_count += 1

            precision_counts[precision] = precision_counts.get(precision, 0) + 1

        # Progress
        done = batch_end
        elapsed = time.time() - start_time
        rate = done / elapsed if elapsed > 0 else 0
        eta = (len(need_geocoding) - done) / rate if rate > 0 else 0

        print(f"  {done}/{len(need_geocoding)} | "
              f"Geocoded: {geocoded_count} | "
              f"Cache hits: {geocoder.cache_hits} | "
              f"Rate: {rate:.1f}/s | "
              f"ETA: {eta:.0f}s")

    # Save cache
    geocoder.save_cache()

    # Analyze after state
    after_coords = set()
    for art in articles:
        loc = art.get("location", {})
        lat = loc.get("lat")
        lon = loc.get("lon")
        if lat and lon:
            after_coords.add((round(lat, 4), round(lon, 4)))

    # Summary
    print("\n" + "=" * 60)
    print("RESULTS SUMMARY")
    print("=" * 60)
    print(f"Total articles: {len(articles)}")
    print(f"Successfully geocoded: {geocoded_count}")
    print(f"API calls: {geocoder.geocode_count}")
    print(f"Cache hits: {geocoder.cache_hits}")
    print(f"\nUnique coordinates:")
    print(f"  Before: {len(before_coords)}")
    print(f"  After:  {len(after_coords)}")
    print(f"  Improvement: {len(after_coords) / max(len(before_coords), 1):.1f}x")
    print(f"\nPrecision breakdown:")
    for p, count in sorted(precision_counts.items(), key=lambda x: -x[1]):
        print(f"  {p}: {count}")

    # Save output
    output_data = {"articles": articles} if isinstance(data, dict) else articles
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print(f"\nSaved to: {args.output}")


if __name__ == "__main__":
    main()
