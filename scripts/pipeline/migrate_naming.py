#!/usr/bin/env python3
"""
Migrate chunk files from nested to flat naming with German months.

Old: chunks/raw/{bundesland}/{year}/{MM}.json
New: chunks/raw/{bundesland}_{monat}_{year}.json

Handles raw, enriched, and filtered chunk directories.
Moves companion .meta.json files alongside their data files.
Cleans up empty directories after migration.

Usage:
    python3 scripts/pipeline/migrate_naming.py --dry-run   # preview
    python3 scripts/pipeline/migrate_naming.py             # execute
"""

import argparse
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from scripts.pipeline.config import (
    CHUNKS_ENRICHED_DIR,
    CHUNKS_FILTERED_DIR,
    CHUNKS_RAW_DIR,
    GERMAN_MONTHS,
    chunk_filename,
)


def migrate_directory(chunk_dir: Path, dry_run: bool) -> int:
    """Migrate all nested chunk files in a directory to flat naming.

    Returns the number of files moved.
    """
    if not chunk_dir.exists():
        return 0

    moved = 0

    # Walk {bundesland}/{year}/{MM}.json
    for bl_dir in sorted(chunk_dir.iterdir()):
        if not bl_dir.is_dir():
            continue

        bundesland = bl_dir.name

        for year_dir in sorted(bl_dir.iterdir()):
            if not year_dir.is_dir():
                # Skip non-directory files at bundesland level (already flat?)
                continue

            year = year_dir.name
            if not year.isdigit() or len(year) != 4:
                continue

            for file in sorted(year_dir.iterdir()):
                if not file.is_file():
                    continue

                name = file.name

                # Handle both data files and companion .meta.json files
                if name.endswith(".meta.json"):
                    # e.g. "01.meta.json" → derive month from base
                    month = name.removesuffix(".meta.json")
                    if month not in GERMAN_MONTHS:
                        print(f"  SKIP (unknown month): {file}")
                        continue
                    new_name = chunk_filename(bundesland, f"{year}-{month}").replace(
                        ".json", ".meta.json"
                    )
                elif name.endswith(".json"):
                    # e.g. "01.json"
                    month = name.removesuffix(".json")
                    if month not in GERMAN_MONTHS:
                        # Could be a non-standard filename, skip
                        print(f"  SKIP (unknown month): {file}")
                        continue
                    new_name = chunk_filename(bundesland, f"{year}-{month}")
                else:
                    continue

                new_path = chunk_dir / new_name

                if new_path.exists():
                    print(f"  SKIP (target exists): {file} → {new_name}")
                    continue

                if dry_run:
                    print(f"  WOULD MOVE: {file.relative_to(chunk_dir)} → {new_name}")
                else:
                    shutil.move(str(file), str(new_path))
                    print(f"  MOVED: {file.relative_to(chunk_dir)} → {new_name}")

                moved += 1

    return moved


def cleanup_empty_dirs(chunk_dir: Path, dry_run: bool) -> int:
    """Remove empty directories left after migration."""
    if not chunk_dir.exists():
        return 0

    removed = 0

    # Walk bottom-up to remove empty dirs
    for dirpath, dirnames, filenames in os.walk(str(chunk_dir), topdown=False):
        p = Path(dirpath)
        if p == chunk_dir:
            continue  # don't remove the root chunk dir

        if not any(p.iterdir()):
            if dry_run:
                print(f"  WOULD REMOVE DIR: {p.relative_to(chunk_dir)}")
            else:
                p.rmdir()
                print(f"  REMOVED DIR: {p.relative_to(chunk_dir)}")
            removed += 1

    return removed


def main():
    parser = argparse.ArgumentParser(
        description="Migrate chunk files from nested to flat naming with German months."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview renames without executing them.",
    )
    args = parser.parse_args()

    if args.dry_run:
        print("=== DRY RUN — no files will be moved ===\n")

    total_moved = 0
    total_dirs = 0

    for label, chunk_dir in [
        ("chunks/raw", CHUNKS_RAW_DIR),
        ("chunks/enriched", CHUNKS_ENRICHED_DIR),
        ("chunks/filtered", CHUNKS_FILTERED_DIR),
    ]:
        print(f"\n--- {label} ---")
        moved = migrate_directory(chunk_dir, args.dry_run)
        dirs = cleanup_empty_dirs(chunk_dir, args.dry_run)
        total_moved += moved
        total_dirs += dirs
        print(f"  {moved} file(s) {'would be ' if args.dry_run else ''}moved, "
              f"{dirs} empty dir(s) {'would be ' if args.dry_run else ''}removed")

    print(f"\n{'DRY RUN ' if args.dry_run else ''}TOTAL: {total_moved} file(s) moved, "
          f"{total_dirs} empty dir(s) removed")


if __name__ == "__main__":
    main()
