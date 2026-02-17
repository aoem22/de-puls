#!/usr/bin/env python3
"""
Backfill the new dashboard columns (city, bundesland, kreis_ags, kreis_name,
pks_category, damage_amount_eur) for existing crime_records in Supabase.

Re-reads the enriched JSON files, extracts the missing fields, computes
kreis_ags/kreis_name via point-in-polygon against the local kreise.json,
and batch-updates matching rows by ID.

Usage:
    python3 scripts/pipeline/backfill_dashboard_columns.py --dry-run
    python3 scripts/pipeline/backfill_dashboard_columns.py --year 2026
    python3 scripts/pipeline/backfill_dashboard_columns.py --year 2026 --run-name v1_2026
"""
import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
load_dotenv(Path(".env.local"), override=True)

# Import make_id from push_to_supabase
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from scripts.pipeline.push_to_supabase import make_id, build_location_text, sanitize_timestamp, collect_articles_from_dir


# ── Kreis lookup via point-in-polygon ──

KREISE_PATH = Path(__file__).resolve().parent.parent.parent / "lib" / "data" / "geo" / "kreise.json"

_kreis_index = None

def _load_kreis_index():
    global _kreis_index
    if _kreis_index is not None:
        return _kreis_index

    with open(KREISE_PATH, encoding="utf-8") as f:
        geojson = json.load(f)

    entries = []
    for feature in geojson.get("features", []):
        props = feature.get("properties", {})
        geo = feature.get("geometry", {})
        geo_type = geo.get("type")
        coords = geo.get("coordinates")
        if not coords or geo_type not in ("Polygon", "MultiPolygon"):
            continue
        # Compute bounding box
        all_rings = coords if geo_type == "Polygon" else [ring for poly in coords for ring in poly]
        lons = [p[0] for ring in all_rings for p in ring]
        lats = [p[1] for ring in all_rings for p in ring]
        entries.append({
            "ags": props.get("ags", ""),
            "name": props.get("name", ""),
            "type": geo_type,
            "coordinates": coords,
            "bbox": (min(lons), min(lats), max(lons), max(lats)),
        })

    _kreis_index = entries
    print(f"Loaded {len(entries)} kreis boundaries from {KREISE_PATH}")
    return entries


def _point_in_ring(lon, lat, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat):
            denom = yj - yi
            if denom != 0:
                x_cross = (xj - xi) * (lat - yi) / denom + xi
                if lon < x_cross:
                    inside = not inside
        j = i
    return inside


def _point_in_polygon(lon, lat, rings):
    if not rings:
        return False
    if not _point_in_ring(lon, lat, rings[0]):
        return False
    for i in range(1, len(rings)):
        if _point_in_ring(lon, lat, rings[i]):
            return False
    return True


def find_kreis(lon, lat):
    """Find which Kreis a point falls in. Returns (ags, name) or (None, None)."""
    for k in _load_kreis_index():
        bbox = k["bbox"]
        if lon < bbox[0] or lon > bbox[2] or lat < bbox[1] or lat > bbox[3]:
            continue
        if k["type"] == "Polygon":
            if _point_in_polygon(lon, lat, k["coordinates"]):
                return k["ags"], k["name"]
        else:  # MultiPolygon
            for poly in k["coordinates"]:
                if _point_in_polygon(lon, lat, poly):
                    return k["ags"], k["name"]
    return None, None


def extract_dashboard_fields(article, pipeline_run="default"):
    """Extract the dashboard-specific fields for a single article."""
    loc = article.get("location", {})
    crime = article.get("crime", {})
    if isinstance(crime, list):
        crime = crime[0] if crime else {}
    details = article.get("details", {})

    url = article.get("url", "")
    published_at = sanitize_timestamp(article.get("date", ""))
    location_text = build_location_text(article)
    pks_code = crime.get("pks_code", "")

    record_id = make_id(url, published_at, location_text or "", pks_code, pipeline_run)

    # City
    city = loc.get("city")
    if not isinstance(city, str) or not city.strip():
        city = None
    else:
        city = city.strip()

    # Bundesland
    bundesland = article.get("bundesland") or loc.get("bundesland")
    if not isinstance(bundesland, str) or not bundesland.strip():
        bundesland = None
    else:
        bundesland = bundesland.strip()

    # PKS category
    pks_category = crime.get("pks_category")
    if not isinstance(pks_category, str) or not pks_category.strip():
        pks_category = None

    # Kreis via point-in-polygon
    lat = loc.get("lat")
    lon = loc.get("lon")
    kreis_ags, kreis_name = None, None
    if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
        kreis_ags, kreis_name = find_kreis(lon, lat)

    # Damage amount
    damage_amount_eur = details.get("damage_amount_eur")
    if isinstance(damage_amount_eur, (int, float)) and damage_amount_eur >= 0:
        damage_amount_eur = int(damage_amount_eur)
    else:
        damage_amount_eur = None

    return {
        "id": record_id,
        "city": city,
        "bundesland": bundesland,
        "kreis_ags": kreis_ags,
        "kreis_name": kreis_name,
        "pks_category": pks_category,
        "damage_amount_eur": damage_amount_eur,
    }


