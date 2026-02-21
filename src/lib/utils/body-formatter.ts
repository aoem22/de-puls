/**
 * Body text formatter for Polizeipressemeldungen.
 *
 * Strips structural artifacts (numbered ToC, cross-references),
 * collapses whitespace, and classifies paragraphs for styled rendering.
 */

export type ParagraphType = 'body' | 'witness_call' | 'suspect_description';

export interface FormattedParagraph {
  text: string;
  type: ParagraphType;
}

/** Numbered ToC line: "1.  Messerangriff – Altstadt" */
const TOC_LINE_RE = /^\d+\.\s{2,}.*–\s+\w+/;

/** Cross-reference: "-siehe Medieninformation ..." or "- siehe Medieninformation ..." */
const CROSS_REF_RE = /^-\s*siehe\s+Medieninformation/i;

/** Witness-call keywords */
const WITNESS_KEYWORDS = [
  'zeugenaufruf',
  'personen, die sachdienliche hinweise',
  'sachdienliche hinweise',
  'zeugenhinweise',
  'hinweise nimmt',
  'hinweise erbittet',
  'wer hat etwas beobachtet',
  'wer kann hinweise geben',
  'hinweise bitte an',
];

/** Suspect-description keywords */
const SUSPECT_DESCRIPTION_KEYWORDS = [
  'personenbeschreibung',
  'wird wie folgt beschrieben',
  'der täter wird beschrieben',
  'die täterin wird beschrieben',
  'täterbeschreibung',
];

function classifyParagraph(text: string): ParagraphType {
  const lower = text.toLowerCase();

  for (const kw of WITNESS_KEYWORDS) {
    if (lower.includes(kw)) return 'witness_call';
  }

  for (const kw of SUSPECT_DESCRIPTION_KEYWORDS) {
    if (lower.includes(kw)) return 'suspect_description';
  }

  return 'body';
}

/**
 * Parse raw police report body text into structured paragraphs.
 *
 * 1. Strips numbered ToC preamble (lines matching `^\d+\.\s{2,}.*–\s+\w+`)
 * 2. Strips "-siehe Medieninformation" cross-reference lines
 * 3. Collapses excessive whitespace (3+ newlines → paragraph break)
 * 4. Splits into paragraphs and classifies each
 */
export function formatBodyText(raw: string | null | undefined): FormattedParagraph[] {
  if (!raw) return [];

  // Split into lines for ToC / cross-ref filtering
  const lines = raw.split('\n');
  const filtered: string[] = [];
  let inTocPreamble = true;

  for (const line of lines) {
    const trimmed = line.trim();

    // Strip ToC lines at the start of the text
    if (inTocPreamble && TOC_LINE_RE.test(trimmed)) {
      continue;
    }
    // Once we hit a non-ToC, non-empty line, stop stripping
    if (inTocPreamble && trimmed.length > 0 && !TOC_LINE_RE.test(trimmed)) {
      inTocPreamble = false;
    }

    // Strip cross-reference lines anywhere
    if (CROSS_REF_RE.test(trimmed)) {
      continue;
    }

    filtered.push(line);
  }

  // Rejoin and collapse excessive whitespace (3+ newlines → 2 newlines)
  let text = filtered.join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  if (!text) return [];

  // Split on double-newline into paragraphs
  const rawParagraphs = text.split(/\n\n+/);

  const result: FormattedParagraph[] = [];
  for (const p of rawParagraphs) {
    const cleaned = p.trim();
    if (!cleaned) continue;
    result.push({
      text: cleaned,
      type: classifyParagraph(cleaned),
    });
  }

  return result;
}
