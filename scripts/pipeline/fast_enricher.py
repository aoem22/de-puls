#!/usr/bin/env python3
"""
Single-round AI enrichment for Blaulicht articles.

One unified LLM call per batch:
  - Classifies articles (crime / junk / feuerwehr) inline
  - Extracts structured data (location, crime, details, clean_title)
  - Multi-incident splitting for digest articles

Rule-based junk filter and incident grouping run upstream (weekly_processor)
or optionally inside enrich_all().

Usage:
    python -m scripts.pipeline.fast_enricher --input data.json --output enriched.json
"""

import hashlib
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path

import certifi
import requests
from dotenv import load_dotenv
from openai import OpenAI

# Load .env
load_dotenv()

# Fix SSL on macOS
os.environ['SSL_CERT_FILE'] = certifi.where()

# Settings
MODEL = "x-ai/grok-4-fast"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
API_DELAY = 0.2  # Seconds between API calls

# Batch sizes
UNIFIED_BATCH_SIZE = 8      # Articles per LLM call (unified enrichment + classification)
UNIFIED_MAX_TOKENS = 10000  # Max tokens for unified prompt response


# ── Unified Prompt (classification + enrichment in 1 round) ──────

UNIFIED_PROMPT = """
Analysiere diese {count} deutschen Polizeipressemeldungen. Klassifiziere und extrahiere strukturierte Daten in EINEM Schritt.

=== REGEL 0: KLASSIFIKATION ===
Prüfe ZUERST ob der Artikel ein Straftatbericht ist:

KEIN Straftatbericht ("junk") — NUR diese Antwort zurückgeben:
  {{"article_index": N, "classification": "junk", "reason": "Verkehrshinweis/Bilanz/etc."}}
Beispiele: Verkehrshinweise, Spendenaufrufe, Erreichbarkeitshinweise, Kontrollaktionen, Warnmeldungen, Tag der offenen Tür, Blitzerstandorte, Bilanzberichte, Präventionshinweise, Stellenangebote, Veranstaltungen

Feuerwehr ohne Polizeibezug ("feuerwehr") — NUR diese Antwort zurückgeben:
  {{"article_index": N, "classification": "feuerwehr", "reason": "Feuerwehreinsatz ohne Straftat"}}
Erkenne Feuerwehr an: Quelle enthält "Feuerwehr"/"Brandschutz"/"Rettungsdienst", Inhalt nur Brand/Rettung ohne Straftatverdacht

IST ein Straftatbericht → Vollständige Enrichment-Daten extrahieren (siehe unten), mit "classification": "crime"

=== REGEL 1: MULTI-INCIDENT ERKENNUNG ===
Erkenne Sammelartikel an diesen Markern:
- Nummerierte Abschnitte (1., 2., 3. oder I., II., III.)
- Mehrere "POL-" Header im Text
- "Weitere Meldungen:" oder "Außerdem:" Trennzeichen
- Mehrere verschiedene Straßen/Städte im selben Artikel
- Artikel mit 1500+ Wörtern und mehreren Orten
Jeder separate Vorfall MUSS ein eigenes JSON-Objekt werden!

=== REGEL 2: NUR DEUTSCHLAND ===
Alle Vorfälle sind in DEUTSCHLAND. Extrahiere NUR deutsche Städte.
Häufige Verwechslungen:
- "Basel" → Wenn Polizeipräsidium Freiburg: wahrscheinlich Grenzach-Wyhlen, Weil am Rhein, oder Lörrach (NICHT Basel, Schweiz!)
- "Frankfurt" → Ohne Zusatz "Oder": Frankfurt am Main (Hessen). MIT "(Oder)": Frankfurt (Oder) (Brandenburg)
- "Freiburg" → Freiburg im Breisgau (Baden-Württemberg), NICHT Freiburg (Schweiz)
- "Konstanz" → Konstanz am Bodensee (Baden-Württemberg), NICHT Kreuzlingen (Schweiz)
Nutze den Bundesland-Kontext aus der Quelle zur Disambiguation. Wenn unklar, wähle die DEUTSCHE Stadt.

=== REGEL 3: TATZEIT EXTRAKTION ===
Extrahiere IMMER eine Tatzeit wenn der Text Zeitangaben enthält. Mappings:
- "gegen 14:30 Uhr" → time="14:30", precision="approximate"
- "um 14:30 Uhr" → time="14:30", precision="exact"
- "zwischen 14:30 und 16:30 Uhr" → time="14:30", precision="approximate" (Startzeit)
- "zwischen 8 und 10 Uhr" → time="08:00", precision="approximate" (Startzeit)
- "im Zeitraum von 8 bis 12 Uhr" → time="08:00", precision="approximate" (Startzeit)
- "in der Zeit von Freitag, 18 Uhr, bis Samstag, 8 Uhr" → time="18:00", precision="approximate" (Startzeit, Datum = Freitag)
- "im Laufe des Wochenendes" → time=null, precision="approximate" (Datum = Samstag)
- "in der Nacht zum Samstag" → time="02:00", precision="approximate"
- "am frühen Morgen" → time="06:00", precision="approximate"
- "am Vormittag" → time="10:00", precision="approximate"
- "am Mittag" / "mittags" → time="12:00", precision="approximate"
- "am Nachmittag" / "nachmittags" → time="15:00", precision="approximate"
- "am Abend" / "abends" → time="20:00", precision="approximate"
- "in den Abendstunden" → time="21:00", precision="approximate"
- "in der Nacht" / "nachts" → time="01:00", precision="approximate"
- "Freitagnacht" → time="01:00", precision="approximate" (+ korrektes Datum)
KRITISCH: Wenn IRGENDEIN Zeithinweis im Text steht, darf precision NICHT "unknown" sein!
precision="unknown" NUR wenn wirklich KEINE Zeitangabe im gesamten Text vorkommt.

Für JEDEN Straftat-Vorfall, extrahiere:
1. STANDORT: street, house_number, district, city, location_hint, cross_street, confidence (0-1)
   - location_hint: Gebäude/Objekt am Tatort falls im Text erwähnt (z.B. "Tankstelle", "Studentenwohnheim", "Hauptbahnhof", "Marktplatz", "Supermarkt", "Parkhaus"). null wenn kein besonderes Objekt.
   - cross_street: Bei Kreuzungen die zweite Straße (z.B. bei "Kreuzung A-Straße / B-Straße" → street="A-Straße", cross_street="B-Straße"). null wenn keine Kreuzung.
2. TATZEIT: date (YYYY-MM-DD), time (HH:MM), precision (exact/approximate/unknown)
3. DELIKT (PKS): pks_code (4-stellig), pks_category, sub_type, confidence (0-1)
4. DETAILS: weapon_type, drug_type, victim_count, suspect_count, victim_age, suspect_age, victim_gender, suspect_gender, victim_herkunft, suspect_herkunft, severity, motive
5. TITEL: Erstelle einen kurzen, sachlichen Titel (max 80 Zeichen).
   Kein Polizeikürzel (POL-MA, etc.), keine PM-Nummern, kein reißerischer Stil.
   Beispiel: "Messerangriff in Mannheimer Innenstadt — Mann schwer verletzt"

PKS-Kategorien:
- 0100: Mord/Totschlag, 0200: Tötungsdelikt
- 1100: Vergewaltigung/sexuelle Nötigung, 1300: Sexueller Missbrauch
- 2100: Raub, 2200: Körperverletzung, 2340: Bedrohung
- 3000/4000: Diebstahl, 4350: Wohnungseinbruch, 4780: Kfz-Diebstahl
- 5100: Betrug, 6740: Brandstiftung, 6750: Sachbeschädigung
- 7100: Verkehrsunfall, 7200: Fahrerflucht, 7300: Trunkenheit
- 8910: Drogen

Feldwerte (nur diese verwenden):
- weapon_type: knife|gun|blunt|explosive|vehicle|none|unknown
- drug_type: cannabis|cocaine|amphetamine|heroin|ecstasy|meth|other|null
- severity: minor|serious|critical|fatal|property_only|unknown
- motive: domestic|robbery|hate|drugs|road_rage|dispute|unknown|null
- victim_age/suspect_age: Alter als String oder null wenn unbekannt
- victim_gender/suspect_gender: male|female|unknown|null
- victim_herkunft/suspect_herkunft: Staatsangehörigkeit falls EXPLIZIT im Text erwähnt (z.B. "syrisch", "polnisch", "deutsch"), sonst null. NUR extrahieren wenn im Text genannt.

ARTIKEL:
{articles_json}

Antworte NUR mit JSON-Array. Mische junk/feuerwehr-Objekte und crime-Objekte:
[
  {{"article_index": 0, "classification": "junk", "reason": "Verkehrshinweis"}},
  {{"article_index": 1, "classification": "crime", "clean_title": "Messerangriff in Mannheim — Mann schwer verletzt", "location": {{"street": "...", "house_number": null, "district": null, "city": "...", "location_hint": "Tankstelle", "cross_street": null, "confidence": 0.8}}, "incident_time": {{"date": "YYYY-MM-DD", "time": "HH:MM", "precision": "exact"}}, "crime": {{"pks_code": "XXXX", "pks_category": "...", "sub_type": "...", "confidence": 0.9}}, "details": {{"weapon_type": "knife", "drug_type": null, "victim_count": 1, "suspect_count": 1, "victim_age": "34", "suspect_age": "22", "victim_gender": "male", "suspect_gender": "male", "victim_herkunft": null, "suspect_herkunft": "syrisch", "severity": "serious", "motive": "dispute"}}}},
  {{"article_index": 2, "classification": "feuerwehr", "reason": "Feuerwehreinsatz"}}
]
"""

