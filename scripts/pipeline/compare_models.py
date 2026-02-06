#!/usr/bin/env python3
"""
Model comparison experiment for LLM enrichment.

Sends the same 20 articles to 9 different OpenRouter models and compares:
- Parse success rate (valid JSON?)
- Field completeness (% non-null values)
- Response time
- Cost projection for full dataset

Usage:
    python -m scripts.pipeline.compare_models
"""

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

# Import the updated prompt from fast_enricher
from scripts.pipeline.fast_enricher import BATCH_PROMPT

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
RAW_INPUT = Path("data/pipeline/chunks/raw/2026-02.json")
OUTPUT_FILE = Path("data/pipeline/chunks/enriched/model_comparison.json")

# Models to test with pricing (per 1M tokens)
MODELS = [
    {"id": "deepseek/deepseek-v3.2", "input_cost": 0.25, "output_cost": 0.38},
    {"id": "google/gemini-2.5-flash-lite", "input_cost": 0.10, "output_cost": 0.40},
    {"id": "x-ai/grok-4.1-fast", "input_cost": 0.20, "output_cost": 0.50},
    {"id": "openai/gpt-oss-120b", "input_cost": 0.039, "output_cost": 0.19},
    {"id": "arcee-ai/trinity-large-preview:free", "input_cost": 0, "output_cost": 0},
    {"id": "openai/gpt-5-nano", "input_cost": 0.05, "output_cost": 0.40},
    {"id": "x-ai/grok-4-fast", "input_cost": 0.20, "output_cost": 0.50},
    {"id": "tngtech/deepseek-r1t2-chimera:free", "input_cost": 0, "output_cost": 0},
    {"id": "z-ai/glm-4.5-air:free", "input_cost": 0, "output_cost": 0},
]

# Indices chosen for diversity: knife, drugs, traffic, robbery, burglary, arson,
# assault, murder, sexual, fraud, missing person, etc.
ARTICLE_INDICES = [
    21,   # Messer/Waffe
    75,   # Droge
    128,  # Cannabis
    3,    # Unfall/Verkehr
    22,   # Raub
    7,    # Einbruch
    37,   # Betrug
    4,    # Brand
    56,   # Körperverletzung + Messer
    18,   # Tötung
    57,   # Mord
    91,   # sexuell
    55,   # Schuss/Waffe
    8,    # Unfall 2
    43,   # Einbruch 2
    96,   # Droge 2
    46,   # Körperverletzung 2
    6,    # Brand 2
    19,   # Betrug 2
    0,    # Vermisst (missing person)
]


def select_articles(all_articles: list[dict]) -> list[dict]:
    """Select 20 diverse articles by index."""
    selected = []
    for idx in ARTICLE_INDICES:
        if idx < len(all_articles):
            selected.append(all_articles[idx])
    return selected


def build_prompt(articles: list[dict]) -> str:
    """Build the enrichment prompt for a batch of articles."""
    articles_data = []
    for i, art in enumerate(articles):
        articles_data.append({
            "index": i,
            "title": art.get("title", "")[:100],
            "body": art.get("body", "")[:2000],
            "date": art.get("date", ""),
            "city": art.get("city", ""),
        })
    return BATCH_PROMPT.format(
        count=len(articles),
        articles_json=json.dumps(articles_data, ensure_ascii=False, indent=2)
    )


def strip_thinking(text: str) -> str:
    """Remove <think>...</think> blocks from thinking models."""
    return re.sub(r'<think>[\s\S]*?</think>', '', text).strip()


def parse_json_response(text: str) -> list[dict]:
    """Extract JSON array from LLM response."""
    text = strip_thinking(text)
    text = text.strip()

    # Strip markdown code fences
    if "```json" in text:
        text = text.split("```json", 1)[1]
    if "```" in text:
        text = text.split("```")[0]

    # Find the JSON array
    match = re.search(r'\[[\s\S]*\]', text)
    if match:
        return json.loads(match.group())
    return []


