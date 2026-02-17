#!/usr/bin/env python3
"""
Prompt evaluation script for the unified enrichment prompt.

Runs a curated set of articles through the enrichment pipeline and compares
results against expected classifications and extractions. Useful for:
  - Testing prompt changes before running on 100K+ articles
  - A/B testing different models or batch sizes
  - Regression testing after prompt edits

Usage:
    python3 -m scripts.pipeline.eval_prompt
    python3 -m scripts.pipeline.eval_prompt --model x-ai/grok-4-fast --batch-size 4
    python3 -m scripts.pipeline.eval_prompt --runs 3  # consistency test
    python3 -m scripts.pipeline.eval_prompt --sample 20 --from-file data/pipeline/merged/blaulicht_enriched_1000.json
"""

import argparse
import json
import os
import sys
import time
from collections import Counter
from pathlib import Path

import certifi
from dotenv import load_dotenv

load_dotenv()
os.environ['SSL_CERT_FILE'] = certifi.where()

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from scripts.pipeline.fast_enricher import FastEnricher, UNIFIED_PROMPT, UNIFIED_BATCH_SIZE


# ── Built-in test cases (curated from real data) ──────────────────────

EVAL_ARTICLES = [
    # --- JUNK ---
    {
        "id": "junk_demo",
        "title": "POL-HH: 230501-5. Tag der Arbeit in Hamburg - Abschlussmeldung zum heutigen Polizeieinsatz",
        "body": "Hamburg(ots)\n\nZeit: 01.05.2023\n\nOrt: Hamburger Stadtgebiet\n\nAm Tag der Arbeit haben in Hamburg wieder tausende Menschen demonstriert. Die Polizei Hamburg war mit einem Großaufgebot an Kräften im Einsatz und zieht eine überwiegend positive Bilanz.\n\nDer Deutsche Gewerkschaftsbund (DGB) hatte drei Demonstrationszüge angemeldet. In Harburg versammelten sich ab dem Vormittag rund 160 Teilnehmerinnen und Teilnehmer, in Bergedorf etwa 500.",
        "date": "2023-05-01T23:00:00",
        "city": "Hamburg",
        "source": "Polizei Hamburg",
        "bundesland": "Hamburg",
        "expected": {"classification": "junk"},  # Demo report / Bilanz — reason may vary
    },
    {
        "id": "junk_housing",
        "title": "IM-MV: Hilfe für Wohnungsunternehmen bei unverschuldeten Geld-Engpässen",
        "body": "Schwerin(ots)\n\nMit den aktuell stark gestiegenen Energiekosten sind erhebliche Belastungen in Bezug auf die Zahlungsfähigkeit von Wohnungsunternehmen verbunden.",
        "date": "2023-05-01T09:00:00",
        "city": "Schwerin",
        "source": "Innenministerium Mecklenburg-Vorpommern",
        "bundesland": "Mecklenburg-Vorpommern",
        "expected": {"classification": "junk"},
    },
    {
        "id": "junk_vermisst",
        "title": "POL-MA: Mannheim: 85-Jähriger aus Mannheim vermisst - Polizei bittet um Mithilfe",
        "body": "Mannheim(ots)\n\nSeit dem 29.04.2023 wird der 85-jährige Helmut S. aus Mannheim vermisst. Er verließ am Samstag gegen 10:00 Uhr seine Wohnung und kehrte seitdem nicht mehr zurück. Er ist dement und orientierungslos. Hinweise an das Polizeirevier Mannheim-Neckarstadt, Tel. 0621 3301-0.",
        "date": "2023-05-01T15:00:00",
        "city": "Mannheim",
        "source": "Polizeipräsidium Mannheim",
        "bundesland": "Baden-Württemberg",
        "expected": {"classification": "junk", "reason_contains": "Vermisst"},
    },
    {
        "id": "junk_kontrolle",
        "title": "HZA-HB: Bundesweite Schwerpunktaktion gegen Schwarzarbeit",
        "body": "Bremen(ots)\n\nAm vergangenen Dienstag hat die Finanzkontrolle Schwarzarbeit des Zolls (FKS) im Rahmen einer bundesweiten Schwerpunktaktion Baustellen kontrolliert. Bei 139 befragten Personen wurden 23 Verdachtsfälle festgestellt.",
        "date": "2023-04-27T10:00:00",
        "city": "Bremen",
        "source": "Hauptzollamt Bremen",
        "bundesland": "Bremen",
        "expected": {"classification": "junk", "reason_contains": "Kontroll"},
    },

    # --- FEUERWEHR ---
    {
        "id": "fw_gas",
        "title": "FW Bremerhaven: Gasausströmung in einem Mehrfamilienhaus",
        "body": "Bremerhaven(ots)\n\nÜber die Notrufnummer 112 meldete am Montagabend ein aufmerksamer Hausbewohner Gasgeruch in einer Wohnung in einem Mehrfamilienhaus im Stadtteil Geestemünde.\n\nUm kurz vor 22 Uhr rückten der Löschzug, ein Spezialfahrzeug mit Messtechnik und der Rettungsdienst der Feuerwehr Bremerhaven aus. Einsatzkräfte schieberten unter schwerem Atemschutz die Gasleitungen ab.",
        "date": "2023-05-01T23:43:08",
        "city": "Bremerhaven",
        "source": "Feuerwehr Bremerhaven",
        "bundesland": "Bremen",
        "expected": {"classification": "feuerwehr"},
    },
    {
        "id": "fw_vegetation",
        "title": "FW Bremerhaven: Feuerwehr Bremerhaven löscht Vegetationsbrand im Forst Reinkenheide",
        "body": "Bremerhaven(ots)\n\nDie Feuerwehr Bremerhaven wurde am frühen Abend zu einem Flächenbrand im Forst Reinkenheide alarmiert. Auf einer Fläche von circa 250qm hatte sich das Feuer ausgebreitet.",
        "date": "2023-04-22T21:15:17",
        "city": "Bremerhaven",
        "source": "Feuerwehr Bremerhaven",
        "bundesland": "Bremen",
        "expected": {"classification": "feuerwehr"},
    },

    # --- CRIME: Simple cases ---
    {
        "id": "crime_kv",
        "title": "POL-NB: Gefährlich Körperverletzung in Neubrandenburg",
        "body": "Neubrandenburg(ots)\n\nAm 30.04.2023 wurde ein 42-jähriger deutscher Staatsangehöriger gegen 23:00 Uhr Opfer eines tätlichen Angriffs im Ponyweg in Neubrandenburg.\n\nZuvor waren Geschädigte und auch der bislang unbekannte Angreifer Gast einer öffentlichen Feierlichkeit in einem örtlichen Bistro. Dort soll es bereits zu einer verbalen Streitigkeit zwischen dem Täter und dem späteren Opfer gekommen sein.\nNach Beendigung der abendlichen Veranstaltung schlug der Unbekannte mit einem Teleskopschlagstock zu. Der Hieb traf den Geschädigten im Gesicht mit einer Platzwunde oberhalb des rechten Auges.",
        "date": "2023-05-01T20:58:54",
        "city": "Neubrandenburg",
        "source": "Polizeipräsidium Neubrandenburg",
        "bundesland": "Mecklenburg-Vorpommern",
        "expected": {
            "classification": "crime",
            "city": "Neubrandenburg",
            "street": "Ponyweg",
            "pks_code": "2200",
            "weapon_type": "blunt",
            "time": "23:00",
            "precision": "approximate",
            "victim_herkunft": "deutsch",
        },
    },
    {
        "id": "crime_hitlergruss",
        "title": "POL-HB: Nr.: 0271 --Hitlergruß vor Kindern gezeigt--",
        "body": "Bremen(ots)\n\nAm Sonntagabend zeigte ein 39 Jahre alter Mann in Hemelingen gegenüber einer Gruppe Kinder den Hitlergruß und äußerte rassistische Beleidigungen.\n\nGegen 18 Uhr spielten fünf Kinder in der Wehrheimer Straße, als sich zunächst ein Junge genähert und rassistische Beleidigungen geäußert haben soll. Zwei Mädchen im Alter von 11 und 12 Jahren sprachen ihn an. Daraufhin erschien dessen 39 Jahre alter Vater, äußerte ebenfalls Beleidigungen und die Worte \"Adolf lebt\" und zeigte den Hitlergruß.",
        "date": "2023-05-01T12:38:24",
        "city": "Bremen",
        "source": "Polizei Bremen",
        "bundesland": "Bremen",
        "expected": {
            "classification": "crime",
            "city": "Bremen",
            "district": "Hemelingen",
            "street": "Wehrheimer Straße",
            "pks_code": "6260",
            "time": "18:00",
            "precision": "approximate",
        },
    },
    {
        "id": "crime_waffe",
        "title": "BPOLI-OG: Messer sichergestellt",
        "body": "Baden-Baden(ots)\n\nDie Beamten der Bundespolizei in Offenburg haben gestern Nachmittag am Bahnhof in Baden-Baden ein verbotenes Einhandmesser sichergestellt. Bei der Kontrolle eines 25-jährigen griechischen Staatsangehörigen wurde das Messer zugriffsbereit in seiner Hosentasche aufgefunden. Ihn erwartet nun eine Anzeige wegen eines Verstoßes gegen das Waffengesetz.",
        "date": "2023-04-27T10:07:09",
        "city": "Baden-Baden",
        "source": "Bundespolizeiinspektion Offenburg",
        "bundesland": "Baden-Württemberg",
        "expected": {
            "classification": "crime",
            "city": "Baden-Baden",
            "location_hint": "Bahnhof",
            "pks_code": "8900",
            "suspect_herkunft": "griechisch",
            "suspect_age": "25",
        },
    },
    {
        "id": "crime_diebstahl",
        "title": "POL-FR: Zell im Wiesental: SB-Automaten an Autowaschanlage aufgebrochen",
        "body": "Freiburg(ots)\n\nAm Donnerstag, 27.04.2023, in dem Zeitraum zwischen 02.40 Uhr bis 03.00 Uhr, hebelte ein Unbekannter in der Schopfheimer Straße einen SB-Staubsaugerautomaten und einen SB-Automaten einer Autowaschanlage auf. Aus den Automaten wurde das darin befindliche Münzgeld entwendet.",
        "date": "2023-04-28T13:12:56",
        "city": "Freiburg",
        "source": "Polizeipräsidium Freiburg",
        "bundesland": "Baden-Württemberg",
        "expected": {
            "classification": "crime",
            "city": "Zell im Wiesental",
            "street": "Schopfheimer Straße",
            "pks_code_in": ["3000", "4000"],  # 3000 or 4000 both valid (Aufbruch ambiguous)
            "location_hint": "Autowaschanlage",
            "time": "02:40",
            "precision": "approximate",
        },
    },
    {
        "id": "crime_trunkenheit",
        "title": "POL-UL: (GP) Göppingen - Betrunken unterwegs",
        "body": "Ulm(ots)\n\nSo kontrollierte die Göppinger Polizei, zwischen Mitternacht und frühem Morgen, zwei Fahrer, die durch ihre Fahrweise auffielen. Beide waren in Schlangenlinien unterwegs. So musste eine 30-Jährige, die kurz nach Mitternacht auf der B10 von Kuchen in Richtung Göppingen fuhr, eine Blutprobe und ihren Führerschein abgeben. Dieses Schicksal ereilte dann auch einen 23-Jährigen, der gegen 01.50 Uhr in der Boller Straße in Fahrtrichtung Jebenhausen unterwegs war.",
        "date": "2023-05-01T09:44:14",
        "city": "Ulm",
        "source": "Polizeipräsidium Ulm",
        "bundesland": "Baden-Württemberg",
        "expected": {
            "classification": "crime",
            "city": "Göppingen",
            "pks_code": "7300",
        },
    },
    {
        "id": "crime_kfz_diebstahl",
        "title": "POL-KN: (Singen, Lkr. Konstanz) Grauer Hyundai i30 vom Parkplatz einer Autovermietung gestohlen",
        "body": "Singen(ots)\n\nBereits vergangenen Woche haben unbekannte Täter ein Auto vom Parkplatz einer Autovermietung in der Marie-Curie-Straße gestohlen. Im Zeitraum zwischen Donnerstag, 20.04.2023 - 18:20 Uhr, und Freitag, 21.04.2023 - 10:00 Uhr, entwendeten die Täter den grauen Hyundai i30 mit dem amtlichen Kennzeichen \"KN-MR 498\".",
        "date": "2023-04-25T12:00:12",
        "city": "Singen",
        "source": "Polizeipräsidium Konstanz",
        "bundesland": "Baden-Württemberg",
        "expected": {
            "classification": "crime",
            "city": "Singen",
            "street": "Marie-Curie-Straße",
            "pks_code": "4780",
            "severity": "property_only",
        },
    },

    # --- CRIME: Multi-incident digests ---
    {
        "id": "multi_2incidents",
        "title": "POL-AA: Rems-Murr-Kreis - Stand: 29.04.2023/13:30 Uhr - 2 Verkehrsunfälle",
        "body": "Aalen(ots)\n\nKernen-Rommelshausen - Beim Aussteigen nicht aufgepasst\n\nAm Freitag gegen 14:35 Uhr wollte ein 58 Jahre alter Renaultfahrer in Kernen-Rommelshausen in der Karlstraße aus seinem Auto aussteigen. Jedoch übersah er beim Öffnen der Türe einen Radfahrer, welcher den dortigen Radstreifen befuhr. Er touchierte den Radfahrer mit der Türe, welcher daraufhin stürzte und leichte Verletzungen erlitt.\n\nBacknang - Vorfahrt missachtet\n\nAm Samstag gegen 10:19 Uhr wollte eine 64 Jahre alte Fahrerin eines Mercedes von der Wiener Straße in Backnang-Maubach auf die B14 einbiegen. Hierbei übersah sie einen 38 Jahre Mercedesfahrer und stieß zusammen. Die 44 Jahre alte Beifahrerin wurde leicht verletzt.",
        "date": "2023-04-29T13:31:47",
        "city": "Aalen",
        "source": "Polizeipräsidium Aalen",
        "bundesland": "Baden-Württemberg",
        "expected": {
            "classification": "crime",
            "min_incidents": 2,
            "cities": ["Kernen", "Backnang"],
        },
    },
    {
        "id": "multi_digest",
        "title": "POL-AA: Ostalbkreis: Erneut eingeschlagene Scheiben, weiterer Einbruchsversuch und Unfälle",
        "body": "Aalen(ots)\n\nAalen: Eingeschlagene Scheiben bei der Agentur für Arbeit\n\nErneut schlug ein Unbekannter mehr als 30 Scheiben am Gebäude der Agentur für Arbeit in der Julius-Bausch-Straße ein. Der Sachschaden, der am Sonntag gegen 17 Uhr bekannt wurde, wird auf etwa 50.000 Euro geschätzt.\n\nAalen: Einbruchsversuch in Schule\n\nEin Unbekannter versuchte am Wochenende in das Gebäude einer Schule in der Galgenbergstraße einzubrechen. Der Versuch scheiterte, es entstand ein Sachschaden von etwa 1.000 Euro.\n\nEllwangen: Unfall beim Rangieren\n\nAm Samstag gegen 15:30 Uhr stieß ein 72 Jahre alter Mann mit seinem LKW beim Rangieren auf einem Parkplatz gegen einen geparkten BMW. Der Schaden wird auf 5.000 Euro geschätzt.",
        "date": "2023-04-24T15:16:05",
        "city": "Aalen",
        "source": "Polizeipräsidium Aalen",
        "bundesland": "Baden-Württemberg",
        "expected": {
            "classification": "crime",
            "min_incidents": 3,
            "cities": ["Aalen", "Aalen", "Ellwangen"],
        },
    },

    # --- CRIME: Nationality test cases ---
    {
        "id": "crime_herkunft_explicit",
        "title": "POL-HH: Mehrere Zuführungen nach Einbrüchen in Hamburg-Marmstorf und Hamburg-Langenhorn",
        "body": "Hamburg(ots)\n\nTatzeiten: a) 28.04.2023, 15:00 Uhr, b) 28.04.2023, 17:30 Uhr\n\na) Freitagnachmittag nahmen Polizisten in Marmstorf drei Rumänen und in Langenhorn einen Polen vorläufig fest. Die Männer sind tatverdächtig, in Einfamilienhäuser eingebrochen zu sein.\n\nb) In Langenhorn beobachtete ein Zeuge gegen 17:30 Uhr einen Verdächtigen, der sich an einem Fenster zu schaffen machte. Die Polizei konnte einen 24-jährigen polnischen Staatsangehörigen festnehmen.",
        "date": "2023-04-28T16:00:00",
        "city": "Hamburg",
        "source": "Polizei Hamburg",
        "bundesland": "Hamburg",
        "expected": {
            "classification": "crime",
            "min_incidents": 2,
            "suspect_herkunft_a": "rumänisch",
            "suspect_herkunft_b": "polnisch",
        },
    },
    {
        "id": "crime_herkunft_false_positive",
        "title": "POL-RT: Tödlicher Verkehrsunfall",
        "body": "Reutlingen(ots)\n\nEin 27-jähriger Fahrer eines Pkw Toyota Yaris mit polnischer Zulassung war in Richtung Trochtelfingen unterwegs und kam im Auslauf einer Rechtskurve aus bislang ungeklärter Ursache auf die Gegenfahrbahn. Dort kollidierte er frontal mit einem entgegenkommenden Sattelzug. Der 27-Jährige erlag noch an der Unfallstelle seinen Verletzungen.",
        "date": "2023-05-01T08:00:00",
        "city": "Reutlingen",
        "source": "Polizeipräsidium Reutlingen",
        "bundesland": "Baden-Württemberg",
        "expected": {
            "classification": "crime",
            "pks_code": "7100",
            "severity": "fatal",
            "victim_herkunft": None,  # "polnische Zulassung" is NOT nationality
        },
    },

    # --- UPDATE / NACHTRAG ---
    {
        "id": "update_nachtrag",
        "title": "POL-NB: Nachtrag: Brand mehrerer Fahrzeuge in Barth",
        "body": "Barth (LK VR)(ots)\n\nWie bereits berichtet, brannten in der Nacht mehrere Fahrzeuge. Die Kriminalpolizei hat die Ermittlungen wegen Brandstiftung aufgenommen. Der Sachschaden beläuft sich auf ca. 80.000 Euro.",
        "date": "2023-05-01T10:00:00",
        "city": "Barth",
        "source": "Polizeipräsidium Neubrandenburg",
        "bundesland": "Mecklenburg-Vorpommern",
        "expected": {
            "classification": "update",
            "update_type": "nachtrag",
        },
    },
    {
        "id": "update_korrektur",
        "title": "POL-RT: Betrunken, zu schnell und ohne Führerschein - Korrektur zur Pressemeldung",
        "body": "Reutlingen(ots)\n\nIn der oben genannten Pressemeldung hat sich ein Tippfehler eingeschlichen. Die Unfallörtlichkeit ist auf der B465.\nWir bitten, diese korrigierte Pressemeldung zu verwenden:\n\nBad Urach: Betrunken, zu schnell und ohne Führerschein. Am Freitagabend gegen 22 Uhr fuhr ein 24-Jähriger mit seinem Opel auf der B465. Er kam von der Fahrbahn ab.",
        "date": "2023-04-28T11:00:00",
        "city": "Reutlingen",
        "source": "Polizeipräsidium Reutlingen",
        "bundesland": "Baden-Württemberg",
        "expected": {
            "classification": "update",
            "update_type": "korrektur",
        },
    },
    {
        "id": "update_erledigung",
        "title": "POL-HH: 230427-2. Erledigung der Öffentlichkeitsfahndung nach 65-jähriger Frau",
        "body": "Hamburg(ots)\n\nDie Vermisste ist wohlbehalten aufgefunden worden. Wir bedanken uns für die Mithilfe.",
        "date": "2023-04-27T18:00:00",
        "city": "Hamburg",
        "source": "Polizei Hamburg",
        "bundesland": "Hamburg",
        "expected": {
            "classification": "update",  # or "junk" — both acceptable
            "update_type": "erledigung",
        },
    },

    # --- EDGE CASES ---
    {
        "id": "edge_empty_body",
        "title": "Zivilcourage vereitelt Raub auf Supermarkt",
        "body": "",
        "date": "2025-12-15T10:00:00",
        "city": "",
        "source": "Polizei Berlin",
        "bundesland": "Berlin",
        "expected": {
            "classification": "crime",
            "pks_code": "2100",
        },
    },
    {
        "id": "edge_brandstiftung_feuerwehr",
        "title": "POL-KN: (Konstanz) Balkonbrand mit hohem Sachschaden",
        "body": "Konstanz(ots)\n\nAm Samstagnachmittag, gg. 16.00 Uhr, gingen mehrere Notrufe ein, dass es in einem Mehrfamilienhaus in Konstanz, Wallgutstraße, brennen würde. Durch die Feuerwehr wurden 10 Personen evakuiert. Die Brandursache ist noch unklar. Die Kriminalpolizei hat die Ermittlungen aufgenommen.",
        "date": "2023-04-30T10:20:00",
        "city": "Konstanz",
        "source": "Polizeipräsidium Konstanz",
        "bundesland": "Baden-Württemberg",
        "expected": {
            "classification": "crime",  # NOT feuerwehr — Kriminalpolizei ermittelt
            "pks_code": "6740",
            "city": "Konstanz",
        },
    },
    {
        "id": "edge_demo_with_crime",
        "title": "POL-MA: Heidelberg: Störung einer Veranstaltung und Hausfriedensbruch",
        "body": "Heidelberg(ots)\n\nIm Rahmen einer Podiumsdiskussion in der Friedrich-Ebert-Gedenkstätte kam es zu einer Störung. Bis zu 30 Personen störten die Diskussion durch Zwischenrufe. Der Aufforderung des Veranstalters das Gebäude zu verlassen kamen sie nicht nach. Bei der Personalienfeststellung kam es zu einer Auseinandersetzung, eine Person wurde leicht verletzt.",
        "date": "2023-04-27T22:00:46",
        "city": "Heidelberg",
        "source": "Polizeipräsidium Mannheim",
        "bundesland": "Baden-Württemberg",
        "expected": {
            "classification": "crime",
            "city": "Heidelberg",
            "pks_code": "6220",  # Hausfriedensbruch
        },
    },
]


