#!/usr/bin/env python3
"""
Push enriched data to Supabase crime_records table.

Transforms the enriched JSON format to the Supabase schema and batch-upserts records.
Supports single-file mode (--input) or directory scanning (--input-dir) with optional
year filtering (--year).

Usage:
    python3 scripts/pipeline/push_to_supabase.py --input-dir data/pipeline/chunks/enriched/ --year 2026 --dry-run
    python3 scripts/pipeline/push_to_supabase.py --input-dir data/pipeline/chunks/enriched/ --year 2026 --run-name cron_2026
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
    "1310": "sexual",  # Exhibitionismus
    "1320": "sexual",  # Sexuelle Belästigung
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
    "Vergewaltigung": "sexual",
    "Sexuelle Belästigung": "sexual",
    "Sexueller Missbrauch": "sexual",
    "Exhibitionismus": "sexual",
    "Sexuelle Nötigung": "sexual",
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


import re as _re
import unicodedata as _unicodedata

# ── City name normalization (mirrors SQL normalize_city_name) ──

BERLIN_DISTRICTS = {
    "Mitte", "Neukölln", "Reinickendorf", "Steglitz-Zehlendorf",
    "Treptow-Köpenick", "Friedrichshain-Kreuzberg", "Charlottenburg-Wilmersdorf",
    "Spandau", "Tempelhof-Schöneberg", "Marzahn-Hellersdorf",
    "Lichtenberg", "Pankow", "Kreuzberg", "Friedrichshain",
    "Charlottenburg", "Wilmersdorf", "Schöneberg", "Tempelhof",
    "Steglitz", "Zehlendorf", "Treptow", "Köpenick",
    "Marzahn", "Hellersdorf", "Prenzlauer Berg", "Wedding",
    "Moabit", "Tiergarten", "Gesundbrunnen",
}

DISTRICT_SUFFIX_CITIES = {
    "Stuttgart", "Hamm", "Köln", "Dortmund", "Essen", "Duisburg",
    "Düsseldorf", "Bochum", "Wuppertal", "Bielefeld", "Gelsenkirchen",
    "Mönchengladbach", "Krefeld", "Oberhausen", "Hagen", "Bottrop",
    "Recklinghausen", "Remscheid", "Solingen", "Herne", "Mülheim",
    "Bonn", "Münster", "Mannheim", "Karlsruhe", "Freiburg",
    "Heidelberg", "Ulm", "Pforzheim", "Reutlingen", "Heilbronn",
    "München", "Nürnberg", "Augsburg", "Regensburg", "Würzburg",
    "Erlangen", "Fürth", "Ingolstadt", "Bamberg",
    "Frankfurt", "Wiesbaden", "Kassel", "Darmstadt", "Offenbach",
    "Hannover", "Braunschweig", "Oldenburg", "Osnabrück", "Wolfsburg",
    "Göttingen", "Hildesheim", "Salzgitter",
    "Bremen", "Bremerhaven",
    "Leipzig", "Dresden", "Chemnitz",
    "Magdeburg", "Halle",
    "Erfurt", "Jena", "Weimar",
    "Rostock", "Schwerin",
    "Kiel", "Lübeck", "Flensburg",
    "Mainz", "Ludwigshafen", "Koblenz", "Trier",
    "Saarbrücken",
}

COMPOUND_CITY_EXCLUSIONS = {
    "Baden-Baden", "Castrop-Rauxel", "Halle-Neustadt", "Frankfurt-Oder",
}


def normalize_city(city: str | None, bundesland: str | None) -> str | None:
    """Normalize city name to canonical form (mirrors SQL normalize_city_name)."""
    if not city or not city.strip():
        return None

    # Unicode dash normalization (U+2011 non-breaking hyphen → regular hyphen)
    c = city.strip().replace("\u2011", "-")

    # Kreis-as-city exclusion
    if _re.search(r"(?:land)?kreis", c, _re.IGNORECASE):
        return None

    # Berlin districts → "Berlin"
    if bundesland == "Berlin":
        if c in BERLIN_DISTRICTS:
            return "Berlin"
        if c.startswith("Berlin-"):
            return "Berlin"
        return c or "Berlin"

    # Frankfurt normalization
    if c == "Frankfurt" and (bundesland == "Hessen" or not bundesland):
        return "Frankfurt am Main"

    # City-District suffix stripping
    dash_idx = c.find("-")
    if dash_idx > 0:
        base = c[:dash_idx]
        if base in DISTRICT_SUFFIX_CITIES and c not in COMPOUND_CITY_EXCLUSIONS:
            if base == "Frankfurt" and bundesland == "Brandenburg":
                return c
            return base

    return c


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


# ---------------------------------------------------------------------------
# Weapon keyword → category mapping
# ---------------------------------------------------------------------------
# The LLM returns the actual German weapon name as free text.  We map to
# normalised categories for filtering.  New keywords can be added over time as
# we encounter more weapon names in the data.

_WEAPON_KEYWORDS: dict[str, list[str]] = {
    "knife": [
        "messer", "messern", "messers",
        "messerangriff", "messerattacke", "messerstich", "messerstiche", "messerähnlich",
        "machete",
        "butterflymesser", "cuttermesser", "cuttermessers",
        "klappmesser", "küchenmesser", "taschenmesser", "taschenmessers", "teppichmesser",
        "einhandmesser",
        "rasierklinge",
        "samuraischwert", "schwert", "säbel", "katana",
        "stichwaffe", "stichwaffen", "stichwerkzeug",
        "stichverletzung", "stichverletzungen", "stichwunde",
        "schnittverletzung", "schnittverletzungen",
        "spitzen gegenstand", "spitzem gegenstand",
        "stach", "stiche",
    ],
    "gun": [
        "schusswaffe", "schusswaffen", "pistole", "revolver", "gewehr",
        "schreckschusswaffe", "schreckschusspistole",
        "softairwaffe", "softair",
        "schüsse", "schuss",
    ],
    "blunt": [
        "schlagstock", "schlagstöcke", "baseballschläger",
        "knüppel", "stock", "eisenstange", "metallstange",
        "hammer", "flasche", "stein", "stuhl",
        "teleskopschlagstock",
    ],
    "axe": [
        "axt", "beil", "hatchet",
    ],
    "explosive": [
        "sprengstoff", "bombe", "granate", "feuerwerkskörper", "böller",
    ],
    "vehicle": [
        "fahrzeug", "pkw", "auto", "transporter", "lkw",
    ],
    "pepper_spray": [
        "pfefferspray", "reizgas", "tierabwehrspray", "cs-gas",
    ],
}

# Build a reverse lookup: keyword → category (longest keywords first for greedy match)
_WEAPON_KEYWORD_MAP: list[tuple[str, str]] = sorted(
    [(kw, cat) for cat, kws in _WEAPON_KEYWORDS.items() for kw in kws],
    key=lambda x: -len(x[0]),
)

# Old enum values from cached enrichments that should pass through directly
_LEGACY_WEAPON_ENUMS = {"knife", "gun", "blunt", "axe", "explosive", "vehicle", "pepper_spray", "other"}


def _classify_weapon(raw: str) -> str | None:
    """Map a free-text German weapon name to a normalised category.

    Returns the category string or 'other' if unrecognised non-empty input.
    Returns None for empty/null input.
    """
    if not raw or raw in ("none", "unknown", "null"):
        return None
    # Pass through legacy enum values from old cached enrichments
    if raw in _LEGACY_WEAPON_ENUMS:
        return raw
    for keyword, category in _WEAPON_KEYWORD_MAP:
        if keyword in raw:
            return category
    return "other"


# Body-text scan: (keyword, display_name, category) ordered most-specific-first
# per category so the scan returns the best match for each weapon type.
_WEAPON_BODY_SCAN: list[tuple[str, str, str]] = [
    # ── knife ──
    ("butterflymesser", "Butterflymesser", "knife"),
    ("cuttermesser", "Cuttermesser", "knife"),
    ("klappmesser", "Klappmesser", "knife"),
    ("küchenmesser", "Küchenmesser", "knife"),
    ("taschenmesser", "Taschenmesser", "knife"),
    ("teppichmesser", "Teppichmesser", "knife"),
    ("einhandmesser", "Einhandmesser", "knife"),
    ("machete", "Machete", "knife"),
    ("samuraischwert", "Samuraischwert", "knife"),
    ("schwert", "Schwert", "knife"),
    ("säbel", "Säbel", "knife"),
    ("katana", "Katana", "knife"),
    ("rasierklinge", "Rasierklinge", "knife"),
    ("stichwaffe", "Stichwaffe", "knife"),
    ("stichwaffen", "Stichwaffe", "knife"),
    ("stichwerkzeug", "Stichwerkzeug", "knife"),
    ("stichverletzung", "Stichverletzung", "knife"),
    ("stichverletzungen", "Stichverletzung", "knife"),
    ("stichwunde", "Stichwunde", "knife"),
    ("schnittverletzung", "Schnittverletzung", "knife"),
    ("schnittverletzungen", "Schnittverletzung", "knife"),
    ("spitzen gegenstand", "spitzer Gegenstand", "knife"),
    ("spitzem gegenstand", "spitzer Gegenstand", "knife"),
    ("messerangriff", "Messer", "knife"),
    ("messerattacke", "Messer", "knife"),
    ("messerstich", "Messer", "knife"),
    ("messerstiche", "Messer", "knife"),
    ("messer", "Messer", "knife"),
    # ── gun ──
    ("schreckschusspistole", "Schreckschusspistole", "gun"),
    ("schreckschusswaffe", "Schreckschusswaffe", "gun"),
    ("schreckschusswaffen", "Schreckschusswaffe", "gun"),
    ("softairpistole", "Softairpistole", "gun"),
    ("softair-pistole", "Softairpistole", "gun"),
    ("softairwaffe", "Softairwaffe", "gun"),
    ("luftdruckwaffe", "Luftdruckwaffe", "gun"),
    ("luftdruckpistole", "Luftdruckpistole", "gun"),
    ("luftgewehr", "Luftgewehr", "gun"),
    ("gaspistole", "Gaspistole", "gun"),
    ("schusswaffe", "Schusswaffe", "gun"),
    ("schusswaffen", "Schusswaffe", "gun"),
    ("pistole", "Pistole", "gun"),
    ("revolver", "Revolver", "gun"),
    ("gewehr", "Gewehr", "gun"),
    ("schüsse", "Schusswaffe", "gun"),
    # ── blunt ──
    ("teleskopschlagstock", "Teleskopschlagstock", "blunt"),
    ("baseballschläger", "Baseballschläger", "blunt"),
    ("schlagstock", "Schlagstock", "blunt"),
    ("schlagstöcke", "Schlagstock", "blunt"),
    ("eisenstange", "Eisenstange", "blunt"),
    ("metallstange", "Metallstange", "blunt"),
    ("glasflasche", "Glasflasche", "blunt"),
    ("hammer", "Hammer", "blunt"),
    # ── axe ──
    ("axt", "Axt", "axe"),
    ("beil", "Beil", "axe"),
    # ── pepper_spray ──
    ("tierabwehrspray", "Tierabwehrspray", "pepper_spray"),
    ("pfefferspray", "Pfefferspray", "pepper_spray"),
    ("reizgas", "Reizgas", "pepper_spray"),
    ("cs-gas", "CS-Gas", "pepper_spray"),
    # ── explosive ──
    ("feuerwerkskörper", "Feuerwerkskörper", "explosive"),
    ("sprengstoff", "Sprengstoff", "explosive"),
    ("granate", "Granate", "explosive"),
    ("bombe", "Bombe", "explosive"),
    ("böller", "Böller", "explosive"),
]


def _scan_body_for_weapons(body: str) -> list[tuple[str, str]]:
    """Scan article body for weapon keywords across all categories.

    Returns a list of (display_name, category) for the first match per category.
    Most specific keywords match first within each category.
    """
    if not body:
        return []
    body_lower = body.lower()
    found: dict[str, str] = {}  # category → display_name (first match wins)
    for keyword, display, category in _WEAPON_BODY_SCAN:
        if category not in found and keyword in body_lower:
            found[category] = display
    return [(display, cat) for cat, display in found.items()]


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

    # Extract weapon_types: LLM now returns free-text German names (e.g. "Machete", "Messer").
    # We store the raw name in weapon_detail and map to categories via keywords.
    raw_weapon_types = details.get("weapon_types")
    if not isinstance(raw_weapon_types, list):
        # Fallback for old cached enrichment results with singular weapon_type
        old_wt = details.get("weapon_type")
        raw_weapon_types = [old_wt] if old_wt and old_wt not in ("none", "unknown") else []

    # Join raw weapon names into a single detail string (skip none/unknown/null)
    _skip_detail = {"none", "unknown", "null", ""}
    detail_parts = [str(w) for w in raw_weapon_types if w and str(w).lower() not in _skip_detail]
    weapon_detail = ", ".join(detail_parts) if detail_parts else None

    # Map free-text weapon names to categories
    weapon_types = []
    for raw in raw_weapon_types:
        cat = _classify_weapon(str(raw).lower()) if raw else None
        if cat and cat not in weapon_types:
            weapon_types.append(cat)

    # Primary weapon for backward compat (weapon_type column)
    weapon_type = weapon_types[0] if weapon_types else None

    # Fallback: scan body text for weapon keywords the LLM missed
    body_text = article.get("body", "")
    body_weapons = _scan_body_for_weapons(body_text)
    for display, cat in body_weapons:
        if cat not in weapon_types:
            weapon_types.append(cat)
            if weapon_type is None:
                weapon_type = cat
            if not weapon_detail:
                weapon_detail = display

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
    valid_motives = {"domestic", "robbery", "hate", "drugs", "road_rage", "dispute", "sexual", "unknown"}
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
        "body": article.get("incident_body") or article.get("body"),
        "published_at": published_at,
        "source_url": url,
        "source_agency": article.get("source"),
        "location_text": location_text,
        "district": loc.get("district"),
        "latitude": lat,
        "longitude": lon,
        "precision": map_precision(article),
        "categories": map_category(crime),
        "weapon_type": weapon_type,
        "weapon_types": weapon_types,
        "weapon_detail": weapon_detail,
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
        "city": normalize_city(
            loc.get("city") if isinstance(loc.get("city"), str) and loc.get("city", "").strip() else None,
            (article.get("bundesland") or loc.get("bundesland"))
            if isinstance(article.get("bundesland") or loc.get("bundesland"), str)
            else None,
        ),
        "bundesland": (
            article.get("bundesland") or loc.get("bundesland")
            if isinstance(article.get("bundesland") or loc.get("bundesland"), str)
            else None
        ),
        "kreis_ags": None,   # computed via backfill or point-in-polygon post-push
        "kreis_name": None,
        "pks_category": crime.get("pks_category") if isinstance(crime.get("pks_category"), str) and crime.get("pks_category", "").strip() else None,
        "damage_amount_eur": damage_amount_eur,
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