def call_model(client: OpenAI, model_id: str, prompt: str) -> dict:
    """Call a single model and return results with timing."""
    start = time.time()
    try:
        response = client.chat.completions.create(
            model=model_id,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=5000,
        )
        elapsed = time.time() - start
        text = response.choices[0].message.content or ""
        usage = response.usage

        return {
            "text": text,
            "elapsed_s": round(elapsed, 2),
            "input_tokens": usage.prompt_tokens if usage else 0,
            "output_tokens": usage.completion_tokens if usage else 0,
            "error": None,
        }
    except Exception as e:
        elapsed = time.time() - start
        return {
            "text": "",
            "elapsed_s": round(elapsed, 2),
            "input_tokens": 0,
            "output_tokens": 0,
            "error": str(e),
        }


def evaluate_completeness(enrichments: list[dict], expected_count: int) -> dict:
    """Calculate field completeness percentages."""
    fields = {
        "location.street": 0,
        "location.city": 0,
        "crime.pks_code": 0,
        "crime.pks_category": 0,
        "details.weapon_type": 0,
        "details.drug_type": 0,
        "details.severity": 0,
        "details.motive": 0,
        "details.victim_count": 0,
        "details.suspect_count": 0,
        "incident_time.date": 0,
    }

    for e in enrichments:
        loc = e.get("location") or {}
        crime = e.get("crime") or {}
        details = e.get("details") or {}
        time_data = e.get("incident_time") or {}

        if loc.get("street"):
            fields["location.street"] += 1
        if loc.get("city"):
            fields["location.city"] += 1
        if crime.get("pks_code"):
            fields["crime.pks_code"] += 1
        if crime.get("pks_category"):
            fields["crime.pks_category"] += 1
        if details.get("weapon_type") and details["weapon_type"] != "unknown":
            fields["details.weapon_type"] += 1
        if details.get("drug_type"):
            fields["details.drug_type"] += 1
        if details.get("severity") and details["severity"] != "unknown":
            fields["details.severity"] += 1
        if details.get("motive") and details["motive"] != "unknown":
            fields["details.motive"] += 1
        if details.get("victim_count") is not None:
            fields["details.victim_count"] += 1
        if details.get("suspect_count") is not None:
            fields["details.suspect_count"] += 1
        if time_data.get("date") and "YYYY" not in time_data["date"]:
            fields["incident_time.date"] += 1

    # Convert to percentages
    n = max(expected_count, 1)
    return {k: round(v / n * 100) for k, v in fields.items()}


def print_summary(results: dict, total_articles: int):
    """Print a formatted comparison table."""
    print("\n" + "=" * 120)
    print("MODEL COMPARISON RESULTS")
    print("=" * 120)

    # Header
    print(f"\n{'Model':<42} {'Parse':>5} {'Time':>6} {'In Tok':>7} {'Out Tok':>8} {'Cost/20':>8} {'Cost/1.2M':>10}")
    print("-" * 120)

    for model_id, data in results.items():
        parsed = data.get("parse_success", 0)
        time_s = data.get("total_time_s", 0)
        in_tok = data.get("total_input_tokens", 0)
        out_tok = data.get("total_output_tokens", 0)

        # Find model pricing
        model_info = next((m for m in MODELS if m["id"] == model_id), None)
        if model_info:
            cost_20 = (in_tok * model_info["input_cost"] + out_tok * model_info["output_cost"]) / 1_000_000
            # Extrapolate: 1.2M articles = 60,000x our 20-article run
            cost_full = cost_20 * 60_000
        else:
            cost_20 = 0
            cost_full = 0

        error = data.get("error")
        if error:
            print(f"{model_id:<42} {'ERROR':>5} {time_s:>5.1f}s {'':>7} {'':>8} {'':>8} {'':>10}  {error[:40]}")
        else:
            print(f"{model_id:<42} {parsed:>3}/20 {time_s:>5.1f}s {in_tok:>7} {out_tok:>8} ${cost_20:>6.4f} ${cost_full:>8.1f}")

    # Field completeness table
    print(f"\n{'Model':<42} {'street':>6} {'city':>5} {'pks':>4} {'weapon':>7} {'drug':>5} {'sever':>6} {'motive':>7} {'date':>5}")
    print("-" * 120)

    for model_id, data in results.items():
        comp = data.get("completeness", {})
        if data.get("error"):
            print(f"{model_id:<42} {'ERROR':>6}")
            continue
        print(
            f"{model_id:<42}"
            f" {comp.get('location.street', 0):>5}%"
            f" {comp.get('location.city', 0):>4}%"
            f" {comp.get('crime.pks_code', 0):>3}%"
            f" {comp.get('details.weapon_type', 0):>6}%"
            f" {comp.get('details.drug_type', 0):>4}%"
            f" {comp.get('details.severity', 0):>5}%"
            f" {comp.get('details.motive', 0):>6}%"
            f" {comp.get('incident_time.date', 0):>4}%"
        )

    print("\n" + "=" * 120)


