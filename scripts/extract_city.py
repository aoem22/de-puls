#!/usr/bin/env python3
"""Extract records for a specific city from state-level JSON files.

Usage:
    python3 scripts/extract_city.py --state hessen --city darmstadt
    python3 scripts/extract_city.py --state hessen --city frankfurt --output data/pipeline/full/frankfurt/frankfurt_all.json
"""

import argparse
import glob
import json
import os
import sys


def main():
    parser = argparse.ArgumentParser(description="Extract city records from state JSON files")
    parser.add_argument("--state", required=True, help="State folder name (e.g. hessen)")
    parser.add_argument("--city", required=True, help="City name to filter (case-insensitive substring match)")
    parser.add_argument("--output", help="Output file path (default: data/pipeline/full/<city>/<city>_all.json)")
    args = parser.parse_args()

    base_dir = os.path.join(os.path.dirname(__file__), "..", "data", "pipeline", "full")
    state_dir = os.path.join(base_dir, args.state)

    if not os.path.isdir(state_dir):
        print(f"Error: state directory not found: {state_dir}")
        sys.exit(1)

    pattern = os.path.join(state_dir, f"{args.state}_*.json")
    files = sorted(glob.glob(pattern))

    if not files:
        print(f"Error: no files matching {pattern}")
        sys.exit(1)

    city_lower = args.city.lower()
    all_records = []
    total_scanned = 0

    print(f"Extracting '{args.city}' from {len(files)} {args.state} files...\n")
    print(f"{'Year':<6} {'Scanned':>8} {'Matched':>8}")
    print("-" * 26)

    for filepath in files:
        year = os.path.basename(filepath).replace(f"{args.state}_", "").replace(".json", "")
        with open(filepath, "r", encoding="utf-8") as f:
            records = json.load(f)

        matched = [r for r in records if city_lower in (r.get("city") or "").lower()]
        total_scanned += len(records)
        all_records.extend(matched)
        print(f"{year:<6} {len(records):>8} {len(matched):>8}")

    # Sort by date descending
    all_records.sort(key=lambda r: r.get("date") or "", reverse=True)

    print("-" * 26)
    print(f"{'Total':<6} {total_scanned:>8} {len(all_records):>8}")

    # Write output
    if args.output:
        out_path = args.output
    else:
        out_path = os.path.join(base_dir, args.city.lower(), f"{args.city.lower()}_all.json")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(all_records, f, ensure_ascii=False, indent=2)

    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    print(f"\nWrote {len(all_records)} records to {out_path} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
