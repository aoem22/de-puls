#!/usr/bin/env python3
"""
Fix all München body-title mismatches by re-splitting original bodies
and matching sections to DB records using location names.

Strategy:
1. Load raw Bayern chunks to get original article bodies by URL
2. For each multi-record group, split body into incident sections
3. Match sections to DB records using location keywords + content overlap
4. Update mismatched records
"""
import os
import sys
import re
import json
import glob
import certifi
from pathlib import Path
from collections import defaultdict
from dotenv import load_dotenv

os.environ["SSL_CERT_FILE"] = certifi.where()
load_dotenv()
load_dotenv(Path(".env.local"), override=True)

from supabase import create_client

DRY_RUN = "--dry-run" in sys.argv


def load_raw_bodies() -> dict[str, str]:
    """Load original article bodies from raw Bayern chunks, keyed by URL."""
    url_to_body = {}
    for f in sorted(glob.glob("data/pipeline/chunks/raw/bayern/2026/*.json")):
        if "_enriched" in f:
            continue
        with open(f) as fh:
            articles = json.load(fh)
        for art in articles:
            url = art.get("url", "")
            body = art.get("body", "")
            if url and body:
                url_to_body[url] = body
    return url_to_body


def split_into_sections(body: str) -> list[str]:
    """Split a München digest body into incident sections.

    Handles multiple split patterns:
    1. "Am [Wochentag], DD.MM.YYYY" — most common
    2. "Fall N:" — numbered case format
    3. Numbered section headers "NN. Title" within body
    """
    # Strip numbered ToC lines from the top
    lines = body.split("\n")
    fc = 0
    for i, line in enumerate(lines):
        s = line.strip()
        if not s:
            continue
        if re.match(r"^\d{2,}\.\s{2,}", s):
            fc = i + 1
            continue
        if s.lower().startswith("weitere informationen"):
            fc = i + 1
            continue
        break
    if fc > 0:
        body = "\n".join(lines[fc:]).strip()

    # Strip non-crime preamble (>1000 chars before first incident marker)
    m = re.search(
        r"Am\s+(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)",
        body,
    )
    if m and m.start() > 1000:
        body = body[m.start() :]

    # Try splitting by "Am [Wochentag]" pattern (most common)
    wochentag_re = re.compile(
        r"(?=Am\s+(?:Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag))"
    )
    sections = [s.strip() for s in wochentag_re.split(body) if s.strip()]
    if len(sections) >= 2:
        return sections

    # Try splitting by "Fall N:" pattern
    fall_re = re.compile(r"(?=Fall\s+\d+[:\s])", re.IGNORECASE)
    sections = [s.strip() for s in fall_re.split(body) if s.strip()]
    if len(sections) >= 2:
        return sections

    # Try splitting by date paragraphs "In der Zeit von" / "Im Zeitraum"
    date_re = re.compile(
        r"(?=(?:In der Zeit von|Im Zeitraum|Am\s+\d{1,2}\.\d{1,2}\.\d{4}))"
    )
    sections = [s.strip() for s in date_re.split(body) if s.strip()]
    if len(sections) >= 2:
        return sections

    # Fallback: return entire body as one section
    return [body]


def extract_location_words(title: str) -> list[str]:
    """Extract distinctive location keywords from a title."""
    if not title:
        return []

    # München neighborhood names and nearby town names to look for
    neighborhoods = [
        "Allach",
        "Altstadt",
        "Aubing",
        "Bogenhausen",
        "Daglfing",
        "Fasangarten",
        "Freimann",
        "Giesing",
        "Grasbrunn",
        "Grünwald",
        "Hadern",
        "Haidhausen",
        "Hasenbergl",
        "Isarvorstadt",
        "Laim",
        "Lehel",
        "Lochhausen",
        "Ludwigsvorstadt",
        "Maxvorstadt",
        "Milbertshofen",
        "Moosach",
        "Neuhausen",
        "Neuperlach",
        "Nymphenburg",
        "Obermenzing",
        "Obergiesing",
        "Pasing",
        "Perlach",
        "Ramersdorf",
        "Riem",
        "Schwabing",
        "Schwanthalerhöhe",
        "Sendling",
        "Solln",
        "Thalkirchen",
        "Trudering",
        "Westend",
        "Berg am Laim",
        # Nearby towns
        "Brunnthal",
        "Garching",
        "Gräfelfing",
        "Hohenschäftlarn",
        "Hohenbrunn",
        "Höhenkirchen",
        "Ismaning",
        "Neuried",
        "Oberschleißheim",
        "Ottobrunn",
        "Planegg",
        "Pullach",
        "Unterhaching",
        "Unterschleißheim",
        "Allershausen",
        "Blumenau",
    ]

    found = []
    title_lower = title.lower()
    for loc in neighborhoods:
        if loc.lower() in title_lower:
            found.append(loc)

    return found


