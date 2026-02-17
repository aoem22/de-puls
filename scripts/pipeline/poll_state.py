"""
Per-source poll state tracking for the live pipeline.

Dual storage:
  - Primary: Supabase `pipeline_poll_state` table (survives machine changes)
  - Fallback: `.cache/poll_state.json` (works offline / when Supabase unreachable)
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
load_dotenv(Path(".env.local"), override=True)


class PollState:
    """Track per-source poll metadata."""

    def __init__(self, cache_dir: str = ".cache"):
        self.cache_dir = Path(cache_dir)
        self.cache_file = self.cache_dir / "poll_state.json"
        self.state: dict[str, dict] = self._load_local()
        self._supabase = None

    def _load_local(self) -> dict[str, dict]:
        if self.cache_file.exists():
            try:
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                pass
        return {}

    def _save_local(self) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        with open(self.cache_file, "w", encoding="utf-8") as f:
            json.dump(self.state, f, indent=2, default=str)

    def _get_supabase(self):
        if self._supabase is None:
            try:
                from supabase import create_client
                url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
                key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
                       or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY"))
                if url and key:
                    self._supabase = create_client(url, key)
            except Exception:
                pass
        return self._supabase

    def get(self, source: str) -> dict:
        return self.state.get(source, {
            "last_success_at": None,
            "last_articles_count": 0,
            "consecutive_failures": 0,
            "last_error": None,
        })

    def record_success(self, source: str, articles_count: int) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self.state[source] = {
            "last_success_at": now,
            "last_articles_count": articles_count,
            "consecutive_failures": 0,
            "last_error": None,
        }
        self._save_local()
        self._sync_to_supabase(source)

    def record_failure(self, source: str, error: str) -> None:
        existing = self.get(source)
        existing["consecutive_failures"] = existing.get("consecutive_failures", 0) + 1
        existing["last_error"] = error[:500]
        self.state[source] = existing
        self._save_local()
        self._sync_to_supabase(source)

    def should_backoff(self, source: str, max_failures: int = 3) -> bool:
        """Return True if source has too many consecutive failures."""
        return self.get(source).get("consecutive_failures", 0) >= max_failures

    def backoff_multiplier(self, source: str) -> int:
        """Return poll interval multiplier based on failure count (1x, 2x, 4x)."""
        failures = self.get(source).get("consecutive_failures", 0)
        if failures < 3:
            return 1
        if failures < 6:
            return 2
        return 4

    def _sync_to_supabase(self, source: str) -> None:
        sb = self._get_supabase()
        if not sb:
            return
        try:
            row = {"source": source, **self.state[source]}
            sb.table("pipeline_poll_state").upsert(row, on_conflict="source").execute()
        except Exception:
            pass  # Supabase sync is best-effort

    def load_from_supabase(self) -> bool:
        """Pull state from Supabase (used on fresh machines). Returns True on success."""
        sb = self._get_supabase()
        if not sb:
            return False
        try:
            result = sb.table("pipeline_poll_state").select("*").execute()
            for row in result.data:
                source = row.pop("source", None)
                if source:
                    row.pop("id", None)
                    row.pop("created_at", None)
                    row.pop("updated_at", None)
                    self.state[source] = row
            self._save_local()
            return True
        except Exception:
            return False

    def summary(self) -> str:
        """Human-readable summary of all sources."""
        if not self.state:
            return "No poll state recorded yet."
        lines = []
        for source, info in sorted(self.state.items()):
            last = info.get("last_success_at", "never")
            count = info.get("last_articles_count", 0)
            fails = info.get("consecutive_failures", 0)
            err = info.get("last_error", "")
            status = f"OK ({count} articles)" if fails == 0 else f"FAILING x{fails}"
            lines.append(f"  {source:<25} {status:<20} last: {last}")
            if err:
                lines.append(f"  {'':25} error: {err[:80]}")
        return "Poll State:\n" + "\n".join(lines)
