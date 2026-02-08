#!/usr/bin/env python3
"""
Extract quality rules from favorites comments using LLM analysis.

Reads a favorites JSON export (with comments), fetches the corresponding
records from Supabase for context, sends everything to the LLM, and
generates a structured markdown file with extracted rules and patterns.

Usage:
    python3 scripts/pipeline/extract_rules.py -f favorites.json
    python3 scripts/pipeline/extract_rules.py -f favorites.json -o rules.md
    python3 scripts/pipeline/extract_rules.py -f favorites.json --run-name feb2026_test100
"""

import json
import os
import sys
from pathlib import Path

import certifi
from dotenv import load_dotenv
from openai import OpenAI

# Fix SSL on macOS
os.environ["SSL_CERT_FILE"] = certifi.where()

# Load env
load_dotenv()
load_dotenv(Path(".env.local"), override=True)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
MODEL = "x-ai/grok-4-fast"

EXTRACTION_PROMPT = """\
You are a data quality analyst reviewing a set of crime press release records \
that a human reviewer has flagged and annotated with comments.

Below is a JSON array of flagged records. Each entry contains:
- "id": the record ID
- "title": the article title
- "clean_title": the LLM-cleaned title (may differ from title)
- "location_text": the extracted location string
- "latitude"/"longitude": geocoded coordinates (may be null or wrong)
- "categories": crime categories assigned
- "incident_date"/"incident_time": extracted crime time
- "incident_time_precision": how precise the time extraction was
- "weapon_type": extracted weapon type
- "body": the original article text (truncated)
- "comment": the human reviewer's annotation explaining what's wrong

Your task:
1. Analyze ALL comments to identify recurring quality issues and patterns
2. Group related comments into thematic RULES
3. For each rule, provide:
   - A clear, actionable rule title
   - A description of the problem pattern
   - Concrete examples from the flagged records (cite record titles)
   - A suggested fix or improvement for the enrichment pipeline
4. Order rules by frequency (most common issues first)
5. Add a summary section at the top with statistics

Output format: Markdown, structured with headers, bullet points, and tables. \
Write in English. Be specific and actionable — these rules will be used to \
improve the LLM enrichment prompt and geocoding pipeline.

Flagged records:
{records_json}
"""


def load_favorites(path: Path) -> dict[str, str]:
    """Load favorites file, handling both array and object formats."""
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read().strip()

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        try:
            parsed = json.loads(json.loads(f'"{raw}"'))
        except Exception:
            print(f"ERROR: Could not parse {path} as JSON")
            sys.exit(1)

    if isinstance(parsed, list):
        return {x: "" for x in parsed if isinstance(x, str)}
    elif isinstance(parsed, dict):
        return {k: (v if isinstance(v, str) else "") for k, v in parsed.items()}
    else:
        print(f"ERROR: Expected JSON array or object, got {type(parsed).__name__}")
        sys.exit(1)


def fetch_records(ids: list[str], run_name: str | None = None) -> list[dict]:
    """Fetch records from Supabase by ID."""
    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    if not supabase_url or not supabase_key:
        print("ERROR: Missing Supabase credentials")
        sys.exit(1)

    from supabase import create_client

    client = create_client(supabase_url, supabase_key)

    all_records = []
    batch_size = 50
    for i in range(0, len(ids), batch_size):
        batch_ids = ids[i : i + batch_size]
        query = client.table("crime_records").select("*").in_("id", batch_ids)
        if run_name:
            query = query.eq("pipeline_run", run_name)
        resp = query.execute()
        all_records.extend(resp.data or [])

    return all_records


def build_llm_input(records: list[dict], comments: dict[str, str]) -> list[dict]:
    """Build the record list to send to the LLM, including comments."""
    items = []
    for rec in records:
        comment = comments.get(rec["id"], "")
        body = (rec.get("body") or "")[:1500]  # truncate for token budget
        items.append(
            {
                "id": rec["id"][:12],
                "title": rec.get("title", ""),
                "clean_title": rec.get("clean_title", ""),
                "location_text": rec.get("location_text", ""),
                "latitude": rec.get("latitude"),
                "longitude": rec.get("longitude"),
                "categories": rec.get("categories", []),
                "incident_date": rec.get("incident_date"),
                "incident_time": rec.get("incident_time"),
                "incident_time_precision": rec.get("incident_time_precision"),
                "weapon_type": rec.get("weapon_type"),
                "body": body,
                "comment": comment,
            }
        )
    return items


def extract_rules(items: list[dict]) -> str:
    """Send flagged records to LLM and extract quality rules."""
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY required")
        sys.exit(1)

    client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)

    prompt = EXTRACTION_PROMPT.format(
        records_json=json.dumps(items, ensure_ascii=False, indent=2)
    )

    print(f"Sending {len(items)} records to LLM for rule extraction...")
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=8000,
        temperature=0.3,
    )

    content = response.choices[0].message.content
    if not content:
        print("ERROR: LLM returned empty response")
        sys.exit(1)

    return content.strip()


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Extract quality rules from favorites comments using LLM"
    )
    parser.add_argument(
        "--favorites",
        "-f",
        required=True,
        help="JSON file with favorites (array or {id: comment} object)",
    )
    parser.add_argument(
        "--output",
        "-o",
        default="data/pipeline/quality_rules.md",
        help="Output markdown file path",
    )
    parser.add_argument(
        "--run-name",
        default=None,
        help="Filter records by pipeline run name",
    )
    args = parser.parse_args()

    fav_path = Path(args.favorites)
    if not fav_path.exists():
        print(f"ERROR: Favorites file not found: {fav_path}")
        sys.exit(1)

    # Load favorites with comments
    comments = load_favorites(fav_path)
    ids = list(comments.keys())
    commented = sum(1 for c in comments.values() if c)
    print(f"Loaded {len(ids)} favorites ({commented} with comments)")

    if not ids:
        print("No favorites to process.")
        sys.exit(0)

    # Fetch records from Supabase
    print("Fetching records from Supabase...")
    records = fetch_records(ids, run_name=args.run_name)
    print(f"Fetched {len(records)} records")

    if not records:
        print("No records found in Supabase.")
        sys.exit(0)

    # Build input for LLM
    items = build_llm_input(records, comments)

    # Only include records that have comments for rule extraction
    commented_items = [item for item in items if item["comment"]]
    if not commented_items:
        print("No records with comments found — nothing to extract rules from.")
        print("Star some records and add comments first, then re-run.")
        sys.exit(0)

    print(f"Extracting rules from {len(commented_items)} commented records...")

    # Extract rules via LLM
    rules_md = extract_rules(commented_items)

    # Write output
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(rules_md)
        f.write("\n")

    print(f"\nRules written to {out_path}")


if __name__ == "__main__":
    main()