def main():
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("ERROR: OPENROUTER_API_KEY required")
        sys.exit(1)

    client = OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)

    # Load articles
    print(f"Loading articles from {RAW_INPUT}...")
    all_articles = json.load(open(RAW_INPUT, encoding="utf-8"))
    articles = select_articles(all_articles)
    print(f"Selected {len(articles)} diverse articles for comparison")

    # Split into 2 batches of 10
    batch1 = articles[:10]
    batch2 = articles[10:]
    prompt1 = build_prompt(batch1)
    prompt2 = build_prompt(batch2)

    print(f"Prompt size: ~{len(prompt1)} chars per batch")

    # Prepare article summaries for output
    article_summaries = [
        {"index": i, "title": a.get("title", "")[:100], "city": a.get("city", "")}
        for i, a in enumerate(articles)
    ]

    results = {}

    for model_info in MODELS:
        model_id = model_info["id"]
        print(f"\n--- Testing: {model_id} ---")

        all_enrichments = []
        total_time = 0
        total_in = 0
        total_out = 0
        model_error = None

        for batch_num, prompt in enumerate([prompt1, prompt2], 1):
            print(f"  Batch {batch_num}/2...", end=" ", flush=True)
            result = call_model(client, model_id, prompt)

            if result["error"]:
                print(f"ERROR: {result['error'][:80]}")
                model_error = result["error"]
                break

            total_time += result["elapsed_s"]
            total_in += result["input_tokens"]
            total_out += result["output_tokens"]

            # Parse response
            try:
                parsed = parse_json_response(result["text"])
                all_enrichments.extend(parsed)
                print(f"OK ({len(parsed)} parsed, {result['elapsed_s']:.1f}s)")
                if len(parsed) == 0:
                    # Debug: show what the model actually returned
                    preview = strip_thinking(result["text"])[:300]
                    print(f"    [DEBUG] Response preview: {preview}")
            except (json.JSONDecodeError, Exception) as e:
                print(f"PARSE ERROR: {e}")
                preview = strip_thinking(result["text"])[:300]
                print(f"    [DEBUG] Response preview: {preview}")

            # Small delay between batches
            if batch_num < 2:
                time.sleep(0.5)

        if model_error:
            results[model_id] = {
                "error": model_error,
                "enrichments": [],
                "parse_success": 0,
                "total_time_s": round(total_time, 2),
                "total_input_tokens": total_in,
                "total_output_tokens": total_out,
                "completeness": {},
            }
        else:
            completeness = evaluate_completeness(all_enrichments, len(articles))
            results[model_id] = {
                "enrichments": all_enrichments,
                "parse_success": len(all_enrichments),
                "total_time_s": round(total_time, 2),
                "total_input_tokens": total_in,
                "total_output_tokens": total_out,
                "completeness": completeness,
                "error": None,
            }

        # Delay between models to be respectful
        time.sleep(1)

    # Save results
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    output = {
        "articles": article_summaries,
        "results": results,
    }
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\nResults saved to {OUTPUT_FILE}")

    # Print summary
    print_summary(results, len(articles))


if __name__ == "__main__":
    main()
