#!/usr/bin/env python3
"""
Human-readable prompt review: shows INPUT → OUTPUT → REASONING for each article.

Sends articles through the enrichment prompt and displays what the LLM saw,
what it produced, and why — so you can spot-check quality before scaling.

Usage:
    # Review built-in test cases (22 articles)
    python3 -m scripts.pipeline.review_prompt

    # Review N random articles from a data file
    python3 -m scripts.pipeline.review_prompt --from-file data/pipeline/merged/blaulicht_enriched_1000.json --sample 10

    # Save output to a file for offline review
    python3 -m scripts.pipeline.review_prompt --output review.txt

    # Use a different model
    python3 -m scripts.pipeline.review_prompt --model x-ai/grok-3

    # Smaller batch (better accuracy for complex articles)
    python3 -m scripts.pipeline.review_prompt --batch-size 4
"""

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import certifi
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
os.environ['SSL_CERT_FILE'] = certifi.where()

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from scripts.pipeline.fast_enricher import UNIFIED_PROMPT, MODEL, OPENROUTER_BASE_URL, UNIFIED_BATCH_SIZE, UNIFIED_MAX_TOKENS
from scripts.pipeline.eval_prompt import EVAL_ARTICLES


# ── Classification explanations ───────────────────────────────────────

CLASSIFICATION_REASONS = {
    "junk": "Kein polizeirelevanter Einzelvorfall — gefiltert (kein Eintrag auf der Karte)",
    "feuerwehr": "Feuerwehreinsatz ohne Straftatverdacht — gefiltert",
    "crime": "Straftat/Ordnungswidrigkeit erkannt — wird auf der Karte angezeigt",
    "update": "Nachtrag/Korrektur/Folgemeldung — wird als Update verarbeitet",
}

PKS_NAMES = {
    "0100": "Mord/Totschlag",
    "0200": "Tötungsdelikt auf Verlangen",
    "1100": "Vergewaltigung/sexuelle Nötigung",
    "1300": "Sexueller Missbrauch",
    "1310": "Exhibitionismus",
    "1320": "Sexuelle Belästigung",
    "2100": "Raub/räuberische Erpressung",
    "2200": "Körperverletzung",
    "2320": "Nötigung",
    "2330": "Freiheitsberaubung",
    "2340": "Bedrohung",
    "3000": "Einfacher Diebstahl",
    "4000": "Schwerer Diebstahl",
    "4350": "Wohnungseinbruchdiebstahl",
    "4780": "Kfz-Diebstahl",
    "5100": "Betrug",
    "5200": "Computerbetrug",
    "6210": "Widerstand gegen Vollstreckungsbeamte",
    "6220": "Hausfriedensbruch",
    "6230": "Landfriedensbruch",
    "6260": "Volksverhetzung/NS-Symbole",
    "6740": "Brandstiftung",
    "6750": "Sachbeschädigung",
    "7100": "Verkehrsunfall mit Personenschaden",
    "7200": "Unfallflucht/Fahrerflucht",
    "7300": "Trunkenheit im Verkehr",
    "8900": "Waffengesetz",
    "8910": "Betäubungsmitteldelikte",
    "8920": "Aufenthaltsgesetz",
}


