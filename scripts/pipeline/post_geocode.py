#!/usr/bin/env python3
"""
Post-geocode enrichment cache entries that lack coordinates.

Reads the enrichment cache, geocodes locations using HERE Geocoding API
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
    """Geocode an address using HERE API, with cache."""
    if address in geocode_cache:
        return geocode_cache[address]

    url = "https://geocode.search.hereapi.com/v1/geocode"
    params = {
        "q": address,
        "apiKey": api_key,
        "limit": 1,
        "lang": "de",
        "in": "countryCode:DEU",
    }

    try:
        resp = requests.get(url, params=params, timeout=10)
        data = resp.json()

        items = data.get("items", [])
        if items:
            item = items[0]
            position = item.get("position", {})
            lat = position.get("lat")
            lng = position.get("lng")

            if lat is None or lng is None:
                geocode_cache[address] = {}
                return {}

            result_type = item.get("resultType", "")
            precision = {
                "houseNumber": "street",
                "street": "street",
                "intersection": "street",
                "district": "neighborhood",
                "locality": "city",
            }.get(result_type, "city")

            cached = {
                "lat": lat,
                "lon": lng,
                "formatted_address": item.get("address", {}).get("label", ""),
                "precision": precision,
                "plz": item.get("address", {}).get("postalCode"),
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

    api_key = os.environ.get("HERE_API_KEY")
    if not api_key and not args.dry_run:
        print("ERROR: HERE_API_KEY not set")
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
        print(f"\n[DRY RUN] Would make ~{new_addrs} HERE API calls")
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

        # Rate limiting: HERE allows 5 req/s
        time.sleep(0.2)

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
        if geo.get("plz"):
            entry["location"]["plz"] = geo["plz"]
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