def main():
    parser = argparse.ArgumentParser(description="Backfill dashboard columns in Supabase crime_records")
    parser.add_argument("--input-dir", default="data/pipeline/chunks/enriched",
                        help="Directory to scan for enriched JSON files")
    parser.add_argument("--year", default=None, help="Only process files from this year")
    parser.add_argument("--run-name", default="default", help="Pipeline run name (must match DB records)")
    parser.add_argument("--batch-size", type=int, default=500, help="Records per batch update")
    parser.add_argument("--dry-run", action="store_true", help="Preview without updating")
    parser.add_argument("--output-json", default=None, help="Write updates to JSON file instead of pushing to DB")
    args = parser.parse_args()

    dir_path = Path(args.input_dir)
    if not dir_path.is_dir():
        print(f"ERROR: Directory not found: {dir_path}")
        sys.exit(1)

    articles = collect_articles_from_dir(dir_path, year=args.year)
    print(f"Total articles: {len(articles)}")

    # Extract dashboard fields
    updates = []
    seen_ids = set()
    for art in articles:
        fields = extract_dashboard_fields(art, pipeline_run=args.run_name)
        if fields["id"] in seen_ids:
            continue
        seen_ids.add(fields["id"])
        # Only include if at least one field is non-null
        has_data = any(v is not None for k, v in fields.items() if k != "id")
        if has_data:
            updates.append(fields)

    with_city = sum(1 for u in updates if u["city"])
    with_bundesland = sum(1 for u in updates if u["bundesland"])
    with_kreis = sum(1 for u in updates if u["kreis_ags"])
    with_pks = sum(1 for u in updates if u["pks_category"])
    with_damage = sum(1 for u in updates if u["damage_amount_eur"] is not None)

    print(f"\nBackfill summary:")
    print(f"  Total updates: {len(updates)}")
    print(f"  With city: {with_city}")
    print(f"  With bundesland: {with_bundesland}")
    print(f"  With kreis: {with_kreis}")
    print(f"  With pks_category: {with_pks}")
    print(f"  With damage_amount_eur: {with_damage}")

    if args.dry_run:
        print("\n[DRY RUN] Sample updates:")
        for u in updates[:5]:
            print(f"  {u['id'][:8]}... city={u['city']}, bl={u['bundesland']}, "
                  f"kreis={u['kreis_ags']}, pks={u['pks_category']}, dmg={u['damage_amount_eur']}")
        print(f"\n[DRY RUN] Total: {len(updates)} records ready for backfill")
        return

    if args.output_json:
        # Write updates to JSON for bulk SQL execution via MCP or psql
        out_path = Path(args.output_json)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(updates, f)
        print(f"\nWrote {len(updates)} update records to {out_path}")
        print("Use this file with the Supabase SQL editor or MCP tool to run bulk UPDATEs.")
        return

    # Connect to Supabase
    from supabase import create_client

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )

    if not supabase_url or not supabase_key:
        print("ERROR: Missing Supabase credentials")
        sys.exit(1)

    print(f"\nConnecting to Supabase: {supabase_url}")
    supabase = create_client(supabase_url, supabase_key)

    # Batch update using individual update calls
    total_batches = (len(updates) + args.batch_size - 1) // args.batch_size
    updated = 0
    errors = 0

    print(f"Updating {len(updates)} records in {total_batches} batches...")

    for i in range(total_batches):
        start = i * args.batch_size
        end = min(start + args.batch_size, len(updates))
        batch = updates[start:end]

        try:
            for record in batch:
                record_id = record["id"]
                payload = {k: v for k, v in record.items() if k != "id"}
                supabase.table("crime_records").update(payload).eq("id", record_id).execute()
            updated += len(batch)
            if (i + 1) % 10 == 0 or (i + 1) == total_batches:
                print(f"  Batch {i + 1}/{total_batches}: {updated}/{len(updates)} records updated")
        except Exception as e:
            errors += len(batch)
            print(f"  Batch {i + 1}/{total_batches} FAILED: {e}")

    # Verify
    result = (
        supabase.table("crime_records")
        .select("id", count="exact")
        .not_.is_("city", "null")
        .execute()
    )
    city_count = result.count if result.count is not None else "?"

    print(f"\nBackfill complete!")
    print(f"  Updated: {updated}")
    print(f"  Errors: {errors}")
    print(f"  Records with city populated: {city_count}")


if __name__ == "__main__":
    main()
