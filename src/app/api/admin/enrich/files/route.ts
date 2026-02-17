import { NextResponse } from 'next/server';
import fs, { createReadStream } from 'fs';
import path from 'path';
import { parseChunkFilename } from '@/lib/admin/chunk-utils';
import { listFilesRecursive } from '@/lib/admin/fs-walk';

const DATA_ROOT = path.join(process.cwd(), 'data', 'pipeline');
const CHUNKS_RAW = path.join(DATA_ROOT, 'chunks', 'raw');
const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024; // 50MB
const FILE_LIST_CACHE_TTL_MS = 60_000;
const FILE_INFO_CACHE_LIMIT = 2000;

interface FileInfo {
  bundesland: string;
  filename: string;
  path: string;
  absolutePath: string;
  articleCount: number;
  dateRange: { earliest: string | null; latest: string | null };
  sizeBytes: number;
}

const fileInfoCache = new Map<string, { mtimeMs: number; value: FileInfo }>();
let filesListCache: { expiresAt: number; value: FileInfo[] } | null = null;

/** Count array length in a JSON file by streaming (for large files) */
async function countArticlesStreaming(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    let depth = 0;
    let count = 0;
    let inString = false;
    let escaped = false;

    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    stream.on('data', (chunk) => {
      for (const ch of chunk) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\' && inString) { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '[' || ch === '{') {
          depth++;
          // An object at depth 2 means either: top-level array item, or item inside {"articles": [...]}
          if (ch === '{' && depth === 2) count++;
        } else if (ch === ']' || ch === '}') {
          depth--;
        }
      }
    });
    stream.on('end', () => resolve(count));
    stream.on('error', () => resolve(0));
  });
}

function extractDateRange(articles: Array<{ date?: string }>): { earliest: string | null; latest: string | null } {
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const a of articles) {
    if (!a.date) continue;
    const d = a.date.slice(0, 10);
    if (!earliest || d < earliest) earliest = d;
    if (!latest || d > latest) latest = d;
  }
  return { earliest, latest };
}

async function scanFile(absPath: string, bundesland: string, filename: string, relPath: string): Promise<FileInfo | null> {
  try {
    const stats = fs.statSync(absPath);
    if (!stats.isFile()) return null;
    const cached = fileInfoCache.get(absPath);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached.value;
    }

    let articleCount = 0;
    let dateRange: { earliest: string | null; latest: string | null } = { earliest: null, latest: null };

    if (stats.size > LARGE_FILE_THRESHOLD) {
      // Stream-count for large files
      articleCount = await countArticlesStreaming(absPath);
    } else {
      const raw = fs.readFileSync(absPath, 'utf-8');
      const data = JSON.parse(raw);
      const articles = Array.isArray(data) ? data : (data.articles || []);
      articleCount = articles.length;
      dateRange = extractDateRange(articles);
    }

    const value: FileInfo = {
      bundesland,
      filename,
      path: relPath,
      absolutePath: absPath,
      articleCount,
      dateRange,
      sizeBytes: stats.size,
    };
    fileInfoCache.set(absPath, { mtimeMs: stats.mtimeMs, value });
    if (fileInfoCache.size > FILE_INFO_CACHE_LIMIT) {
      const oldestKey = fileInfoCache.keys().next().value;
      if (oldestKey) fileInfoCache.delete(oldestKey);
    }

    return value;
  } catch {
    return null;
  }
}

export async function GET() {
  const now = Date.now();
  if (filesListCache && filesListCache.expiresAt > now) {
    return NextResponse.json(filesListCache.value);
  }

  const files: FileInfo[] = [];
  const tasks: Promise<void>[] = [];

  const rawEntries = listFilesRecursive(CHUNKS_RAW);

  // 1. Scan chunks/raw/*.json (flat naming with German months)
  for (const entry of rawEntries) {
    if (entry.relPath.includes('/')) continue;
    if (!entry.name.endsWith('.json')) continue;
    if (entry.name.endsWith('.meta.json') || entry.name.includes('_enriched')) continue;
    const parsed = parseChunkFilename(entry.name);
    const bl = parsed?.bundesland ?? 'unknown';
    const relPath = `chunks/raw/${entry.name}`;
    tasks.push(
      scanFile(entry.absPath, bl, entry.name, relPath).then((f) => { if (f) files.push(f); })
    );
  }

  // 2. Nested: chunks/raw/{bundesland}/{year}/{MM}.json
  for (const entry of rawEntries) {
    if (!entry.name.endsWith('.json')) continue;
    if (entry.name.endsWith('.meta.json') || entry.name.includes('_enriched')) continue;
    const nestedMatch = entry.relPath.match(/^([^/]+)\/(\d{4})\/([^/]+\.json)$/);
    if (!nestedMatch) continue;
    const [, bl, yearDir, monthFile] = nestedMatch;
    const nestedFilename = `${bl}/${yearDir}/${monthFile}`;
    tasks.push(
      scanFile(entry.absPath, bl, nestedFilename, nestedFilename).then((f) => { if (f) files.push(f); })
    );
  }

  // 3. Scan {YYYY}/{YYYY-MM}/{bundesland}.json (legacy)
  for (const entry of listFilesRecursive(DATA_ROOT)) {
    if (!entry.name.endsWith('.json')) continue;
    const legacyMatch = entry.relPath.match(/^(\d{4})\/(\d{4}-\d{2})\/([^/]+\.json)$/);
    if (!legacyMatch) continue;
    const [, yearDir, monthDir, fileName] = legacyMatch;
    const bl = fileName.replace('.json', '');
    const relPath = `${yearDir}/${monthDir}/${fileName}`;
    tasks.push(
      scanFile(entry.absPath, bl, fileName, relPath).then((f) => { if (f) files.push(f); })
    );
  }

  await Promise.all(tasks);

  // Sort by bundesland, then path
  files.sort((a, b) => a.bundesland.localeCompare(b.bundesland) || a.path.localeCompare(b.path));

  filesListCache = {
    value: files,
    expiresAt: now + FILE_LIST_CACHE_TTL_MS,
  };

  return NextResponse.json(files);
}
