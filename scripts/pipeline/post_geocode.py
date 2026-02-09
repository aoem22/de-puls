#!/usr/bin/env python3
"""
Post-geocode enrichment cache entries that lack coordinates.

Reads the enrichment cache, geocodes locations using Google Maps API
(with geocode cache), and updates the enrichment cache with lat/lon.

Usage:
    python3 scripts/pipeline/post_geocode.py --cache-dir .cache/week_2026_w01
"""
import json
import os
import sys
import time
from pathlib import Path

import certifi
import requests
from dotenv import load_dotenv

load_dotenv()
load_dotenv(Path(".env.local"), override=True)
os.environ['SSL_CERT_FILE'] = certifi.where()


def geocode(address: str, api_key: str, geocode_cache: dict) -> dict:
    """Geocode an address, using cache if available."""
    if address in geocode_cache:
        return geocode_cache[address]

    url = "https://maps.googleapis.com/maps/api/geocode/json"
    params = {
        "address": address,
        "key": api_key,
        "region": "de",
        "language": "de",
    }

    try:
        resp = requests.get(url, params=params, timeout=10)
        data = resp.json()

        if data.get("status") == "OK" and data.get("results"):
            result = data["results"][0]
            geo = result["geometry"]["location"]
            loc_type = result["geometry"].get("location_type", "")
            precision = {
                "ROOFTOP": "street",
                "RANGE_INTERPOLATED": "street",
                "GEOMETRIC_CENTER": "neighborhood",
            }.get(loc_type, "city")

            cached = {
                "lat": geo["lat"],
                "lon": geo["lng"],
                "formatted_address": result.get("formatted_address"),
                "precision": precision,
            }
            geocode_cache[address] = cached
            return cached
        else:
            geocode_cache[address] = {}
            return {}
    except Exception as e:
        print(f"    Geocode error for '{address[:50]}': {e}")
        geocode_cache[address] = {}
        return {}


