#!/usr/bin/env python3
"""
Article filter and incident grouping.

Runs between scrape and enrich to:
1. Remove junk articles (Feuerwehr leftovers, traffic advisories, announcements)
2. Group related articles (follow-ups, updates) via incident_group_id

Usage:
    python -m scripts.pipeline.filter_articles --input scraped.json --output filtered.json
    python -m scripts.pipeline.filter_articles --input scraped.json --output filtered.json --dry-run
"""

import hashlib
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import certifi
from dotenv import load_dotenv

load_dotenv()
os.environ['SSL_CERT_FILE'] = certifi.where()


# ───────────────────────────────────────────────────────
# 1. JUNK REMOVAL — rule-based, no LLM
# ───────────────────────────────────────────────────────

# Title patterns that indicate non-crime junk
JUNK_TITLE_PATTERNS = [
    re.compile(r'Verkehrshinweis', re.IGNORECASE),
    re.compile(r'Erreichbarkeit\s+(der\s+)?Polizeipressestelle', re.IGNORECASE),
    re.compile(r'Mobil\s+im\s+Alter', re.IGNORECASE),
    re.compile(r'Kontrollaktionen?\b', re.IGNORECASE),
    re.compile(r'Warnmeldung.*Gewitter', re.IGNORECASE),
    re.compile(r'Silvester.*Bilanz', re.IGNORECASE),
    re.compile(r'Spendenaufruf', re.IGNORECASE),
    re.compile(r'Polizei\s+informiert\s+über', re.IGNORECASE),
    re.compile(r'Tag\s+der\s+offenen\s+Tür', re.IGNORECASE),
    re.compile(r'Blitzerstandorte', re.IGNORECASE),
    # New high-signal junk categories found in full-corpus audit
    re.compile(r'\bBlitzermeldung\b', re.IGNORECASE),
    re.compile(r'\bGeschwindigkeitskontrollstellen?\b', re.IGNORECASE),
    re.compile(r'\bVersammlungsgeschehen\b', re.IGNORECASE),
    re.compile(r'Einsatz der Bundespolizei.*Fußballspielbegegnung', re.IGNORECASE),
    re.compile(r'\bSave the date\b', re.IGNORECASE),
    re.compile(r'\bPresseeinladung\b', re.IGNORECASE),
    re.compile(r'Präventionsveranstaltung|Praeventionsveranstaltung', re.IGNORECASE),
    re.compile(r'Internationaler Zolltag', re.IGNORECASE),
    re.compile(r'Karriere beim ZOLL|Berufseinsteiger beim Hauptzollamt|Berufsinformationstag beim HZA', re.IGNORECASE),
    re.compile(r'Weltverbrauchertag.*ZOLL|Tag der Kinderhospizarbeit.*ZOLL', re.IGNORECASE),
]

# Body patterns (checked only if title didn't match)
JUNK_BODY_PATTERNS = [
    re.compile(r'Geschwindigkeitskontrolle.*Messstelle', re.IGNORECASE),
    re.compile(r'Die Pressestelle.*ist.*erreichbar', re.IGNORECASE),
    re.compile(r'(Rücknahme|Widerruf|Erledigung).*(Vermisstenfahndung|Vermisstenmeldung|Öffentlichkeitsfahndung|Oeffentlichkeitsfahndung)', re.IGNORECASE),
]

# Feuerwehr source filter (backup — should be caught by scraper)
FEUERWEHR_PATTERN = re.compile(
    r'Feuerwehr|^FW[ -]|Berufsfeuerwehr|Freiwillige Feuerwehr',
    re.IGNORECASE,
)