# Backwards-compat alias (quality_fix.py imports ENRICHMENT_PROMPT_V2)
ENRICHMENT_PROMPT_V2 = UNIFIED_PROMPT


# Germany bounding box for coordinate validation
GERMANY_BBOX = {
    "lat_min": 47.27,
    "lat_max": 55.06,
    "lon_min": 5.87,
    "lon_max": 15.04,
}


def is_in_germany(lat: float, lon: float) -> bool:
    """Check if coordinates fall within Germany's bounding box."""
    if lat is None or lon is None:
        return False
    return (
        GERMANY_BBOX["lat_min"] <= lat <= GERMANY_BBOX["lat_max"]
        and GERMANY_BBOX["lon_min"] <= lon <= GERMANY_BBOX["lon_max"]
    )


class FastEnricher:
    """Single-round article enricher with Google Maps geocoding."""

    def __init__(self, cache_dir: str = ".cache", no_geocode: bool = False, model: str = None):
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY required")

        self.google_maps_key = os.environ.get("GOOGLE_MAPS_API_KEY")
        if not no_geocode and not self.google_maps_key:
            raise ValueError("GOOGLE_MAPS_API_KEY required for geocoding")

        self.client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)
        self.model = model or MODEL
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / "enrichment_cache.json"
        self.geocode_file = self.cache_dir / "geocode_cache.json"
        self.cache = self._load_cache(self.cache_file)
        self.geocode_cache = self._load_cache(self.geocode_file) if not no_geocode else {}
        self.no_geocode = no_geocode

    def _load_cache(self, path: Path) -> dict:
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_cache(self, cache: dict, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)

    def _cache_key(self, url: str, body: str) -> str:
        return hashlib.sha256(f"{url}:{body}".encode()).hexdigest()[:16]

    def _call_llm(self, prompt: str, max_tokens: int = 4000) -> list[dict]:
        """Call LLM and parse JSON array response."""
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=max_tokens,
            )
            text = response.choices[0].message.content

            # Parse JSON response
            text = text.strip()
            if "```json" in text:
                text = text.split("```json", 1)[1]
            if "```" in text:
                text = text.split("```")[0]

            # Find the array
            match = re.search(r'\[[\s\S]*\]', text)
            if match:
                return json.loads(match.group())
            return []

        except Exception as e:
            print(f"    LLM error: {e}")
            return []

    # ── Enrichment ─────────────────────────────────────────────────

    def _enrich_batch(self, articles: list[dict], max_tokens: int = UNIFIED_MAX_TOKENS) -> list[dict]:
        """Enrich a batch of articles with unified classification + enrichment."""
        articles_data = []
        for i, art in enumerate(articles):
            articles_data.append({
                "index": i,
                "title": art.get("title", "")[:200],
                "body": art.get("body", ""),  # Full body — no truncation
                "date": art.get("date", ""),
                "city": art.get("city", ""),
                "source": art.get("source", ""),  # Needed for feuerwehr detection
            })

        prompt = UNIFIED_PROMPT.format(
            count=len(articles),
            articles_json=json.dumps(articles_data, ensure_ascii=False, indent=2)
        )

        return self._call_llm(prompt, max_tokens=max_tokens)

    def _enrich_articles(self, articles: list[dict]) -> tuple[list[dict], list[dict]]:
        """Enrich articles with unified classification + enrichment.

        Returns (enriched_records, removed_records).
        """
        uncached = []
        uncached_indices = []
        results_by_idx: dict[int, list[dict]] = {}
        removed_by_idx: dict[int, dict] = {}

        regeocode_count = 0
        for i, art in enumerate(articles):
            key = self._cache_key(art.get("url", ""), art.get("body", ""))
            if key in self.cache:
                cached = self.cache[key]
                entries = cached if isinstance(cached, list) else [cached]

                # Check for classification sentinel (junk/feuerwehr from previous run)
                if len(entries) == 1 and entries[0].get("_classification"):
                    cls = entries[0]["_classification"]
                    removed_by_idx[i] = {
                        **art,
                        "_removal_reason": f"llm:{cls}",
                        "_triage_reason": entries[0].get("reason", ""),
                    }
                    continue

                # Re-geocode cached entries missing coordinates
                if not self.no_geocode:
                    updated = False
                    for entry in entries:
                        loc = entry.get("location", {})
                        if isinstance(loc, dict) and not loc.get("lat") and (loc.get("street") or loc.get("city")):
                            lat, lon, precision = self._geocode(
                                street=loc.get("street"),
                                city=loc.get("city") or art.get("city"),
                                district=loc.get("district"),
                                bundesland=art.get("bundesland"),
                                location_hint=loc.get("location_hint"),
                                cross_street=loc.get("cross_street"),
                            )
                            loc["lat"] = lat
                            loc["lon"] = lon
                            loc["precision"] = precision
                            loc["bundesland"] = art.get("bundesland")
                            updated = True
                            regeocode_count += 1
                    if updated:
                        self.cache[key] = entries

                results_by_idx[i] = [{**art, **e} for e in entries]
            else:
                uncached.append(art)
                uncached_indices.append(i)

        cached_count = len(articles) - len(uncached) - len(removed_by_idx)
        cached_removed = len(removed_by_idx)
        if cached_count > 0 or cached_removed > 0:
            geo_msg = f", {regeocode_count} re-geocoded" if regeocode_count else ""
            removed_msg = f", {cached_removed} cached-removed" if cached_removed else ""
            print(f"  Enrichment: {cached_count} cached{geo_msg}{removed_msg}, {len(uncached)} to enrich")

        if uncached:
            batch_size = UNIFIED_BATCH_SIZE
            max_tokens = UNIFIED_MAX_TOKENS
            batches = [uncached[i:i + batch_size] for i in range(0, len(uncached), batch_size)]
            print(f"  Enrichment: processing {len(uncached)} articles in {len(batches)} batches...")

            batch_offset = 0
            for batch_num, batch in enumerate(batches, 1):
                llm_results = self._enrich_batch(batch, max_tokens=max_tokens)

                # Group LLM results by article_index
                incidents_by_idx: dict[int, list[dict]] = {}
                for llm_result in llm_results:
                    idx = llm_result.get("article_index", -1)
                    if 0 <= idx < len(batch):
                        incidents_by_idx.setdefault(idx, []).append(llm_result)

                # Process each article's results
                for idx, incidents in incidents_by_idx.items():
                    art = batch[idx]
                    orig_idx = uncached_indices[batch_offset + idx]
                    key = self._cache_key(art.get("url", ""), art.get("body", ""))

                    # Check if LLM classified as junk/feuerwehr
                    first = incidents[0]
                    classification = first.get("classification", "crime")

                    if classification in ("junk", "feuerwehr"):
                        # Store sentinel in enrichment cache
                        self.cache[key] = [{"_classification": classification, "reason": first.get("reason", "")}]
                        removed_by_idx[orig_idx] = {
                            **art,
                            "_removal_reason": f"llm:{classification}",
                            "_triage_reason": first.get("reason", ""),
                        }
                        continue

                    # Crime — extract enrichment data
                    enrichments = []
                    for llm_result in incidents:
                        loc = llm_result.get("location") or {}
                        enrichment = {
                            "clean_title": llm_result.get("clean_title"),
                            "location": loc,
                            "incident_time": llm_result.get("incident_time") or {},
                            "crime": llm_result.get("crime") or {},
                            "details": llm_result.get("details") or {},
                        }

                        # Geocode if we have location data
                        if loc.get("street") or loc.get("city") or loc.get("district"):
                            lat, lon, precision = self._geocode(
                                street=loc.get("street"),
                                city=loc.get("city") or art.get("city"),
                                district=loc.get("district"),
                                bundesland=art.get("bundesland"),
                                location_hint=loc.get("location_hint"),
                                cross_street=loc.get("cross_street"),
                            )
                            enrichment["location"]["lat"] = lat
                            enrichment["location"]["lon"] = lon
                            enrichment["location"]["precision"] = precision
                            enrichment["location"]["bundesland"] = art.get("bundesland")

                        enrichments.append(enrichment)

                    self.cache[key] = enrichments
                    results_by_idx[orig_idx] = [{**art, **e} for e in enrichments]

                batch_offset += len(batch)

                geocoded = sum(
                    1 for records in results_by_idx.values()
                    for r in records if r.get("location", {}).get("lat")
                )
                total_records = sum(len(records) for records in results_by_idx.values())
                batch_removed = len(removed_by_idx)
                print(
                    f"    Batch {batch_num}/{len(batches)}: "
                    f"{total_records} enriched, {geocoded} geocoded, {batch_removed} removed",
                    flush=True,
                )

                if batch_num < len(batches):
                    time.sleep(API_DELAY)

        # Build flat output lists
        enriched = []
        for i in range(len(articles)):
            if i in results_by_idx:
                enriched.extend(results_by_idx[i])

        removed = list(removed_by_idx.values())

        return enriched, removed

    # ── Geocoding ────────────────────────────────────────────────

    def _geocode(self, street: str, city: str, district: str = None, bundesland: str = None,
                 location_hint: str = None, cross_street: str = None) -> tuple[float, float, str]:
        """Geocode an address using Google Maps API."""
        if self.no_geocode:
            return None, None, "none"

        # Build street part with cross_street / location_hint for better precision
        if cross_street and street:
            street_part = f"{street} & {cross_street}"
        elif location_hint and street:
            street_part = f"{location_hint}, {street}"
        elif location_hint and not street:
            street_part = location_hint
        else:
            street_part = street

        parts = [p for p in [street_part, district, city, bundesland, "Germany"] if p]
        address = ", ".join(parts)

        if address in self.geocode_cache:
            cached = self.geocode_cache[address]
            if not cached:
                return None, None, "none"
            return cached.get("lat"), cached.get("lon"), cached.get("precision", "cached")

        url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {
            "address": address,
            "key": self.google_maps_key,
            "region": "de",
            "language": "de",
        }
        if city:
            params["components"] = f"locality:{city}|country:DE"

        try:
            response = requests.get(url, params=params, timeout=10)
            data = response.json()

            if data["status"] == "OK" and data["results"]:
                result = data["results"][0]
                location = result["geometry"]["location"]
                location_type = result["geometry"]["location_type"]

                precision_map = {
                    "ROOFTOP": "rooftop",
                    "RANGE_INTERPOLATED": "range",
                    "GEOMETRIC_CENTER": "center",
                    "APPROXIMATE": "approximate",
                }
                precision = precision_map.get(location_type, "approximate")

                lat_val = location["lat"]
                lon_val = location["lng"]

                # Validate against Germany bounding box
                if not is_in_germany(lat_val, lon_val):
                    print(f"    WARNING: Geocoded outside Germany: {address} → ({lat_val}, {lon_val})")
                    precision = "outside_germany"

                self.geocode_cache[address] = {
                    "lat": lat_val,
                    "lon": lon_val,
                    "precision": precision,
                }
                return lat_val, lon_val, precision

            self.geocode_cache[address] = {}
            return None, None, "none"

        except Exception as e:
            print(f"    Geocoding error: {e}")
            return None, None, "none"

    # ── Main Entry Point ─────────────────────────────────────────

    def enrich_all(self, articles: list[dict], skip_clustering: bool = False) -> tuple[list[dict], list[dict]]:
        """Enrich all articles in a single LLM round.

        The unified prompt classifies (crime/junk/feuerwehr) and extracts
        structured data in one call. Optional rule-based incident grouping
        runs after enrichment.

        Args:
            articles: Raw articles to enrich.
            skip_clustering: If True, skip rule-based incident grouping.

        Returns (enriched_articles, removed_articles).
        """
        total = len(articles)
        print(f"\n{'='*60}")
        print(f"Single-round AI enrichment: {total} articles")
        print(f"{'='*60}")

        if not articles:
            return [], []

        # ── Unified enrichment + classification ──
        print(f"\n--- Enrichment (unified classification + extraction) ---")
        enriched, removed = self._enrich_articles(articles)

        print(f"  Total enriched records: {len(enriched)} (from {total} articles)")
        print(f"  Removed by LLM: {len(removed)}")

        # ── Rule-based incident grouping ──
        if skip_clustering:
            print(f"\n--- Incident grouping [SKIPPED] ---")
            # Assign solo group IDs
            for art in enriched:
                if not art.get("incident_group_id"):
                    art["incident_group_id"] = uuid.uuid4().hex[:12]
                    art["group_role"] = "primary"
        else:
            print(f"\n--- Incident grouping (rule-based) ---")
            from .filter_articles import group_incidents
            enriched = group_incidents(enriched)

        print(f"\n{'='*60}")
        geocoded = sum(1 for r in enriched if isinstance(r.get("location"), dict) and r["location"].get("lat"))
        classified = sum(1 for r in enriched if isinstance(r.get("crime"), dict) and r["crime"].get("pks_code"))
        print(f"Final: {len(enriched)} records, {geocoded} geocoded, {classified} classified")
        print(f"Removed: {len(removed)} articles (LLM classification)")
        print(f"{'='*60}\n")

        return enriched, removed

    def save_caches(self):
        self._save_cache(self.cache, self.cache_file)
        if not self.no_geocode:
            self._save_cache(self.geocode_cache, self.geocode_file)


