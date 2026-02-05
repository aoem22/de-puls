"""
Pipeline configuration constants and paths.
"""

from pathlib import Path

# All 16 German Bundesländer slugs (matching scrape_blaulicht.py)
BUNDESLAENDER = [
    "baden-wuerttemberg",
    "bayern",
    "berlin",
    "brandenburg",
    "bremen",
    "hamburg",
    "hessen",
    "mecklenburg-vorpommern",
    "niedersachsen",
    "nordrhein-westfalen",
    "rheinland-pfalz",
    "saarland",
    "sachsen",
    "sachsen-anhalt",
    "schleswig-holstein",
    "thueringen",
]

# Date range for 3-year scrape
DEFAULT_START_DATE = "2023-02-01"
DEFAULT_END_DATE = "2026-02-01"

# Chunk configuration
CHUNK_SIZE_MONTHS = 1

# Paths
PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "pipeline"
CHUNKS_RAW_DIR = DATA_DIR / "chunks" / "raw"
CHUNKS_ENRICHED_DIR = DATA_DIR / "chunks" / "enriched"
MERGED_DIR = DATA_DIR / "merged"
MANIFEST_PATH = DATA_DIR / "manifest.json"
LOG_DIR = PROJECT_ROOT / "logs"
CACHE_DIR = PROJECT_ROOT / ".cache"

# Scripts paths
SCRAPER_SCRIPT = PROJECT_ROOT / "scripts" / "scrape_blaulicht.py"
ASYNC_SCRAPER_SCRIPT = PROJECT_ROOT / "scripts" / "scrape_blaulicht_async.py"
ENRICHER_SCRIPT = PROJECT_ROOT / "scripts" / "enrich_blaulicht.py"
FAST_ENRICHER_SCRIPT = PROJECT_ROOT / "scripts" / "pipeline" / "fast_enricher.py"
TRANSFORMER_SCRIPT = PROJECT_ROOT / "scripts" / "transform_to_crimes.py"

# Rate limiting and delays
DELAY_BETWEEN_CHUNKS_SECONDS = 5
MAX_RETRIES = 3
RETRY_DELAYS_SECONDS = [60, 300, 900]  # 1min, 5min, 15min

# API Keys (loaded from environment)
# GOOGLE_MAPS_API_KEY - Required for geocoding (set in .env)
# OPENROUTER_API_KEY - Required for LLM enrichment (set in .env)

# Output files
MERGED_RAW_FILE = MERGED_DIR / "blaulicht_all_raw.json"
MERGED_ENRICHED_FILE = MERGED_DIR / "blaulicht_all_enriched.json"
FINAL_CRIMES_FILE = PROJECT_ROOT / "lib" / "data" / "blaulicht-crimes.json"