def call_llm_raw(client, model, articles, batch_size=UNIFIED_BATCH_SIZE):
    """Send articles to the LLM and return raw parsed results per batch."""
    all_results = []

    for batch_start in range(0, len(articles), batch_size):
        batch = articles[batch_start:batch_start + batch_size]

        articles_data = []
        for i, art in enumerate(batch):
            articles_data.append({
                "index": i,
                "title": art.get("title", "")[:200],
                "body": art.get("body", ""),
                "date": art.get("date", ""),
                "city": art.get("city", ""),
                "source": art.get("source", ""),
            })

        prompt = UNIFIED_PROMPT.format(
            count=len(batch),
            articles_json=json.dumps(articles_data, ensure_ascii=False, indent=2)
        )

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=UNIFIED_MAX_TOKENS,
            )
            text = response.choices[0].message.content.strip()
            usage = response.usage

            # Parse JSON
            clean = text
            if "```json" in clean:
                clean = clean.split("```json", 1)[1]
            if "```" in clean:
                clean = clean.split("```")[0]

            match = re.search(r'\[[\s\S]*\]', clean)
            results = json.loads(match.group()) if match else []

            # Group by article_index
            by_idx = {}
            for r in results:
                idx = r.get("article_index", -1)
                by_idx.setdefault(idx, []).append(r)

            all_results.append({
                "batch_start": batch_start,
                "batch": batch,
                "results_by_idx": by_idx,
                "input_tokens": usage.prompt_tokens if usage else 0,
                "output_tokens": usage.completion_tokens if usage else 0,
            })

        except Exception as e:
            all_results.append({
                "batch_start": batch_start,
                "batch": batch,
                "results_by_idx": {},
                "error": str(e),
                "input_tokens": 0,
                "output_tokens": 0,
            })

        if batch_start + batch_size < len(articles):
            time.sleep(0.3)

    return all_results