# Missing-person bulletins are treated as junk per enrichment prompt policy.
MISSING_PERSON_CORE_PATTERN = re.compile(
    r'(vermisst|vermisstenfahndung|vermisstensuche|vermisstenmeldung|öffentlichkeitsfahndung|oeffentlichkeitsfahndung)',
    re.IGNORECASE,
)
MISSING_PERSON_EXPLICIT_PATTERN = re.compile(
    r'(vermisst|vermisstenfahndung|vermisstensuche|vermisstenmeldung)',
    re.IGNORECASE,
)
PUBLIC_SEARCH_PATTERN = re.compile(
    r'(öffentlichkeitsfahndung|oeffentlichkeitsfahndung)',
    re.IGNORECASE,
)
MISSING_PERSON_STRONG_PATTERN = re.compile(
    r'(rücknahme|ruecknahme|widerruf|erledigung).*(vermissten|öffentlichkeits|oeffentlichkeits)?fahndung'
    r'|\bvermisst(?:e|er|en)?\b.*\b(wieder da|wieder aufgefunden|aufgefunden|tot aufgefunden|leblos aufgefunden)\b'
    r'|polizei bittet um hinweise',
    re.IGNORECASE,
)
MISSING_PERSON_CRIME_CONTEXT_PATTERN = re.compile(
    r'(raub|mord|tötungsdelikt|toetungsdelikt|einbruch|betrug|landfriedensbruch|brandstiftung|körperverletzung|koerperverletzung|tatverdächtig|tatverdaechtig|schwerer\s+bandendiebstahl)',
    re.IGNORECASE,
)


def _is_missing_person_bulletin(title: str) -> bool:
    """Conservative missing-person detector to avoid filtering crime-fahndung posts."""
    if not title or ";" in title:
        return False
    if not MISSING_PERSON_CORE_PATTERN.search(title):
        return False
    # Generic public-fahndung can be crime-related; require explicit missing-person markers.
    has_explicit_missing_marker = bool(MISSING_PERSON_EXPLICIT_PATTERN.search(title))
    if PUBLIC_SEARCH_PATTERN.search(title) and not has_explicit_missing_marker:
        return False
    if MISSING_PERSON_CRIME_CONTEXT_PATTERN.search(title):
        return False
    if MISSING_PERSON_STRONG_PATTERN.search(title):
        return True
    return bool(
        re.search(
            r'\b(\d{1,3}-jährige[rsn]?\b.*\bvermisst|vermisst\b.*\b(polizei|kripo))',
            title.lower(),
        )
    )


def is_junk_article(article: dict) -> Optional[str]:
    """Check if article is junk.
    Returns removal reason string, or None if article is valid.
    """
    title = article.get("title", "")
    body = article.get("body", "")
    source = article.get("source", "")

    # Feuerwehr backup check
    if source and FEUERWEHR_PATTERN.search(source):
        return "feuerwehr_source"
    if title and re.match(r'^FW[ -]', title):
        return "feuerwehr_title"

    # Missing-person/search-only bulletins (non-incident)
    if _is_missing_person_bulletin(title):
        return "junk_title:missing_person"

    # Title-based junk
    for pattern in JUNK_TITLE_PATTERNS:
        if pattern.search(title):
            return f"junk_title:{pattern.pattern[:30]}"

    # Body-based junk
    for pattern in JUNK_BODY_PATTERNS:
        if pattern.search(body[:500]):
            return f"junk_body:{pattern.pattern[:30]}"

    return None


# ───────────────────────────────────────────────────────
# 2. INCIDENT GROUPING — 3-tier dedup
# ───────────────────────────────────────────────────────

def _parse_date(date_str: str) -> Optional[datetime]:
    """Parse various date formats to datetime."""
    if not date_str:
        return None
    try:
        if "T" in date_str:
            return datetime.fromisoformat(date_str.replace("Z", "+00:00")).replace(tzinfo=None)
        return datetime.fromisoformat(date_str)
    except (ValueError, TypeError):
        return None


def _strip_pm_nr(title: str) -> tuple[str, Optional[str]]:
    """Strip 'PM Nr. X' suffix from title, return (base_title, pm_nr)."""
    match = re.search(r'\s*[-–]\s*PM\s+Nr\.?\s*(\d+)\s*$', title)
    if match:
        return title[:match.start()].strip(), match.group(1)
    return title, None


