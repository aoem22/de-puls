#!/usr/bin/env python3
"""
Push enriched data to Supabase crime_records table.

Transforms the enriched JSON format to the Supabase schema and batch-upserts records.
Supports single-file mode (--input) or directory scanning (--input-dir) with optional
year filtering (--year).

Usage:
    python3 scripts/pipeline/push_to_supabase.py --input-dir data/pipeline/chunks/enriched/ --year 2026 --dry-run
    python3 scripts/pipeline/push_to_supabase.py --input-dir data/pipeline/chunks/enriched/ --year 2026 --run-name v1_2026
    python3 scripts/pipeline/push_to_supabase.py --input path/to/enriched.json
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
    # Other violence
    "6200": "assault",  # Widerstand gegen Vollstreckungsbeamte
    # Traffic
    "7400": "traffic",  # Unerlaubtes Entfernen vom Unfallort
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


def make_id(url: str, published_at: str, location_text: str = "", pks_code: str = "", pipeline_run: str = "default") -> str:
    """Generate a deterministic ID from URL + timestamp + location + crime type + run.

    The location_text and pks_code disambiguate multiple incidents from the same article.
    The pipeline_run ensures records from different experiment runs don't collide.
    """
    raw = f"{url}:{published_at}:{location_text}:{pks_code}:{pipeline_run}"
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


def transform_article(article: dict, pipeline_run: str = "default") -> dict | None:
    """Transform enriched article to Supabase crime_records row."""
    loc = article.get("location", {})
    crime = article.get("crime", {})
    if isinstance(crime, list):
        crime = crime[0] if crime else {}
    details = article.get("details", {})

    lat = loc.get("lat")
    lon = loc.get("lon")

    url = article.get("url", "")
    published_at = sanitize_timestamp(article.get("date", ""))

    # Extract weapon_type from details, validate against known values
    weapon_type = details.get("weapon_type")
    valid_weapons = {"knife", "gun", "blunt", "explosive", "vehicle", "none", "unknown"}
    if weapon_type not in valid_weapons:
        weapon_type = None

    # Extract drug_type, validate against known values
    drug_type = details.get("drug_type")
    valid_drugs = {"cannabis", "cocaine", "amphetamine", "heroin", "ecstasy", "meth", "other"}
    if drug_type not in valid_drugs:
        drug_type = None

    # Extract counts, validate as non-negative ints
    victim_count = details.get("victim_count")
    if isinstance(victim_count, (int, float)) and victim_count >= 0:
        victim_count = int(victim_count)
    else:
        victim_count = None

    suspect_count = details.get("suspect_count")
    if isinstance(suspect_count, (int, float)) and suspect_count >= 0:
        suspect_count = int(suspect_count)
    else:
        suspect_count = None

    # Ages as strings (can be "34", "30-35", "Kind")
    victim_age = details.get("victim_age")
    if not isinstance(victim_age, str) or not victim_age.strip():
        victim_age = None

    suspect_age = details.get("suspect_age")
    if not isinstance(suspect_age, str) or not suspect_age.strip():
        suspect_age = None

    # Gender fields
    valid_genders = {"male", "female", "unknown"}
    victim_gender = details.get("victim_gender")
    if victim_gender not in valid_genders:
        victim_gender = None

    suspect_gender = details.get("suspect_gender")
    if suspect_gender not in valid_genders:
        suspect_gender = None

    # Herkunft fields — any non-empty string or null
    victim_herkunft = details.get("victim_herkunft")
    if not isinstance(victim_herkunft, str) or not victim_herkunft.strip():
        victim_herkunft = None

    suspect_herkunft = details.get("suspect_herkunft")
    if not isinstance(suspect_herkunft, str) or not suspect_herkunft.strip():
        suspect_herkunft = None

    # Person description fields (free-text from police report)
    victim_description = details.get("victim_description")
    if not isinstance(victim_description, str) or not victim_description.strip():
        victim_description = None

    suspect_description = details.get("suspect_description")
    if not isinstance(suspect_description, str) or not suspect_description.strip():
        suspect_description = None

    # Severity, validate against known values
    severity = details.get("severity")
    valid_severities = {"minor", "serious", "critical", "fatal", "property_only", "unknown"}
    if severity not in valid_severities:
        severity = None

    # Motive, validate against known values
    motive = details.get("motive")
    valid_motives = {"domestic", "robbery", "hate", "drugs", "road_rage", "dispute", "unknown"}
    if motive not in valid_motives:
        motive = None

    # Damage amount in EUR, validate as non-negative int
    damage_amount_eur = details.get("damage_amount_eur")
    if isinstance(damage_amount_eur, (int, float)) and damage_amount_eur >= 0:
        damage_amount_eur = int(damage_amount_eur)
    else:
        damage_amount_eur = None

    # Damage estimate precision
    damage_estimate = details.get("damage_estimate")
    valid_estimates = {"exact", "approximate", "unknown"}
    if damage_estimate not in valid_estimates:
        damage_estimate = None

    # Incident time fields (prompt outputs start_date/start_time/end_date/end_time)
    incident_time_obj = article.get("incident_time", {})
    incident_date = incident_time_obj.get("start_date") or incident_time_obj.get("date")
    if not isinstance(incident_date, str) or not incident_date.strip():
        incident_date = None

    incident_time = incident_time_obj.get("start_time") or incident_time_obj.get("time")
    if not isinstance(incident_time, str) or not incident_time.strip():
        incident_time = None

    incident_end_date = incident_time_obj.get("end_date")
    if not isinstance(incident_end_date, str) or not incident_end_date.strip():
        incident_end_date = None

    incident_end_time = incident_time_obj.get("end_time")
    if not isinstance(incident_end_time, str) or not incident_end_time.strip():
        incident_end_time = None

    incident_time_precision = incident_time_obj.get("precision")
    valid_precisions = {"exact", "approximate", "unknown"}
    if incident_time_precision not in valid_precisions:
        incident_time_precision = None

    # Crime sub-fields
    crime_sub_type = crime.get("sub_type")
    if not isinstance(crime_sub_type, str) or not crime_sub_type.strip():
        crime_sub_type = None

    crime_confidence = crime.get("confidence")
    if isinstance(crime_confidence, (int, float)) and 0 <= crime_confidence <= 1:
        crime_confidence = float(crime_confidence)
    else:
        crime_confidence = None

    location_text = build_location_text(article)

    pks_code = crime.get("pks_code", "")

    # Incident grouping fields (from filter_articles.py)
    incident_group_id = article.get("incident_group_id")
    group_role = article.get("group_role")
    valid_group_roles = {"primary", "follow_up", "update", "resolution", "related"}
    if group_role not in valid_group_roles:
        group_role = None

    # Clean title from AI enrichment
    clean_title = article.get("clean_title")
    if not isinstance(clean_title, str) or not clean_title.strip():
        clean_title = None

    return {
        "id": make_id(url, published_at, location_text or "", pks_code, pipeline_run),
        "title": article.get("title", ""),
        "clean_title": clean_title,
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
        "incident_date": incident_date,
        "incident_time": incident_time,
        "incident_time_precision": incident_time_precision,
        "incident_end_date": incident_end_date,
        "incident_end_time": incident_end_time,
        "crime_sub_type": crime_sub_type,
        "crime_confidence": crime_confidence,
        "drug_type": drug_type,
        "victim_count": victim_count,
        "suspect_count": suspect_count,
        "victim_age": victim_age,
        "suspect_age": suspect_age,
        "victim_gender": victim_gender,
        "suspect_gender": suspect_gender,
        "victim_herkunft": victim_herkunft,
        "suspect_herkunft": suspect_herkunft,
        "victim_description": victim_description,
        "suspect_description": suspect_description,
        "severity": severity,
        "motive": motive,
        "damage_amount_eur": damage_amount_eur,
        "damage_estimate": damage_estimate,
        "incident_group_id": incident_group_id,
        "group_role": group_role,
        "pipeline_run": pipeline_run,
        "classification": article.get("classification"),
    }


def collect_articles_from_dir(dir_path: Path, year: str | None = None) -> list[dict]:
    """Scan a directory tree for enriched JSON files and collect all articles.

    Args:
        dir_path: Root directory to scan (e.g. chunks/enriched/)
        year: If set, only load files from */{year}/*.json subdirectories
    """
    articles = []
    files_loaded = 0
    for json_file in sorted(dir_path.rglob("*.json")):
        # Year filter: check if the file is inside a /{year}/ directory
        if year and f"/{year}/" not in str(json_file):
            continue
        try:
            data = json.load(open(json_file, encoding="utf-8"))
            if isinstance(data, list) and len(data) > 0:
                articles.extend(data)
                files_loaded += 1
        except (json.JSONDecodeError, OSError) as e:
            print(f"  WARN: skipping {json_file}: {e}")
    print(f"Scanned {files_loaded} files from {dir_path}" + (f" (year={year})" if year else ""))
    return articles


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Push enriched data to Supabase")
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--input", "-i",
        help="Input enriched JSON file (single file mode)",
    )
    group.add_argument(
        "--input-dir",
        help="Input directory to scan for enriched JSON files (recursive)",
    )
    parser.add_argument("--year", help="Only load files from this year (e.g. 2026)")
    parser.add_argument("--dry-run", action="store_true", help="Preview without uploading")
    parser.add_argument("--batch-size", type=int, default=500, help="Records per batch")
    parser.add_argument("--run-name", default="default", help="Pipeline run name for A/B experiments")
    args = parser.parse_args()

    # Load enriched data
    if args.input_dir:
        dir_path = Path(args.input_dir)
        if not dir_path.is_dir():
            print(f"ERROR: Directory not found: {dir_path}")
            sys.exit(1)
        articles = collect_articles_from_dir(dir_path, year=args.year)
    elif args.input:
        input_path = Path(args.input)
        if not input_path.exists():
            print(f"ERROR: Input file not found: {input_path}")
            sys.exit(1)
        articles = json.load(open(input_path, encoding="utf-8"))
        print(f"Loaded {len(articles)} articles from {input_path}")
    else:
        # Default: scan CHUNKS_ENRICHED_DIR
        from scripts.pipeline.config import CHUNKS_ENRICHED_DIR
        articles = collect_articles_from_dir(CHUNKS_ENRICHED_DIR, year=args.year)

    print(f"Total articles: {len(articles)}")
    print(f"Pipeline run: {args.run_name}")

    # Transform and deduplicate by ID (multi-incident articles can produce dupes)
    rows = []
    seen_ids: set[str] = set()
    skipped = 0
    dupes = 0
    for art in articles:
        row = transform_article(art, pipeline_run=args.run_name)
        if row:
            if row["id"] in seen_ids:
                dupes += 1
                continue
            seen_ids.add(row["id"])
            rows.append(row)
        else:
            skipped += 1

    no_coords = sum(1 for r in rows if r["latitude"] is None or r["longitude"] is None)
    print(f"Transformed {len(rows)} records ({skipped} skipped, {dupes} deduped, {no_coords} without coords)")

    # Category distribution
    from collections import Counter
    cats = Counter(cat for r in rows for cat in r["categories"])
    print("\nCategory distribution:")
    for cat, count in cats.most_common():
        print(f"  {count:3d} {cat}")

    if args.dry_run:
        print("\n[DRY RUN] Would upload these records. Sample:")
        for row in rows[:3]:
            coords = f"({row['latitude']}, {row['longitude']})" if row['latitude'] else "(no coords)"
            print(f"  {row['id'][:8]}... | {row['title'][:50]} | {coords} | {row['categories']}")
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
