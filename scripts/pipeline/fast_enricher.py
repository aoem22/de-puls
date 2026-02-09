#!/usr/bin/env python3
"""
Multi-round AI enrichment for Blaulicht articles.

Three rounds:
  Round 1 — Triage: classify articles (single/multi/junk/feuerwehr)
  Round 2 — Enrichment: extract structured data + clean title
  Round 3 — Clustering: group related articles about the same incident

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
from collections import defaultdict
from datetime import datetime, timedelta
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

# Batch sizes per round
TRIAGE_BATCH_SIZE = 25      # Round 1: cheap classification
SINGLE_BATCH_SIZE = 10      # Round 2: normal enrichment
MULTI_BATCH_SIZE = 3        # Round 2: multi-incident enrichment
CLUSTER_BATCH_SIZE = 20     # Round 3: clustering


# ── Round 1: Triage Prompt ──────────────────────────────────────

TRIAGE_PROMPT = """
Klassifiziere diese {count} deutschen Polizeipressemeldungen.

Kategorien:
- "single": Normaler Polizeibericht mit EINEM Vorfall
- "multi": Sammelartikel mit MEHREREN separaten Vorfällen (z.B. PP Heilbronn Digest mit 5+ Vorfällen)
- "junk": Kein Straftatbericht (Verkehrshinweise, Spendenaufrufe, Erreichbarkeitshinweise, Kontrollaktionen, Warnmeldungen, Tag der offenen Tür, Blitzerstandorte, Bilanzberichte)
- "feuerwehr": Feuerwehr-/Brandmeldung ohne Polizeibezug

ARTIKEL:
{articles_json}

Antworte NUR mit JSON-Array:
[
  {{"article_index": 0, "classification": "single", "incident_count": 1}},
  {{"article_index": 1, "classification": "junk", "reason": "Verkehrshinweis"}},
  {{"article_index": 2, "classification": "multi", "incident_count": 5}},
  {{"article_index": 3, "classification": "feuerwehr", "reason": "Feuerwehreinsatz"}}
]
"""


# ── Round 2: Enrichment Prompt ──────────────────────────────────

ENRICHMENT_PROMPT = """
Analysiere diese {count} deutschen Polizeiberichte und extrahiere strukturierte Daten.

WICHTIG: Viele Pressemeldungen enthalten MEHRERE separate Vorfälle. Erstelle für JEDEN einzelnen Vorfall ein eigenes JSON-Objekt. Verwende den gleichen article_index für alle Vorfälle aus demselben Artikel.

Für JEDEN Vorfall, extrahiere:
1. STANDORT: street, house_number, district, city, confidence (0-1)
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

Antworte NUR mit JSON-Array. Ein Objekt pro VORFALL (nicht pro Artikel — ein Artikel kann mehrere Vorfälle haben):
[
  {{
    "article_index": 0,
    "clean_title": "Messerangriff in Mannheim — Mann schwer verletzt",
    "location": {{"street": "...", "house_number": null, "district": null, "city": "...", "confidence": 0.8}},
    "incident_time": {{"date": "YYYY-MM-DD", "time": "HH:MM", "precision": "exact"}},
    "crime": {{"pks_code": "XXXX", "pks_category": "...", "sub_type": "...", "confidence": 0.9}},
    "details": {{"weapon_type": "knife", "drug_type": null, "victim_count": 1, "suspect_count": 1, "victim_age": "34", "suspect_age": "22", "victim_gender": "male", "suspect_gender": "male", "victim_herkunft": null, "suspect_herkunft": "syrisch", "severity": "serious", "motive": "dispute"}}
  }},
  ...
]
"""


# ── Round 2b: Enrichment Prompt V2 (quality fix) ─────────────────

ENRICHMENT_PROMPT_V2 = """
Analysiere diese {count} deutschen Polizeiberichte und extrahiere strukturierte Daten.

WICHTIG: Viele Pressemeldungen enthalten MEHRERE separate Vorfälle. Erstelle für JEDEN einzelnen Vorfall ein eigenes JSON-Objekt. Verwende den gleichen article_index für alle Vorfälle aus demselben Artikel.

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

Für JEDEN Vorfall, extrahiere:
1. STANDORT: street, house_number, district, city, confidence (0-1)
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