def _is_follow_up(title: str) -> tuple[bool, str]:
    """Check if title indicates a follow-up report.
    Returns (is_follow_up, base_title).
    """
    # Nachtrag, Folgemeldung, Korrektur, Update patterns
    follow_up_patterns = [
        re.compile(r'^(Nachtrag|Folgemeldung|Korrekturmeldung|Korrektur|Update)\s*[\s:/-]+\s*', re.IGNORECASE),
        re.compile(r'\s*[-–]\s*(Nachtrag|Folgemeldung|Update|Korrektur)\s*$', re.IGNORECASE),
        re.compile(r'\(\s*(Nachtrag|Folgemeldung|Update|Korrektur)\s*\)', re.IGNORECASE),
    ]

    for pattern in follow_up_patterns:
        match = pattern.search(title)
        if match:
            base = pattern.sub('', title).strip()
            return True, base

    return False, title


def _extract_back_references(body: str) -> list[str]:
    """Extract presseportal back-reference URLs from article body."""
    pattern = re.compile(r'presseportal\.de/blaulicht/pm/(\d+)/(\d+)')
    return [f"https://www.presseportal.de/blaulicht/pm/{m.group(1)}/{m.group(2)}" for m in pattern.finditer(body)]


def _word_tokens(text: str) -> set[str]:
    """Extract lowercase word tokens from text, removing common stopwords."""
    stopwords = {'der', 'die', 'das', 'und', 'in', 'von', 'zu', 'den', 'für',
                 'mit', 'auf', 'im', 'ist', 'ein', 'eine', 'dem', 'des', 'am',
                 'aus', 'an', 'bei', 'nach', 'pol', 'polizei'}
    words = set(re.findall(r'[a-zäöüß]{3,}', text.lower()))
    return words - stopwords


def _jaccard_similarity(set_a: set, set_b: set) -> float:
    """Compute Jaccard similarity between two sets."""
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


def _make_group_id(key: str) -> str:
    """Generate a deterministic incident group ID from a key string."""
    return hashlib.sha256(key.encode()).hexdigest()[:12]