# ── Scoring Logic ─────────────────────────────────────────────────────

def score_result(expected: dict, actual: dict | None, article_id: str) -> dict:
    """Score a single result against expected values. Returns dict of checks."""
    checks = {}

    if actual is None:
        checks["found"] = {"pass": False, "expected": "result", "actual": "no result returned"}
        return checks

    checks["found"] = {"pass": True}

    # Classification
    exp_cls = expected.get("classification")
    act_cls = actual.get("classification", "unknown")
    if exp_cls:
        # "update" and "junk" are both acceptable for erledigung-type articles
        if article_id == "update_erledigung" and act_cls in ("update", "junk"):
            checks["classification"] = {"pass": True, "expected": exp_cls, "actual": act_cls}
        else:
            checks["classification"] = {
                "pass": act_cls == exp_cls,
                "expected": exp_cls,
                "actual": act_cls,
            }

    # For junk/feuerwehr/update-only, classification is the main check
    if exp_cls in ("junk", "feuerwehr"):
        reason = expected.get("reason_contains")
        if reason:
            act_reason = actual.get("reason", "")
            checks["reason_contains"] = {
                "pass": reason.lower() in act_reason.lower(),
                "expected": f"contains '{reason}'",
                "actual": act_reason,
            }
        return checks

    if exp_cls == "update":
        exp_ut = expected.get("update_type")
        if exp_ut:
            act_ut = actual.get("update_type", "")
            checks["update_type"] = {
                "pass": act_ut == exp_ut,
                "expected": exp_ut,
                "actual": act_ut,
            }
        return checks

    # Crime-specific checks
    if expected.get("city"):
        act_city = (actual.get("location") or {}).get("city", "")
        checks["city"] = {
            "pass": expected["city"].lower() in act_city.lower() if act_city else False,
            "expected": expected["city"],
            "actual": act_city,
        }

    if expected.get("street"):
        act_street = (actual.get("location") or {}).get("street", "")
        checks["street"] = {
            "pass": expected["street"].lower() in act_street.lower() if act_street else False,
            "expected": expected["street"],
            "actual": act_street,
        }

    if expected.get("district"):
        act_district = (actual.get("location") or {}).get("district", "")
        checks["district"] = {
            "pass": expected["district"].lower() in (act_district or "").lower(),
            "expected": expected["district"],
            "actual": act_district,
        }

    if expected.get("location_hint"):
        act_hint = (actual.get("location") or {}).get("location_hint", "")
        checks["location_hint"] = {
            "pass": expected["location_hint"].lower() in (act_hint or "").lower(),
            "expected": expected["location_hint"],
            "actual": act_hint,
        }

    if expected.get("pks_code"):
        act_pks = (actual.get("crime") or {}).get("pks_code", "")
        checks["pks_code"] = {
            "pass": str(act_pks) == str(expected["pks_code"]),
            "expected": expected["pks_code"],
            "actual": act_pks,
        }

    if expected.get("pks_code_prefix"):
        act_pks = str((actual.get("crime") or {}).get("pks_code", ""))
        checks["pks_code_prefix"] = {
            "pass": act_pks.startswith(expected["pks_code_prefix"]),
            "expected": f"starts with {expected['pks_code_prefix']}",
            "actual": act_pks,
        }

    if expected.get("pks_code_in"):
        act_pks = str((actual.get("crime") or {}).get("pks_code", ""))
        checks["pks_code_in"] = {
            "pass": act_pks in expected["pks_code_in"],
            "expected": f"one of {expected['pks_code_in']}",
            "actual": act_pks,
        }

    if expected.get("time"):
        act_time = (actual.get("incident_time") or {}).get("time", "")
        checks["time"] = {
            "pass": str(act_time) == str(expected["time"]),
            "expected": expected["time"],
            "actual": act_time,
        }

    if expected.get("precision"):
        act_prec = (actual.get("incident_time") or {}).get("precision", "")
        checks["precision"] = {
            "pass": act_prec == expected["precision"],
            "expected": expected["precision"],
            "actual": act_prec,
        }

    if expected.get("severity"):
        act_sev = (actual.get("details") or {}).get("severity", "")
        checks["severity"] = {
            "pass": act_sev == expected["severity"],
            "expected": expected["severity"],
            "actual": act_sev,
        }

    if expected.get("weapon_type"):
        act_wt = (actual.get("details") or {}).get("weapon_type", "")
        checks["weapon_type"] = {
            "pass": act_wt == expected["weapon_type"],
            "expected": expected["weapon_type"],
            "actual": act_wt,
        }

    # Herkunft checks (including null expected = should NOT extract)
    for field in ["victim_herkunft", "suspect_herkunft"]:
        if field in expected:
            act_val = (actual.get("details") or {}).get(field)
            exp_val = expected[field]
            if exp_val is None:
                checks[field] = {
                    "pass": act_val is None or act_val == "null",
                    "expected": "null (not mentioned explicitly)",
                    "actual": act_val,
                }
            else:
                checks[field] = {
                    "pass": exp_val.lower() in (act_val or "").lower() if act_val else False,
                    "expected": exp_val,
                    "actual": act_val,
                }

    if expected.get("suspect_age"):
        act_age = (actual.get("details") or {}).get("suspect_age", "")
        checks["suspect_age"] = {
            "pass": str(expected["suspect_age"]) in str(act_age or ""),
            "expected": expected["suspect_age"],
            "actual": act_age,
        }

    return checks


