#!/usr/bin/env python3
"""
Transform enriched Blaulicht articles to CrimeRecord format for map display.

Converts blaulicht_enriched.json → public/crimes.json

Usage:
    python scripts/transform_to_crimes.py
    python scripts/transform_to_crimes.py --input blaulicht_enriched.json --output public/crimes.json
"""

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

# Built-in German city coordinates (lat, lon)
# Covers major cities and those appearing in Blaulicht reports
GERMAN_CITY_COORDS = {
    # Major cities
    "Berlin": (52.52, 13.405),
    "Hamburg": (53.5511, 9.9937),
    "München": (48.1351, 11.582),
    "Köln": (50.9375, 6.9603),
    "Frankfurt": (50.1109, 8.6821),
    "Frankfurt am Main": (50.1109, 8.6821),
    "Stuttgart": (48.7758, 9.1829),
    "Düsseldorf": (51.2277, 6.7735),
    "Dortmund": (51.5136, 7.4653),
    "Essen": (51.4556, 7.0116),
    "Leipzig": (51.3397, 12.3731),
    "Bremen": (53.0793, 8.8017),
    "Dresden": (51.0504, 13.7373),
    "Hannover": (52.3759, 9.732),
    "Nürnberg": (49.4521, 11.0767),
    "Duisburg": (51.4344, 6.7623),
    "Bochum": (51.4818, 7.2162),
    "Wuppertal": (51.2562, 7.1508),
    "Bielefeld": (52.0302, 8.5325),
    "Bonn": (50.7374, 7.0982),
    "Münster": (51.9607, 7.6261),
    "Karlsruhe": (49.0069, 8.4037),
    "Mannheim": (49.4875, 8.466),
    "Augsburg": (48.3705, 10.8978),
    "Wiesbaden": (50.0782, 8.2398),
    "Mönchengladbach": (51.1805, 6.4428),
    "Gelsenkirchen": (51.5177, 7.0857),
    "Braunschweig": (52.2689, 10.5268),
    "Aachen": (50.7753, 6.0839),
    "Kiel": (54.3233, 10.1228),
    "Chemnitz": (50.8278, 12.9214),
    "Halle": (51.4969, 11.9688),
    "Magdeburg": (52.1205, 11.6276),
    "Freiburg": (47.999, 7.8421),
    "Krefeld": (51.3388, 6.5853),
    "Mainz": (49.9929, 8.2473),
    "Lübeck": (53.8655, 10.6866),
    "Erfurt": (50.9848, 11.0299),
    "Oberhausen": (51.4963, 6.8637),
    "Rostock": (54.0924, 12.0991),
    "Kassel": (51.3127, 9.4797),
    "Hagen": (51.3671, 7.4633),
    "Potsdam": (52.3906, 13.0645),
    "Saarbrücken": (49.2402, 6.9969),
    "Hamm": (51.6739, 7.8159),
    "Ludwigshafen": (49.4774, 8.4452),
    "Oldenburg": (53.1435, 8.2146),
    "Osnabrück": (52.2799, 8.0472),
    "Leverkusen": (51.0459, 6.9844),
    "Heidelberg": (49.3988, 8.6724),
    "Darmstadt": (49.8728, 8.6512),
    "Regensburg": (49.0134, 12.1016),
    "Würzburg": (49.7913, 9.9534),
    "Göttingen": (51.5413, 9.9158),
    "Wolfsburg": (52.4227, 10.7865),
    "Heilbronn": (49.1427, 9.2109),
    "Ulm": (48.4011, 9.9876),
    "Pforzheim": (48.8922, 8.6947),
    "Offenbach": (50.0956, 8.7761),
    "Ingolstadt": (48.7665, 11.4258),
    "Reutlingen": (48.4914, 9.2043),
    "Koblenz": (50.3569, 7.5889),
    "Trier": (49.7596, 6.6439),
    "Kaiserslautern": (49.4401, 7.7491),

    # Cities from Blaulicht data
    "Neu-Isenburg": (50.0503, 8.6951),
    "Trossingen": (48.0761, 8.6364),
    "Spaichingen": (48.0756, 8.7361),
    "Hainburg": (50.0667, 8.9333),
    "Isterberg": (52.2833, 7.0167),
    "Heimsheim": (48.8047, 8.8644),
    "Hasborn": (49.7833, 6.8667),
    "Menden": (51.4436, 7.7978),
    "Föhren": (49.8567, 6.7689),
    "Bekond": (49.8333, 6.8333),
    "Bad Kreuznach": (49.8414, 7.8672),
    "Gevelsberg": (51.3236, 7.3386),
    "Greven": (52.0931, 7.6086),
    "Dormagen": (51.0964, 6.8319),
    "Viersen": (51.2556, 6.3942),
    "Willich": (51.2639, 6.5494),
    "Tönisvorst": (51.3217, 6.4908),
    "Bad Säckingen": (47.5536, 7.9458),
    "Crivitz": (53.5736, 11.6519),
    "Gundersheim": (49.6833, 8.1833),
    "Biedesheim": (49.6333, 8.1333),
    "Altenglan": (49.5333, 7.4667),
    "Frankenthal": (49.5333, 8.35),
    "Alzey": (49.7464, 8.1147),
    "Wörrstadt": (49.8456, 8.1247),
    "Alfeld": (51.9833, 9.8167),
    "Biedenkopf": (50.9108, 8.5297),
    "Brockscheid": (50.2, 6.8833),
    "Brüggen": (51.2403, 6.1847),
    "Guxhagen": (51.2028, 9.4667),
    "Konz": (49.6939, 6.5756),
    "Stadtroda": (50.8597, 11.7331),
    "Tautenhain": (50.9333, 11.8833),
}