def group_incidents(articles: list[dict], use_llm: bool = False) -> list[dict]:
    """Assign incident_group_id and group_role to each article.

    Three-tier dedup:
      Tier 1 — Deterministic: PM Nr., Nachtrag/Folgemeldung, body back-references
      Tier 2 — Heuristic: title token Jaccard ≥ 0.5 within (source, city, 7-day window)
      Tier 3 — LLM verification (optional, for Tier 2 candidates)

    Args:
        articles: List of article dicts (each must have title, url, date, source, city, body)
        use_llm: Whether to use LLM for Tier 3 verification (default: False)

    Returns:
        Articles with incident_group_id and group_role added.
    """
    n = len(articles)

    # Initialize: each article is its own group
    group_ids = [None] * n
    group_roles = ["primary"] * n
    url_to_idx = {a.get("url", ""): i for i, a in enumerate(articles)}

    # ── Tier 1: Deterministic ──

    # 1a. PM Nr. series: same base title + source → same group
    pm_groups: dict[str, list[int]] = defaultdict(list)
    for i, art in enumerate(articles):
        base_title, pm_nr = _strip_pm_nr(art.get("title", ""))
        if pm_nr:
            source = art.get("source", "") or ""
            key = f"{source}|{base_title}"
            pm_groups[key].append(i)

    for key, indices in pm_groups.items():
        if len(indices) > 1:
            gid = _make_group_id(f"pm:{key}")
            for j, idx in enumerate(indices):
                group_ids[idx] = gid
                group_roles[idx] = "primary" if j == 0 else "update"

    # 1b. Nachtrag/Folgemeldung: link to parent by stripped title match
    title_to_idx: dict[str, int] = {}
    for i, art in enumerate(articles):
        title = art.get("title", "")
        # Normalize: remove source prefix (POL-XX: ...)
        clean = re.sub(r'^[A-Z]{2,5}-[A-Z]{1,4}\s*:\s*', '', title).strip()
        title_to_idx[clean.lower()] = i

    for i, art in enumerate(articles):
        is_fu, base = _is_follow_up(art.get("title", ""))
        if is_fu:
            clean_base = re.sub(r'^[A-Z]{2,5}-[A-Z]{1,4}\s*:\s*', '', base).strip().lower()
            parent_idx = title_to_idx.get(clean_base)
            if parent_idx is not None and parent_idx != i:
                # Link to parent's group
                if group_ids[parent_idx]:
                    group_ids[i] = group_ids[parent_idx]
                else:
                    gid = _make_group_id(f"fu:{articles[parent_idx].get('url', '')}")
                    group_ids[parent_idx] = gid
                    group_ids[i] = gid
                group_roles[i] = "follow_up"

    # 1c. Body back-references: link via presseportal URLs in body
    for i, art in enumerate(articles):
        refs = _extract_back_references(art.get("body", ""))
        for ref_url in refs:
            parent_idx = url_to_idx.get(ref_url)
            if parent_idx is not None and parent_idx != i:
                if group_ids[parent_idx]:
                    group_ids[i] = group_ids[parent_idx]
                else:
                    gid = _make_group_id(f"ref:{ref_url}")
                    group_ids[parent_idx] = gid
                    group_ids[i] = gid
                group_roles[i] = "follow_up"

    # ── Tier 2: Heuristic (same source+city, 7-day window, Jaccard ≥ 0.5) ──

    # Build candidate buckets: (source, city, week_key) → [indices]
    buckets: dict[str, list[int]] = defaultdict(list)
    for i, art in enumerate(articles):
        if group_ids[i]:
            continue  # Already grouped in Tier 1
        source = (art.get("source") or "").strip()
        city = (art.get("city") or "").strip()
        date = _parse_date(art.get("date", ""))
        if not source or not city or not date:
            continue
        # Use 7-day sliding window buckets (week number)
        week_key = f"{date.year}-W{date.isocalendar()[1]:02d}"
        bucket_key = f"{source}|{city}|{week_key}"
        buckets[bucket_key].append(i)

    tier2_pairs = []
    for bucket_key, indices in buckets.items():
        if len(indices) < 2:
            continue
        # Compare all pairs in this bucket
        tokens_cache: dict[int, set[str]] = {}
        for a_pos in range(len(indices)):
            idx_a = indices[a_pos]
            if idx_a not in tokens_cache:
                tokens_cache[idx_a] = _word_tokens(articles[idx_a].get("title", ""))
            for b_pos in range(a_pos + 1, len(indices)):
                idx_b = indices[b_pos]
                if idx_b not in tokens_cache:
                    tokens_cache[idx_b] = _word_tokens(articles[idx_b].get("title", ""))

                sim = _jaccard_similarity(tokens_cache[idx_a], tokens_cache[idx_b])
                if sim >= 0.5:
                    # Check date proximity (≤ 7 days)
                    date_a = _parse_date(articles[idx_a].get("date", ""))
                    date_b = _parse_date(articles[idx_b].get("date", ""))
                    if date_a and date_b and abs((date_a - date_b).days) <= 7:
                        tier2_pairs.append((idx_a, idx_b, sim))

    # Apply Tier 2 groupings (skip LLM verification for now)
    for idx_a, idx_b, sim in tier2_pairs:
        # Assign to same group
        if group_ids[idx_a] and not group_ids[idx_b]:
            group_ids[idx_b] = group_ids[idx_a]
            group_roles[idx_b] = "related"
        elif group_ids[idx_b] and not group_ids[idx_a]:
            group_ids[idx_a] = group_ids[idx_b]
            group_roles[idx_a] = "related"
        elif not group_ids[idx_a] and not group_ids[idx_b]:
            gid = _make_group_id(f"t2:{articles[idx_a].get('url', '')}:{articles[idx_b].get('url', '')}")
            group_ids[idx_a] = gid
            group_ids[idx_b] = gid
            # Earlier article is primary
            date_a = _parse_date(articles[idx_a].get("date", ""))
            date_b = _parse_date(articles[idx_b].get("date", ""))
            if date_a and date_b and date_b < date_a:
                group_roles[idx_a] = "related"
            else:
                group_roles[idx_b] = "related"

    # Assign remaining ungrouped articles their own unique group
    for i in range(n):
        if group_ids[i] is None:
            group_ids[i] = _make_group_id(f"solo:{articles[i].get('url', str(i))}")

    # Write back to articles
    for i in range(n):
        articles[i]["incident_group_id"] = group_ids[i]
        articles[i]["group_role"] = group_roles[i]

    return articles


