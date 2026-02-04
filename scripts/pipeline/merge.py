"""
Merge all completed chunks into final output files.
Handles deduplication and sorting.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from .config import (
    MERGED_DIR,
    MERGED_RAW_FILE,
    MERGED_ENRICHED_FILE,
    FINAL_CRIMES_FILE,
    TRANSFORMER_SCRIPT,
)
from .chunk_manager import get_or_create_manifest


def merge_chunks(
    manifest: dict,
    output_raw: Optional[Path] = None,
    output_enriched: Optional[Path] = None,
) -> tuple[int, int]:
    """
    Merge all completed chunks into combined output files.

    Args:
        manifest: The manifest dict
        output_raw: Override raw output path
        output_enriched: Override enriched output path

    Returns:
        (raw_count, enriched_count) - number of articles in each file
    """
    output_raw = output_raw or MERGED_RAW_FILE
    output_enriched = output_enriched or MERGED_ENRICHED_FILE

    # Ensure output directory exists
    MERGED_DIR.mkdir(parents=True, exist_ok=True)

    # Collect all articles from completed chunks
    raw_articles = []
    enriched_articles = []
    seen_urls_raw = set()
    seen_urls_enriched = set()

    completed_chunks = [
        (chunk_id, chunk)
        for chunk_id, chunk in manifest["chunks"].items()
        if chunk["status"] == "completed"
    ]

    print(f"Merging {len(completed_chunks)} completed chunks...")

    for chunk_id, chunk in sorted(completed_chunks):
        # Load raw articles
        raw_path = Path(chunk["raw_file"])
        if raw_path.exists():
            with open(raw_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                for article in data.get("articles", []):
                    url = article.get("url")
                    if url and url not in seen_urls_raw:
                        seen_urls_raw.add(url)
                        raw_articles.append(article)

        # Load enriched articles
        enriched_path = Path(chunk["enriched_file"])
        if enriched_path.exists():
            with open(enriched_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                for article in data.get("articles", []):
                    url = article.get("url")
                    if url and url not in seen_urls_enriched:
                        seen_urls_enriched.add(url)
                        enriched_articles.append(article)

    # Sort by published date (newest first)
    def get_date(article):
        date_str = article.get("publishedAt") or article.get("published_at") or ""
        try:
            return datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return datetime.min

    raw_articles.sort(key=get_date, reverse=True)
    enriched_articles.sort(key=get_date, reverse=True)

    # Write merged files
    print(f"Writing {len(raw_articles)} raw articles to {output_raw}")
    with open(output_raw, "w", encoding="utf-8") as f:
        json.dump({
            "merged_at": datetime.now().isoformat(),
            "chunk_count": len(completed_chunks),
            "articles": raw_articles,
        }, f, ensure_ascii=False, indent=2)

    print(f"Writing {len(enriched_articles)} enriched articles to {output_enriched}")
    with open(output_enriched, "w", encoding="utf-8") as f:
        json.dump({
            "merged_at": datetime.now().isoformat(),
            "chunk_count": len(completed_chunks),
            "articles": enriched_articles,
        }, f, ensure_ascii=False, indent=2)

    return len(raw_articles), len(enriched_articles)


def run_merge() -> None:
    """Load manifest and merge all completed chunks."""
    print(f"[{datetime.now().isoformat()}] Starting merge...")

    manifest = get_or_create_manifest()

    stats = manifest["statistics"]
    print(f"Completed chunks: {stats['completed']}/{stats['total_chunks']}")

    if stats["completed"] == 0:
        print("No completed chunks to merge")
        return

    raw_count, enriched_count = merge_chunks(manifest)

    print(f"\nMerge complete!")
    print(f"  Raw articles: {raw_count:,}")
    print(f"  Enriched articles: {enriched_count:,}")
    print(f"\nOutput files:")
    print(f"  {MERGED_RAW_FILE}")
    print(f"  {MERGED_ENRICHED_FILE}")

    print(f"\nTo generate crimes.json for the app, run:")
    print(f"  python {TRANSFORMER_SCRIPT} \\")
    print(f"    --input {MERGED_ENRICHED_FILE} \\")
    print(f"    --output {FINAL_CRIMES_FILE}")


def run_transform() -> None:
    """Run the transformer to generate the final crimes.json."""
    import subprocess
    import sys

    print(f"[{datetime.now().isoformat()}] Running transformer...")

    if not MERGED_ENRICHED_FILE.exists():
        print(f"ERROR: Merged enriched file not found: {MERGED_ENRICHED_FILE}")
        print("Run 'merge' first to create it.")
        return

    # Ensure output directory exists
    FINAL_CRIMES_FILE.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        str(TRANSFORMER_SCRIPT),
        "--input", str(MERGED_ENRICHED_FILE),
        "--output", str(FINAL_CRIMES_FILE),
    ]

    print(f"Running: {' '.join(cmd)}")

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"ERROR: Transformer failed:")
        print(result.stderr or result.stdout)
        return

    print(result.stdout)
    print(f"\nTransform complete!")
    print(f"Output: {FINAL_CRIMES_FILE}")
