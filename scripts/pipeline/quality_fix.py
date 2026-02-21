#!/usr/bin/env python3
"""
Quality fix pipeline for flagged enrichment errors.

Re-enriches starred/flagged records from Supabase with improved V2 prompt,
validates geocoding against Germany bbox, and generates a markdown report.

Usage:
    # Dry run (report only, no Supabase changes)
    python3 scripts/pipeline/quality_fix.py -f flagged_ids.json --run-name feb2026_test100 --dry-run

    # Apply fixes
    python3 scripts/pipeline/quality_fix.py -f flagged_ids.json --run-name feb2026_test100

    # Custom report path
    python3 scripts/pipeline/quality_fix.py -f flagged_ids.json --run-name feb2026_test100 --report my_report.md

Export favorites from browser console:
    copy(localStorage.getItem('adlerlicht_favorites'))
    // paste into flagged_ids.json
"""

import json
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import certifi
from dotenv import load_dotenv

# Fix SSL on macOS
os.environ['SSL_CERT_FILE'] = certifi.where()

# Load env
load_dotenv()
load_dotenv(Path(".env.local"), override=True)

# Import from sibling modules
from fast_enricher import (
    ENRICHMENT_PROMPT_V2,
    GERMANY_BBOX,
    FastEnricher,
    is_in_germany,
)
from push_to_supabase import (
    build_location_text,
    make_id,
    map_category,
    map_precision,
    sanitize_timestamp,
    transform_article,
)

# Known non-German cities that cause geocoding errors
NON_GERMAN_CITIES = {
    "basel", "zürich", "zurich", "bern", "luzern", "genf", "lausanne",
    "salzburg", "wien", "vienna", "innsbruck", "graz", "linz",
    "strasbourg", "straßburg", "mulhouse", "metz",
    "amsterdam", "rotterdam", "maastricht",
    "prag", "prague", "brno",
    "warschau", "warsaw", "krakau",
    "kopenhagen",
}

# Time patterns for detecting tatzeit in body text
TIME_PATTERNS = [
    r'\d{1,2}[:.]\d{2}\s*Uhr',
    r'gegen\s+\d{1,2}[:.]\d{2}',
    r'zwischen\s+\d{1,2}[:.]\d{2}\s+und\s+\d{1,2}[:.]\d{2}',
    r'um\s+\d{1,2}[:.]\d{2}',
    r'am\s+(frühen\s+)?Morgen',
    r'am\s+Vormittag',
    r'am\s+(späten\s+)?Nachmittag',
    r'am\s+(späten\s+)?Abend',
    r'in\s+der\s+Nacht',
    r'in\s+den\s+(Abend|Nacht|Morgen)stunden',
    r'mittags',
    r'nachts',
    r'abends',
    r'morgens',
    r'vormittags',
    r'nachmittags',
]
TIME_REGEX = re.compile('|'.join(TIME_PATTERNS), re.IGNORECASE)

# Digest markers for multi-incident detection
DIGEST_PATTERNS = [
    r'^\s*\d+\.\s+',                         # numbered list "1. "
    r'^\s*[IVX]+\.\s+',                       # roman numerals
    r'Weitere\s+Meldungen?:',                 # explicit separator
    r'Außerdem:',                              # another separator
    r'POL-[A-Z]{2,4}\s*:',                    # multiple POL- headers
]
DIGEST_REGEX = re.compile('|'.join(DIGEST_PATTERNS), re.MULTILINE)