Antworte NUR mit JSON-Array. Ein Objekt pro VORFALL (nicht pro Artikel — ein Artikel kann mehrere Vorfälle haben):
[
  {{
    "article_index": 0,
    "clean_title": "Messerangriff in Mannheim — Mann schwer verletzt",
    "location": {{"street": "...", "house_number": null, "district": null, "city": "...", "confidence": 0.8}},
    "incident_time": {{"date": "YYYY-MM-DD", "time": "HH:MM", "precision": "exact"}},
    "crime": {{"pks_code": "XXXX", "pks_category": "...", "sub_type": "...", "confidence": 0.9}},
    "details": {{"weapon_type": "knife", "drug_type": null, "victim_count": 1, "suspect_count": 1, "victim_age": "34", "suspect_age": "22", "victim_gender": "male", "suspect_gender": "male", "victim_herkunft": null, "suspect_herkunft": "syrisch", "severity": "serious", "motive": "dispute"}}
  }},
  ...
]
"""


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


# ── Round 3: Clustering Prompt ──────────────────────────────────

CLUSTER_PROMPT = """
Sind diese Polizeimeldungen über denselben Vorfall? Gruppiere sie.

Regeln:
- Nur Meldungen mit gleicher Stadt, ähnlichem Datum (max 7 Tage) und ähnlichem Delikt gruppieren
- Nachtragsmeldungen, Folgemeldungen und Updates gehören zur Erstmeldung
- Verschiedene Vorfälle in der gleichen Stadt sind NICHT dasselbe
- "primary" ist die früheste/ausführlichste Meldung der Gruppe

MELDUNGEN:
{summaries_json}

