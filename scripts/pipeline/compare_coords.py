#!/usr/bin/env python3
"""
Compare LLM-estimated coordinates vs Google Maps geocoded coordinates.

Loads enriched test data with LLM-estimated coords, geocodes the same locations
via Google Maps API, and reports distance accuracy statistics.
"""

import json
import math
import os
import sys
import time
from pathlib import Path
from statistics import mean, median

import requests
from dotenv import load_dotenv

# Project root
ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(ROOT / ".env")

# Paths
INPUT_FILE = ROOT / "data/pipeline/chunks/enriched/test_llm_coords.json"
OUTPUT_FILE = ROOT / "data/pipeline/chunks/enriched/coords_comparison.json"
CACHE_FILE = ROOT / ".cache/geocode_cache.json"

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
RATE_LIMIT_DELAY = 0.1  # seconds between API calls


def load_cache() -> dict:
    if CACHE_FILE.exists():
        with open(CACHE_FILE) as f:
            return json.load(f)
    return {}


def save_cache(cache: dict):
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in meters between two lat/lon points."""
    R = 6_371_000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def geocode(address: str, cache: dict) -> tuple[float | None, float | None, str]:
    """
    Geocode an address via Google Maps API with caching.
    Returns (lat, lon, precision) or (None, None, "none").
    """
    # Check cache
    if address in cache:
        cached = cache[address]
        if not cached:
            return None, None, "none"
        return cached.get("lat"), cached.get("lon"), cached.get("precision", "cached")

    # Call API
    params = {
        "address": address,
        "key": GOOGLE_MAPS_API_KEY,
        "region": "de",
        "language": "de",
    }

    try:
        resp = requests.get(GEOCODE_URL, params=params, timeout=10)
        data = resp.json()

        if data["status"] == "OK" and data["results"]:
            result = data["results"][0]
            loc = result["geometry"]["location"]
            loc_type = result["geometry"]["location_type"]

            precision_map = {
                "ROOFTOP": "rooftop",
                "RANGE_INTERPOLATED": "range",
                "GEOMETRIC_CENTER": "center",
                "APPROXIMATE": "approximate",
            }
            precision = precision_map.get(loc_type, "approximate")

            cache[address] = {"lat": loc["lat"], "lon": loc["lng"], "precision": precision}
            return loc["lat"], loc["lng"], precision

        # Cache the miss
        cache[address] = {}
        return None, None, "none"

    except Exception as e:
        print(f"  Geocoding error for '{address}': {e}")
        return None, None, "none"


def build_address(record: dict) -> str:
    """Build address string from record fields, matching fast_enricher pattern."""
    loc = record.get("location", {})
    parts = [
        loc.get("street"),
        loc.get("district"),
        loc.get("city"),
        record.get("bundesland"),
        "Germany",
    ]
    return ", ".join(p for p in parts if p)


def format_distance(meters: float) -> str:
    if meters >= 1000:
        return f"{meters / 1000:.1f}km"
    return f"{meters:.0f}m"


def percentile(values: list[float], p: float) -> float:
    """Simple percentile calculation."""
    if not values:
        return 0
    sorted_v = sorted(values)
    idx = (len(sorted_v) - 1) * p / 100
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return sorted_v[lo]
    frac = idx - lo
    return sorted_v[lo] * (1 - frac) + sorted_v[hi] * frac


def main():
    if not GOOGLE_MAPS_API_KEY:
        print("ERROR: GOOGLE_MAPS_API_KEY not set in .env")
        sys.exit(1)

    # Load input
    with open(INPUT_FILE) as f:
        records = json.load(f)
    print(f"Loaded {len(records)} records from {INPUT_FILE.name}")

    # Filter to records with LLM coords
    with_coords = [r for r in records if r.get("location", {}).get("lat") is not None]
    print(f"Records with LLM coordinates: {len(with_coords)}")

    # Load geocode cache
    cache = load_cache()
    initial_cache_size = len(cache)
    print(f"Geocode cache: {initial_cache_size} entries")

    # Geocode each record via Google Maps
    comparisons = []
    api_calls = 0
    cache_hits = 0

    for i, rec in enumerate(with_coords):
        address = build_address(rec)
        loc = rec["location"]
        llm_lat, llm_lon = loc["lat"], loc["lon"]
        confidence = loc.get("confidence", 0)
        has_street = loc.get("street") is not None

        was_cached = address in cache
        gm_lat, gm_lon, gm_precision = geocode(address, cache)

        if was_cached:
            cache_hits += 1
        else:
            api_calls += 1
            time.sleep(RATE_LIMIT_DELAY)

        # Calculate distance if both have coords
        distance = None
        if gm_lat is not None and llm_lat is not None:
            distance = haversine_meters(llm_lat, llm_lon, gm_lat, gm_lon)

        comp = {
            "title": rec.get("title", ""),
            "address": address,
            "has_street": has_street,
            "llm_lat": llm_lat,
            "llm_lon": llm_lon,
            "llm_confidence": confidence,
            "gm_lat": gm_lat,
            "gm_lon": gm_lon,
            "gm_precision": gm_precision,
            "distance_m": round(distance, 1) if distance is not None else None,
        }
        comparisons.append(comp)

        # Progress
        if (i + 1) % 25 == 0 or i == len(with_coords) - 1:
            print(f"  Processed {i + 1}/{len(with_coords)} (API calls: {api_calls}, cache hits: {cache_hits})")

    # Save cache
    new_entries = len(cache) - initial_cache_size
    if new_entries > 0:
        save_cache(cache)
        print(f"Cache updated: +{new_entries} entries (total: {len(cache)})")

    # Save full comparison
    with open(OUTPUT_FILE, "w") as f:
        json.dump(comparisons, f, ensure_ascii=False, indent=2)
    print(f"\nFull comparison saved to {OUTPUT_FILE.name}")

    # === Analysis ===
    matched = [c for c in comparisons if c["distance_m"] is not None]
    failed = [c for c in comparisons if c["gm_lat"] is None]
    distances = [c["distance_m"] for c in matched]

    print("\n" + "=" * 50)
    print("  LLM vs Google Maps Coordinate Accuracy")
    print("=" * 50)
    print(f"Total with LLM coords:   {len(with_coords)}")
    print(f"Google Maps matched:     {len(matched)}")
    print(f"Google Maps failed:      {len(failed)}")

    if distances:
        print(f"\n--- Overall ({len(distances)} records) ---")
        print(f"  Mean distance:    {format_distance(mean(distances))}")
        print(f"  Median distance:  {format_distance(median(distances))}")
        print(f"  P95 distance:     {format_distance(percentile(distances, 95))}")
        print(f"  Max distance:     {format_distance(max(distances))}")

        # By confidence level
        print(f"\n--- By LLM Confidence ---")
        buckets = {
            "High (>=0.8)": [c for c in matched if c["llm_confidence"] >= 0.8],
            "Medium (0.6-0.8)": [c for c in matched if 0.6 <= c["llm_confidence"] < 0.8],
            "Low (<0.6)": [c for c in matched if c["llm_confidence"] < 0.6],
        }
        for label, group in buckets.items():
            if group:
                dists = [c["distance_m"] for c in group]
                print(f"  {label:20s}  median {format_distance(median(dists)):>8s}  mean {format_distance(mean(dists)):>8s}  (N={len(group)})")

        # By location type
        print(f"\n--- By Location Type ---")
        with_street = [c for c in matched if c["has_street"]]
        city_only = [c for c in matched if not c["has_street"]]

        if with_street:
            dists = [c["distance_m"] for c in with_street]
            print(f"  {'With street':20s}  median {format_distance(median(dists)):>8s}  mean {format_distance(mean(dists)):>8s}  (N={len(with_street)})")
        if city_only:
            dists = [c["distance_m"] for c in city_only]
            print(f"  {'City-only':20s}  median {format_distance(median(dists)):>8s}  mean {format_distance(mean(dists)):>8s}  (N={len(city_only)})")

        # By Google Maps precision
        print(f"\n--- By Google Maps Precision ---")
        for prec in ["rooftop", "range", "center", "approximate", "cached"]:
            group = [c for c in matched if c["gm_precision"] == prec]
            if group:
                dists = [c["distance_m"] for c in group]
                print(f"  {prec:20s}  median {format_distance(median(dists)):>8s}  mean {format_distance(mean(dists)):>8s}  (N={len(group)})")

        # Worst offenders
        print(f"\n--- Top 10 Largest Distances ---")
        worst = sorted(matched, key=lambda c: c["distance_m"], reverse=True)[:10]
        for c in worst:
            print(f"  {format_distance(c['distance_m']):>8s}  conf={c['llm_confidence']:.1f}  {c['address'][:60]}")

    # Google Maps failures
    if failed:
        print(f"\n--- Google Maps Failures ({len(failed)}) ---")
        for c in failed:
            print(f"  {c['address'][:70]}")

    print()


if __name__ == "__main__":
    main()
