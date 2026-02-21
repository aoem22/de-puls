# Adlerlicht Enrichment Pipeline

> Complete architecture reference for the German police press-release enrichment pipeline.

---

## 1. Pipeline Overview (5-Phase Flow)

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                    PHASE 1: SCRAPE                                  │
 │  scripts/scrape_blaulicht_async.py                                  │
 │                                                                     │
 │  presseportal.de ──► 16 Bundesländer × monthly chunks               │
 │                      (8 concurrent in parallel mode)                │
 │                                                                     │
 │  Output: data/pipeline/chunks/raw/*.json                            │
 └───────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │                    PHASE 2: FILTER                                   │
 │  scripts/pipeline/filter_articles.py                                │
 │                                                                     │
 │  Tier 1 (Deterministic) ─► PM number series, Nachtrag detection     │
 │  Tier 2 (Heuristic)     ─► Jaccard similarity ≥ 0.5                │
 │                             within (source, city, 7-day window)     │
 │  Junk removal           ─► regex patterns for non-crime articles    │
 │  Feuerwehr filter       ─► drops ~15% fire dept articles            │
 │                                                                     │
 │  Output: data/pipeline/chunks/filtered/*.json                       │
 │          + incident_group_id, group_role on each article            │
 └───────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │                    PHASE 3: ENRICH (3 LLM Rounds)                   │
 │  scripts/pipeline/fast_enricher.py                                  │
 │                                                                     │
 │  ┌───────────────────────────────────────────────────────┐          │
 │  │ Round 1 — TRIAGE (TRIAGE_PROMPT)                      │          │
 │  │ Batch: 25 articles │ Model: grok-4-fast               │          │
 │  │ → Classify: single | multi | junk | feuerwehr         │          │
 │  │ Cache: .cache/triage_cache.json                       │          │
 │  └──────────────────────┬────────────────────────────────┘          │
 │                         ▼                                           │
 │  ┌───────────────────────────────────────────────────────┐          │
 │  │ Round 2 — ENRICHMENT (ENRICHMENT_PROMPT_V2)           │          │
 │  │ Single batch: 10 articles, 8K tokens                  │          │
 │  │ Multi batch:   3 articles, 12K tokens                 │          │
 │  │ → Extract: location, crime/PKS, details, clean_title  │          │
 │  │ → Geocode via Google Maps API                         │          │
 │  │ Cache: .cache/enrichment_cache.json                   │          │
 │  │        .cache/geocode_cache.json                      │          │
 │  └──────────────────────┬────────────────────────────────┘          │
 │                         ▼                                           │
 │  ┌───────────────────────────────────────────────────────┐          │
 │  │ Round 3 — CLUSTERING (CLUSTER_PROMPT)                 │          │
 │  │ Batch: 20 incidents │ Model: grok-4-fast              │          │
 │  │ → Group related incidents (same city, ≤7 days, PKS)   │          │
 │  │ → Assign: incident_group_id + group_role              │          │
 │  └───────────────────────────────────────────────────────┘          │
 │                                                                     │
 │  Output: data/pipeline/chunks/enriched/*.json                       │
 └───────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │                    PHASE 4: MERGE                                    │
 │  Orchestrator combines all enriched chunks                          │
 │                                                                     │
 │  Output: data/pipeline/merged/blaulicht_all_enriched.json           │
 └───────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │                    PHASE 5: PUSH TO SUPABASE                        │
 │  scripts/pipeline/push_to_supabase.py                               │
 │                                                                     │
 │  Transform enriched JSON → Supabase schema                          │
 │  Map PKS codes → crime categories                                   │
 │  Generate deterministic IDs (SHA256)                                │
 │  Batch upsert → crime_records table                                 │
 │  Supports --run-name for A/B experiments                            │
 └─────────────────────────────────────────────────────────────────────┘
```

### Orchestration Modes

| Mode | Script | Concurrency |
|------|--------|-------------|
| Sequential | `orchestrator.py` | 1 Bundesland at a time |
| Parallel | `parallel_orchestrator.py` | 8 scrape / 8 filter / 4 enrich |
| CLI Runner | `runner.py` | Configurable via flags |

---

## 2. LLM Prompts (Verbatim)

All prompts target **`x-ai/grok-4-fast`** via OpenRouter. Written in German to match police report language.

### 2.1 TRIAGE_PROMPT (Round 1 — Classification)

**File:** `scripts/pipeline/fast_enricher.py`
**Batch size:** 25 articles
**Purpose:** Classify each article as single-incident, multi-incident, junk, or fire department.

```
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
```

---

### 2.2 ENRICHMENT_PROMPT (V1 — Original)

**File:** `scripts/pipeline/fast_enricher.py`
**Batch size:** 10 (single) / 3 (multi) articles
**Purpose:** Extract structured data from each incident. This is the original prompt before quality improvements.

```
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
```

---

### 2.3 ENRICHMENT_PROMPT_V2 (Enhanced — Current Default)

**File:** `scripts/pipeline/fast_enricher.py`
**Batch size:** 10 (single) / 3 (multi) articles
**Purpose:** Same extraction as V1 but with three additional quality rules for multi-incident detection, Germany-only disambiguation, and improved time extraction.

```
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
```

---

### 2.4 CLUSTER_PROMPT (Round 3 — Incident Grouping)

**File:** `scripts/pipeline/fast_enricher.py`
**Batch size:** 20 incidents
**Purpose:** Group related incidents (updates, follow-ups, resolutions) under a single primary.

```
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
```

---

## 3. V1 vs V2 Enrichment Prompt Comparison

| Aspect | V1 (`ENRICHMENT_PROMPT`) | V2 (`ENRICHMENT_PROMPT_V2`) |
|--------|--------------------------|----------------------------|
| Multi-incident detection | Mentioned in intro only | **REGEL 1** — explicit markers (numbered sections, POL-headers, word count heuristic) |
| Geography | No guidance | **REGEL 2** — Germany-only constraint with common confusion pairs (Basel, Frankfurt, Freiburg, Konstanz) |
| Time extraction | Basic format spec | **REGEL 3** — 12 German time-expression mappings ("gegen", "am Abend", "Freitagnacht", etc.) with strict `precision != "unknown"` rule |
| PKS categories | Identical | Identical |
| Field value enums | Identical | Identical |
| Output schema | Identical | Identical |

**Key insight:** V2 doesn't change *what* is extracted — it improves *how well* the LLM handles edge cases. The three rules address the most common enrichment errors found during quality review.

---

## 4. Cache Architecture

```
.cache/
├── triage_cache.json        Round 1 results
├── enrichment_cache.json    Round 2 results
└── geocode_cache.json       Google Maps responses
```

### Cache Key Generation

```python
def _cache_key(self, url: str, body: str) -> str:
    return hashlib.sha256(f"{url}:{body}".encode()).hexdigest()[:16]
```

### Cache Details

| Cache File | Key Format | Value Format | Scope |
|------------|-----------|--------------|-------|
| `triage_cache.json` | `triage:{sha256(url:body)[:16]}` | `{"classification": "single\|multi\|junk\|feuerwehr", "incident_count": int, "reason": str\|null}` | Per article |
| `enrichment_cache.json` | `{sha256(url:body)[:16]}` | List of enrichment dicts (one per incident in article) | Per article → multiple incidents |
| `geocode_cache.json` | `"{street}, {district}, {city}, {bundesland}, Germany"` | `{"lat": float, "lon": float, "precision": "rooftop\|range\|center\|approximate\|outside_germany"}` | Per unique address |

All caches are loaded at `FastEnricher.__init__()` and saved via `save_caches()` after each batch. This means a crashed run can resume without re-calling the LLM or Google Maps API for already-processed articles.

---

## 5. Field Mapping: Enriched JSON → Supabase `crime_records`

**File:** `scripts/pipeline/push_to_supabase.py` — `transform_article()`

### Core Fields

| Enriched JSON Path | Supabase Column | Type | Notes |
|---|---|---|---|
| `url` | `source_url` | text | Original article URL |
| `date` | `published_at` | timestamptz | Sanitized to ISO-8601 |
| `title` | `title` | text | Original title |
| `clean_title` | `clean_title` | text | LLM-generated, max 80 chars |
| `body` | `body` | text | Full article text |
| `source` | `source_agency` | text | Police department name |

### Location Fields

| Enriched JSON Path | Supabase Column | Type | Notes |
|---|---|---|---|
| `location.lat` | `latitude` | float8 | **Required** — skip if null |
| `location.lon` | `longitude` | float8 | **Required** — skip if null |
| `location.confidence` | `confidence` | float4 | 0.0–1.0 |
| `location.street` + `house_number` + `district` + `city` | `location_text` | text | Human-readable concatenation |
| Derived from `location.street` + `confidence` | `precision` | text | `"street"` (conf ≥ 0.8), `"neighborhood"` (≥ 0.5), `"city"`, `"unknown"` |

### Crime Fields

| Enriched JSON Path | Supabase Column | Type | Notes |
|---|---|---|---|
| `crime.pks_code` → `map_category()` | `categories` | text[] | Array of mapped categories |
| `crime.sub_type` | `crime_sub_type` | text | Crime subtype |
| `crime.confidence` | `crime_confidence` | float4 | 0.0–1.0 |

### Incident Time Fields

| Enriched JSON Path | Supabase Column | Type | Notes |
|---|---|---|---|
| `incident_time.date` | `incident_date` | date | YYYY-MM-DD |
| `incident_time.time` | `incident_time` | time | HH:MM |
| `incident_time.precision` | `incident_time_precision` | text | exact / approximate / unknown |

### Detail Fields

| Enriched JSON Path | Supabase Column | Type | Allowed Values |
|---|---|---|---|
| `details.weapon_type` | `weapon_type` | text | knife, gun, blunt, explosive, vehicle, none, unknown |
| `details.drug_type` | `drug_type` | text | cannabis, cocaine, amphetamine, heroin, ecstasy, meth, other |
| `details.victim_count` | `victim_count` | int4 | Non-negative integer |
| `details.suspect_count` | `suspect_count` | int4 | Non-negative integer |
| `details.victim_age` | `victim_age` | text | Age string or null |
| `details.suspect_age` | `suspect_age` | text | Age string or null |
| `details.victim_gender` | `victim_gender` | text | male, female, unknown |
| `details.suspect_gender` | `suspect_gender` | text | male, female, unknown |
| `details.victim_herkunft` | `victim_herkunft` | text | Nationality (only if explicit in text) |
| `details.suspect_herkunft` | `suspect_herkunft` | text | Nationality (only if explicit in text) |
| `details.severity` | `severity` | text | minor, serious, critical, fatal, property_only, unknown |
| `details.motive` | `motive` | text | domestic, robbery, hate, drugs, road_rage, dispute, unknown |

### Experiment / Grouping Fields

| Enriched JSON Path | Supabase Column | Type | Notes |
|---|---|---|---|
| `incident_group_id` | `incident_group_id` | text | UUID for dedup grouping |
| `group_role` | `group_role` | text | primary, follow_up, update, resolution, related |
| `--run-name` CLI flag | `pipeline_run` | text | A/B experiment identifier |

### Deterministic ID Generation

```python
def make_id(url, published_at, location_text="", pks_code="", pipeline_run="default"):
    raw = f"{url}:{published_at}:{location_text}:{pks_code}:{pipeline_run}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]
```

Records with the same source URL, date, location, and PKS code always get the same ID, enabling idempotent upserts.

---

## 6. PKS Code → Category Mapping

### Primary Mapping (`PKS_TO_CATEGORY`)

| PKS Code | German Name | Category |
|----------|-------------|----------|
| 0100 | Mord/Totschlag | `murder` |
| 0200 | Tötungsdelikt | `murder` |
| 2110 | Tötungsdelikt (Raub) | `murder` |
| 2100 | Raub | `robbery` |
| 2200 | Körperverletzung | `assault` |
| 2340 | Bedrohung | `assault` |
| 1100 | Vergewaltigung/sexuelle Nötigung | `sexual` |
| 1110 | Sexuelle Nötigung | `sexual` |
| 1300 | Sexueller Missbrauch | `sexual` |
| 3000 | Diebstahl (einfach) | `burglary` |
| 4000 | Diebstahl (schwer) | `burglary` |
| 4350 | Wohnungseinbruch | `burglary` |
| 4780 | Kfz-Diebstahl | `burglary` |
| 5100 | Betrug | `fraud` |
| 6200 | Widerstand gg. Vollstreckungsbeamte | `assault` |
| 6740 | Brandstiftung | `arson` |
| 6750 | Sachbeschädigung | `vandalism` |
| 7100 | Verkehrsunfall | `traffic` |
| 7200 | Fahrerflucht | `traffic` |
| 7300 | Trunkenheit im Verkehr | `traffic` |
| 7400 | Unerlaubtes Entfernen vom Unfallort | `traffic` |
| 8910 | Drogendelikte | `drugs` |
| 8990 | Sonstiges | `other` |

### Fallback German-Name Mapping (`GERMAN_TO_CATEGORY`)

Used when PKS code is missing but the LLM returned a German category name:

| German Name | Category |
|-------------|----------|
| Mord | `murder` |
| Tötungsdelikt | `murder` |
| Raub | `robbery` |
| Körperverletzung | `assault` |
| Bedrohung | `assault` |
| Sexualdelikt | `sexual` |
| Diebstahl | `burglary` |
| Wohnungseinbruch | `burglary` |
| Kfz-Diebstahl | `burglary` |
| Betrug | `fraud` |
| Brandstiftung | `arson` |
| Sachbeschädigung | `vandalism` |
| Verkehrsunfall | `traffic` |
| Fahrerflucht | `traffic` |
| Trunkenheit | `traffic` |
| Drogen | `drugs` |
| Vermisst | `missing_person` |
| Versammlung | `other` |
| Verkehrskontrolle | `traffic` |
| Sonstige | `other` |

---

## 7. Configuration Reference

**File:** `scripts/pipeline/config.py`

| Constant | Value |
|----------|-------|
| LLM Model | `x-ai/grok-4-fast` (via OpenRouter) |
| LLM API Base | `https://openrouter.ai/api/v1` |
| Date Range | 2023-02-01 → 2026-02-01 (3 years) |
| Chunk Size | 1 month per Bundesland |
| Delay Between Chunks | 5 seconds |
| Max Retries | 3 (delays: 1min, 5min, 15min) |
| Germany Bounding Box | lat 47.27–55.06, lon 5.87–15.04 |
| Bundesländer | All 16 German states |

### Directory Structure

```
data/pipeline/
├── chunks/
│   ├── raw/           Phase 1 output (scraped articles)
│   ├── filtered/      Phase 2 output (deduplicated)
│   └── enriched/      Phase 3 output (LLM-enriched)
├── merged/            Phase 4 output (combined files)
└── manifest.json      Pipeline progress tracking

.cache/
├── triage_cache.json
├── enrichment_cache.json
└── geocode_cache.json
```
