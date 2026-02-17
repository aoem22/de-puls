#!/usr/bin/env python3
"""
Geocode enriched articles with the Geocodify API.

This reads an enriched JSON file (either a list or {"articles": [...]}) and
fills missing location.lat/location.lon fields in-place (or to a separate
output file).

Usage:
    python -m scripts.pipeline.geocodify_geocoder --input data.json
    python -m scripts.pipeline.geocodify_geocoder --input data.json --output geocoded.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

API_URL = "https://api.geocodify.com/v2/geocode"
DEFAULT_CACHE_FILE = Path(".cache/geocodify_geocode_cache.json")
CACHE_SAVE_INTERVAL = 100


class FatalGeocodeError(RuntimeError):
    """Raised when geocoding cannot proceed (auth, malformed response, etc.)."""


def load_env() -> None:
    load_dotenv()
    load_dotenv(Path(".env.local"), override=True)


def to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def has_coordinates(location: dict[str, Any]) -> bool:
    lat = to_float(location.get("lat"))
    lon = to_float(location.get("lon"))
    if lat is None or lon is None:
        return False
    if lat < -90 or lat > 90 or lon < -180 or lon > 180:
        return False
    # Legacy placeholder used for unresolved geocodes.
    if lat == 0 and lon == 0:
        return False
    return True


def clean_part(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def dedupe_parts(parts: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for part in parts:
        key = part.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(part)
    return out


def build_address(article: dict[str, Any], country: str) -> str | None:
    location = article.get("location")
    if not isinstance(location, dict):
        return None

    parts: list[str] = []

    street = clean_part(location.get("street"))
    if street:
        house_number = clean_part(location.get("house_number"))
        parts.append(f"{street} {house_number}".strip() if house_number else street)

    cross_street = clean_part(location.get("cross_street"))
    if cross_street:
        parts.append(cross_street)

    location_hint = clean_part(location.get("location_hint"))
    if location_hint:
        parts.append(location_hint)

    district = clean_part(location.get("district"))
    if district:
        parts.append(district)

    city = clean_part(location.get("city")) or clean_part(article.get("city"))
    if city:
        parts.append(city)

    bundesland = clean_part(location.get("bundesland")) or clean_part(article.get("bundesland"))
    if bundesland:
        parts.append(bundesland)

    if not parts:
        return None

    parts.append(country)
    normalized = dedupe_parts(parts)
    return ", ".join(normalized)


def extract_lat_lon(value: Any, depth: int = 0) -> tuple[float, float] | None:
    if depth > 8:
        return None

    if isinstance(value, dict):
        lat = to_float(value.get("lat"))
        lon = to_float(value.get("lon"))
        lng = to_float(value.get("lng"))
        latitude = to_float(value.get("latitude"))
        longitude = to_float(value.get("longitude"))

        if lat is not None and lng is not None:
            return lat, lng
        if lat is not None and lon is not None:
            return lat, lon
        if latitude is not None and longitude is not None:
            return latitude, longitude

        coordinates = value.get("coordinates")
        if isinstance(coordinates, (list, tuple)) and len(coordinates) >= 2:
            first = to_float(coordinates[0])
            second = to_float(coordinates[1])
            if first is not None and second is not None:
                # Most APIs use [lon, lat] for coordinate arrays.
                if abs(first) > 90 and abs(second) <= 90:
                    return second, first
                if abs(second) > 90 and abs(first) <= 90:
                    return first, second
                return second, first

        for key in ("geometry", "location", "result", "properties", "position"):
            if key in value:
                nested = extract_lat_lon(value[key], depth + 1)
                if nested:
                    return nested

        for nested_value in value.values():
            if isinstance(nested_value, (dict, list, tuple)):
                nested = extract_lat_lon(nested_value, depth + 1)
                if nested:
                    return nested

    elif isinstance(value, (list, tuple)):
        for item in value:
            nested = extract_lat_lon(item, depth + 1)
            if nested:
                return nested

    return None


def extract_response_candidates(payload: dict[str, Any]) -> list[Any]:
    response = payload.get("response")
    if isinstance(response, list):
        return response
    if isinstance(response, dict):
        for key in ("results", "items", "features", "data"):
            child = response.get(key)
            if isinstance(child, list):
                return child
        return [response]
    return []


def extract_precision(candidate: Any) -> str | None:
    if not isinstance(candidate, dict):
        return None

    value = candidate.get("precision") or candidate.get("accuracy") or candidate.get("location_type") or candidate.get("type")
    if value is None:
        return None

    text = str(value).strip().lower()
    if not text:
        return None

    if any(token in text for token in ("rooftop", "address", "house", "street")):
        return "street"
    if any(token in text for token in ("range", "interpolated", "parcel")):
        return "street"
    if any(token in text for token in ("district", "neighborhood", "locality", "quarter")):
        return "neighborhood"
    if any(token in text for token in ("city", "town", "village", "municipality")):
        return "city"
    if any(token in text for token in ("region", "state", "country")):
        return "region"

    return None


def choose_precision(location: dict[str, Any], candidate_precision: str | None) -> str:
    if clean_part(location.get("street")):
        return "street"
    if clean_part(location.get("district")) or clean_part(location.get("location_hint")):
        return "neighborhood"
    if clean_part(location.get("city")):
        return "city"
    if candidate_precision:
        return candidate_precision
    return "city"


def read_json(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False)
    tmp_path.replace(path)


class GeocodifyClient:
    def __init__(
        self,
        api_key: str,
        cache_file: Path,
        max_rps: float,
        timeout_s: float,
        max_retries: int,
    ) -> None:
        self.api_key = api_key
        self.cache_file = cache_file
        self.timeout_s = timeout_s
        self.max_retries = max_retries
        self.min_interval_s = (1.0 / max_rps) if max_rps > 0 else 0.0

        self.session = requests.Session()
        self.last_request_ts = 0.0

        self.cache = self._load_cache()
        self.cache_hits = 0
        self.api_calls = 0

    def _load_cache(self) -> dict[str, dict[str, Any]]:
        if self.cache_file.exists():
            try:
                payload = read_json(self.cache_file)
                if isinstance(payload, dict):
                    return payload
            except Exception:
                pass
        return {}

    def save_cache(self) -> None:
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.cache_file, "w", encoding="utf-8") as f:
            json.dump(self.cache, f, ensure_ascii=False)

    def _respect_rate_limit(self) -> None:
        if self.min_interval_s <= 0:
            return
        elapsed = time.time() - self.last_request_ts
        if elapsed < self.min_interval_s:
            time.sleep(self.min_interval_s - elapsed)

    def geocode(self, query: str) -> dict[str, Any]:
        if query in self.cache:
            self.cache_hits += 1
            return self.cache[query]

        backoff_s = 1.0

        for attempt in range(1, self.max_retries + 1):
            self._respect_rate_limit()
            self.last_request_ts = time.time()

            try:
                response = self.session.get(
                    API_URL,
                    params={
                        "api_key": self.api_key,
                        "q": query,
                    },
                    timeout=self.timeout_s,
                )
            except requests.RequestException:
                if attempt == self.max_retries:
                    self.cache[query] = {}
                    return {}
                time.sleep(backoff_s)
                backoff_s = min(backoff_s * 2, 10.0)
                continue

            self.api_calls += 1

            try:
                payload = response.json()
            except ValueError:
                if attempt == self.max_retries:
                    self.cache[query] = {}
                    return {}
                time.sleep(backoff_s)
                backoff_s = min(backoff_s * 2, 10.0)
                continue

            meta = payload.get("meta") if isinstance(payload, dict) else None
            api_code = None
            if isinstance(meta, dict):
                api_code = meta.get("code")

            if response.status_code in (401, 403) or str(api_code) in {"401", "403", "601"}:
                error_detail = ""
                if isinstance(meta, dict):
                    detail = meta.get("error_detail") or meta.get("error_type")
                    if detail:
                        error_detail = f": {detail}"
                raise FatalGeocodeError(f"Geocodify authentication failed{error_detail}")

            if response.status_code == 429:
                if attempt == self.max_retries:
                    self.cache[query] = {}
                    return {}
                time.sleep(backoff_s)
                backoff_s = min(backoff_s * 2, 30.0)
                continue

            if response.status_code >= 500:
                if attempt == self.max_retries:
                    self.cache[query] = {}
                    return {}
                time.sleep(backoff_s)
                backoff_s = min(backoff_s * 2, 10.0)
                continue

            if not isinstance(payload, dict):
                self.cache[query] = {}
                return {}

            candidates = extract_response_candidates(payload)
            for candidate in candidates:
                coords = extract_lat_lon(candidate)
                if not coords:
                    continue
                precision = extract_precision(candidate)
                result = {
                    "lat": coords[0],
                    "lon": coords[1],
                    "precision": precision,
                }
                self.cache[query] = result
                return result

            self.cache[query] = {}
            return {}

        self.cache[query] = {}
        return {}


def main() -> int:
    parser = argparse.ArgumentParser(description="Geocode enriched articles with Geocodify")
    parser.add_argument("--input", "-i", required=True, help="Input JSON file")
    parser.add_argument("--output", "-o", help="Output JSON file (defaults to --input)")
    parser.add_argument("--cache-file", default=str(DEFAULT_CACHE_FILE), help="Geocode cache JSON path")
    parser.add_argument("--country", default="Germany", help="Country suffix appended to geocoding queries")
    parser.add_argument("--max-rps", type=float, default=1.0, help="Max requests per second (default: 1)")
    parser.add_argument("--timeout", type=float, default=12.0, help="HTTP timeout seconds per request")
    parser.add_argument("--max-retries", type=int, default=4, help="Max retries for transient failures")
    parser.add_argument("--save-every", type=int, default=CACHE_SAVE_INTERVAL, help="Persist cache every N API calls")
    parser.add_argument("--force", action="store_true", help="Re-geocode rows even if lat/lon already exists")

    args = parser.parse_args()

    load_env()

    api_key = os.environ.get("GEOCODIFY_API_KEY")
    if not api_key:
        print("ERROR: GEOCODIFY_API_KEY is not set", flush=True)
        return 1

    input_path = Path(args.input)
    output_path = Path(args.output) if args.output else input_path
    cache_file = Path(args.cache_file)

    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}", flush=True)
        return 1

    try:
        raw_payload = read_json(input_path)
    except Exception as exc:
        print(f"ERROR: Failed to read JSON: {exc}", flush=True)
        return 1

    if isinstance(raw_payload, list):
        articles = raw_payload
        payload_is_list = True
    elif isinstance(raw_payload, dict) and isinstance(raw_payload.get("articles"), list):
        articles = raw_payload["articles"]
        payload_is_list = False
    else:
        print("ERROR: Input must be a JSON array or an object with an 'articles' array", flush=True)
        return 1

    client = GeocodifyClient(
        api_key=api_key,
        cache_file=cache_file,
        max_rps=max(args.max_rps, 0.1),
        timeout_s=max(args.timeout, 1.0),
        max_retries=max(args.max_retries, 1),
    )

    total = len(articles)
    already_geocoded = 0
    no_location_data = 0

    addresses_to_locations: dict[str, list[dict[str, Any]]] = {}

    for article in articles:
        if not isinstance(article, dict):
            continue

        location = article.get("location")
        if not isinstance(location, dict):
            no_location_data += 1
            continue

        if not args.force and has_coordinates(location):
            already_geocoded += 1
            continue

        address = build_address(article, args.country)
        if not address:
            no_location_data += 1
            continue

        addresses_to_locations.setdefault(address, []).append(location)

    unique_addresses = sorted(addresses_to_locations.keys())

    print(f"Loaded {total} records", flush=True)
    print(f"Already geocoded: {already_geocoded}", flush=True)
    print(f"Need geocoding: {sum(len(v) for v in addresses_to_locations.values())}", flush=True)
    print(f"Unique addresses: {len(unique_addresses)}", flush=True)
    print(f"Cache entries loaded: {len(client.cache)}", flush=True)

    started = time.time()

    geocoded_records = 0
    missing_records = 0
    processed_addresses = 0

    try:
        for address in unique_addresses:
            result = client.geocode(address)
            processed_addresses += 1

            if client.api_calls > 0 and client.api_calls % max(args.save_every, 1) == 0:
                client.save_cache()

            locations = addresses_to_locations[address]

            lat = to_float(result.get("lat")) if isinstance(result, dict) else None
            lon = to_float(result.get("lon")) if isinstance(result, dict) else None

            if lat is None or lon is None:
                missing_records += len(locations)
            else:
                candidate_precision = None
                if isinstance(result, dict):
                    value = result.get("precision")
                    candidate_precision = str(value) if value else None

                for location in locations:
                    location["lat"] = lat
                    location["lon"] = lon
                    location["precision"] = choose_precision(location, candidate_precision)
                geocoded_records += len(locations)

            if processed_addresses % 25 == 0 or processed_addresses == len(unique_addresses):
                elapsed = max(time.time() - started, 0.001)
                rate = processed_addresses / elapsed
                remaining = len(unique_addresses) - processed_addresses
                eta_s = remaining / rate if rate > 0 else 0
                print(
                    f"Progress: {processed_addresses}/{len(unique_addresses)} addresses | "
                    f"geocoded records: {geocoded_records} | "
                    f"api calls: {client.api_calls} | "
                    f"cache hits: {client.cache_hits} | "
                    f"eta: {int(eta_s)}s",
                    flush=True,
                )

    except FatalGeocodeError as exc:
        print(f"ERROR: {exc}", flush=True)
        client.save_cache()
        return 1

    client.save_cache()

    if payload_is_list:
        output_payload = articles
    else:
        raw_payload["articles"] = articles
        output_payload = raw_payload

    try:
        write_json_atomic(output_path, output_payload)
    except Exception as exc:
        print(f"ERROR: Failed to write output: {exc}", flush=True)
        return 1

    elapsed = time.time() - started
    print("Done", flush=True)
    print(f"Updated records with coordinates: {geocoded_records}", flush=True)
    print(f"Records still missing coordinates: {missing_records}", flush=True)
    print(f"API calls: {client.api_calls}", flush=True)
    print(f"Cache hits: {client.cache_hits}", flush=True)
    print(f"Duration: {elapsed:.1f}s", flush=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