def format_review(articles, batch_results, out):
    """Format the full review output."""
    total_input_tokens = sum(b["input_tokens"] for b in batch_results)
    total_output_tokens = sum(b["output_tokens"] for b in batch_results)

    out.write("=" * 80 + "\n")
    out.write("  PROMPT REVIEW — INPUT → OUTPUT → REASONING\n")
    out.write(f"  {len(articles)} articles | {len(batch_results)} batches | "
              f"{total_input_tokens:,} input tokens | {total_output_tokens:,} output tokens\n")
    out.write("=" * 80 + "\n\n")

    article_num = 0

    for batch_info in batch_results:
        if batch_info.get("error"):
            out.write(f"  ❌ BATCH ERROR: {batch_info['error']}\n\n")
            article_num += len(batch_info["batch"])
            continue

        batch = batch_info["batch"]
        results_by_idx = batch_info["results_by_idx"]

        for local_idx, art in enumerate(batch):
            article_num += 1
            results = results_by_idx.get(local_idx, [])

            # ── INPUT ──
            out.write("─" * 80 + "\n")
            art_id = art.get("id", f"article_{article_num}")
            out.write(f"  #{article_num} [{art_id}]\n")
            out.write("─" * 80 + "\n\n")

            out.write("  INPUT\n")
            out.write(f"  ├─ Title:  {art.get('title', '(leer)')[:100]}\n")
            out.write(f"  ├─ Source: {art.get('source', '(leer)')}\n")
            out.write(f"  ├─ Date:   {art.get('date', '(leer)')}\n")
            out.write(f"  ├─ City:   {art.get('city', '(leer)')}\n")

            body = art.get("body", "")
            body_preview = body[:250].replace("\n", " ↵ ")
            if len(body) > 250:
                body_preview += "..."
            out.write(f"  └─ Body:   ({len(body)} chars) {body_preview}\n")
            out.write("\n")

            if not results:
                out.write("  OUTPUT\n")
                out.write("  └─ ⚠️  Keine Antwort vom LLM (article_index nicht gefunden)\n\n")
                continue

            for inc_num, result in enumerate(results):
                cls = result.get("classification", "?")
                prefix = "  OUTPUT" if inc_num == 0 else f"  OUTPUT (Vorfall {inc_num + 1})"

                if len(results) > 1 and inc_num == 0:
                    prefix = f"  OUTPUT (Vorfall 1 von {len(results)})"
                elif len(results) > 1:
                    prefix = f"  OUTPUT (Vorfall {inc_num + 1} von {len(results)})"

                out.write(f"{prefix}\n")

                # Classification
                cls_icon = {"junk": "🗑️", "feuerwehr": "🚒", "crime": "🔴", "update": "🔄"}.get(cls, "❓")
                out.write(f"  ├─ Klassifikation: {cls_icon}  {cls.upper()}\n")

                if cls in ("junk", "feuerwehr"):
                    reason = result.get("reason", "?")
                    out.write(f"  └─ Grund: {reason}\n")
                    out.write("\n")

                    # Reasoning
                    out.write("  WARUM?\n")
                    out.write(f"  └─ {CLASSIFICATION_REASONS.get(cls, '?')}\n")
                    if cls == "junk":
                        _explain_junk(art, reason, out)
                    elif cls == "feuerwehr":
                        _explain_feuerwehr(art, out)
                    out.write("\n")
                    continue

                if cls == "update" and not result.get("location") and not result.get("crime"):
                    ut = result.get("update_type", "?")
                    reason = result.get("reason", "?")
                    out.write(f"  ├─ Update-Typ: {ut}\n")
                    out.write(f"  └─ Grund: {reason}\n")
                    out.write("\n")
                    out.write("  WARUM?\n")
                    out.write(f"  └─ {CLASSIFICATION_REASONS.get('update', '?')}\n")
                    out.write("\n")
                    continue

                # Crime / update-with-data
                clean_title = result.get("clean_title", "?")
                out.write(f"  ├─ Titel (neu): {clean_title}\n")

                if result.get("is_update"):
                    out.write(f"  ├─ Update-Typ: {result.get('update_type', 'nachtrag')}\n")

                # Location
                loc = result.get("location") or {}
                loc_parts = []
                if loc.get("street"):
                    s = loc["street"]
                    if loc.get("house_number"):
                        s += f" {loc['house_number']}"
                    loc_parts.append(s)
                if loc.get("cross_street"):
                    loc_parts.append(f"Ecke {loc['cross_street']}")
                if loc.get("location_hint"):
                    loc_parts.append(f"({loc['location_hint']})")
                if loc.get("district"):
                    loc_parts.append(f"[{loc['district']}]")
                if loc.get("city"):
                    loc_parts.append(loc["city"])

                loc_str = ", ".join(loc_parts) if loc_parts else "(kein Standort)"
                loc_conf = loc.get("confidence", "?")
                out.write(f"  ├─ Tatort: {loc_str}  (Konfidenz: {loc_conf})\n")

                # Time
                it = result.get("incident_time") or {}
                date_str = it.get("date", "?")
                time_str = it.get("time", "?") or "?"
                prec = it.get("precision", "?")
                prec_icon = {"exact": "⏱️", "approximate": "~", "unknown": "?"}.get(prec, "?")
                out.write(f"  ├─ Tatzeit: {date_str} {time_str} Uhr  {prec_icon} ({prec})\n")

                # Crime
                crime = result.get("crime") or {}
                pks = str(crime.get("pks_code", "?"))
                pks_name = PKS_NAMES.get(pks, crime.get("pks_category", "?"))
                sub = crime.get("sub_type", "")
                crime_conf = crime.get("confidence", "?")
                crime_str = f"PKS {pks}: {pks_name}"
                if sub:
                    crime_str += f" → {sub}"
                out.write(f"  ├─ Delikt: {crime_str}  (Konfidenz: {crime_conf})\n")

                # Details
                det = result.get("details") or {}
                detail_parts = []

                wt = det.get("weapon_type")
                if wt and wt not in ("none", "unknown"):
                    wt_names = {"knife": "Messer", "gun": "Schusswaffe", "blunt": "Schlagwaffe",
                                "explosive": "Sprengstoff", "vehicle": "Fahrzeug", "pepper_spray": "Pfefferspray"}
                    detail_parts.append(f"Waffe: {wt_names.get(wt, wt)}")

                dt = det.get("drug_type")
                if dt:
                    detail_parts.append(f"Droge: {dt}")

                sev = det.get("severity")
                if sev:
                    sev_names = {"minor": "leicht", "serious": "schwer", "critical": "lebensgefährlich",
                                 "fatal": "tödlich", "property_only": "nur Sachschaden", "unknown": "unklar"}
                    detail_parts.append(f"Schwere: {sev_names.get(sev, sev)}")

                mot = det.get("motive")
                if mot and mot not in ("unknown", "null", None):
                    mot_names = {"domestic": "häuslich", "robbery": "Raub", "hate": "Hass",
                                 "drugs": "Drogen", "road_rage": "Straßenverkehr", "dispute": "Streit",
                                 "sexual": "sexuell"}
                    detail_parts.append(f"Motiv: {mot_names.get(mot, mot)}")

                vc = det.get("victim_count")
                sc = det.get("suspect_count")
                if vc is not None:
                    detail_parts.append(f"Opfer: {vc}")
                if sc is not None:
                    detail_parts.append(f"Verdächtige: {sc}")

                if detail_parts:
                    out.write(f"  ├─ Details: {' | '.join(detail_parts)}\n")

                # People
                people_parts = []
                va, vg, vh = det.get("victim_age"), det.get("victim_gender"), det.get("victim_herkunft")
                sa, sg, sh = det.get("suspect_age"), det.get("suspect_gender"), det.get("suspect_herkunft")

                if any(x for x in [va, vg, vh]):
                    v_str = "Opfer:"
                    if va: v_str += f" {va}J"
                    if vg and vg != "unknown": v_str += f", {vg}"
                    if vh: v_str += f", {vh}"
                    people_parts.append(v_str)

                if any(x for x in [sa, sg, sh]):
                    s_str = "Tatverdächtige(r):"
                    if sa: s_str += f" {sa}J"
                    if sg and sg != "unknown": s_str += f", {sg}"
                    if sh: s_str += f", {sh}"
                    people_parts.append(s_str)

                if people_parts:
                    out.write(f"  ├─ Personen: {' | '.join(people_parts)}\n")

                out.write(f"  └─\n")
                out.write("\n")

                # Reasoning
                out.write("  WARUM?\n")
                _explain_crime(art, result, out)
                out.write("\n")

    # Summary
    out.write("=" * 80 + "\n")
    out.write("  ZUSAMMENFASSUNG\n")
    out.write("=" * 80 + "\n\n")

    all_results_flat = []
    for b in batch_results:
        for idx_results in b["results_by_idx"].values():
            all_results_flat.extend(idx_results)

    cls_counts = {}
    for r in all_results_flat:
        c = r.get("classification", "?")
        cls_counts[c] = cls_counts.get(c, 0) + 1

    out.write(f"  Artikel gesamt: {len(articles)}\n")
    out.write(f"  LLM-Ergebnisse: {len(all_results_flat)} (inkl. Multi-Incident-Splits)\n")
    for cls, count in sorted(cls_counts.items()):
        icon = {"junk": "🗑️", "feuerwehr": "🚒", "crime": "🔴", "update": "🔄"}.get(cls, "❓")
        out.write(f"    {icon} {cls}: {count}\n")

    out.write(f"\n  Token-Verbrauch: {total_input_tokens:,} Input + {total_output_tokens:,} Output = {total_input_tokens + total_output_tokens:,} gesamt\n")
    cost_est = (total_input_tokens * 0.003 + total_output_tokens * 0.012) / 1000  # rough grok-4-fast pricing
    out.write(f"  Geschätzte Kosten (OpenRouter): ~${cost_est:.4f}\n")

    # PKS distribution
    pks_counts = {}
    for r in all_results_flat:
        pks = (r.get("crime") or {}).get("pks_code")
        if pks:
            pks_counts[str(pks)] = pks_counts.get(str(pks), 0) + 1

    if pks_counts:
        out.write(f"\n  PKS-Verteilung:\n")
        for pks, count in sorted(pks_counts.items(), key=lambda x: -x[1]):
            name = PKS_NAMES.get(pks, "?")
            out.write(f"    {pks} {name}: {count}\n")

    out.write("\n")