def main():
    import argparse
    from .filter_articles import is_junk_article

    parser = argparse.ArgumentParser(description="Single-round AI article enrichment")
    parser.add_argument("--input", "-i", required=True, help="Input JSON file")
    parser.add_argument("--output", "-o", required=True, help="Output JSON file")
    parser.add_argument("--no-geocode", action="store_true", help="Skip geocoding")
    parser.add_argument("--cache-dir", default=".cache", help="Cache directory")
    parser.add_argument("--removed", help="Path for removed articles log")
    parser.add_argument("--skip-clustering", action="store_true",
                        help="Skip rule-based incident grouping")
    parser.add_argument("--no-prefilter", action="store_true",
                        help="Skip regex pre-filter (send all articles to LLM)")

    args = parser.parse_args()

    # Load articles
    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        articles = data
    else:
        articles = data.get("articles", [])

    if not articles:
        print("No articles found")
        sys.exit(1)

    print(f"Loaded {len(articles)} articles from {args.input}", flush=True)

    # Optional regex pre-filter (saves LLM tokens)
    prefilter_removed = []
    if not args.no_prefilter:
        kept = []
        for art in articles:
            reason = is_junk_article(art)
            if reason:
                prefilter_removed.append({
                    **art,
                    "_removal_reason": f"prefilter:{reason}",
                })
            else:
                kept.append(art)
        if prefilter_removed:
            print(f"Pre-filter: removed {len(prefilter_removed)}, kept {len(kept)}")
        articles = kept

    # Enrich
    enricher = FastEnricher(cache_dir=args.cache_dir, no_geocode=args.no_geocode)

    try:
        enriched, removed = enricher.enrich_all(
            articles, skip_clustering=args.skip_clustering
        )
    except KeyboardInterrupt:
        print("\nInterrupted")
        enricher.save_caches()
        sys.exit(1)

    enricher.save_caches()

    # Combine all removed
    all_removed = prefilter_removed + removed

    # Save enriched output
    output_data = {"articles": enriched} if isinstance(data, dict) else enriched
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    # Save removed log
    if all_removed:
        removed_path = args.removed or str(Path(args.output).with_suffix("")) + "_removed.json"
        with open(removed_path, "w", encoding="utf-8") as f:
            json.dump(all_removed, f, ensure_ascii=False, indent=2)
        print(f"Saved {len(all_removed)} removed articles to {removed_path}")

    # Stats
    geocoded = sum(1 for r in enriched if r.get("location", {}).get("lat"))
    classified = sum(1 for r in enriched if r.get("crime", {}).get("pks_code"))
    print(f"\nSaved {len(enriched)} articles to {args.output}")
    print(f"  Geocoded: {geocoded}")
    print(f"  Classified: {classified}")


if __name__ == "__main__":
    main()
