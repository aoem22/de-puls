'use client';

import { useMemo } from 'react';
import { formatBodyText, type FormattedParagraph } from '@/lib/utils/body-formatter';

interface FormattedBodyProps {
  text: string | null | undefined;
  compact?: boolean;
  maxParagraphs?: number;
  className?: string;
}

function ParagraphBlock({ para, compact }: { para: FormattedParagraph; compact: boolean }) {
  const textSize = compact ? 'text-xs' : 'text-sm';

  if (para.type === 'witness_call') {
    return (
      <div className={`border-l-2 border-amber-500/60 pl-3 ${textSize} leading-relaxed`} style={{ color: 'var(--text-secondary)' }}>
        {para.text}
      </div>
    );
  }

  if (para.type === 'suspect_description') {
    return (
      <div
        className={`rounded-md px-3 py-2 ${textSize} leading-relaxed`}
        style={{ background: 'var(--card-elevated)', color: 'var(--text-secondary)' }}
      >
        {para.text}
      </div>
    );
  }

  return (
    <p className={`${textSize} leading-relaxed`} style={{ color: 'var(--text-secondary)' }}>
      {para.text}
    </p>
  );
}

/**
 * Renders police report body text with structured paragraph formatting.
 *
 * - Strips ToC preamble and cross-references
 * - Classifies paragraphs (witness call, suspect description, body)
 * - Applies styled rendering per type
 */
export function FormattedBody({ text, compact = false, maxParagraphs, className }: FormattedBodyProps) {
  const paragraphs = useMemo(() => formatBodyText(text), [text]);

  if (paragraphs.length === 0) return null;

  const display = maxParagraphs ? paragraphs.slice(0, maxParagraphs) : paragraphs;
  const isTruncated = maxParagraphs != null && paragraphs.length > maxParagraphs;
  const spacing = compact ? 'space-y-2' : 'space-y-3';

  return (
    <div className={`${spacing} ${className ?? ''}`}>
      {display.map((para, i) => (
        <ParagraphBlock key={i} para={para} compact={compact} />
      ))}
      {isTruncated && (
        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>…</span>
      )}
    </div>
  );
}