def extract_content_keywords(title: str) -> list[str]:
    """Extract crime-type and distinctive keywords from title for content matching."""
    if not title:
        return []

    keywords = []
    title_lower = title.lower()

    # Crime type keywords and their body-text equivalents
    crime_patterns = {
        "exhibitionis": ["exhibitionis", "entblößt", "geschlechtsteil"],
        "küchenbrand": ["küchenbrand", "brand in einer küche"],
        "wohnungsbrand": ["wohnungsbrand", "brand in einer wohnung"],
        "brandstiftung": ["brand", "feuer", "flammen"],
        "messerangriff": ["messer", "stich"],
        "fahrerflucht": ["entzog sich", "flucht", "flüchte", "fuhr davon"],
        "fahrradflucht": ["fahrrad", "radfahrer", "rad"],
        "raubüberfall": ["raubte", "beraubt", "überfall", "bedroh"],
        "trickdiebstahl": ["haustür", "handwerker", "trickdieb", "vortäusch"],
        "schockanruf": ["schockanruf", "anruf", "telefonisch", "falsche polizei"],
        "sachbeschädigung": ["beschädigt", "schmierschrift", "graffiti", "gespray"],
        "volksverhetzung": ["volksverhetz", "hitlergruß", "ns-"],
        "einbruch": ["einbruch", "einbrach", "verschafften sich", "drangen ein", "aufgehebelt"],
        "körperverletzung": ["geschlagen", "getreten", "verletzt", "angegriff"],
        "sprengstoff": ["sprengstoff", "detonation", "explosion", "böller"],
        "sexuelle": ["sexuell", "unsittlich", "belästig"],
        "brief": ["brief", "schreiben"],
        "flagge": ["flagge", "fahne"],
        "wahlplakat": ["wahlplakat", "plakat"],
        "e-scooter": ["e-scooter", "roller"],
        "tierschutz": ["pferd", "tier"],
    }

    for crime_key, body_kws in crime_patterns.items():
        if crime_key in title_lower:
            keywords.extend(body_kws)

    return keywords


def match_sections_to_records(
    sections: list[str], records: list[dict]
) -> list[tuple[dict, str, float]]:
    """Match body sections to DB records using location + content keywords.

    Returns list of (record, section, score) tuples.
    """
    # Build score matrix
    scores: dict[tuple[int, int], float] = {}

    for ri, rec in enumerate(records):
        title = rec.get("clean_title") or ""
        loc_words = extract_location_words(title)
        content_kws = extract_content_keywords(title)

        for si, sec in enumerate(sections):
            sec_lower = sec.lower()
            score = 0.0

            # Location match (high weight — very distinctive)
            for loc in loc_words:
                if loc.lower() in sec_lower:
                    score += 10.0

            # Content keyword match
            for kw in content_kws:
                if kw.lower() in sec_lower:
                    score += 2.0

            # Person age match (e.g., "41-Jähriger" in title and body)
            age_match = re.search(r"(\d{1,2})-[Jj]ährig", title)
            if age_match:
                age = age_match.group(1)
                if f"{age}-jährig" in sec_lower or f"{age}-Jährig" in sec:
                    score += 3.0

            scores[(ri, si)] = score

    # Greedy exclusive matching: pick highest score, assign, repeat
    used_recs: set[int] = set()
    used_secs: set[int] = set()
    matches: list[tuple[dict, str, float]] = []

    for _ in range(min(len(records), len(sections))):
        best_pair = None
        best_score = -1.0
        for (ri, si), score in scores.items():
            if ri in used_recs or si in used_secs:
                continue
            if score > best_score:
                best_score = score
                best_pair = (ri, si)

        if best_pair and best_score > 0:
            ri, si = best_pair
            used_recs.add(ri)
            used_secs.add(si)
            matches.append((records[ri], sections[si], best_score))

    return matches


def main():
    sb = create_client(
        os.environ["NEXT_PUBLIC_SUPABASE_URL"],
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    )

    print("Loading raw Bayern data...")
    raw_bodies = load_raw_bodies()
    print(f"  Loaded {len(raw_bodies)} raw articles")

    print("Fetching München records...")
    all_records = []
    offset = 0
    while True:
        batch = (
            sb.table("crime_records")
            .select("id, source_url, body, clean_title")
            .eq("source_agency", "Polizeipräsidium München")
            .order("source_url")
            .range(offset, offset + 999)
            .execute()
        )
        if not batch.data:
            break
        all_records.extend(batch.data)
        offset += 1000
        if len(batch.data) < 1000:
            break

    print(f"  Fetched {len(all_records)} records")

    # Group by URL
    groups: dict[str, list[dict]] = {}
    for rec in all_records:
        url = rec.get("source_url", "")
        if url:
            groups.setdefault(url, []).append(rec)

    # Process multi-record groups
    total_updated = 0
    total_skipped = 0
    total_no_raw = 0
    total_no_match = 0

    for url, recs in sorted(groups.items()):
        if len(recs) < 2:
            continue

        gid = url.split("/")[-2]
        original_body = raw_bodies.get(url)
        if not original_body:
            total_no_raw += 1
            continue

        sections = split_into_sections(original_body)
        if len(sections) < 2:
            continue

        matches = match_sections_to_records(sections, recs)

        group_updated = 0
        for rec, new_body, score in matches:
            old_body = rec.get("body", "")
            if new_body == old_body:
                total_skipped += 1
                continue

            # Verify the match makes sense: location from title should be in new body
            title = rec.get("clean_title") or ""
            loc_words = extract_location_words(title)
            loc_in_new = any(w.lower() in new_body.lower() for w in loc_words)

            if loc_words and not loc_in_new:
                # Location mismatch — don't trust this match
                total_no_match += 1
                continue

            if not DRY_RUN:
                sb.table("crime_records").update({"body": new_body}).eq(
                    "id", rec["id"]
                ).execute()

            group_updated += 1
            total_updated += 1

        if group_updated > 0:
            print(f"  {gid}: {group_updated} updated (of {len(recs)} records, {len(sections)} sections)")

    print(f"\n{'=' * 60}")
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}Fix complete!")
    print(f"  Updated: {total_updated} records")
    print(f"  Skipped (already correct): {total_skipped}")
    print(f"  No raw data: {total_no_raw} groups")
    print(f"  Low-confidence (skipped): {total_no_match}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
