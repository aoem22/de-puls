#!/usr/bin/env python3
"""
Test precise geocoding with Gemini Flash + Google Maps API.

This script tests the new geocoding approach on 100 records:
1. Extract precise location from body text using Gemini Flash
2. Geocode with Google Maps API (much faster than Nominatim)
3. Compare before/after coordinates

Usage:
    python scripts/test_precise_geocoding.py
"""

import json
import os
import sys
import time
from pathlib import Path

import certifi
import requests
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

# Fix SSL on macOS
os.environ['SSL_CERT_FILE'] = certifi.where()

# Configuration
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
MODEL = "google/gemini-3-flash-preview"
TEST_SIZE = 100
BATCH_SIZE = 10

# Paths
PROJECT_ROOT = Path(__file__).parent.parent
DATA_FILE = PROJECT_ROOT / "data" / "pipeline" / "merged" / "blaulicht_geocoded.json"
OUTPUT_FILE = PROJECT_ROOT / "data" / "pipeline" / "merged" / "test_precise_100.json"


def get_google_maps_api_key() -> str:
    """Get Google Maps API key from environment."""
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key:
        print("Error: GOOGLE_MAPS_API_KEY not set in environment")
        print("Please add it to your .env file")
        sys.exit(1)
    return key


def geocode_with_google_maps(address: str, api_key: str) -> tuple[float, float, str]:
    """
    Geocode an address using Google Maps Geocoding API.

    Returns:
        (latitude, longitude, precision) where precision is:
        - "rooftop": Exact address match
        - "range": Interpolated between known points
        - "center": Geometric center of area
        - "approximate": Approximate location
        - "none": No result found
    """
    url = "https://maps.googleapis.com/maps/api/geocode/json"
    params = {
        "address": address,
        "key": api_key,
        "region": "de",  # Bias to Germany
        "language": "de",
    }

    try:
        response = requests.get(url, params=params, timeout=10)
        data = response.json()

        if data["status"] == "OK" and data["results"]:
            result = data["results"][0]
            location = result["geometry"]["location"]
            location_type = result["geometry"]["location_type"]

            # Map Google's location types to our precision levels
            precision_map = {
                "ROOFTOP": "rooftop",
                "RANGE_INTERPOLATED": "range",
                "GEOMETRIC_CENTER": "center",
                "APPROXIMATE": "approximate",
            }
            precision = precision_map.get(location_type, "approximate")

            return location["lat"], location["lng"], precision

        return None, None, "none"

    except Exception as e:
        print(f"    Geocoding error for '{address[:50]}...': {e}")
        return None, None, "none"


def extract_locations_batch(client: OpenAI, articles: list[dict]) -> list[dict]:
    """
    Extract precise locations from article bodies using Gemini Flash.

    Returns list of location extractions with street, house_number, city, etc.
    """
    # Prepare articles for the prompt
    articles_data = []
    for i, art in enumerate(articles):
        articles_data.append({
            "index": i,
            "title": art.get("title", "")[:100],
            "body": art.get("body", "")[:2000],
            "city": art.get("city", ""),
        })

    prompt = f"""Analysiere diese {len(articles)} deutschen Polizeiberichte und extrahiere die GENAUEN Tatorte.

Für JEDEN Artikel, finde:
- street: Straßenname (z.B. "Schillerstraße", "Hauptstraße")
- house_number: Hausnummer falls erwähnt (z.B. "15", "23a")
- district: Stadtteil/Ortsteil falls erwähnt (z.B. "Geestemünde", "Altstadt")
- city: Stadt (aus Artikel oder aus "city" Feld)
- landmark: Markanter Ort falls keine Straße (z.B. "Hauptbahnhof", "Marktplatz")

WICHTIG:
- Suche nach Straßennamen im Text (enden oft auf -straße, -weg, -platz, -allee)
- Hausnummern stehen meist direkt nach dem Straßennamen
- Stadtteile werden oft in Klammern oder mit "im Stadtteil" erwähnt
- Wenn keine genaue Adresse gefunden wird, setze street/house_number auf null

ARTIKEL:
{json.dumps(articles_data, ensure_ascii=False, indent=2)}

Antworte mit JSON-Array (gleiche Reihenfolge wie Artikel):
[
  {{
    "article_index": 0,
    "street": "Musterstraße" oder null,
    "house_number": "15" oder null,
    "district": "Stadtteil" oder null,
    "city": "Stadt",
    "landmark": "Bahnhof" oder null,
    "confidence": 0.8
  }},
  ...
]
"""

    try:
        response = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=4000,
        )
        text = response.choices[0].message.content

        # Parse JSON
        text = text.strip()
        if "```json" in text:
            text = text.split("```json", 1)[1]
        if "```" in text:
            text = text.split("```")[0]

        import re
        match = re.search(r'\[[\s\S]*\]', text)
        if match:
            return json.loads(match.group())
        return []

    except Exception as e:
        print(f"    LLM error: {e}")
        return []


def build_address(location: dict, original_city: str) -> str:
    """Build a geocodable address string from extracted location."""
    parts = []

    # Street with house number
    if location.get("street"):
        street = location["street"]
        if location.get("house_number"):
            street += f" {location['house_number']}"
        parts.append(street)
    elif location.get("landmark"):
        parts.append(location["landmark"])

    # District
    if location.get("district"):
        parts.append(location["district"])

    # City
    city = location.get("city") or original_city
    if city:
        parts.append(city)

    # Always add Germany
    parts.append("Germany")

    return ", ".join(parts)


