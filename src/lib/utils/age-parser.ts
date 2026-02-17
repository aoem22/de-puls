/**
 * Age string parser for suspect/victim age fields.
 *
 * Handles formats like "42", "42, 21", "14-16", "ca. 30".
 */

export function parseAges(ageStr: string): number[] {
  const ages: number[] = [];
  for (const part of ageStr.split(/[,;]/)) {
    const rangeMatch = part.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (rangeMatch) {
      ages.push((parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2);
    } else {
      const numMatch = part.match(/(\d+)/);
      if (numMatch) ages.push(parseInt(numMatch[1]));
    }
  }
  return ages.filter((a) => a > 0 && a < 120);
}
