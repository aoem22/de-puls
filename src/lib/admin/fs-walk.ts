import fs from 'fs';
import path from 'path';

export interface RecursiveFileEntry {
  absPath: string;
  relPath: string;
  name: string;
}

type DirentWithParent = fs.Dirent & {
  parentPath?: string;
  path?: string;
};

/**
 * Walk a directory recursively and return file entries with absolute + relative paths.
 * Uses Dirent parent metadata so callers can avoid rebuilding deep dynamic path joins.
 */
export function listFilesRecursive(rootDir: string): RecursiveFileEntry[] {
  if (!fs.existsSync(rootDir)) return [];

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(rootDir, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }

  const entries: RecursiveFileEntry[] = [];
  for (const dirent of dirents) {
    if (!dirent.isFile()) continue;
    const parentDir = (dirent as DirentWithParent).parentPath
      ?? (dirent as DirentWithParent).path
      ?? rootDir;
    const absPath = path.resolve(parentDir, dirent.name);
    const relPath = path.relative(rootDir, absPath).split(path.sep).join('/');
    entries.push({
      absPath,
      relPath,
      name: dirent.name,
    });
  }

  return entries;
}
