#!/usr/bin/env python3
"""
Re-enrich München multi-record groups via LLM.

München "Medieninformation" articles bundle 3-8 incidents into a single article.
The enrichment pipeline splits them into separate crime_records, but the body text
for each record may contain the full digest instead of the relevant incident text.

This script:
1. Queries Supabase for München groups (same source_url, multiple records, identical body)
2. Reconstructs articles from DB data in the format FastEnricher expects
3. Evicts stale cache entries
4. Re-runs enrichment via FastEnricher
5. Updates each DB record's body with the LLM-provided incident_body

Usage:
    python3 scripts/pipeline/reenrich_munich.py --dry-run
    python3 scripts/pipeline/reenrich_munich.py
    python3 scripts/pipeline/reenrich_munich.py --limit 5
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import certifi
from dotenv import load_dotenv
from supabase import create_client

# Fix SSL on macOS
os.environ['SSL_CERT_FILE'] = certifi.where()

load_dotenv()
load_dotenv(Path(".env.local"), override=True)

# Import FastEnricher from the pipeline
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from scripts.pipeline.fast_enricher import FastEnricher


def cache_key(url: str, body: str) -> str:
    """Compute enrichment cache key — same as FastEnricher._cache_key."""
    return hashlib.sha256(f"{url}:{body}".encode()).hexdigest()[:16]


def fetch_munich_groups(supabase) -> dict[str, list[dict]]:
    """Fetch München multi-record groups where all records share identical body."""
    print("Querying München multi-record groups...")

    # Fetch all München records
    all_records = []
    page_size = 1000
    offset = 0
    while True:
        batch = (
            supabase.table("crime_records")
            .select("id, source_url, body, title, clean_title, published_at, source_agency, location_text, incident_date")
            .eq("source_agency", "Polizeipräsidium München")
            .order("source_url")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        if not batch.data:
            break
        all_records.extend(batch.data)
        offset += page_size
        if len(batch.data) < page_size:
            break

    print(f"  Fetched {len(all_records)} München records")

    # Group by source_url
    groups: dict[str, list[dict]] = {}
    for rec in all_records:
        url = rec.get("source_url", "")
        if url:
            groups.setdefault(url, []).append(rec)

    # Filter to multi-record groups where all bodies are identical
    identical_groups = {}
    for url, recs in groups.items():
        if len(recs) < 2:
            continue
        bodies = {r.get("body", "") for r in recs}
        if len(bodies) == 1:
            # All records share the same body — needs re-enrichment
            identical_groups[url] = recs

    return identical_groups


def strip_toc_preamble(body: str) -> str:
    """Strip numbered ToC lines and non-crime lead sections from München digests.

    München digest bodies have two problematic sections:
    1. Numbered ToC at the top (e.g. "234.  Festnahme nach Einbruch – Isarvorstadt")
    2. A non-crime feature article (prevention tips, event reports, anniversaries)
       that precedes the actual crime incident narratives.

    Both cause the LLM to misclassify the whole article as junk.
    """
    import re
    lines = body.split('\n')
    # Phase 1: Skip leading numbered ToC lines
    first_content = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if re.match(r'^\d{2,}\.\s{2,}', stripped):
            first_content = i + 1
            continue
        if stripped.lower().startswith('weitere informationen'):
            first_content = i + 1
            continue
        break

    if first_content > 0:
        body = '\n'.join(lines[first_content:]).strip()

    # Phase 2: Strip non-crime preamble before first incident narrative.
    # München incidents consistently start with "Am [Wochentag], DD.MM.YYYY".
    # If that pattern is far from the start (>1000 chars), the text before it
    # is likely a non-crime feature article (conference report, prevention tip, etc.)
    INCIDENT_START_RE = re.compile(
        r'Am\s+(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)'
    )
    m = INCIDENT_START_RE.search(body)
    if m and m.start() > 1000:
        body = body[m.start():]
        print(f"    Stripped {m.start()} char non-crime preamble")

    return body


def reconstruct_article(url: str, records: list[dict]) -> dict:
    """Reconstruct an article dict from DB records for FastEnricher input."""
    first = records[0]
    body = first.get("body", "")

    # Use the original Medieninformation title, not a single incident's clean_title
    title = first.get("title", "")

    # Strip ToC preamble that can cause junk misclassification
    body = strip_toc_preamble(body)

    # Prepend incident titles directly in the body so the LLM sees crime content
    # before any ambiguous narrative. This prevents REGEL 0 junk misclassification
    # when the first incident section happens to be non-crime (e.g. death without
    # Fremdeinwirkung, conference report).
    incident_titles = [r.get("clean_title") or r.get("title") or "" for r in records]
    incident_hint = "\n".join(f"- {t}" for t in incident_titles if t)
    if incident_hint:
        title = f"{title} [Sammelartikel mit {len(records)} Vorfällen]"
        body = (
            f"POLIZEI-SAMMELARTIKEL MIT {len(records)} KRIMINALVORFÄLLEN:\n"
            f"{incident_hint}\n\n"
            f"VORFALLBERICHTE:\n{body}"
        )

    return {
        "title": title,
        "body": body,
        "url": url,
        "date": first.get("published_at", ""),
        "source": "Polizeipräsidium München",
        "city": None,  # München articles have city=null in raw data
        "bundesland": "Bayern",
    }


def _title_tokens(title: str) -> set[str]:
    """Extract meaningful tokens from a title for fuzzy matching."""
    # Remove common noise words and punctuation
    noise = {"in", "der", "die", "das", "und", "mit", "von", "am", "an", "im", "zu", "nach",
             "bei", "für", "auf", "aus", "ein", "eine", "einem", "einen", "einer", "des",
             "dem", "den", "—", "-", "–", "durch"}
    tokens = set()
    for word in title.lower().replace("—", " ").replace("–", " ").replace("-", " ").split():
        word = word.strip(".,;:!?()[]\"'")
        if word and word not in noise and len(word) > 2:
            tokens.add(word)
    return tokens


def _title_similarity(a: str, b: str) -> float:
    """Compute Jaccard similarity between title tokens."""
    ta = _title_tokens(a)
    tb = _title_tokens(b)
    if not ta or not tb:
        return 0.0
    intersection = ta & tb
    union = ta | tb
    return len(intersection) / len(union)


def match_enriched_to_records(enrichments: list[dict], db_records: list[dict]) -> list[tuple[dict, dict]]:
    """Match enriched results to DB records using fuzzy title similarity.

    Strategy: for each enrichment, find the DB record with highest title
    token overlap. Falls back to incident_body content matching if titles
    are ambiguous.
    Returns list of (db_record, enrichment) pairs.
    """
    remaining_db = {rec["id"]: rec for rec in db_records}
    matched: list[tuple[dict, dict]] = []

    # Sort enrichments by specificity (longer titles match more reliably)
    sorted_enr = sorted(enrichments, key=lambda e: len(e.get("clean_title") or ""), reverse=True)

    for enr in sorted_enr:
        enr_title = enr.get("clean_title") or ""
        if not enr_title or not remaining_db:
            continue

        # Find best matching DB record by title similarity
        best_id = None
        best_score = 0.0
        for db_id, db_rec in remaining_db.items():
            db_title = db_rec.get("clean_title") or db_rec.get("title") or ""
            score = _title_similarity(enr_title, db_title)
            if score > best_score:
                best_score = score
                best_id = db_id

        if best_id and best_score >= 0.3:
            matched.append((remaining_db.pop(best_id), enr))
        else:
            # No good title match — try matching via incident_body content
            ib = enr.get("incident_body") or ""
            if ib and remaining_db:
                # Score by how many title tokens appear in the incident_body
                best_ib_id = None
                best_ib_score = 0
                ib_lower = ib.lower()
                for db_id, db_rec in remaining_db.items():
                    db_title = db_rec.get("clean_title") or db_rec.get("title") or ""
                    tokens = _title_tokens(db_title)
                    hits = sum(1 for t in tokens if t in ib_lower)
                    if hits > best_ib_score:
                        best_ib_score = hits
                        best_ib_id = db_id
                if best_ib_id and best_ib_score >= 2:
                    matched.append((remaining_db.pop(best_ib_id), enr))

    return matched


def main():
    parser = argparse.ArgumentParser(description="Re-enrich München multi-record groups")
    parser.add_argument("--dry-run", action="store_true", help="Preview without updating")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of groups to process (0=all)")
    parser.add_argument("--cache-dir", default=".cache", help="Cache directory")
    parser.add_argument("--no-geocode", action="store_true", default=True,
                        help="Skip geocoding (default: true)")
    parser.add_argument("--with-geocode", action="store_true",
                        help="Enable geocoding during re-enrichment")
    args = parser.parse_args()

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not supabase_url or not supabase_key:
        print("ERROR: Missing Supabase credentials")
        sys.exit(1)

    supabase = create_client(supabase_url, supabase_key)

    # Find München groups needing re-enrichment
    groups = fetch_munich_groups(supabase)
    total_groups = len(groups)
    total_records = sum(len(recs) for recs in groups.values())
    print(f"Found {total_groups} groups with {total_records} records needing re-enrichment")

    if total_groups == 0:
        print("Nothing to re-enrich!")
        return

    if args.limit:
        urls = list(groups.keys())[:args.limit]
        groups = {url: groups[url] for url in urls}
        print(f"Limited to {len(groups)} groups")

    # Preview
    for url, recs in groups.items():
        body_len = len(recs[0].get("body", ""))
        titles = [r.get("clean_title") or r.get("title", "???") for r in recs]
        print(f"\n  {url}")
        print(f"    {len(recs)} records, body={body_len} chars")
        for title in titles[:4]:
            print(f"      - {title[:80]}")
        if len(titles) > 4:
            print(f"      ... +{len(titles) - 4} more")

    if args.dry_run:
        print(f"\n[DRY RUN] Would re-enrich {len(groups)} groups ({total_records} records)")
        return

    # Initialize enricher
    no_geocode = not args.with_geocode
    enricher = FastEnricher(cache_dir=args.cache_dir, no_geocode=no_geocode)

    # Evict stale cache entries for these articles
    evicted = 0
    articles_to_enrich = []
    group_map: dict[str, list[dict]] = {}  # url → db_records

    for url, recs in groups.items():
        article = reconstruct_article(url, recs)
        key = cache_key(article["url"], article["body"])

        if key in enricher.cache:
            del enricher.cache[key]
            evicted += 1

        articles_to_enrich.append(article)
        group_map[url] = recs

    print(f"\nEvicted {evicted} stale cache entries")
    print(f"Re-enriching {len(articles_to_enrich)} articles...")

    # Run enrichment
    try:
        enriched, removed = enricher.enrich_all(articles_to_enrich, skip_clustering=True)
    except KeyboardInterrupt:
        print("\nInterrupted — saving caches")
        enricher.save_caches()
        sys.exit(1)

    enricher.save_caches()
    print(f"\nEnrichment complete: {len(enriched)} records, {len(removed)} removed")

    # Group enriched results by source URL
    enriched_by_url: dict[str, list[dict]] = {}
    for rec in enriched:
        url = rec.get("url", "")
        enriched_by_url.setdefault(url, []).append(rec)

    # Update DB records with per-incident body text
    updated = 0
    skipped = 0
    errors = 0

    for url, db_recs in group_map.items():
        enr_recs = enriched_by_url.get(url, [])
        if not enr_recs:
            print(f"  SKIP (no enrichment results): {url}")
            skipped += len(db_recs)
            continue

        # Match enriched to DB records
        pairs = match_enriched_to_records(enr_recs, db_recs)

        for db_rec, enr in pairs:
            new_body = enr.get("incident_body")
            if not new_body:
                # Single incident or LLM didn't provide incident_body
                skipped += 1
                continue

            old_body = db_rec.get("body", "")
            if new_body == old_body:
                skipped += 1
                continue

            try:
                supabase.table("crime_records").update({
                    "body": new_body,
                }).eq("id", db_rec["id"]).execute()
                updated += 1

                title = db_rec.get("clean_title") or db_rec.get("title", "???")
                print(f"  UPDATED: {title[:60]} (body: {len(old_body)}→{len(new_body)} chars)")
            except Exception as e:
                print(f"  ERROR updating {db_rec['id']}: {e}")
                errors += 1

    print(f"\n{'='*60}")
    print(f"Re-enrichment complete!")
    print(f"  Updated: {updated} records")
    print(f"  Skipped: {skipped} records (no incident_body or unchanged)")
    print(f"  Errors: {errors}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