def main():
    print("=" * 60)
    print("Precise Geocoding Test - 100 Records")
    print("=" * 60)

    # Check API keys
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    if not openrouter_key:
        print("Error: OPENROUTER_API_KEY not set")
        sys.exit(1)

    google_maps_key = get_google_maps_api_key()
    print(f"✓ Google Maps API key found")

    # Initialize OpenAI client for OpenRouter
    client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=openrouter_key)
    print(f"✓ OpenRouter client initialized")

    # Load data
    print(f"\nLoading data from {DATA_FILE}...")
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    articles = data.get("articles", data) if isinstance(data, dict) else data
    print(f"Total articles: {len(articles)}")

    # Sample 100 articles with body text
    test_articles = []
    for art in articles:
        if art.get("body") and len(art.get("body", "")) > 100:
            test_articles.append(art)
            if len(test_articles) >= TEST_SIZE:
                break

    print(f"Selected {len(test_articles)} articles for testing")

    # Analyze before state
    before_coords = set()
    for art in test_articles:
        loc = art.get("location", {})
        lat = loc.get("lat") or art.get("lat")
        lng = loc.get("lon") or art.get("lon") or art.get("lng")
        if lat and lng:
            before_coords.add((round(lat, 4), round(lng, 4)))

    print(f"\nBEFORE: {len(before_coords)} unique coordinates (city-level)")

    # Process in batches
    results = []
    total_geocoded = 0
    street_level = 0

    print(f"\nProcessing {len(test_articles)} articles in {len(test_articles) // BATCH_SIZE + 1} batches...")

    for batch_start in range(0, len(test_articles), BATCH_SIZE):
        batch_end = min(batch_start + BATCH_SIZE, len(test_articles))
        batch = test_articles[batch_start:batch_end]
        batch_num = batch_start // BATCH_SIZE + 1

        print(f"\n  Batch {batch_num}: articles {batch_start}-{batch_end-1}")

        # Extract locations with LLM
        print(f"    Extracting locations with Gemini Flash...")
        locations = extract_locations_batch(client, batch)

        # Match locations to articles and geocode
        for i, art in enumerate(batch):
            result = {
                "original": {
                    "city": art.get("city"),
                    "lat": art.get("location", {}).get("lat"),
                    "lng": art.get("location", {}).get("lon"),
                    "precision": art.get("location", {}).get("precision", "city"),
                },
                "body_excerpt": art.get("body", "")[:200],
            }

            # Find matching location extraction
            extracted = None
            for loc in locations:
                if loc.get("article_index") == i:
                    extracted = loc
                    break

            if extracted:
                result["extracted"] = extracted

                # Build address and geocode
                address = build_address(extracted, art.get("city"))
                result["geocode_address"] = address

                print(f"    [{batch_start + i}] Geocoding: {address[:60]}...")
                lat, lng, precision = geocode_with_google_maps(address, google_maps_key)

                if lat and lng:
                    result["new"] = {
                        "lat": lat,
                        "lng": lng,
                        "precision": precision,
                    }
                    total_geocoded += 1
                    if precision in ["rooftop", "range"]:
                        street_level += 1
                else:
                    result["new"] = {"error": "geocoding_failed"}
            else:
                result["extracted"] = {"error": "extraction_failed"}
                result["new"] = {"error": "no_extraction"}

            results.append(result)

        # Small delay between batches
        time.sleep(0.5)

    # Analyze after state
    after_coords = set()
    for r in results:
        new = r.get("new", {})
        if new.get("lat") and new.get("lng"):
            after_coords.add((round(new["lat"], 4), round(new["lng"], 4)))

    # Summary
    print("\n" + "=" * 60)
    print("RESULTS SUMMARY")
    print("=" * 60)
    print(f"Total records processed: {len(results)}")
    print(f"Successfully geocoded:   {total_geocoded}")
    print(f"Street-level precision:  {street_level}")
    print(f"\nUnique coordinates:")
    print(f"  BEFORE: {len(before_coords)} (city centers only)")
    print(f"  AFTER:  {len(after_coords)} (precise locations)")
    print(f"  Improvement: {len(after_coords) / max(len(before_coords), 1):.1f}x more unique points")

    # Precision breakdown
    precision_counts = {}
    for r in results:
        new = r.get("new", {})
        p = new.get("precision") or new.get("error", "unknown")
        precision_counts[p] = precision_counts.get(p, 0) + 1

    print(f"\nPrecision breakdown:")
    for p, count in sorted(precision_counts.items(), key=lambda x: -x[1]):
        print(f"  {p}: {count}")

    # Save results
    output_data = {
        "summary": {
            "total": len(results),
            "geocoded": total_geocoded,
            "street_level": street_level,
            "unique_coords_before": len(before_coords),
            "unique_coords_after": len(after_coords),
            "precision_breakdown": precision_counts,
        },
        "results": results,
    }

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print(f"\nResults saved to: {OUTPUT_FILE}")

    # Show sample comparisons
    print("\n" + "=" * 60)
    print("SAMPLE COMPARISONS")
    print("=" * 60)

    samples = [r for r in results if r.get("new", {}).get("lat")][:5]
    for i, r in enumerate(samples):
        print(f"\n[{i+1}] City: {r['original']['city']}")
        print(f"    Body: {r['body_excerpt'][:100]}...")
        if r.get("extracted"):
            ext = r["extracted"]
            print(f"    Extracted: {ext.get('street', 'N/A')}, {ext.get('district', 'N/A')}")
        print(f"    Before: ({r['original']['lat']}, {r['original']['lng']}) - city level")
        new = r.get("new", {})
        print(f"    After:  ({new.get('lat')}, {new.get('lng')}) - {new.get('precision')}")


if __name__ == "__main__":
    main()
