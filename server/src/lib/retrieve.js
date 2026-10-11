/**
 * Retrieval over the agreement's sections.
 *
 * BM25 rather than embeddings, deliberately:
 *  - Contracts turn on specific nouns ("checkout", "blog", "training"), and
 *    lexical match finds those reliably without a second API dependency.
 *  - It runs in-process, so a request is classified in one network hop.
 *
 * Swapping in a vector store later means replacing `retrieve` only — the
 * function signature is the whole contract with the rest of the app.
 */

const STOP = new Set(
  `a about after again all also am an and any are as at be because been before being but by can cannot could did do does doing done each for from further had has have he her here hers him his how i if in into is it its itself just me more most much my no nor not of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours`.split(
    ' '
  )
);

const K1 = 1.5;
const B = 0.75;

export function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 4 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

export function buildIndex(sections) {
  const docs = sections.map((s) => tokenize(s.text));
  const N = docs.length || 1;
  const avgdl = docs.reduce((a, d) => a + d.length, 0) / N || 1;
  const df = new Map();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) || 0) + 1);
  }
  const tfs = docs.map((doc) => {
    const tf = new Map();
    for (const term of doc) tf.set(term, (tf.get(term) || 0) + 1);
    return tf;
  });
  return { sections, docs, tfs, df, N, avgdl };
}

export function score(index, query) {
  const terms = new Set(tokenize(query));
  return index.sections.map((section, i) => {
    const tf = index.tfs[i];
    const len = index.docs[i].length;
    let s = 0;
    const matched = [];
    for (const term of terms) {
      const f = tf.get(term) || 0;
      if (!f) continue;
      matched.push(term);
      const n = index.df.get(term) || 0;
      const idf = Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * len) / index.avgdl)));
    }
    return { ...section, score: Number(s.toFixed(4)), matched };
  });
}

/**
 * Returns the sections the model should read.
 *
 * A zero-overlap request is the most important case in this product — it
 * usually means the work was never discussed at all. We still hand the model
 * a few sections so it can say "nothing here covers this" from evidence
 * rather than from an empty prompt.
 */
export function retrieve(sections, query, k = 4) {
  if (!sections.length) return [];
  const index = buildIndex(sections);
  const scored = score(index, query).sort((a, b) => b.score - a.score);
  const hits = scored.filter((s) => s.score > 0).slice(0, k);
  if (hits.length >= 2) return hits;
  return scored.slice(0, Math.min(3, scored.length));
}
