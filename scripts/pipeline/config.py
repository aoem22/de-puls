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

# States that use dedicated scrapers instead of presseportal.de.
# presseportal's /blaulicht/l/berlin and /blaulicht/l/brandenburg endpoints
# return ALL German articles (not state-filtered), so they must be scraped
# from their own state police portals.
DEDICATED_SCRAPER_STATES = {
    "berlin",
    "brandenburg",
    "bayern",
    "sachsen-anhalt",
    # hamburg removed: polizei.hamburg embeds presseportal.de iframe, use presseportal
    "sachsen",
}

# States that use presseportal.de (all except DEDICATED_SCRAPER_STATES)
PRESSEPORTAL_STATES = [s for s in BUNDESLAENDER if s not in DEDICATED_SCRAPER_STATES]

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
FILTER_SCRIPT = PROJECT_ROOT / "scripts" / "pipeline" / "filter_articles.py"
ASYNC_ENRICHER_SCRIPT = PROJECT_ROOT / "scripts" / "pipeline" / "async_enricher.py"
TRANSFORMER_SCRIPT = PROJECT_ROOT / "scripts" / "transform_to_crimes.py"

# Dedicated state scrapers (scripts/scrapers/)
SCRAPERS_DIR = PROJECT_ROOT / "scripts" / "scrapers"
STATE_SCRAPER_SCRIPTS = {
    "berlin": SCRAPERS_DIR / "scrape_berlin_polizei.py",
    "brandenburg": SCRAPERS_DIR / "scrape_brandenburg_polizei.py",
    "bayern": SCRAPERS_DIR / "scrape_bayern_polizei.py",
    "sachsen-anhalt": SCRAPERS_DIR / "scrape_sachsen_anhalt.py",
    "hamburg": SCRAPERS_DIR / "scrape_hamburg_polizei.py",
    "sachsen": SCRAPERS_DIR / "scrape_sachsen_polizei.py",
}

# Live pipeline settings
LIVE_POLL_INTERVAL_MINUTES = 15
LIVE_MAX_ARTICLES_PER_SOURCE = 200
LIVE_CONCURRENT_REQUESTS = 5
LIVE_PIPELINE_RUN_NAME = "cron_2026"

# Rate limiting and delays
DELAY_BETWEEN_CHUNKS_SECONDS = 5
MAX_RETRIES = 3
RETRY_DELAYS_SECONDS = [60, 300, 900]  # 1min, 5min, 15min

# Async enrichment settings (async_enricher.py)
ASYNC_CONCURRENCY = 30           # Max concurrent LLM requests
ASYNC_BATCH_SIZE = 8             # Articles per LLM call
ASYNC_CACHE_SAVE_INTERVAL = 500  # Save cache every N articles
ASYNC_MAX_RETRIES = 5            # Per-request retries on 429
ASYNC_RETRY_BASE_DELAY = 1.0    # Exponential backoff base (seconds)
ASYNC_RETRY_MAX_DELAY = 60.0    # Cap on retry delay

# API Keys (loaded from environment)
# HERE_API_KEY - Required for geocoding (set in .env)
# OPENROUTER_API_KEY - Required for LLM enrichment (set in .env)

# Filter configuration
CHUNKS_FILTERED_DIR = DATA_DIR / "chunks" / "filtered"

# Output files
MERGED_RAW_FILE = MERGED_DIR / "blaulicht_all_raw.json"
MERGED_ENRICHED_FILE = MERGED_DIR / "blaulicht_all_enriched.json"
FINAL_CRIMES_FILE = PROJECT_ROOT / "lib" / "data" / "blaulicht-crimes.json"

# German month names for flat chunk filenames
GERMAN_MONTHS = {
    "01": "januar",
    "02": "februar",
    "03": "maerz",
    "04": "april",
    "05": "mai",
    "06": "juni",
    "07": "juli",
    "08": "august",
    "09": "september",
    "10": "oktober",
    "11": "november",
    "12": "dezember",
}

GERMAN_MONTHS_REVERSE = {v: k for k, v in GERMAN_MONTHS.items()}


def chunk_filename(bundesland: str, year_month: str) -> str:
    """Build flat chunk filename: e.g. 'hessen_januar_2024.json'"""
    year, month = year_month.split("-")
    german_month = GERMAN_MONTHS[month]
    return f"{bundesland}_{german_month}_{year}.json"


def parse_chunk_filename(filename: str) -> tuple[str, str] | None:
    """Parse a flat chunk filename back to (bundesland, year_month).

    e.g. 'hessen_januar_2024.json' → ('hessen', '2024-01')
    Returns None if the filename doesn't match the expected pattern.
    """
    name = filename.removesuffix(".json")
    if name == filename:
        return None  # no .json extension

    # Find the last two underscores: {bundesland}_{german_month}_{year}
    # bundesland itself may contain hyphens but not underscores
    parts = name.rsplit("_", 2)
    if len(parts) != 3:
        return None

    bundesland, german_month, year = parts
    month_num = GERMAN_MONTHS_REVERSE.get(german_month)
    if month_num is None or not year.isdigit() or len(year) != 4:
        return None

    return (bundesland, f"{year}-{month_num}")


def chunk_raw_path(bundesland: str, year_month: str) -> Path:
    """Build raw chunk path: chunks/raw/{bundesland}_{monat}_{year}.json

    Creates parent directory if it doesn't exist.
    """
    p = CHUNKS_RAW_DIR / chunk_filename(bundesland, year_month)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def chunk_enriched_path(bundesland: str, year_month: str) -> Path:
    """Build enriched chunk path: chunks/enriched/{bundesland}_{monat}_{year}.json

    Creates parent directory if it doesn't exist.
    """
    p = CHUNKS_ENRICHED_DIR / chunk_filename(bundesland, year_month)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def chunk_filtered_path(bundesland: str, year_month: str) -> Path:
    """Build filtered chunk path: chunks/filtered/{bundesland}_{monat}_{year}.json

    Creates parent directory if it doesn't exist.
    """
    p = CHUNKS_FILTERED_DIR / chunk_filename(bundesland, year_month)
    p.parent.mkdir(parents=True, exist_ok=True)
    return p
