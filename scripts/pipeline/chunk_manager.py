"""
Chunk manager for tracking pipeline progress via manifest.json.
Handles generating chunks, tracking status, and atomic saves.
"""

import json
import os
import tempfile
from datetime import datetime
from dateutil.relativedelta import relativedelta
from pathlib import Path
from typing import Optional

from .config import (
    BUNDESLAENDER,
    DEFAULT_START_DATE,
    DEFAULT_END_DATE,
    CHUNK_SIZE_MONTHS,
    CHUNKS_RAW_DIR,
    CHUNKS_ENRICHED_DIR,
    MANIFEST_PATH,
    DATA_DIR,
    chunk_raw_path,
    chunk_enriched_path,
    chunk_filename,
)


def generate_all_chunks(
    start_date: str = DEFAULT_START_DATE,
    end_date: str = DEFAULT_END_DATE,
) -> list[dict]:
    """
    Generate all chunk definitions for the given date range.

    Each chunk represents one month of data for ALL Bundesländer.
    For 3 years = 36 chunks.
    """
    chunks = []
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")

    current = start
    while current < end:
        # Calculate chunk end date (start of next month)
        chunk_end = current + relativedelta(months=CHUNK_SIZE_MONTHS)
        if chunk_end > end:
            chunk_end = end

        year_month = current.strftime("%Y-%m")

        # One chunk per month, covering all Bundesländer
        chunk_id = year_month
        chunks.append({
            "id": chunk_id,
            "year_month": year_month,
            "start_date": current.strftime("%Y-%m-%d"),
            "end_date": chunk_end.strftime("%Y-%m-%d"),
        })

        current = chunk_end

    return chunks


def create_initial_manifest(
    start_date: str = DEFAULT_START_DATE,
    end_date: str = DEFAULT_END_DATE,
) -> dict:
    """Create a fresh manifest with all chunks in pending state."""
    chunks = generate_all_chunks(start_date, end_date)

    manifest = {
        "config": {
            "start_date": start_date,
            "end_date": end_date,
            "created_at": datetime.now().isoformat(),
            "bundeslaender": BUNDESLAENDER,
        },
        "statistics": {
            "total_chunks": len(chunks),
            "completed": 0,
            "in_progress": 0,
            "failed": 0,
            "pending": len(chunks),
        },
        "chunks": {},
    }

    for chunk in chunks:
        chunk_id = chunk["id"]
        year_month = chunk["year_month"]

        manifest["chunks"][chunk_id] = {
            "status": "pending",
            "year_month": year_month,
            "start_date": chunk["start_date"],
            "end_date": chunk["end_date"],
            "raw_file": str(CHUNKS_RAW_DIR / chunk_filename("_all_", year_month)),
            "enriched_file": str(CHUNKS_ENRICHED_DIR / chunk_filename("_all_", year_month)),
            "bundeslaender_completed": [],  # Track which states are done
            "articles_count": None,
            "enriched_count": None,
            "error": None,
            "started_at": None,
            "completed_at": None,
            "retries": 0,
        }

    return manifest