def score_multi(expected: dict, results: list[dict]) -> dict:
    """Score multi-incident expectations."""
    checks = {}

    min_inc = expected.get("min_incidents", 1)
    checks["incident_count"] = {
        "pass": len(results) >= min_inc,
        "expected": f">= {min_inc}",
        "actual": len(results),
    }

    if expected.get("cities"):
        result_cities = [
            (r.get("location") or {}).get("city", "").lower()
            for r in results
        ]
        for i, exp_city in enumerate(expected["cities"]):
            found = exp_city.lower() in " ".join(result_cities)
            checks[f"city_{i}"] = {
                "pass": found,
                "expected": exp_city,
                "actual": result_cities,
            }

    return checks


# ── Main Evaluation Loop ──────────────────────────────────────────────

def run_eval(model: str = None, batch_size: int = None, runs: int = 1,
             articles: list = None, verbose: bool = True) -> dict:
    """Run evaluation and return summary stats."""

    if articles is None:
        articles = EVAL_ARTICLES

    enricher = FastEnricher(cache_dir=".cache/eval", no_geocode=True, model=model)

    # Prepare articles for enrichment (strip expected)
    input_articles = []
    for art in articles:
        clean = {k: v for k, v in art.items() if k not in ("expected", "id")}
        clean["url"] = f"eval_{art.get('id', 'unknown')}"  # unique cache key
        input_articles.append(clean)

    all_run_results = []

    for run_num in range(1, runs + 1):
        if runs > 1:
            print(f"\n{'='*60}")
            print(f"  RUN {run_num}/{runs}")
            print(f"{'='*60}")
            # Clear eval cache between runs for consistency testing
            enricher.cache = {}

        # Override batch size if specified
        orig_batch_size = None
        if batch_size:
            import scripts.pipeline.fast_enricher as fe
            orig_batch_size = fe.UNIFIED_BATCH_SIZE
            fe.UNIFIED_BATCH_SIZE = batch_size

        enriched, removed = enricher.enrich_all(input_articles, skip_clustering=True)

        if orig_batch_size:
            fe.UNIFIED_BATCH_SIZE = orig_batch_size

        # Map results back to eval articles by URL
        results_by_url = {}
        for r in enriched:
            url = r.get("url", "")
            # Enriched articles are implicitly "crime" (or "update" if is_update)
            enriched_r = dict(r)
            if enriched_r.get("is_update"):
                enriched_r["classification"] = "update"
                # update_type already set by enricher if available
            else:
                enriched_r["classification"] = "crime"
            results_by_url.setdefault(url, []).append(enriched_r)
        for r in removed:
            url = r.get("url", "")
            cls = r.get("_removal_reason", "").replace("llm:", "")
            results_by_url.setdefault(url, []).append({
                "classification": cls,
                "reason": r.get("_triage_reason", ""),
                "update_type": "erledigung" if "erledigung" in r.get("_triage_reason", "").lower()
                    else "korrektur" if "korrektur" in r.get("_triage_reason", "").lower()
                    else "nachtrag" if cls == "update" else "",
            })

        # Score each test case
        run_checks = {}
        for art in articles:
            art_id = art.get("id", "unknown")
            url_key = f"eval_{art_id}"
            results = results_by_url.get(url_key, [])
            expected = art.get("expected", {})

            if expected.get("min_incidents", 1) > 1:
                # Multi-incident test
                checks = score_multi(expected, results)
            else:
                # Single result test
                result = results[0] if results else None
                checks = score_result(expected, result, art_id)

            run_checks[art_id] = checks

        all_run_results.append(run_checks)

        # Print results for this run
        if verbose:
            total_checks = 0
            total_pass = 0
            print(f"\n{'─'*60}")
            for art_id, checks in run_checks.items():
                passes = sum(1 for c in checks.values() if c["pass"])
                fails = sum(1 for c in checks.values() if not c["pass"])
                total_checks += len(checks)
                total_pass += passes

                status = "✓" if fails == 0 else "✗"
                print(f"  {status} {art_id}: {passes}/{passes+fails} checks passed")

                for check_name, check in checks.items():
                    if not check["pass"]:
                        print(f"      FAIL {check_name}: expected={check['expected']}, got={check['actual']}")

            print(f"\n{'─'*60}")
            accuracy = (total_pass / total_checks * 100) if total_checks > 0 else 0
            print(f"  TOTAL: {total_pass}/{total_checks} checks passed ({accuracy:.1f}%)")
            print(f"{'─'*60}")

    # Consistency analysis across runs
    if runs > 1 and verbose:
        print(f"\n{'='*60}")
        print(f"  CONSISTENCY ANALYSIS ({runs} runs)")
        print(f"{'='*60}")
        inconsistent = 0
        for art_id in all_run_results[0].keys():
            run_classifications = []
            for run_result in all_run_results:
                checks = run_result.get(art_id, {})
                cls_check = checks.get("classification", {})
                run_classifications.append(cls_check.get("actual", "?"))

            if len(set(run_classifications)) > 1:
                inconsistent += 1
                print(f"  ✗ {art_id}: classifications vary: {run_classifications}")

        if inconsistent == 0:
            print(f"  ✓ All {len(all_run_results[0])} test cases consistent across {runs} runs")
        else:
            print(f"  ✗ {inconsistent}/{len(all_run_results[0])} test cases inconsistent")

    return {
        "runs": all_run_results,
        "total_articles": len(articles),
    }