def _explain_junk(art, reason, out):
    """Generate human-readable explanation for junk classification."""
    body = art.get("body", "").lower()
    title = art.get("title", "").lower()
    source = art.get("source", "").lower()

    hints = []
    if "vermiss" in title or "vermiss" in body:
        hints.append("Titel/Body enthält 'vermisst' → Vermisstensuche, keine Straftat")
    if "bilanz" in title or "bilanz" in body:
        hints.append("Bilanz/Statistik-Artikel → kein Einzelvorfall")
    if any(kw in title for kw in ["kontroll", "schwerpunkt", "razzia"]):
        hints.append("Kontroll-/Schwerpunktaktion → kein konkreter Einzelvorfall")
    if any(kw in title for kw in ["versammlung", "demo", "tag der arbeit"]):
        hints.append("Versammlungsbericht → kein Einzelvorfall (wenn keine Straftaten)")
    if "warnmeldung" in title:
        hints.append("Warnmeldung → informativ, keine Straftat")
    if "hilfe" in title or "förder" in title:
        hints.append("Hilfsprogramm/Fördermaßnahme → administrativ, kein Vorfall")
    if "zoll" in source or "hza" in source.lower():
        hints.append("Zoll-Quelle: oft Kontrollberichte ohne Einzelvorfall")

    if not hints:
        hints.append(f"LLM-Grund: '{reason}'")

    for h in hints:
        out.write(f"     → {h}\n")


