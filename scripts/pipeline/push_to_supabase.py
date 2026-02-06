#!/usr/bin/env python3
"""
Push enriched LLM-coords data to Supabase crime_records table.

Transforms the enriched JSON format (from test_llm_coords.py) to the
Supabase schema and batch-upserts records.

Usage:
    python3 scripts/pipeline/push_to_supabase.py
    python3 scripts/pipeline/push_to_supabase.py --input path/to/enriched.json
    python3 scripts/pipeline/push_to_supabase.py --dry-run  # preview without uploading
"""
import hashlib
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
# Also load .env.local (higher priority, override=True)
load_dotenv(Path(".env.local"), override=True)

# PKS code → CrimeCategory mapping
PKS_TO_CATEGORY: dict[str, str] = {
    # Violence
    "0100": "murder",
    "0200": "murder",
    "2110": "murder",
    "2100": "robbery",
    "2200": "assault",
    "2340": "assault",
    # Sexual
    "1100": "sexual",
    "1110": "sexual",
    "1300": "sexual",
    # Theft / Burglary
    "3000": "burglary",
    "4000": "burglary",
    "4350": "burglary",
    "4780": "burglary",
    # Fraud
    "5100": "fraud",
    # Property / Arson
    "6740": "arson",
    "6750": "vandalism",
    # Traffic
    "7100": "traffic",
    "7200": "traffic",
    "7300": "traffic",
    # Drugs
    "8910": "drugs",
    # Other
    "8990": "other",
}

# Fallback: map German category names when PKS code is missing or unmapped
GERMAN_TO_CATEGORY: dict[str, str] = {
    "Mord": "murder",
    "Tötungsdelikt": "murder",
    "Raub": "robbery",
    "Körperverletzung": "assault",
    "Bedrohung": "assault",
    "Sexualdelikt": "sexual",
    "Diebstahl": "burglary",
    "Wohnungseinbruch": "burglary",
    "Kfz-Diebstahl": "burglary",
    "Betrug": "fraud",
    "Brandstiftung": "arson",
    "Sachbeschädigung": "vandalism",
    "Verkehrsunfall": "traffic",
    "Fahrerflucht": "traffic",
    "Trunkenheit": "traffic",
    "Drogen": "drugs",
    "Vermisst": "missing_person",
    "Versammlung": "other",
    "Verkehrskontrolle": "traffic",
    "Sonstige": "other",
}


def make_id(url: str, published_at: str, location_text: str = "") -> str:
    """Generate a deterministic ID from URL + timestamp + location.

    The location_text disambiguates multiple incidents from the same article.
    """
    raw = f"{url}:{published_at}:{location_text}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def map_category(crime: dict) -> list[str]:
    """Map PKS code/category to CrimeCategory enum values."""
    pks_code = crime.get("pks_code", "")
    pks_category = crime.get("pks_category", "")

    # Try PKS code first
    cat = PKS_TO_CATEGORY.get(pks_code)
    if cat:
        return [cat]

    # Try German category name
    cat = GERMAN_TO_CATEGORY.get(pks_category)
    if cat:
        return [cat]

    return ["other"]


def map_precision(article: dict) -> str:
    """Determine location precision from confidence and available data."""
    loc = article.get("location", {})
    confidence = loc.get("confidence", 0)
    street = loc.get("street")

    if street and confidence >= 0.8:
        return "street"
    if street and confidence >= 0.5:
        return "neighborhood"
    if loc.get("city"):
        return "city"
    return "unknown"


def build_location_text(article: dict) -> str | None:
    """Build human-readable location string."""
    loc = article.get("location", {})
    parts = []
    if loc.get("street"):
        s = loc["street"]
        if loc.get("house_number"):
            s += f" {loc['house_number']}"
        parts.append(s)
    if loc.get("district"):
        parts.append(loc["district"])
    if loc.get("city"):
        parts.append(loc["city"])
    return ", ".join(parts) if parts else None


def sanitize_timestamp(ts: str) -> str:
    """Ensure valid ISO timestamp format."""
    if not ts:
        return "2026-01-01T00:00:00"
    if "unknown" in ts:
        ts = ts.replace("Tunknown:00", "T00:00:00")
    if "T" not in ts:
        ts += "T00:00:00"
    return ts


