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
    # Geocoding is deferred by default; run manually later:
    python -m scripts.pipeline.post_geocode --cache-dir .cache
    # Optional: run geocoding inline during enrichment
    python -m scripts.pipeline.fast_enricher --input data.json --output enriched.json --with-geocode
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

# Provider configurations: {base_url, api_key_env, default_model}
PROVIDERS = {
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_env": "OPENROUTER_API_KEY",
        "default_model": "x-ai/grok-4-fast",
        "max_output_tokens": 10000,
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "api_key_env": "DEEPSEEK_API_KEY",
        "default_model": "deepseek-chat",
        "max_output_tokens": 8192,
        "batch_size": 5,
    },
}
DEFAULT_PROVIDER = "openrouter"

# Batch sizes
UNIFIED_BATCH_SIZE = 8      # Articles per LLM call (unified enrichment + classification)
UNIFIED_MAX_TOKENS = 10000  # Max tokens for unified prompt response


# ── Unified Prompt (classification + enrichment in 1 round) ──────

UNIFIED_PROMPT = """
Analysiere diese {count} deutschen Polizeipressemeldungen. Klassifiziere und extrahiere strukturierte Daten in EINEM Schritt.

WICHTIG: Titel sind oft abgeschnitten (enden mitten im Wort). Nutze IMMER den Body als primäre Informationsquelle. Der Titel dient nur als Ergänzung. Wenn der Body leer oder sehr kurz ist (<50 Zeichen), extrahiere was möglich ist nur aus dem Titel.

=== REGEL 0: KLASSIFIKATION ===
Prüfe ZUERST ob der Artikel ein Straftatbericht ist. Klassifiziere in genau EINE Kategorie:

A) "junk" — Kein polizeirelevanter Vorfall. NUR zurückgeben:
  {{"article_index": N, "classification": "junk", "reason": "..."}}
  Beispiele:
  - Verkehrshinweise/-sperrungen (OHNE Unfall), Blitzerstandorte, Stauprognosen
  - Bilanzberichte, Statistiken, Jahresrückblicke
  - Spendenaufrufe, Präventionshinweise, Erreichbarkeitshinweise
  - Kontrollaktionen/Razzien OHNE konkreten Einzelvorfall (z.B. "Zoll kontrolliert Baustellen")
  - Stellenangebote, Tag der offenen Tür, Veranstaltungen, Polizeisport
  - Warnmeldungen (Gewitter, Hochwasser), Personalien/Beförderungen
  - Hilfsmaßnahmen/Förderprogramme (z.B. "Hilfe für Wohnungsunternehmen")
  - Reine Versammlungs-/Demonstrationsberichte OHNE Straftaten (z.B. "DGB-Demo friedlich verlaufen")
  - Vermisstensuche/Öffentlichkeitsfahndung (keine Straftat, sondern Hilfsmaßnahme)

B) "feuerwehr" — Feuerwehreinsatz OHNE Straftatverdacht. NUR zurückgeben:
  {{"article_index": N, "classification": "feuerwehr", "reason": "..."}}
  Erkenne an: Quelle enthält "Feuerwehr"/"FW-"/"Brandschutz"/"Rettungsdienst", Inhalt NUR Brand/Rettung/Gasaustritt/Naturereignis ohne jeglichen Straftatverdacht.
  ACHTUNG → "crime" statt "feuerwehr" wenn EINES zutrifft:
  - Brandstiftung vermutet oder erwähnt
  - "Kriminalpolizei" / "Kripo" ermittelt
  - "Brandursache unklar" (= mögliche Straftat)
  - Polizei als Quelle (z.B. "POL-KN") trotz Brandbericht

C) "crime" — Polizeirelevanter Vorfall → Vollständige Daten extrahieren (siehe unten).
  Dazu zählen:
  - Alle Straftaten (Diebstahl, Körperverletzung, Raub, Betrug, etc.)
  - Verkehrsunfälle MIT Personenschaden oder Fahrerflucht oder Trunkenheit
  - Waffendelikte (verbotene Messer, Schusswaffen)
  - Drogendelikte
  - Brandstiftung (auch wenn Feuerwehr beteiligt)
  - Sachbeschädigung
  - Demonstrationen/Versammlungen MIT konkreten Straftaten (Angriffe auf Polizei, Sachbeschädigung)

D) "update" — Nachtrag/Korrektur/Folgemeldung zu einem früheren Vorfall. Zurückgeben:
  {{"article_index": N, "classification": "update", "reason": "Nachtrag/Korrektur/Folgemeldung", "update_type": "nachtrag|korrektur|folgemeldung|erledigung"}}
  Erkenne an: "Nachtrag", "Nachtragsmeldung", "Korrektur", "Korrekturmeldung", "Folgemeldung", "Erledigung der Öffentlichkeitsfahndung", "Wir berichteten:", "Wie bereits berichtet", "Update"
  Extrahiere ZUSÄTZLICH die crime-Daten, wenn im Text genug Informationen vorhanden sind.
  Bei reinen Korrekturen ohne neue Sachinformationen (z.B. "Alter war 16, nicht 18"): NUR update-Objekt.

=== REGEL 1: MULTI-INCIDENT ERKENNUNG ===
Sammelartikel enthalten MEHRERE separate Vorfälle. Erkenne an:
- Semikolon-getrennte Themen im Titel (z.B. "Messerangriff; Verkehrsunfälle; Brandstiftung")
- Fettgedruckte Zwischen-Überschriften mit Ortsnamen (z.B. "Schorndorf: Radlader verliert Ladung")
- Titelformat "Pressemitteilung ... mit Berichten aus dem [Kreis]"
- Mehrere Orts-Absätze mit jeweils eigener Straße/Stadt
- "a)", "b)" oder "1.", "2.", "3." nummerierte Abschnitte mit verschiedenen Vorfällen
WICHTIG: Jeder separate Vorfall MUSS ein eigenes JSON-Objekt werden! Alle Objekte teilen denselben article_index.
Kontext-Vererbung: Jeder Split erbt Bundesland und date vom Elternartikel, wenn nicht explizit anders.
NICHT splitten: Nummerierte Listen die Details EINES Vorfalls beschreiben (z.B. Zeugenhinweise 1-3 zum selben Unfall).

=== REGEL 2: NUR DEUTSCHLAND + STADT vs. STADTTEIL ===
Alle Vorfälle sind in DEUTSCHLAND. Extrahiere NUR deutsche Städte.
WICHTIG STADT/STADTTEIL: Die `city` ist IMMER die Hauptstadt/Gemeinde, NICHT der Stadtteil. Stadtteilnamen gehören in `district`.
- Bei Berlin: city ist IMMER "Berlin". Bezirksnamen (Mitte, Neukölln, Charlottenburg, Kreuzberg, etc.) gehören in `district`.
- Bei Städten mit Bindestrich-Stadtteilen: city="Stuttgart", district="Bad Cannstatt" (NICHT city="Stuttgart-Bad Cannstatt").
- Bei Städten mit Bindestrich-Stadtteilen: city="Hamm", district="Bockum-Hövel" (NICHT city="Hamm-Bockum-Hövel").
Häufige Verwechslungen:
- "Basel" → Bei Polizeipräsidium Freiburg: Grenzach-Wyhlen, Weil am Rhein, oder Lörrach (NICHT Basel, Schweiz!)
- "Frankfurt" → Ohne "(Oder)": Frankfurt am Main (Hessen). MIT "(Oder)": Frankfurt (Oder) (Brandenburg)
- "Freiburg" → Freiburg im Breisgau (BW), NICHT Freiburg (Schweiz)
- "Konstanz" → Konstanz am Bodensee (BW), NICHT Kreuzlingen (Schweiz)
Nutze den Bundesland-Kontext aus der Quelle zur Disambiguation.
STADT-EXTRAKTION: Die Stadt steht oft am Body-Anfang im Format "Stadtname(ots)" oder im Titel als "(Stadtname, Lkr. XX)". Bei Bundespolizei-Meldungen steht der Tatort meist im Body, NICHT im "source"-Feld.

=== REGEL 3: TATZEIT EXTRAKTION ===
Extrahiere IMMER eine Tatzeit wenn der Text Zeitangaben enthält. Mappings:
- "gegen 14:30 Uhr" / "kurz vor 15 Uhr" / "kurz nach 14 Uhr" → time aus Kontext, precision="approximate"
- "um 14:30 Uhr" → time="14:30", precision="exact"
- "zwischen 14:30 und 16:30 Uhr" → time="14:30", precision="approximate" (Startzeit)
- "zwischen 8 und 10 Uhr" → time="08:00", precision="approximate"
- "im Zeitraum von 8 bis 12 Uhr" → time="08:00", precision="approximate"
- "in der Zeit von Freitag, 18 Uhr, bis Samstag, 8 Uhr" → time="18:00", precision="approximate" (Datum = Freitag)
- "im Laufe des Wochenendes" → time=null, precision="approximate" (Datum = Samstag)
- "in der Nacht zum Samstag" / "Freitagnacht" → time="02:00", precision="approximate"
- "am frühen Morgen" → time="06:00", precision="approximate"
- "am Vormittag" → time="10:00", precision="approximate"
- "am Mittag" / "mittags" → time="12:00", precision="approximate"
- "am Nachmittag" / "nachmittags" → time="15:00", precision="approximate"
- "am Abend" / "abends" → time="20:00", precision="approximate"
- "in den Abendstunden" → time="21:00", precision="approximate"
- "in der Nacht" / "nachts" → time="01:00", precision="approximate"
- RELATIVE ZEITEN: "gestern" / "heute" / "am vergangenen Freitag" → Berechne das echte Datum aus dem date-Feld des Artikels!
KRITISCH: Wenn IRGENDEIN Zeithinweis im Text steht, MUSS precision "exact" oder "approximate" sein!
precision="unknown" NUR wenn wirklich KEINE Zeitangabe im gesamten Text vorkommt.

=== REGEL 4: DATENEXTRAKTION ===
Für JEDEN Straftat-Vorfall, extrahiere:

1. STANDORT: street, house_number, district, city, location_hint, cross_street, confidence (0-1)
   - street: Straßenname (z.B. "Karlstraße", "B29", "A5"). Bei Autobahnen: "BAB 5" oder "A5".
   - location_hint: Gebäude/Objekt am Tatort (z.B. "Tankstelle", "Hauptbahnhof", "Spielhalle", "Autowaschanlage", "Einkaufszentrum", "Parkhaus", "Agentur für Arbeit"). null wenn keins.
   - cross_street: Bei Kreuzungen die zweite Straße. null wenn keine Kreuzung.
   - district: Stadtteil/Ortsteil wenn explizit genannt (z.B. "Geestemünde", "Hemelingen", "Lichtental"). NICHT den Landkreis!
   - confidence: 1.0 wenn Straße+Hausnummer, 0.9 wenn Straße ohne Nr., 0.7 wenn nur Stadtteil, 0.5 wenn nur Stadt.

2. TATZEIT: date (YYYY-MM-DD), time (HH:MM oder null), precision (exact/approximate/unknown)

3. DELIKT (PKS): pks_code (4-stellig), pks_category, sub_type, confidence (0-1)

4. DETAILS: weapon_type, drug_type, victim_count, suspect_count, victim_age, suspect_age, victim_gender, suspect_gender, victim_herkunft, suspect_herkunft, victim_description, suspect_description, severity, motive, damage_amount_eur, damage_estimate

5. TITEL: Kurzer, sachlicher Titel (max 80 Zeichen).
   - Kein Polizeikürzel (POL-MA, etc.), keine PM-Nummern, kein reißerischer Stil.
   - Format: "[Delikt] in [Stadt] — [Kerninfo]"
   - Beispiel: "Messerangriff in Mannheimer Innenstadt — Mann schwer verletzt"

6. is_update: true wenn der Artikel eine Folgemeldung/Nachtrag zu einem früheren Vorfall ist, sonst false.

PKS-Kategorien (häufigste zuerst):
Gewalt:
- 0100: Mord/Totschlag, 0200: Tötungsdelikt auf Verlangen
- 1100: Vergewaltigung/sexuelle Nötigung, 1300: Sexueller Missbrauch, 1310: Exhibitionismus, 1320: Sexuelle Belästigung
- 2100: Raub/räuberische Erpressung, 2200: Körperverletzung (einfach+gefährlich+schwer)
- 2320: Nötigung, 2330: Freiheitsberaubung, 2340: Bedrohung
Eigentum:
- 3000: Einfacher Diebstahl (Ladendiebstahl, Taschendiebstahl, Fahrrad)
- 4000: Schwerer Diebstahl, 4350: Wohnungseinbruchdiebstahl, 4780: Kfz-Diebstahl
- 5100: Betrug, 5200: Computerbetrug (Phishing, SMS-Betrug, Schockanrufe, falsche Polizisten)
Brand/Sachbeschädigung:
- 6740: Brandstiftung (vorsätzlich/fahrlässig), 6750: Sachbeschädigung (inkl. Graffiti, Vandalismus)
Verkehr:
- 7100: Verkehrsunfall mit Personenschaden, 7200: Unfallflucht/Fahrerflucht, 7300: Trunkenheit im Verkehr
Sonstiges:
- 6210: Widerstand gegen Vollstreckungsbeamte, 6220: Hausfriedensbruch, 6230: Landfriedensbruch
- 8900: Verstöße gegen das Waffengesetz (verbotene Messer, Schusswaffen, Reizgas)
- 8910: Betäubungsmitteldelikte (Besitz, Handel, Anbau)
- 8920: Verstöße gegen das Aufenthaltsgesetz
- 6260: Volksverhetzung, Verwenden von Kennzeichen verfassungswidriger Organisationen (Hitlergruß, NS-Symbole)
Bei Unsicherheit: Wähle den übergeordneten Code (z.B. 2200 statt 2210 wenn unklar ob einfach oder gefährlich).

Feldwerte (NUR diese verwenden):
- weapon_type: knife|gun|blunt|axe|explosive|vehicle|pepper_spray|other|none|unknown
- drug_type: cannabis|cocaine|amphetamine|heroin|ecstasy|meth|other|null
- severity: minor|serious|critical|fatal|property_only|unknown
- motive: domestic|robbery|hate|drugs|road_rage|dispute|sexual|unknown|null
- victim_age/suspect_age: Alter als String (z.B. "34", "25-30") oder null wenn unbekannt
- victim_gender/suspect_gender: male|female|unknown|null
- victim_herkunft/suspect_herkunft: Staatsangehörigkeit NUR wenn wortwörtlich im Text als Adjektiv ("syrischer Staatsangehöriger", "polnischer Nationalität", "rumänische Tatverdächtige") oder Substantiv ("ein Syrer", "der Pole"). NICHT ableiten aus Namen, Aussehen, oder "polnische Zulassung"/"polnischer Transporter". null wenn nicht explizit als Personenbeschreibung genannt.
- victim_description/suspect_description: Freitext-Personenbeschreibung aus dem Artikel (Größe, Statur, Haarfarbe, Hautfarbe, Kleidung, Akzent, Besonderheiten). Wortwörtlich aus dem Polizeibericht übernehmen, nicht interpretieren. null wenn keine Beschreibung vorhanden.
- damage_amount_eur: Sachschaden/Gesamtschaden in Euro als Integer OHNE Tausendertrennzeichen (z.B. 5000, 70000). null wenn kein Schaden erwähnt. Bei "mehrere tausend Euro" → 3000 (konservative Schätzung). Bei "mehrere zehntausend Euro" → 30000. Bei Wertsachen: Diebesgut-Wert als damage_amount_eur.
- damage_estimate: exact|approximate|unknown — "exact" bei genauem Betrag, "approximate" bei "etwa"/"rund"/"geschätzt"/"mehrere", "unknown" bei "Angaben können noch nicht gemacht werden"

ARTIKEL:
{articles_json}

Antworte NUR mit einem JSON-Array. Keine Erklärungen, kein Markdown:
[
  {{"article_index": 0, "classification": "junk", "reason": "Verkehrshinweis"}},
  {{"article_index": 1, "classification": "crime", "clean_title": "Messerangriff in Mannheim — Mann schwer verletzt", "is_update": false, "location": {{"street": "Breite Straße", "house_number": "12", "district": "Innenstadt", "city": "Mannheim", "location_hint": null, "cross_street": null, "confidence": 1.0}}, "incident_time": {{"date": "2025-01-15", "time": "21:15", "precision": "exact"}}, "crime": {{"pks_code": "2200", "pks_category": "Körperverletzung", "sub_type": "Gefährliche Körperverletzung mit Messer", "confidence": 0.95}}, "details": {{"weapon_type": "knife", "drug_type": null, "victim_count": 1, "suspect_count": 1, "victim_age": "34", "suspect_age": "22", "victim_gender": "male", "suspect_gender": "male", "victim_herkunft": null, "suspect_herkunft": "syrisch", "victim_description": null, "suspect_description": "ca. 180 cm, schlanke Statur, kurze dunkle Haare, bekleidet mit schwarzer Jacke und Jeans", "severity": "serious", "motive": "dispute", "damage_amount_eur": 5000, "damage_estimate": "approximate"}}}},
  {{"article_index": 2, "classification": "feuerwehr", "reason": "Gasausströmung ohne Straftatverdacht"}},
  {{"article_index": 3, "classification": "update", "reason": "Nachtrag zu Brandfall", "update_type": "nachtrag"}}
]
"""