def _explain_feuerwehr(art, out):
    """Generate human-readable explanation for feuerwehr classification."""
    source = art.get("source", "")
    body = art.get("body", "").lower()

    hints = []
    if "feuerwehr" in source.lower() or "fw" in source.lower()[:5]:
        hints.append(f"Quelle ist Feuerwehr: '{source}'")
    if "kriminalpolizei" not in body and "kripo" not in body and "brandstiftung" not in body:
        hints.append("Kein Hinweis auf Straftat im Body (keine Kripo, keine Brandstiftung)")
    if "gasaustritt" in body or "gasgeruch" in body or "gasausströmung" in body:
        hints.append("Gasaustritt → typischer Feuerwehr-Einsatz ohne Straftatbezug")

    if not hints:
        hints.append("Feuerwehreinsatz ohne Straftatverdacht")

    for h in hints:
        out.write(f"     → {h}\n")


def _explain_crime(art, result, out):
    """Generate human-readable explanation for crime extraction decisions."""
    body = art.get("body", "")
    loc = result.get("location") or {}
    crime = result.get("crime") or {}
    det = result.get("details") or {}
    it = result.get("incident_time") or {}

    hints = []

    # Classification reasoning
    cls = result.get("classification", "crime")
    if cls == "update" or result.get("is_update"):
        for marker in ["nachtrag", "korrektur", "folgemeldung", "wie bereits berichtet", "wir berichteten"]:
            if marker in body.lower() or marker in art.get("title", "").lower():
                hints.append(f"Update erkannt: '{marker}' im Text gefunden")
                break

    # City reasoning
    city = loc.get("city", "")
    if city:
        if f"{city}(ots)" in body or f"{city} (ots)" in body:
            hints.append(f"Stadt '{city}' aus Body-Anfang '{city}(ots)' extrahiert")
        elif city.lower() in art.get("title", "").lower():
            hints.append(f"Stadt '{city}' aus dem Titel extrahiert")
        else:
            hints.append(f"Stadt '{city}' aus dem Body-Kontext extrahiert")

    # Street reasoning
    street = loc.get("street", "")
    if street:
        if street.lower() in body.lower():
            hints.append(f"Straße '{street}' direkt im Body erwähnt")

    # PKS reasoning
    pks = str(crime.get("pks_code", ""))
    if pks:
        pks_name = PKS_NAMES.get(pks, crime.get("pks_category", ""))
        sub = crime.get("sub_type", "")
        hint = f"Delikt PKS {pks} ({pks_name})"
        if sub:
            hint += f" → '{sub}'"

        # Explain common PKS choices
        conf = crime.get("confidence", 0)
        if conf and float(conf) < 0.8:
            hint += f" [niedrige Konfidenz {conf} — ggf. prüfen]"
        hints.append(hint)

    # Time reasoning
    prec = it.get("precision", "")
    time_val = it.get("time")
    if prec == "exact" and time_val:
        hints.append(f"Exakte Uhrzeit '{time_val}' mit 'um' im Text")
    elif prec == "approximate" and time_val:
        hints.append(f"Ungefähre Uhrzeit '{time_val}' — Schlüsselwort 'gegen'/'kurz vor'/'am Abend'/etc.")
    elif prec == "unknown":
        hints.append("Keine Zeitangabe im Text gefunden → precision='unknown'")

    # Herkunft reasoning
    for role, field in [("Opfer", "victim_herkunft"), ("Verdächtige(r)", "suspect_herkunft")]:
        val = det.get(field)
        if val:
            hints.append(f"{role} Herkunft '{val}' — explizit im Text als Staatsangehörigkeit erwähnt")

    # Severity reasoning
    sev = det.get("severity")
    if sev == "fatal":
        hints.append("Schwere 'fatal' — Todesfall im Text erwähnt")
    elif sev == "critical":
        hints.append("Schwere 'critical' — lebensgefährliche Verletzungen erwähnt")
    elif sev == "property_only":
        hints.append("Schwere 'property_only' — nur Sachschaden, keine Verletzten")

    # Weapon reasoning
    wt = det.get("weapon_type")
    if wt and wt not in ("none", "unknown"):
        weapon_keywords = {
            "knife": ["messer", "stich", "gestochen"],
            "gun": ["schuss", "pistole", "waffe", "geschossen"],
            "blunt": ["schlagstock", "schlag", "geschlagen", "flasche", "stein"],
            "pepper_spray": ["pfefferspray", "reizgas"],
        }
        kws = weapon_keywords.get(wt, [])
        found = [kw for kw in kws if kw in body.lower()]
        if found:
            hints.append(f"Waffe '{wt}' — Schlüsselwort '{found[0]}' im Text")

    if not hints:
        hints.append("Standardextraktion basierend auf Body-Inhalt")

    for h in hints:
        out.write(f"     → {h}\n")