# Normalize city name for lookup
def normalize_city(name: str) -> str:
    """Normalize city name for lookup."""
    # Remove common suffixes
    name = re.sub(r'\s*\(.*?\)\s*', '', name)  # Remove parenthetical
    name = re.sub(r'\s*/\s*.*$', '', name)  # Remove slash and after
    name = name.strip()
    return name

def lookup_city_coords(city: str) -> tuple[Optional[float], Optional[float]]:
    """Look up city coordinates from built-in table."""
    if not city:
        return None, None

    normalized = normalize_city(city)

    # Direct lookup
    if normalized in GERMAN_CITY_COORDS:
        return GERMAN_CITY_COORDS[normalized]

    # Case-insensitive lookup
    city_lower = normalized.lower()
    for name, coords in GERMAN_CITY_COORDS.items():
        if name.lower() == city_lower:
            return coords

    # Partial match (city name contains or is contained)
    for name, coords in GERMAN_CITY_COORDS.items():
        if name.lower() in city_lower or city_lower in name.lower():
            return coords

    return None, None

# PKS code to CrimeCategory mapping
PKS_TO_CATEGORY = {
    # Violence → assault
    "0100": "assault",  # Mord
    "0200": "assault",  # Totschlag
    "0300": "assault",  # Tötung auf Verlangen
    "2200": "assault",  # Körperverletzung
    "2320": "assault",  # Freiheitsberaubung
    "2330": "assault",  # Nötigung
    "2340": "assault",  # Bedrohung

    # Robbery
    "2100": "robbery",

    # Sexual crimes → assault (for now)
    "1100": "assault",  # Vergewaltigung
    "1300": "assault",  # Sexueller Missbrauch

    # Burglary/Theft
    "3000": "burglary",  # Diebstahl ohne erschwerende Umstände
    "4000": "burglary",  # Diebstahl unter erschwerenden Umständen
    "4350": "burglary",  # Wohnungseinbruchdiebstahl
    "4730": "burglary",  # Taschendiebstahl
    "4780": "burglary",  # Kfz-Diebstahl

    # Fraud
    "5100": "fraud",  # Betrug
    "5180": "fraud",  # Leistungserschleichung
    "5200": "fraud",  # Unterschlagung

    # Arson
    "6740": "arson",  # Brandstiftung

    # Property damage → other
    "6200": "other",  # Widerstand gegen Vollstreckungsbeamte
    "6750": "other",  # Sachbeschädigung

    # Traffic
    "7100": "traffic",  # Verkehrsunfall mit Personenschaden
    "7200": "traffic",  # Unerlaubtes Entfernen vom Unfallort
    "7300": "traffic",  # Trunkenheit im Verkehr

    # Drugs → other
    "8910": "other",  # Allgemeine Verstöße BtMG
    "8920": "other",  # Illegaler Handel BtMG
}

# Keywords for knife crime detection
KNIFE_KEYWORDS = [
    r'\bmesser\b',
    r'\bmesserattacke\b',
    r'\bmesserstich\b',
    r'\bgestochen\b',
    r'\bstichverletzung\b',
    r'\bstichwaffe\b',
]
KNIFE_PATTERN = re.compile('|'.join(KNIFE_KEYWORDS), re.IGNORECASE)


def detect_knife_crime(body: str) -> bool:
    """Check if article mentions knife crime."""
    return bool(KNIFE_PATTERN.search(body))


def get_crime_categories(pks_code: Optional[str], body: str) -> list[str]:
    """Map PKS code to CrimeCategory, with knife detection."""
    categories = []

    # Check for knife crime first (highest priority)
    if detect_knife_crime(body):
        categories.append("knife")

    # Map PKS code to category
    if pks_code and pks_code in PKS_TO_CATEGORY:
        category = PKS_TO_CATEGORY[pks_code]
        if category not in categories:
            categories.append(category)

    # Default to "other" if no category found
    if not categories:
        categories.append("other")

    return categories