# Backwards-compat alias (quality_fix.py imports ENRICHMENT_PROMPT_V2)
ENRICHMENT_PROMPT_V2 = UNIFIED_PROMPT


def load_prompt(prompts_dir: Path = None, version: str = None) -> dict:
    """Load prompt template and companion config from file system.

    Returns a dict with keys:
        template: str    — the prompt template text
        model: str       — LLM model identifier
        provider: str    — provider key (e.g. "openrouter")
        max_tokens: int  — max output tokens
        temperature: float
    """
    if prompts_dir is None:
        prompts_dir = Path(__file__).parent / "prompts"
    if version is None:
        active_file = prompts_dir / "active.txt"
        if active_file.exists():
            version = active_file.read_text().strip()

    # Load prompt template
    template = UNIFIED_PROMPT  # fallback to inline
    if version:
        prompt_file = prompts_dir / f"{version}.txt"
        if prompt_file.exists():
            template = prompt_file.read_text()

    # Load companion JSON config (same basename, .json extension)
    defaults = {
        "model": MODEL,
        "provider": DEFAULT_PROVIDER,
        "max_tokens": UNIFIED_MAX_TOKENS,
        "temperature": 0,
    }
    config = dict(defaults)
    if version:
        config_file = prompts_dir / f"{version}.json"
        if config_file.exists():
            try:
                with open(config_file, "r", encoding="utf-8") as f:
                    config.update(json.load(f))
            except Exception:
                pass  # Fall back to defaults on parse error

    return {"template": template, **config}


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

    def __init__(self, cache_dir: str = ".cache", no_geocode: bool = False, model: str = None,
                 prompt_version: str = None, provider: str = None):
        # Load prompt config first — it may supply model/provider defaults
        self.prompt_config = load_prompt(version=prompt_version)

        # CLI overrides > prompt config > provider defaults
        effective_provider = provider or self.prompt_config.get("provider", DEFAULT_PROVIDER)
        prov = PROVIDERS[effective_provider]
        api_key = os.environ.get(prov["api_key_env"])
        if not api_key:
            raise ValueError(f"{prov['api_key_env']} required")

        self.google_maps_key = os.environ.get("GOOGLE_MAPS_API_KEY")
        if not no_geocode and not self.google_maps_key:
            raise ValueError("GOOGLE_MAPS_API_KEY required for geocoding")

        self.client = OpenAI(base_url=prov["base_url"], api_key=api_key)
        self.model = model or self.prompt_config.get("model") or prov["default_model"]
        self.max_output_tokens = self.prompt_config.get("max_tokens") or prov.get("max_output_tokens", UNIFIED_MAX_TOKENS)
        self.batch_size = prov.get("batch_size", UNIFIED_BATCH_SIZE)
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / "enrichment_cache.json"
        self.geocode_file = self.cache_dir / "geocode_cache.json"
        self.cache = self._load_cache(self.cache_file)
        self.geocode_cache = self._load_cache(self.geocode_file) if not no_geocode else {}
        self.no_geocode = no_geocode
        self.prompt_version = prompt_version

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

    def _call_llm(self, prompt: str, max_tokens: int = 4000, batch_size: int = 1) -> list[dict]:
        """Call LLM and parse JSON array response."""
        try:
            start_time = time.time()
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=max_tokens,
            )
            latency_ms = int((time.time() - start_time) * 1000)
            text = response.choices[0].message.content

            # Record token usage
            if response.usage:
                entry = {
                    "timestamp": time.time(),
                    "model": self.model,
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens,
                    "batch_size": batch_size,
                    "latency_ms": latency_ms,
                }
                usage_path = os.path.join(self.cache_dir, "token_usage.jsonl")
                os.makedirs(self.cache_dir, exist_ok=True)
                with open(usage_path, "a") as f:
                    f.write(json.dumps(entry) + "\n")

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

        prompt = self.prompt_config["template"].format(
            count=len(articles),
            articles_json=json.dumps(articles_data, ensure_ascii=False, indent=2)
        )

        return self._call_llm(prompt, max_tokens=max_tokens, batch_size=len(articles))

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
            batch_size = self.batch_size
            max_tokens = self.max_output_tokens
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

                    # "update" without crime data = pure correction/erledigung → remove
                    if classification == "update" and not first.get("location") and not first.get("crime"):
                        self.cache[key] = [{"_classification": "update", "reason": first.get("reason", ""), "update_type": first.get("update_type", "")}]
                        removed_by_idx[orig_idx] = {
                            **art,
                            "_removal_reason": "llm:update",
                            "_triage_reason": first.get("reason", ""),
                        }
                        continue

                    # Crime or update-with-data — extract enrichment data
                    enrichments = []
                    for llm_result in incidents:
                        loc = llm_result.get("location") or {}
                        is_update = llm_result.get("is_update", False) or classification == "update"
                        enrichment = {
                            "clean_title": llm_result.get("clean_title"),
                            "classification": classification,
                            "location": loc,
                            "incident_time": llm_result.get("incident_time") or {},
                            "crime": llm_result.get("crime") or {},
                            "details": llm_result.get("details") or {},
                            "is_update": is_update,
                        }
                        if is_update:
                            enrichment["update_type"] = first.get("update_type", "nachtrag")

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
    from filter_articles import is_junk_article

    parser = argparse.ArgumentParser(description="Single-round AI article enrichment")
    parser.add_argument("--input", "-i", required=True, help="Input JSON file")
    parser.add_argument("--output", "-o", required=True, help="Output JSON file")
    # Geocoding is intentionally disabled by default and run in a separate manual step.
    geo_group = parser.add_mutually_exclusive_group()
    geo_group.add_argument(
        "--with-geocode",
        action="store_true",
        help="Enable inline geocoding during enrichment (default: off)",
    )
    geo_group.add_argument(
        "--no-geocode",
        action="store_true",
        help="Skip geocoding (default behavior; kept for compatibility)",
    )
    parser.add_argument("--cache-dir", default=".cache", help="Cache directory")
    parser.add_argument("--removed", help="Path for removed articles log")
    parser.add_argument("--skip-clustering", action="store_true",
                        help="Skip rule-based incident grouping")
    parser.add_argument("--no-prefilter", action="store_true",
                        help="Skip regex pre-filter (send all articles to LLM)")
    parser.add_argument("--prompt-version", default=None,
                        help="Override prompt version (e.g., v1, v2). Default: read from active.txt")
    parser.add_argument("--model", default=None,
                        help="Override LLM model (default: depends on provider)")
    parser.add_argument("--provider", default=None, choices=list(PROVIDERS.keys()),
                        help="LLM provider (default: openrouter)")

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
    if args.with_geocode:
        print("Geocoding mode: inline (same-pass)")
    else:
        print("Geocoding mode: deferred (LLM-only enrich now; run post_geocode manually)")

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
    # Default is no geocoding unless explicitly requested.
    no_geocode = not args.with_geocode
    enricher = FastEnricher(cache_dir=args.cache_dir, no_geocode=no_geocode,
                            prompt_version=args.prompt_version, model=args.model,
                            provider=args.provider)

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