def load_manifest() -> Optional[dict]:
    """Load manifest from disk, or return None if it doesn't exist."""
    if not MANIFEST_PATH.exists():
        return None

    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_manifest(manifest: dict) -> None:
    """
    Atomically save manifest to disk.

    Uses write-to-temp-then-rename pattern to prevent corruption
    if the process crashes during write.
    """
    # Ensure directory exists
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Update statistics
    stats = {"completed": 0, "in_progress": 0, "failed": 0, "pending": 0}
    for chunk in manifest["chunks"].values():
        status = chunk["status"]
        if status in stats:
            stats[status] += 1

    manifest["statistics"] = {
        "total_chunks": len(manifest["chunks"]),
        **stats,
    }
    manifest["statistics"]["last_updated"] = datetime.now().isoformat()

    # Write to temp file then rename (atomic on POSIX)
    fd, temp_path = tempfile.mkstemp(
        dir=MANIFEST_PATH.parent,
        prefix=".manifest_",
        suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        os.rename(temp_path, MANIFEST_PATH)
    except Exception:
        # Clean up temp file on error
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        raise


def get_or_create_manifest(
    start_date: str = DEFAULT_START_DATE,
    end_date: str = DEFAULT_END_DATE,
) -> dict:
    """Load existing manifest or create a new one."""
    manifest = load_manifest()
    if manifest is None:
        manifest = create_initial_manifest(start_date, end_date)
        save_manifest(manifest)
    return manifest


def get_next_pending_chunk(manifest: dict) -> Optional[dict]:
    """
    Get the next chunk to process.

    Returns the first pending chunk, or None if all chunks are
    completed/in_progress/failed.
    """
    for chunk_id, chunk in manifest["chunks"].items():
        if chunk["status"] == "pending":
            return {"id": chunk_id, **chunk}
    return None


def get_failed_chunks(manifest: dict) -> list[dict]:
    """Get all failed chunks for retry."""
    failed = []
    for chunk_id, chunk in manifest["chunks"].items():
        if chunk["status"] == "failed":
            failed.append({"id": chunk_id, **chunk})
    return failed


def update_chunk_status(
    manifest: dict,
    chunk_id: str,
    status: str,
    articles_count: Optional[int] = None,
    enriched_count: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    """
    Update a chunk's status in the manifest.

    Args:
        manifest: The manifest dict to update
        chunk_id: ID of the chunk to update
        status: New status (pending, in_progress, completed, failed)
        articles_count: Number of articles scraped (for completed scrape)
        enriched_count: Number of articles enriched (for completed enrich)
        error: Error message if failed
    """
    if chunk_id not in manifest["chunks"]:
        raise ValueError(f"Unknown chunk: {chunk_id}")

    chunk = manifest["chunks"][chunk_id]
    chunk["status"] = status

    if status == "in_progress":
        chunk["started_at"] = datetime.now().isoformat()
        chunk["error"] = None
    elif status == "completed":
        chunk["completed_at"] = datetime.now().isoformat()
        chunk["error"] = None
    elif status == "failed":
        chunk["error"] = error
        chunk["retries"] = chunk.get("retries", 0) + 1

    if articles_count is not None:
        chunk["articles_count"] = articles_count
    if enriched_count is not None:
        chunk["enriched_count"] = enriched_count


def reset_in_progress_chunks(manifest: dict) -> int:
    """
    Reset any in_progress chunks back to pending.

    This is useful for recovery after a crash - any chunks that were
    in_progress when the process died should be retried.

    Returns the number of chunks reset.
    """
    count = 0
    for chunk in manifest["chunks"].values():
        if chunk["status"] == "in_progress":
            chunk["status"] = "pending"
            chunk["started_at"] = None
            count += 1
    return count


def reset_failed_chunks(manifest: dict) -> int:
    """
    Reset all failed chunks back to pending for retry.

    Returns the number of chunks reset.
    """
    count = 0
    for chunk in manifest["chunks"].values():
        if chunk["status"] == "failed":
            chunk["status"] = "pending"
            chunk["error"] = None
            count += 1
    return count


def get_progress_summary(manifest: dict) -> str:
    """Get a human-readable progress summary."""
    stats = manifest["statistics"]
    total = stats["total_chunks"]
    completed = stats["completed"]
    in_progress = stats["in_progress"]
    failed = stats["failed"]
    pending = stats["pending"]

    # Calculate total articles
    total_articles = sum(
        c.get("articles_count", 0) or 0
        for c in manifest["chunks"].values()
        if c["status"] == "completed"
    )

    pct = (completed / total * 100) if total > 0 else 0

    lines = [
        f"Pipeline Progress: {completed}/{total} chunks ({pct:.1f}%)",
        f"  - Completed: {completed}",
        f"  - In Progress: {in_progress}",
        f"  - Failed: {failed}",
        f"  - Pending: {pending}",
        f"  - Total Articles: {total_articles:,}",
    ]

    if failed > 0:
        lines.append("\nFailed chunks:")
        for chunk_id, chunk in manifest["chunks"].items():
            if chunk["status"] == "failed":
                lines.append(f"  - {chunk_id}: {chunk.get('error', 'Unknown error')}")

    return "\n".join(lines)
