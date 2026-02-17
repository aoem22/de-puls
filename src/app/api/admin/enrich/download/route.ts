import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_ROOT = path.join(process.cwd(), 'data', 'pipeline');

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');

  if (!filePath) {
    return NextResponse.json({ error: 'Missing path parameter' }, { status: 400 });
  }

  // Validate: must start with chunks/enriched/ or chunks/raw/, no traversal
  if (
    (!filePath.startsWith('chunks/enriched/') && !filePath.startsWith('chunks/raw/')) ||
    filePath.includes('..')
  ) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const absPath = path.resolve(DATA_ROOT, filePath);

  // Double-check resolved path is under DATA_ROOT
  if (!absPath.startsWith(DATA_ROOT)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const content = fs.readFileSync(absPath);
  const displayName = path.basename(filePath);

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `inline; filename="${displayName}"`,
    },
  });
}