def make_address(loc: dict, bundesland: str = "") -> str:
    """Build address string from location dict."""
    parts = []
    street = loc.get("street", "")
    if street:
        house = loc.get("house_number", "")
        if house:
            parts.append(f"{street} {house}")
        else:
            parts.append(street)
    district = loc.get("district", "")
    if district:
        parts.append(district)
    city = loc.get("city", "")
    if city:
        parts.append(city)
    if bundesland:
        parts.append(bundesland)
    parts.append("Germany")
    return ", ".join(parts)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Post-geocode enrichment cache")
    parser.add_argument("--cache-dir", required=True, help="Cache directory (e.g. .cache/week_2026_w01)")
    parser.add_argument("--dry-run", action="store_true", help="Count addresses without geocoding")
    parser.add_argument("--batch-save", type=int, default=200, help="Save cache every N geocodes")
    args = parser.parse_args()

    cache_dir = Path(args.cache_dir)
    enrichment_file = cache_dir / "enrichment_cache.json"
    geocode_file = cache_dir / "geocode_cache.json"

    api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not api_key and not args.dry_run:
        print("ERROR: GOOGLE_MAPS_API_KEY not set")
        sys.exit(1)

    # Load caches
    print(f"Loading enrichment cache from {enrichment_file}")
    enrichment_cache = json.load(open(enrichment_file, encoding="utf-8"))
    print(f"  {len(enrichment_cache)} entries")

    geocode_cache = {}
    if geocode_file.exists():
        geocode_cache = json.load(open(geocode_file, encoding="utf-8"))
    print(f"  Geocode cache: {len(geocode_cache)} entries")

    # Find entries needing geocoding
    needs_geocoding = []  # (cache_key, entry_index, address, bundesland)
    already_has_coords = 0
    no_location_data = 0

    for cache_key, val in enrichment_cache.items():
        entries = val if isinstance(val, list) else [val]
        for idx, entry in enumerate(entries):
            loc = entry.get("location", {})
            if loc.get("lat") is not None and loc.get("lon") is not None:
                already_has_coords += 1
                continue
            if not (loc.get("street") or loc.get("city") or loc.get("district")):
                no_location_data += 1
                continue
            bundesland = loc.get("bundesland", "")
            address = make_address(loc, bundesland)
            needs_geocoding.append((cache_key, idx, address, bundesland))

    # Deduplicate addresses
    unique_addresses = set(addr for _, _, addr, _ in needs_geocoding)
    cached_addrs = sum(1 for a in unique_addresses if a in geocode_cache and geocode_cache[a].get("lat") is not None)
    failed_addrs = sum(1 for a in unique_addresses if a in geocode_cache and not geocode_cache[a])
    new_addrs = sum(1 for a in unique_addresses if a not in geocode_cache)

    print(f"\nRecords needing geocoding: {len(needs_geocoding)}")
    print(f"  Already have coords: {already_has_coords}")
    print(f"  No location data: {no_location_data}")
    print(f"\nUnique addresses: {len(unique_addresses)}")
    print(f"  In geocode cache (have coords): {cached_addrs}")
    print(f"  In geocode cache (failed): {failed_addrs}")
    print(f"  New (need API call): {new_addrs}")

    if args.dry_run:
        print(f"\n[DRY RUN] Would make ~{new_addrs} Google Maps API calls")
        return

    # Geocode all unique addresses first
    print(f"\nGeocoding {new_addrs} new addresses...")
    geocoded_count = 0
    failed_count = 0
    api_calls = 0

    for i, addr in enumerate(sorted(unique_addresses)):
        if addr in geocode_cache:
            continue

        result = geocode(addr, api_key, geocode_cache)
        api_calls += 1

        if result.get("lat") is not None:
            geocoded_count += 1
        else:
            failed_count += 1

        if api_calls % 100 == 0:
            print(f"  {api_calls}/{new_addrs} API calls ({geocoded_count} geocoded, {failed_count} failed)")

        if api_calls % args.batch_save == 0:
            with open(geocode_file, "w", encoding="utf-8") as f:
                json.dump(geocode_cache, f, ensure_ascii=False)

        # Rate limiting: ~45 requests/sec
        if api_calls % 45 == 0:
            time.sleep(1)

    print(f"  Done: {geocoded_count} geocoded, {failed_count} failed out of {api_calls} API calls")

    # Save geocode cache
    with open(geocode_file, "w", encoding="utf-8") as f:
        json.dump(geocode_cache, f, ensure_ascii=False)
    print(f"  Saved geocode cache ({len(geocode_cache)} entries)")

    # Now update enrichment cache entries with coordinates
    print(f"\nUpdating enrichment cache with coordinates...")
    updated = 0
    still_missing = 0

    for cache_key, entry_idx, address, bundesland in needs_geocoding:
        geo = geocode_cache.get(address, {})
        if not geo or geo.get("lat") is None:
            still_missing += 1
            continue

        val = enrichment_cache[cache_key]
        entries = val if isinstance(val, list) else [val]
        entry = entries[entry_idx]
        entry["location"]["lat"] = geo["lat"]
        entry["location"]["lon"] = geo["lon"]
        entry["location"]["precision"] = geo.get("precision", "city")
        if bundesland:
            entry["location"]["bundesland"] = bundesland
        updated += 1

    print(f"  Updated: {updated} records")
    print(f"  Still missing coords: {still_missing}")

    # Save enrichment cache
    with open(enrichment_file, "w", encoding="utf-8") as f:
        json.dump(enrichment_cache, f, ensure_ascii=False)
    print(f"  Saved enrichment cache")

    print(f"\nDone! Re-run the pipeline to push to Supabase:")
    print(f"  python3 -m scripts.pipeline.runner week --year 2026 --week 1 --skip-clustering")


if __name__ == "__main__":
    main()