def extract_article_id(url: str) -> str:
    """Extract article ID from Presseportal URL."""
    # URL format: https://www.presseportal.de/blaulicht/pm/AGENCY_ID/ARTICLE_ID
    match = re.search(r'/pm/\d+/(\d+)', url)
    if match:
        return match.group(1)
    return url.split('/')[-1]


def build_location_text(location: dict) -> Optional[str]:
    """Build human-readable location string."""
    parts = []

    if location.get("street"):
        street = location["street"]
        if location.get("house_number"):
            street += f" {location['house_number']}"
        parts.append(street)

    if location.get("district"):
        parts.append(location["district"])

    if location.get("city"):
        parts.append(location["city"])

    return ", ".join(parts) if parts else None


def transform_article(article: dict, verbose: bool = False) -> dict:
    """Transform an enriched article to CrimeRecord format."""

    location = article.get("location", {})
    crime = article.get("crime", {})
    incident_time = article.get("incident_time", {})

    # Get coordinates from enrichment or lookup by city
    lat = location.get("lat")
    lon = location.get("lon")

    # Use built-in city lookup if no coordinates
    if lat is None:
        city = location.get("city")
        if city:
            lat, lon = lookup_city_coords(city)
            if verbose and lat:
                print(f"    Looked up: {city} → ({lat}, {lon})")

    # Determine precision
    if lat is not None:
        if location.get("street"):
            precision = "street"
        elif location.get("district"):
            precision = "neighborhood"
        elif location.get("city"):
            precision = "city"
        else:
            precision = "region"
    else:
        precision = "unknown"

    # Build categories
    categories = get_crime_categories(crime.get("pks_code"), article.get("body", ""))

    # Get timestamp
    published_at = article.get("date", "")
    if incident_time.get("date"):
        # Use incident time if available
        incident_date = incident_time["date"]
        incident_hour = incident_time.get("time", "00:00")
        if incident_hour:
            published_at = f"{incident_date}T{incident_hour}:00"
        else:
            published_at = f"{incident_date}T00:00:00"

    return {
        "id": extract_article_id(article.get("url", "")),
        "title": article.get("title", ""),
        "summary": crime.get("sub_type"),
        "body": article.get("body"),  # Full press release text
        "publishedAt": published_at,
        "sourceUrl": article.get("url", ""),
        "sourceAgency": article.get("source"),
        "locationText": build_location_text(location),
        "latitude": lat,
        "longitude": lon,
        "precision": precision,
        "categories": categories,
        "confidence": crime.get("confidence", 0.5),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Transform enriched articles to CrimeRecord format",
    )
    parser.add_argument(
        "--input", "-i",
        default="blaulicht_enriched.json",
        help="Input enriched JSON file"
    )
    parser.add_argument(
        "--output", "-o",
        default="public/crimes.json",
        help="Output CrimeRecord JSON file"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Verbose output"
    )

    args = parser.parse_args()

    # Load input
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: Input file not found: {args.input}")
        sys.exit(1)

    with open(input_path, "r", encoding="utf-8") as f:
        articles = json.load(f)

    print(f"Loaded {len(articles)} enriched articles from {args.input}")
    print(f"Using built-in German city coordinates lookup")

    # Transform articles
    records = []
    geocoded_count = 0

    for i, article in enumerate(articles, 1):
        record = transform_article(article, args.verbose)
        records.append(record)

        if record["latitude"] is not None:
            geocoded_count += 1

        if i % 10 == 0 or i == len(articles):
            print(f"  Processed: {i}/{len(articles)} (geocoded: {geocoded_count})")

    # Build output dataset
    dates = [r["publishedAt"][:10] for r in records if r["publishedAt"]]
    date_range = {
        "start": min(dates) if dates else "",
        "end": max(dates) if dates else "",
    }

    output = {
        "generatedAt": datetime.now().isoformat(),
        "source": "presseportal",
        "range": date_range,
        "records": records,
    }

    # Ensure output directory exists
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # Summary
    category_counts = {}
    for r in records:
        for cat in r["categories"]:
            category_counts[cat] = category_counts.get(cat, 0) + 1

    print()
    print("=" * 50)
    print(f"Saved {len(records)} crime records to {args.output}")
    print()
    print("Summary:")
    print(f"  Geocoded: {geocoded_count}/{len(records)}")
    print(f"  Date range: {date_range['start']} to {date_range['end']}")
    print()
    print("Categories:")
    for cat, count in sorted(category_counts.items(), key=lambda x: -x[1]):
        print(f"  {cat}: {count}")
    print("=" * 50)


if __name__ == "__main__":
    main()