# ───────────────────────────────────────────────────────
# CLI
# ───────────────────────────────────────────────────────

def run_filter(
    input_path: str,
    output_path: str,
    dry_run: bool = False,
    removed_path: Optional[str] = None,
) -> dict:
    """Run the full filter pipeline on an article file.

    Returns stats dict with counts.
    """
    # Load articles
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        articles = data
    else:
        articles = data.get("articles", [])

    total = len(articles)
    print(f"Loaded {total} articles from {input_path}")

    # Step 1: Junk removal
    kept = []
    removed = []
    for art in articles:
        reason = is_junk_article(art)
        if reason:
            removed.append({**art, "_removal_reason": reason})
        else:
            kept.append(art)

    junk_count = len(removed)
    print(f"Junk removal: {junk_count} removed, {len(kept)} kept")

    # Log removal reasons
    from collections import Counter
    reason_counts = Counter(r["_removal_reason"].split(":")[0] for r in removed)
    for reason, count in reason_counts.most_common():
        print(f"  {count:4d} {reason}")

    # Step 2: Incident grouping
    kept = group_incidents(kept)

    # Count groups
    groups = defaultdict(list)
    for art in kept:
        groups[art.get("incident_group_id", "")].append(art)

    multi_groups = {gid: arts for gid, arts in groups.items() if len(arts) > 1}
    grouped_articles = sum(len(arts) for arts in multi_groups.values())
    print(f"Incident grouping: {len(multi_groups)} groups with {grouped_articles} articles")

    stats = {
        "total_input": total,
        "junk_removed": junk_count,
        "kept": len(kept),
        "incident_groups": len(multi_groups),
        "grouped_articles": grouped_articles,
    }

    if dry_run:
        print(f"\n[DRY RUN] Would write {len(kept)} filtered articles")
        if multi_groups:
            print(f"\nSample groups:")
            for gid, arts in list(multi_groups.items())[:3]:
                print(f"  Group {gid[:8]}... ({len(arts)} articles):")
                for a in arts:
                    print(f"    [{a.get('group_role', '?')}] {a.get('title', '')[:60]}")
        return stats

    # Write output
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, list):
        output_data = kept
    else:
        output_data = {**data, "articles": kept}

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(kept)} filtered articles to {output_path}")

    # Write removed log
    if removed_path is None:
        removed_path = str(Path(output_path).with_suffix("")) + "_removed.json"
    with open(removed_path, "w", encoding="utf-8") as f:
        json.dump(removed, f, ensure_ascii=False, indent=2)
    print(f"Saved {len(removed)} removed articles to {removed_path}")

    return stats


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Filter and group articles")
    parser.add_argument("--input", "-i", required=True, help="Input JSON file")
    parser.add_argument("--output", "-o", required=True, help="Output JSON file")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing")
    parser.add_argument("--removed", help="Path for removed articles log (default: <output>_removed.json)")

    args = parser.parse_args()

    if not Path(args.input).exists():
        print(f"ERROR: Input file not found: {args.input}")
        sys.exit(1)

    run_filter(
        input_path=args.input,
        output_path=args.output,
        dry_run=args.dry_run,
        removed_path=args.removed,
    )


if __name__ == "__main__":
    main()
