/**
 * Splits an agreement into retrievable sections.
 *
 * Contracts are already written in semantically complete blocks, and the
 * boundaries carry meaning: "two rounds of revisions" belongs to the
 * revisions clause and nowhere else. So sections follow the document's own
 * paragraphs rather than a fixed character budget.
 *
 * Two adjustments to that rule:
 *  - A heading ("3. OUT OF SCOPE") means nothing alone and changes the
 *    meaning of what follows, so it is glued to the next real block.
 *  - A very long block is packed by sentence, so one wall of text cannot
 *    swallow the retrieval budget.
 *
 * Text is never rewritten. A quote from a section must appear word-for-word
 * in the original document — that is what makes the evidence worth showing
 * to a client.
 */

const MAX_BLOCK = 900;
const SENTENCE_PACK = 650;
const HEADING_MAX = 80;
const MAX_SECTIONS = 80;

export function chunkDocument(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return [];

  const blocks = raw
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const sections = [];
  let heading = '';

  for (const block of blocks) {
    if (isHeading(block)) {
      heading = heading ? `${heading}\n${block}` : block;
      continue;
    }
    const body = heading ? `${heading}\n${block}` : block;
    heading = '';
    if (body.length > MAX_BLOCK) sections.push(...packSentences(body));
    else sections.push(body);
  }

  // A document that is nothing but headings still has to be searchable.
  if (heading) sections.push(heading);

  return sections
    .slice(0, MAX_SECTIONS)
    .map((t, i) => ({ id: `s${i + 1}`, idx: i, text: t.trim() }));
}

function isHeading(block) {
  if (block.includes('\n')) return false;
  if (block.length > HEADING_MAX) return false;
  const stripped = block.replace(/[.:]$/, '');
  if (stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped)) return true;
  if (/^\d+[.)]\s/.test(block) && !block.endsWith('.')) return true;
  return !/[.!?]$/.test(block) && block.split(/\s+/).length <= 8;
}

function packSentences(block) {
  const sentences = block.split(/(?<=[.!?])\s+/);
  const packed = [];
  let cur = '';
  for (const s of sentences) {
    const candidate = cur ? `${cur} ${s}` : s;
    if (candidate.length > SENTENCE_PACK && cur) {
      packed.push(cur.trim());
      cur = s;
    } else {
      cur = candidate;
    }
  }
  if (cur.trim()) packed.push(cur.trim());
  return packed;
}

export function wordCount(text) {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}