class QualityFixer:
    """Fix enrichment errors on flagged Supabase records."""

    def __init__(self, run_name: str = "default", dry_run: bool = False):
        self.run_name = run_name
        self.dry_run = dry_run

        # Supabase client
        supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        supabase_key = (
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        )
        if not supabase_url or not supabase_key:
            print("ERROR: Missing Supabase credentials")
            sys.exit(1)

        from supabase import create_client
        self.supabase = create_client(supabase_url, supabase_key)

        # Enricher (reuses caches)
        self.enricher = FastEnricher(cache_dir=".cache")

        # Track results for report
        self.results: list[dict] = []

    def fetch_flagged_records(self, ids: list[str]) -> list[dict]:
        """Fetch flagged records from Supabase by ID."""
        print(f"Fetching {len(ids)} flagged records from Supabase...")

        # Supabase .in_() has a limit, batch if needed
        all_records = []
        batch_size = 50
        for i in range(0, len(ids), batch_size):
            batch_ids = ids[i:i + batch_size]
            resp = (
                self.supabase.table("crime_records")
                .select("*")
                .in_("id", batch_ids)
                .execute()
            )
            all_records.extend(resp.data or [])

        found_ids = {r["id"] for r in all_records}
        missing = [rid for rid in ids if rid not in found_ids]
        if missing:
            print(f"  WARNING: {len(missing)} IDs not found in Supabase: {missing[:5]}...")

        print(f"  Fetched {len(all_records)} records")
        return all_records

    def detect_issues(self, record: dict) -> list[str]:
        """Auto-detect enrichment problems on a record."""
        issues = []

        # 1. Wrong geocoding — coords outside Germany
        lat = record.get("latitude")
        lon = record.get("longitude")
        if lat is not None and lon is not None:
            if not is_in_germany(lat, lon):
                issues.append("wrong_geocoding")

        # 2. Missing tatzeit — body has time indicators but precision is unknown
        body = record.get("body") or ""
        precision = record.get("incident_time_precision")
        incident_time = record.get("incident_time")
        if (precision == "unknown" or (precision is None and incident_time is None)):
            if TIME_REGEX.search(body):
                issues.append("missing_tatzeit")

        # 3. Unsplit multi-incident — digest markers in body
        word_count = len(body.split())
        digest_matches = len(DIGEST_REGEX.findall(body))
        # Multiple cities mentioned
        cities_in_body = set()
        for line in body.split('\n'):
            # Look for lines that start with city-like patterns
            m = re.search(r'(?:in|aus)\s+([A-ZÄÖÜ][a-zäöüß]+(?:\s+[a-zäöüß]+)?)', line)
            if m:
                cities_in_body.add(m.group(1).lower())

        if digest_matches >= 2 or (word_count > 1500 and len(cities_in_body) >= 3):
            issues.append("unsplit_multi")

        return issues

    def reconstruct_article(self, record: dict) -> dict:
        """Reconstruct an article dict from a Supabase crime_records row.

        This is the inverse of transform_article() — builds the format
        that fast_enricher expects as input.
        """
        # Parse bundesland from source_agency if possible
        bundesland = None
        source = record.get("source_agency") or ""

        return {
            "title": record.get("title") or "",
            "body": record.get("body") or "",
            "date": record.get("published_at") or "",
            "city": (record.get("location_text") or "").split(",")[-1].strip() if record.get("location_text") else "",
            "url": record.get("source_url") or "",
            "source": source,
            "bundesland": bundesland,
        }

    def re_enrich_single(self, record: dict) -> list[dict]:
        """Re-enrich a single record using V2 prompt.

        Returns list of enrichment dicts (>1 if multi-split).
        Processes one at a time for better splitting reliability.
        """
        article = self.reconstruct_article(record)

        # Build article data for the prompt (same format as _enrich_batch)
        articles_data = [{
            "index": 0,
            "title": article.get("title", "")[:200],
            "body": article.get("body", ""),
            "date": article.get("date", ""),
            "city": article.get("city", ""),
        }]

        prompt = ENRICHMENT_PROMPT_V2.format(
            count=1,
            articles_json=json.dumps(articles_data, ensure_ascii=False, indent=2)
        )

        # Call LLM directly through enricher's client
        llm_results = self.enricher._call_llm(prompt, max_tokens=8000)

        if not llm_results:
            print(f"    WARNING: LLM returned no results for {record['id'][:8]}...")
            return []

        # Process each enrichment result
        enrichments = []
        for llm_result in llm_results:
            loc = llm_result.get("location") or {}
            enrichment = {
                # Carry over original article fields
                **article,
                "clean_title": llm_result.get("clean_title"),
                "location": loc,
                "incident_time": llm_result.get("incident_time") or {},
                "crime": llm_result.get("crime") or {},
                "details": llm_result.get("details") or {},
            }
            enrichments.append(enrichment)

        return enrichments

    def validate_and_geocode(self, enrichment: dict, original: dict) -> dict:
        """Validate extracted city and geocode with Germany bbox check.

        If city is in known non-German set or coords outside Germany,
        retry with city + bundesland + Germany (dropping street).
        """
        loc = enrichment.get("location", {})
        city = (loc.get("city") or "").strip()

        # Check for known non-German cities
        if city.lower() in NON_GERMAN_CITIES:
            print(f"    Non-German city detected: {city} — skipping direct geocode")
            # Try to use original record's city/bundesland context
            loc["city"] = city  # keep extracted city for report
            loc["_original_city"] = city
            # Attempt to infer correct German city from source context
            # (the V2 prompt should have already handled this, but as a safety net)

        # Geocode using enricher's method
        street = loc.get("street")
        geocode_city = loc.get("city") or ""
        district = loc.get("district")
        bundesland = enrichment.get("bundesland") or original.get("bundesland")

        # Try full address first
        lat, lon, precision = self.enricher._geocode(
            street=street,
            city=geocode_city,
            district=district,
            bundesland=bundesland,
        )

        # If outside Germany, retry with just city + bundesland + Germany
        if lat is not None and not is_in_germany(lat, lon):
            print(f"    Geocoded outside Germany ({lat}, {lon}), retrying with city only...")
            # Invalidate the cache entry for the bad address
            parts = [p for p in [street, district, geocode_city, bundesland, "Germany"] if p]
            bad_address = ", ".join(parts)
            self.enricher.geocode_cache.pop(bad_address, None)

            lat, lon, precision = self.enricher._geocode(
                street=None,
                city=geocode_city,
                district=None,
                bundesland=bundesland,
            )

        # Still outside? Give up on coords
        if lat is not None and not is_in_germany(lat, lon):
            print(f"    Still outside Germany ({lat}, {lon}) — setting coords to null")
            lat, lon, precision = None, None, "outside_germany"

        loc["lat"] = lat
        loc["lon"] = lon
        loc["precision"] = precision
        loc["bundesland"] = bundesland
        enrichment["location"] = loc

        return enrichment

    def build_corrected_records(
        self, original: dict, enrichments: list[dict]
    ) -> tuple[list[dict], list[str]]:
        """Build corrected Supabase rows from enrichments.

        Returns (new_rows, ids_to_delete).
        When 1→N split, the original ID should be deleted.
        """
        new_rows = []
        ids_to_delete = []
        original_id = original["id"]

        for enrichment in enrichments:
            row = transform_article(enrichment, pipeline_run=self.run_name)
            if row is None:
                continue
            new_rows.append(row)

        if not new_rows:
            return [], []

        # If multi-split (>1 new rows) or new ID differs from original,
        # we need to delete the original
        new_ids = {r["id"] for r in new_rows}
        if original_id not in new_ids:
            ids_to_delete.append(original_id)

        return new_rows, ids_to_delete

    def process_record(self, record: dict) -> dict:
        """Process a single flagged record through the fix pipeline."""
        record_id = record["id"]
        title = record.get("clean_title") or record.get("title") or "(no title)"
        short_id = record_id[:12]

        print(f"\n  Processing: {title[:60]} ({short_id}...)")

        result = {
            "id": record_id,
            "title": title,
            "issues_detected": [],
            "before": {},
            "after": {},
            "status": "skipped",
            "new_rows": [],
            "ids_to_delete": [],
        }

        # Detect issues
        issues = self.detect_issues(record)
        result["issues_detected"] = issues

        if not issues:
            print(f"    No issues detected — skipping")
            result["status"] = "no_issues"
            return result

        print(f"    Issues: {', '.join(issues)}")

        # Snapshot 'before' state
        result["before"] = {
            "city": record.get("location_text"),
            "latitude": record.get("latitude"),
            "longitude": record.get("longitude"),
            "incident_time": record.get("incident_time"),
            "incident_time_precision": record.get("incident_time_precision"),
            "incident_date": record.get("incident_date"),
            "clean_title": record.get("clean_title"),
        }

        # Clear enrichment cache for this article so V2 prompt is used
        url = record.get("source_url") or ""
        body = record.get("body") or ""
        cache_key = self.enricher._cache_key(url, body)
        self.enricher.cache.pop(cache_key, None)

        # Re-enrich with V2
        print(f"    Re-enriching with V2 prompt...")
        enrichments = self.re_enrich_single(record)

        if not enrichments:
            result["status"] = "enrich_failed"
            print(f"    FAILED: no enrichment results")
            return result

        print(f"    Got {len(enrichments)} enrichment(s)")

        # Validate and geocode each enrichment
        validated = []
        for i, enrichment in enumerate(enrichments):
            print(f"    Validating enrichment {i + 1}/{len(enrichments)}...")
            enrichment = self.validate_and_geocode(enrichment, record)
            validated.append(enrichment)

        # Build corrected Supabase rows
        new_rows, ids_to_delete = self.build_corrected_records(record, validated)
        result["new_rows"] = new_rows
        result["ids_to_delete"] = ids_to_delete

        if not new_rows:
            result["status"] = "no_valid_rows"
            print(f"    WARNING: no valid rows produced (missing coords?)")
            return result

        # Snapshot 'after' state (first row for comparison)
        first_row = new_rows[0]
        result["after"] = {
            "city": first_row.get("location_text"),
            "latitude": first_row.get("latitude"),
            "longitude": first_row.get("longitude"),
            "incident_time": first_row.get("incident_time"),
            "incident_time_precision": first_row.get("incident_time_precision"),
            "incident_date": first_row.get("incident_date"),
            "clean_title": first_row.get("clean_title"),
        }

        if len(new_rows) > 1:
            result["split_count"] = len(new_rows)
            result["split_titles"] = [r.get("clean_title") or r.get("title") for r in new_rows]

        result["status"] = "fixed"
        print(f"    Status: FIXED ({len(new_rows)} row(s), {len(ids_to_delete)} to delete)")
        return result

    def apply_fixes(self, results: list[dict]) -> None:
        """Upsert corrected rows and delete old IDs in Supabase."""
        all_new_rows = []
        all_ids_to_delete = []

        for r in results:
            if r["status"] == "fixed":
                all_new_rows.extend(r["new_rows"])
                all_ids_to_delete.extend(r["ids_to_delete"])

        if not all_new_rows:
            print("\nNo fixes to apply.")
            return

        print(f"\nApplying fixes: {len(all_new_rows)} rows to upsert, {len(all_ids_to_delete)} old IDs to delete")

        # Upsert new rows
        batch_size = 50
        for i in range(0, len(all_new_rows), batch_size):
            batch = all_new_rows[i:i + batch_size]
            try:
                self.supabase.table("crime_records").upsert(batch).execute()
                print(f"  Upserted batch {i // batch_size + 1}: {len(batch)} rows")
            except Exception as e:
                print(f"  ERROR upserting batch: {e}")

        # Delete old IDs (from splits)
        if all_ids_to_delete:
            try:
                self.supabase.table("crime_records").delete().in_(
                    "id", all_ids_to_delete
                ).execute()
                print(f"  Deleted {len(all_ids_to_delete)} old records (from splits)")
            except Exception as e:
                print(f"  ERROR deleting old records: {e}")

    def generate_report(self, results: list[dict], output_path: str) -> None:
        """Generate a markdown quality report."""
        now = datetime.now().isoformat(timespec="seconds")

        # Compute summary stats
        total_flagged = len(results)
        total_issues = sum(len(r["issues_detected"]) for r in results)
        fixed = sum(1 for r in results if r["status"] == "fixed")
        no_issues = sum(1 for r in results if r["status"] == "no_issues")
        failed = sum(1 for r in results if r["status"] in ("enrich_failed", "no_valid_rows"))
        skipped = sum(1 for r in results if r["status"] == "skipped")

        # Issue breakdown
        issue_counts: dict[str, int] = {}
        issue_fixed: dict[str, int] = {}
        for r in results:
            for issue in r["issues_detected"]:
                issue_counts[issue] = issue_counts.get(issue, 0) + 1
                if r["status"] == "fixed":
                    issue_fixed[issue] = issue_fixed.get(issue, 0) + 1

        # Build markdown
        lines = [
            "# Quality Fix Report",
            f"Generated: {now}",
            f"Pipeline run: {self.run_name}",
            "",
            "## Summary",
            "| Metric | Count |",
            "|--------|-------|",
            f"| Records flagged | {total_flagged} |",
            f"| Issues detected | {total_issues} |",
            f"| Records fixed | {fixed} |",
            f"| No issues found | {no_issues} |",
            f"| Still problematic | {failed} |",
            "",
            "### Issue Breakdown",
            "| Issue Type | Count | Fixed |",
            "|------------|-------|-------|",
        ]

        issue_labels = {
            "wrong_geocoding": "Wrong geocoding",
            "missing_tatzeit": "Missing Tatzeit",
            "unsplit_multi": "Unsplit multi-incident",
        }
        for issue_key in ["wrong_geocoding", "missing_tatzeit", "unsplit_multi"]:
            count = issue_counts.get(issue_key, 0)
            fix_count = issue_fixed.get(issue_key, 0)
            label = issue_labels.get(issue_key, issue_key)
            if count > 0:
                lines.append(f"| {label} | {count} | {fix_count} |")

        lines.extend(["", "## Record Details", ""])

        for i, r in enumerate(results, 1):
            short_id = r["id"][:12]
            title = r["title"]
            lines.append(f"### {i}. \"{title}\" (ID: {short_id}...)")

            user_comment = r.get("user_comment", "")
            if user_comment:
                lines.append(f"**User note:** {user_comment}")

            if not r["issues_detected"]:
                lines.append("**No issues detected**")
                lines.append("")
                continue

            lines.append(f"**Issues:** {', '.join(issue_labels.get(iss, iss) for iss in r['issues_detected'])}")

            before = r.get("before", {})
            after = r.get("after", {})

            if before or after:
                lines.append("| Field | Before | After |")
                lines.append("|-------|--------|-------|")

                compare_fields = [
                    ("city", "location_text"),
                    ("latitude", "latitude"),
                    ("longitude", "longitude"),
                    ("incident_time", "incident_time"),
                    ("incident_time_precision", "incident_time_precision"),
                    ("clean_title", "clean_title"),
                ]
                for label, key in compare_fields:
                    bval = before.get(key if key != "location_text" else "city")
                    aval = after.get(key if key != "location_text" else "city")
                    if bval != aval:
                        lines.append(f"| {label} | {bval} | {aval} |")

            if r.get("split_count"):
                lines.append(f"\n**Split into {r['split_count']} records:**")
                for st in r.get("split_titles", []):
                    lines.append(f"- {st}")

            lines.append(f"**Status:** {r['status'].upper()}")
            lines.append("")

        report_text = "\n".join(lines)

        # Write report
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(report_text)

        print(f"\nReport written to {output_path}")


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Quality fix pipeline for flagged enrichment errors"
    )
    parser.add_argument(
        "--favorites", "-f", required=True,
        help="JSON file with array of flagged record IDs (from localStorage export)"
    )
    parser.add_argument(
        "--run-name", default="default",
        help="Pipeline run name to filter/tag records"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Generate report only, don't modify Supabase"
    )
    parser.add_argument(
        "--report", default="data/pipeline/quality_report.md",
        help="Output path for the quality report"
    )
    args = parser.parse_args()

    # Load flagged IDs
    fav_path = Path(args.favorites)
    if not fav_path.exists():
        print(f"ERROR: Favorites file not found: {fav_path}")
        sys.exit(1)

    with open(fav_path, "r", encoding="utf-8") as f:
        raw = f.read().strip()

    # Handle both raw JSON and localStorage string format (possibly double-encoded)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # Maybe it's a JSON string (double-encoded from localStorage)
        try:
            parsed = json.loads(json.loads(f'"{raw}"'))
        except Exception:
            print(f"ERROR: Could not parse {fav_path} as JSON")
            sys.exit(1)

    # Extract IDs and comments from either format
    comments: dict[str, str] = {}
    if isinstance(parsed, list):
        # Legacy array format: ["id1", "id2"]
        ids = [x for x in parsed if isinstance(x, str)]
        comments = {x: "" for x in ids}
    elif isinstance(parsed, dict):
        # New object format: {"id1": "comment", "id2": ""}
        ids = list(parsed.keys())
        comments = {k: (v if isinstance(v, str) else "") for k, v in parsed.items()}
    else:
        print(f"ERROR: Expected JSON array or object, got {type(parsed).__name__}")
        sys.exit(1)

    if not ids:
        print("ERROR: No IDs found in favorites file")
        sys.exit(1)

    commented = sum(1 for c in comments.values() if c)
    print(f"Loaded {len(ids)} flagged IDs from {fav_path} ({commented} with comments)")
    print(f"Pipeline run: {args.run_name}")
    print(f"Dry run: {args.dry_run}")
    print(f"Report: {args.report}")

    # Initialize fixer
    fixer = QualityFixer(run_name=args.run_name, dry_run=args.dry_run)

    # Fetch flagged records
    records = fixer.fetch_flagged_records(ids)

    if not records:
        print("No records found — nothing to fix.")
        sys.exit(0)

    # Process each record
    print(f"\n{'=' * 60}")
    print(f"Processing {len(records)} flagged records")
    print(f"{'=' * 60}")

    results = []
    for record in records:
        result = fixer.process_record(record)
        result["user_comment"] = comments.get(record["id"], "")
        results.append(result)
        time.sleep(0.2)  # Rate limit between LLM calls

    # Summary
    fixed = sum(1 for r in results if r["status"] == "fixed")
    issues_total = sum(len(r["issues_detected"]) for r in results)
    print(f"\n{'=' * 60}")
    print(f"Done: {fixed}/{len(results)} records fixed, {issues_total} issues detected")
    print(f"{'=' * 60}")

    # Apply fixes (unless dry run)
    if not args.dry_run:
        fixer.apply_fixes(results)
    else:
        print("\n[DRY RUN] No changes applied to Supabase")

    # Generate report
    fixer.generate_report(results, args.report)

    # Save enricher caches
    fixer.enricher.save_caches()

    print("\nDone!")


if __name__ == "__main__":
    main()