def load_from_file(filepath, n=10, seed=42):
    """Load N random articles from a data file."""
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
        })
    return articles


def main():
    parser = argparse.ArgumentParser(description="Review enrichment prompt output with reasoning")
    parser.add_argument("--model", default=None, help="Model to use (default: from config)")
    parser.add_argument("--batch-size", type=int, default=None, help="Override batch size")
    parser.add_argument("--from-file", default=None, help="Load articles from a JSON data file")
    parser.add_argument("--sample", type=int, default=10, help="Number of articles to sample from file")
    parser.add_argument("--output", "-o", default=None, help="Save review to a file instead of stdout")
    args = parser.parse_args()

    model = args.model or MODEL
    batch_size = args.batch_size or UNIFIED_BATCH_SIZE

    if args.from_file:
        articles = load_from_file(args.from_file, n=args.sample)
        source_desc = f"{len(articles)} articles from {args.from_file}"
    else:
        articles = EVAL_ARTICLES
        source_desc = f"{len(articles)} built-in test cases"

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY required")
        sys.exit(1)

    client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)

    print(f"Reviewing: {source_desc}")
    print(f"Model: {model} | Batch size: {batch_size}")
    print(f"Sending {len(articles)} articles in {(len(articles) + batch_size - 1) // batch_size} batches...\n")

    batch_results = call_llm_raw(client, model, articles, batch_size)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            format_review(articles, batch_results, f)
        print(f"Review saved to: {args.output}")
    else:
        import io
        buf = io.StringIO()
        format_review(articles, batch_results, buf)
        print(buf.getvalue())


if __name__ == "__main__":
    main()