def sample_from_file(filepath: str, n: int = 20, seed: int = 42) -> list[dict]:
    """Load N random articles from a data file (without expected values)."""
    import random
    random.seed(seed)

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    sample = random.sample(data, min(n, len(data)))

    articles = []
    for i, art in enumerate(sample):
        articles.append({
            "id": f"sample_{i}",
            "title": art.get("title", ""),
            "body": art.get("body", ""),
            "date": art.get("date", ""),
            "city": art.get("city", ""),
            "source": art.get("source", ""),
            "bundesland": art.get("bundesland", ""),
            "expected": {"classification": "any"},  # no scoring, just observe
        })

    return articles


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate enrichment prompt quality")
    parser.add_argument("--model", default=None, help="Model to test (default: from config)")
    parser.add_argument("--batch-size", type=int, default=None, help="Override batch size")
    parser.add_argument("--runs", type=int, default=1, help="Number of runs for consistency testing")
    parser.add_argument("--from-file", default=None, help="Load articles from file instead of built-in test set")
    parser.add_argument("--sample", type=int, default=20, help="Number of articles to sample from file")
    args = parser.parse_args()

    if args.from_file:
        articles = sample_from_file(args.from_file, n=args.sample)
        print(f"Loaded {len(articles)} sample articles from {args.from_file}")
        print("NOTE: No expected values — results shown for manual review only.")
    else:
        articles = None  # use built-in test cases

    run_eval(
        model=args.model,
        batch_size=args.batch_size,
        runs=args.runs,
        articles=articles,
    )
