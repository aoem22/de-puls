#!/usr/bin/env python3
"""
Test enricher with LLM-estimated coordinates (no geocoding API).

This script asks Gemini to directly estimate lat/lon coordinates based on
the article's location description, eliminating the need for a separate
geocoding API call.

Key differences from fast_enricher.py:
- LLM outputs coordinates directly (no Google Maps API)
- Processes articles one at a time for detailed logging
- Targets a small test set (200 articles)

Cost: ~$0.10 for 200 articles (Gemini Flash pricing)
"""
import json
import os
import sys
from pathlib import Path

import certifi
from dotenv import load_dotenv
from openai import OpenAI

# Load .env
load_dotenv()

# Fix SSL on macOS
os.environ["SSL_CERT_FILE"] = certifi.where()

MODEL = "google/gemini-2.0-flash-001"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

PROMPT = """Analysiere diesen deutschen Polizeibericht und extrahiere:

1. STANDORT mit geschätzten Koordinaten:
   - street, house_number, district, city
   - lat, lon (schätze basierend auf der Stadt/Straße in Deutschland)
   - confidence (0-1): wie sicher bist du bei den Koordinaten?

2. TATZEIT:
   - date (YYYY-MM-DD), time (HH:MM), precision (exact/approximate/unknown)

3. DELIKT (PKS-Code):
   - pks_code (4-stellig), pks_category, confidence (0-1)

PKS-Kategorien:
- 2100: Raub, 2200: Körperverletzung, 2340: Bedrohung
- 3000/4000: Diebstahl, 4350: Wohnungseinbruch, 4780: Kfz-Diebstahl
- 5100: Betrug, 6740: Brandstiftung, 6750: Sachbeschädigung
- 7100: Verkehrsunfall, 7200: Fahrerflucht, 7300: Trunkenheit
- 8910: Drogen, 8990: Sonstige

WICHTIG für Koordinaten:
- Nutze dein Wissen über deutsche Städte und Straßen
- Bayern liegt bei lat 47.5-50.5, lon 9.5-13.8
- Wenn nur die Stadt bekannt ist, nutze Stadtzentrum-Koordinaten
- Bei bekannter Straße, schätze genauere Position

ARTIKEL:
Titel: {title}
Datum: {date}
Stadt: {city}
Bundesland: {bundesland}
Text: {body}

Antworte NUR mit JSON (kein Markdown, keine Erklärung):
{{
  "location": {{
    "street": "...",
    "house_number": null,
    "district": "...",
    "city": "...",
    "lat": 49.4521,
    "lon": 11.0767,
    "confidence": 0.8
  }},
  "incident_time": {{
    "date": "YYYY-MM-DD",
    "time": "HH:MM",
    "precision": "exact"
  }},
  "crime": {{
    "pks_code": "XXXX",
    "pks_category": "...",
    "confidence": 0.9
  }}
}}
"""


def parse_llm_response(text: str) -> dict | None:
    """Parse JSON from LLM response, handling markdown code blocks."""
    text = text.strip()

    # Remove markdown code blocks
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        text = text.split("```")[1].split("```")[0]

    try:
        return json.loads(text.strip())
    except json.JSONDecodeError as e:
        print(f"    JSON parse error: {e}")
        return None


def validate_coordinates(lat: float, lon: float) -> bool:
    """Check if coordinates are within Germany's bounding box."""
    if lat is None or lon is None:
        return False
    # Germany: lat 47.3-55.1, lon 5.9-15.0
    return 47.0 <= lat <= 55.5 and 5.5 <= lon <= 15.5


def main():
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY not set")
        sys.exit(1)

    client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)

    # Load test data (Bayern Jan 2026)
    input_file = Path("data/pipeline/chunks/raw/bayern/2026-01.json")
    if not input_file.exists():
        print(f"ERROR: Input file not found: {input_file}")
        sys.exit(1)

    articles = json.load(open(input_file, encoding="utf-8"))
    print(f"Loaded {len(articles)} articles from {input_file}")

    # Limit to first 200
    max_articles = 200
    articles = articles[:max_articles]
    print(f"Processing {len(articles)} articles...\n")

    results = []
    stats = {"total": 0, "with_coords": 0, "valid_coords": 0, "with_crime": 0, "errors": 0}

    for i, art in enumerate(articles, 1):
        stats["total"] += 1
        title = art.get("title", "No title")[:60]
        print(f"[{i}/{len(articles)}] {title}...")

        prompt = PROMPT.format(
            title=art.get("title", ""),
            date=art.get("date", ""),
            city=art.get("city", ""),
            bundesland=art.get("bundesland", ""),
            body=art.get("body", "")[:2000],
        )

        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=500,
            )
            text = response.choices[0].message.content.strip()
            data = parse_llm_response(text)

            if data:
                # Extract and log location
                loc = data.get("location", {})
                crime = data.get("crime", {})
                lat = loc.get("lat")
                lon = loc.get("lon")

                # Log details
                street = loc.get("street") or "?"
                city = loc.get("city") or "?"
                print(f"    Location: {street}, {city}")
                print(f"    Coords:   ({lat}, {lon}) conf={loc.get('confidence', '?')}")
                print(f"    Crime:    {crime.get('pks_category', '?')} ({crime.get('pks_code', '?')})")

                # Validate coordinates
                if lat and lon:
                    stats["with_coords"] += 1
                    if validate_coordinates(lat, lon):
                        stats["valid_coords"] += 1
                    else:
                        print(f"    WARNING: Coords outside Germany!")

                if crime.get("pks_code"):
                    stats["with_crime"] += 1

                results.append({**art, **data})
            else:
                print("    ERROR: Could not parse response")
                stats["errors"] += 1
                results.append(art)

        except Exception as e:
            print(f"    ERROR: {e}")
            stats["errors"] += 1
            results.append(art)

        print()  # Blank line between articles

    # Save results
    output_dir = Path("data/pipeline/chunks/enriched")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = output_dir / "test_llm_coords.json"

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    # Summary
    print("=" * 60)
    print(f"Done! {stats['total']} articles processed")
    print(f"  With coordinates:  {stats['with_coords']}")
    print(f"  Valid coords:      {stats['valid_coords']}")
    print(f"  With crime code:   {stats['with_crime']}")
    print(f"  Errors:            {stats['errors']}")
    print(f"  Output: {output_file}")


if __name__ == "__main__":
    main()