def transform_article(article: dict) -> dict | None:
    """Transform enriched article to Supabase crime_records row."""
    loc = article.get("location", {})
    crime = article.get("crime", {})
    details = article.get("details", {})

    # Skip articles without coordinates
    lat = loc.get("lat")
    lon = loc.get("lon")
    if lat is None or lon is None:
        return None

    url = article.get("url", "")
    published_at = sanitize_timestamp(article.get("date", ""))

    # Extract weapon_type from details, validate against known values
    weapon_type = details.get("weapon_type")
    valid_weapons = {"knife", "gun", "blunt", "explosive", "vehicle", "none", "unknown"}
    if weapon_type not in valid_weapons:
        weapon_type = None

    location_text = build_location_text(article)

    return {
        "id": make_id(url, published_at, location_text or ""),
        "title": article.get("title", ""),
        "summary": None,
        "body": article.get("body"),
        "published_at": published_at,
        "source_url": url,
        "source_agency": article.get("source"),
        "location_text": location_text,
        "latitude": lat,
        "longitude": lon,
        "precision": map_precision(article),
        "categories": map_category(crime),
        "weapon_type": weapon_type,
        "confidence": loc.get("confidence", 0.5),
    }


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Push enriched data to Supabase")
    parser.add_argument(
        "--input", "-i",
        default="data/pipeline/chunks/enriched/test_llm_coords.json",
        help="Input enriched JSON file",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview without uploading")
    parser.add_argument("--batch-size", type=int, default=500, help="Records per batch")
    args = parser.parse_args()

    # Load enriched data
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}")
        sys.exit(1)

    articles = json.load(open(input_path, encoding="utf-8"))
    print(f"Loaded {len(articles)} articles from {input_path}")

    # Transform
    rows = []
    skipped = 0
    for art in articles:
        row = transform_article(art)
        if row:
            rows.append(row)
        else:
            skipped += 1

    print(f"Transformed {len(rows)} records ({skipped} skipped - no coordinates)")

    # Category distribution
    from collections import Counter
    cats = Counter(cat for r in rows for cat in r["categories"])
    print("\nCategory distribution:")
    for cat, count in cats.most_common():
        print(f"  {count:3d} {cat}")

    if args.dry_run:
        print("\n[DRY RUN] Would upload these records. Sample:")
        for row in rows[:3]:
            print(f"  {row['id'][:8]}... | {row['title'][:50]} | ({row['latitude']}, {row['longitude']}) | {row['categories']}")
        print(f"\n[DRY RUN] Total: {len(rows)} records ready for upload")
        return

    # Connect to Supabase
    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )

    if not supabase_url or not supabase_key:
        print("ERROR: Missing Supabase credentials")
        print(f"  NEXT_PUBLIC_SUPABASE_URL: {'set' if supabase_url else 'MISSING'}")
        print(f"  SUPABASE_SERVICE_ROLE_KEY: {'set' if supabase_key else 'MISSING'}")
        sys.exit(1)

    print(f"\nConnecting to Supabase: {supabase_url}")
    supabase = create_client(supabase_url, supabase_key)

    # Batch upsert
    total_batches = (len(rows) + args.batch_size - 1) // args.batch_size
    inserted = 0
    errors = 0

    print(f"Uploading {len(rows)} records in {total_batches} batches...")

    for i in range(total_batches):
        start = i * args.batch_size
        end = min(start + args.batch_size, len(rows))
        batch = rows[start:end]

        try:
            supabase.table("crime_records").upsert(batch).execute()
            inserted += len(batch)
            print(f"  Batch {i + 1}/{total_batches}: {inserted}/{len(rows)} records uploaded")
        except Exception as e:
            errors += len(batch)
            print(f"  Batch {i + 1}/{total_batches} FAILED: {e}")

    # Verify
    result = supabase.table("crime_records").select("id", count="exact").execute()
    total_in_db = result.count if result.count is not None else "?"

    print(f"\nUpload complete!")
    print(f"  Inserted/updated: {inserted}")
    print(f"  Errors: {errors}")
    print(f"  Total records in database: {total_in_db}")


if __name__ == "__main__":
    main()