Antworte NUR mit JSON-Array:
[
  {{"group": [0, 2, 5], "primary": 0, "roles": {{"0": "primary", "2": "update", "5": "resolution"}}}},
  {{"group": [1], "primary": 1, "roles": {{"1": "primary"}}}},
  {{"group": [3, 4], "primary": 3, "roles": {{"3": "primary", "4": "follow_up"}}}}
]
"""


class FastEnricher:
    """Multi-round article enricher with Google Maps geocoding."""

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
        self.triage_cache_file = self.cache_dir / "triage_cache.json"
        self.geocode_file = self.cache_dir / "geocode_cache.json"
        self.cache = self._load_cache(self.cache_file)
        self.triage_cache = self._load_cache(self.triage_cache_file)
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

    # ── Round 1: Triage ──────────────────────────────────────────

    def _triage_batch(self, articles: list[dict]) -> list[dict]:
        """Classify a batch of articles (Round 1)."""
        articles_data = []
        for i, art in enumerate(articles):
            articles_data.append({
                "index": i,
                "title": art.get("title", "")[:200],
                "body": art.get("body", "")[:1000],  # Only need first 1000 chars for triage
                "source": art.get("source", ""),
            })

        prompt = TRIAGE_PROMPT.format(
            count=len(articles),
            articles_json=json.dumps(articles_data, ensure_ascii=False, indent=2)
        )

        return self._call_llm(prompt, max_tokens=2000)

    def _triage_all(self, articles: list[dict]) -> list[dict]:
        """Run triage on all articles. Returns list of triage results."""
        results = [None] * len(articles)
        uncached_indices = []
        uncached_articles = []

        # Check cache
        for i, art in enumerate(articles):
            key = self._cache_key(art.get("url", ""), art.get("body", ""))
            triage_key = f"triage:{key}"
            if triage_key in self.triage_cache:
                results[i] = self.triage_cache[triage_key]
            else:
                uncached_indices.append(i)
                uncached_articles.append(art)

        cached_count = len(articles) - len(uncached_articles)
        if cached_count > 0:
            print(f"  Triage: {cached_count} cached, {len(uncached_articles)} to classify")

        if not uncached_articles:
            return results

        # Process uncached in batches
        batches = [uncached_articles[i:i + TRIAGE_BATCH_SIZE]
                    for i in range(0, len(uncached_articles), TRIAGE_BATCH_SIZE)]

        print(f"  Triage: classifying {len(uncached_articles)} articles in {len(batches)} batches...")

        batch_offset = 0
        for batch_num, batch in enumerate(batches, 1):
            llm_results = self._triage_batch(batch)

            # Map results back
            for r in llm_results:
                idx = r.get("article_index", -1)
                if 0 <= idx < len(batch):
                    global_idx = uncached_indices[batch_offset + idx]
                    classification = r.get("classification", "single")
                    triage_result = {
                        "classification": classification,
                        "incident_count": r.get("incident_count", 1),
                        "reason": r.get("reason"),
                    }
                    results[global_idx] = triage_result

                    # Cache it
                    art = batch[idx]
                    key = self._cache_key(art.get("url", ""), art.get("body", ""))
                    self.triage_cache[f"triage:{key}"] = triage_result

            batch_offset += len(batch)
            print(f"    Triage batch {batch_num}/{len(batches)}: done")

            if batch_num < len(batches):
                time.sleep(API_DELAY)

        # Default uncategorized articles to "single"
        for i in range(len(results)):
            if results[i] is None:
                results[i] = {"classification": "single", "incident_count": 1}

        return results

    def _apply_triage(self, articles: list[dict], triage_results: list[dict]) -> tuple[list[dict], list[dict]]:
        """Split articles into kept and removed based on triage."""
        kept = []
        removed = []

        counts = defaultdict(int)
        for i, (art, triage) in enumerate(zip(articles, triage_results)):
            classification = triage["classification"]
            counts[classification] += 1

            if classification in ("junk", "feuerwehr"):
                removed.append({
                    **art,
                    "_removal_reason": f"triage:{classification}",
                    "_triage_reason": triage.get("reason", ""),
                })
            else:
                kept.append({
                    **art,
                    "_triage": classification,
                    "_incident_count": triage.get("incident_count", 1),
                })

        print(f"  Triage results: {dict(counts)}")
        print(f"  Kept: {len(kept)}, Removed: {len(removed)}")
        return kept, removed

    # ── Round 2: Enrichment ──────────────────────────────────────

    def _enrich_batch(self, articles: list[dict], max_tokens: int = 8000) -> list[dict]:
        """Enrich a batch of articles (Round 2)."""
        articles_data = []
        for i, art in enumerate(articles):
            articles_data.append({
                "index": i,
                "title": art.get("title", "")[:200],
                "body": art.get("body", ""),  # Full body — no truncation
                "date": art.get("date", ""),
                "city": art.get("city", ""),
            })

        prompt = ENRICHMENT_PROMPT_V2.format(
            count=len(articles),
            articles_json=json.dumps(articles_data, ensure_ascii=False, indent=2)
        )

        return self._call_llm(prompt, max_tokens=max_tokens)

    def _enrich_articles(self, articles: list[dict], batch_size: int, max_tokens: int, label: str) -> list[dict]:
        """Enrich a set of articles with given batch size and token limit."""
        # Split into cached and uncached
        uncached = []
        uncached_indices = []
        results_by_idx: dict[int, list[dict]] = {}

        regeocode_count = 0
        for i, art in enumerate(articles):
            key = self._cache_key(art.get("url", ""), art.get("body", ""))
            if key in self.cache:
                cached = self.cache[key]
                entries = cached if isinstance(cached, list) else [cached]

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

        cached_count = len(articles) - len(uncached)
        if cached_count > 0:
            geo_msg = f", {regeocode_count} re-geocoded" if regeocode_count else ""
            print(f"  {label}: {cached_count} cached{geo_msg}, {len(uncached)} to enrich")

        if uncached:
            batches = [uncached[i:i + batch_size] for i in range(0, len(uncached), batch_size)]
            print(f"  {label}: enriching {len(uncached)} articles in {len(batches)} batches (max_tokens={max_tokens})...")

            batch_offset = 0
            for batch_num, batch in enumerate(batches, 1):
                llm_results = self._enrich_batch(batch, max_tokens=max_tokens)

                # Group LLM results by article_index
                incidents_by_idx: dict[int, list[dict]] = {}
                for llm_result in llm_results:
                    idx = llm_result.get("article_index", -1)
                    if 0 <= idx < len(batch):
                        incidents_by_idx.setdefault(idx, []).append(llm_result)

                # Process each article's incidents
                for idx, incidents in incidents_by_idx.items():
                    art = batch[idx]
                    orig_idx = uncached_indices[batch_offset + idx]
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
                            )
                            enrichment["location"]["lat"] = lat
                            enrichment["location"]["lon"] = lon
                            enrichment["location"]["precision"] = precision
                            enrichment["location"]["bundesland"] = art.get("bundesland")

                        enrichments.append(enrichment)

                    # Cache all incidents for this article
                    key = self._cache_key(art.get("url", ""), art.get("body", ""))
                    self.cache[key] = enrichments
                    results_by_idx[orig_idx] = [{**art, **e} for e in enrichments]

                batch_offset += len(batch)

                geocoded = sum(
                    1 for records in results_by_idx.values()
                    for r in records if r.get("location", {}).get("lat")
                )
                total_records = sum(len(records) for records in results_by_idx.values())
                print(
                    f"    {label} batch {batch_num}/{len(batches)}: "
                    f"{total_records} records, {geocoded} geocoded",
                    flush=True,
                )

                if batch_num < len(batches):
                    time.sleep(API_DELAY)

        # Build flat output list, preserving article order
        results = []
        for i in range(len(articles)):
            if i in results_by_idx:
                results.extend(results_by_idx[i])
            else:
                results.append(articles[i])

        return results

    # ── Round 3: Clustering ──────────────────────────────────────

    def _cluster_incidents(self, enriched: list[dict]) -> list[dict]:
        """Group related articles about the same incident (Round 3)."""
        # Pre-filter: group by (source_agency, city, 7-day window)
        buckets: dict[str, list[int]] = defaultdict(list)
        for i, art in enumerate(enriched):
            source = (art.get("source") or "").strip()
            city = (art.get("location", {}).get("city") or art.get("city") or "").strip()
            date_str = art.get("date", "")

            if not source or not city or not date_str:
                continue

            # Parse date for week bucketing
            try:
                if "T" in date_str:
                    dt = datetime.fromisoformat(date_str.replace("Z", "+00:00")).replace(tzinfo=None)
                else:
                    dt = datetime.fromisoformat(date_str)
                week_key = f"{dt.year}-W{dt.isocalendar()[1]:02d}"
            except (ValueError, TypeError):
                continue

            bucket_key = f"{source}|{city}|{week_key}"
            buckets[bucket_key].append(i)

        # Only process buckets with 2+ articles
        candidate_buckets = {k: v for k, v in buckets.items() if len(v) >= 2}

        if not candidate_buckets:
            print("  Clustering: no candidate groups found")
            # Assign solo group IDs
            for art in enriched:
                if not art.get("incident_group_id"):
                    art["incident_group_id"] = uuid.uuid4().hex[:12]
                    art["group_role"] = "primary"
            return enriched

        # Flatten candidate indices for batch processing
        all_candidate_indices = set()
        for indices in candidate_buckets.values():
            all_candidate_indices.update(indices)

        print(f"  Clustering: {len(candidate_buckets)} candidate buckets, {len(all_candidate_indices)} articles to compare")

        # Process each bucket through LLM
        cluster_batch = []
        cluster_batch_indices = []

        for bucket_key, indices in candidate_buckets.items():
            # Build summaries for this bucket
            summaries = []
            for local_idx, global_idx in enumerate(indices):
                art = enriched[global_idx]
                summaries.append({
                    "index": local_idx,
                    "clean_title": art.get("clean_title") or art.get("title", ""),
                    "date": art.get("date", ""),
                    "city": art.get("location", {}).get("city") or art.get("city", ""),
                    "crime_type": art.get("crime", {}).get("pks_category", ""),
                })

            cluster_batch.append(summaries)
            cluster_batch_indices.append(indices)

            # Process when batch is large enough
            if len(cluster_batch) >= 3 or sum(len(s) for s in cluster_batch) >= CLUSTER_BATCH_SIZE:
                self._process_cluster_batch(enriched, cluster_batch, cluster_batch_indices)
                cluster_batch = []
                cluster_batch_indices = []
                time.sleep(API_DELAY)

        # Process remaining
        if cluster_batch:
            self._process_cluster_batch(enriched, cluster_batch, cluster_batch_indices)

        # Assign solo group IDs to ungrouped articles
        for art in enriched:
            if not art.get("incident_group_id"):
                art["incident_group_id"] = uuid.uuid4().hex[:12]
                art["group_role"] = "primary"

        # Count groups
        groups = defaultdict(list)
        for art in enriched:
            groups[art.get("incident_group_id", "")].append(art)
        multi_groups = sum(1 for g in groups.values() if len(g) > 1)
        multi_articles = sum(len(g) for g in groups.values() if len(g) > 1)
        print(f"  Clustering: {multi_groups} groups with {multi_articles} articles")

        return enriched

    def _process_cluster_batch(
        self,
        enriched: list[dict],
        summaries_list: list[list[dict]],
        indices_list: list[list[int]],
    ) -> None:
        """Process a batch of cluster candidate groups through LLM."""
        for summaries, indices in zip(summaries_list, indices_list):
            if len(summaries) < 2:
                continue

            prompt = CLUSTER_PROMPT.format(
                summaries_json=json.dumps(summaries, ensure_ascii=False, indent=2)
            )

            llm_results = self._call_llm(prompt, max_tokens=2000)

            for group_info in llm_results:
                group_indices = group_info.get("group", [])
                primary_local = group_info.get("primary", 0)
                roles = group_info.get("roles", {})

                if len(group_indices) < 1:
                    continue

                group_id = uuid.uuid4().hex[:12]

                for local_idx in group_indices:
                    if 0 <= local_idx < len(indices):
                        global_idx = indices[local_idx]
                        enriched[global_idx]["incident_group_id"] = group_id
                        role = roles.get(str(local_idx), "related")
                        if local_idx == primary_local:
                            role = "primary"
                        enriched[global_idx]["group_role"] = role

    # ── Geocoding ────────────────────────────────────────────────

    def _geocode(self, street: str, city: str, district: str = None, bundesland: str = None) -> tuple[float, float, str]:
        """Geocode an address using Google Maps API."""
        if self.no_geocode:
            return None, None, "none"

        parts = [p for p in [street, district, city, bundesland, "Germany"] if p]
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
        """Enrich all articles through 2-3 rounds.

        Args:
            articles: Raw articles to enrich.
            skip_clustering: If True, skip Round 3 (clustering).

        Returns (enriched_articles, removed_articles).
        """
        total = len(articles)
        print(f"\n{'='*60}")
        print(f"Multi-round AI enrichment: {total} articles")
        print(f"{'='*60}")

        # ── Round 1: Triage ──
        print(f"\n--- Round 1: Triage ---")
        triage_results = self._triage_all(articles)
        kept, removed = self._apply_triage(articles, triage_results)

        if not kept:
            print("  No articles to enrich after triage")
            return [], removed

        # ── Round 2: Enrichment (smart batching) ──
        print(f"\n--- Round 2: Enrichment ---")
        singles = [a for a in kept if a.get("_triage") == "single"]
        multis = [a for a in kept if a.get("_triage") == "multi"]

        enriched = []
        if singles:
            enriched.extend(
                self._enrich_articles(singles, SINGLE_BATCH_SIZE, 8000, "Singles")
            )
        if multis:
            enriched.extend(
                self._enrich_articles(multis, MULTI_BATCH_SIZE, 12000, "Multis")
            )

        print(f"  Total enriched records: {len(enriched)} (from {len(kept)} articles)")

        # ── Round 3: Clustering ──
        if skip_clustering:
            print(f"\n--- Round 3: Clustering [SKIPPED] ---")
        else:
            print(f"\n--- Round 3: Clustering ---")
            enriched = self._cluster_incidents(enriched)

        # Clean up internal triage fields
        for art in enriched:
            art.pop("_triage", None)
            art.pop("_incident_count", None)

        print(f"\n{'='*60}")
        geocoded = sum(1 for r in enriched if isinstance(r.get("location"), dict) and r["location"].get("lat"))
        classified = sum(1 for r in enriched if isinstance(r.get("crime"), dict) and r["crime"].get("pks_code"))
        print(f"Final: {len(enriched)} records, {geocoded} geocoded, {classified} classified")
        print(f"Removed: {len(removed)} articles (triage)")
        print(f"{'='*60}\n")

        return enriched, removed

    def save_caches(self):
        self._save_cache(self.cache, self.cache_file)
        self._save_cache(self.triage_cache, self.triage_cache_file)
        if not self.no_geocode:
            self._save_cache(self.geocode_cache, self.geocode_file)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Multi-round AI article enrichment")
    parser.add_argument("--input", "-i", required=True, help="Input JSON file")
    parser.add_argument("--output", "-o", required=True, help="Output JSON file")
    parser.add_argument("--no-geocode", action="store_true", help="Skip geocoding")
    parser.add_argument("--cache-dir", default=".cache", help="Cache directory")
    parser.add_argument("--removed", help="Path for removed articles log")

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

    # Enrich
    enricher = FastEnricher(cache_dir=args.cache_dir, no_geocode=args.no_geocode)

    try:
        enriched, removed = enricher.enrich_all(articles)
    except KeyboardInterrupt:
        print("\nInterrupted")
        enricher.save_caches()
        sys.exit(1)

    enricher.save_caches()

    # Save enriched output
    output_data = {"articles": enriched} if isinstance(data, dict) else enriched
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    # Save removed log
    if removed:
        removed_path = args.removed or str(Path(args.output).with_suffix("")) + "_removed.json"
        with open(removed_path, "w", encoding="utf-8") as f:
            json.dump(removed, f, ensure_ascii=False, indent=2)
        print(f"Saved {len(removed)} removed articles to {removed_path}")

    # Stats
    geocoded = sum(1 for r in enriched if r.get("location", {}).get("lat"))
    classified = sum(1 for r in enriched if r.get("crime", {}).get("pks_code"))
    print(f"\nSaved {len(enriched)} articles to {args.output}")
    print(f"  Geocoded: {geocoded}")
    print(f"  Classified: {classified}")


if __name__ == "__main__":
    main()
