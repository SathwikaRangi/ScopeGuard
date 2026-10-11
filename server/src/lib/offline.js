/**
 * Offline analyst.
 *
 * Runs the same pipeline as the real one — same retrieval, same output shape,
 * same validation — but reaches its verdict with rules instead of a model.
 * It exists so the app is fully demonstrable with no API key, no billing and
 * no internet connection.
 *
 * It is not as good as the model and does not pretend to be. It works by
 * recognising the asks that recur in client work (a blog, a checkout, a
 * training session, one more revision round), expanding each into the words a
 * contract would use for it, and then reading the retrieved sections for three
 * signals:
 *
 *   1. an exclusion clause naming the thing asked for  -> outside scope
 *   2. a numeric limit the request pushes past         -> outside scope
 *   3. a deliverables clause naming the thing          -> agreed
 *
 * Anything else falls to "unclear", which is the honest answer for a rule
 * engine that cannot reason about phrasing it has never seen. Closing that
 * gap is exactly what the model is for.
 *
 * Enable with DEMO_MODE=true.
 */

import { retrieve, tokenize } from './retrieve.js';

/**
 * The recurring asks, each with the vocabulary a contract would use for it and
 * a starting effort estimate. Matching on the request expands the search terms,
 * which is what lets "a walkthrough on Zoom" find a clause about "training
 * sessions" — words that share no letters but the same meaning.
 */
const SUBJECTS = [
  {
    match: /check ?out|e-?commerce|shop online|sell .*(online|on the site|directly)|cart|stripe|payment/,
    label: 'Online checkout',
    terms: ['checkout', 'commerce', 'ecommerce', 'shop', 'sell', 'cart', 'payment', 'transaction'],
    hours: 12,
  },
  {
    match: /blog|roast notes|articles?|news section|posts? each/,
    label: 'Blog section',
    terms: ['blog', 'article', 'post', 'news'],
    hours: 6,
  },
  {
    match: /migrat|pull .*(across|over)|bring .*(across|over)|from our old|previous site|import .*content/,
    label: 'Content migration',
    terms: ['migration', 'migrate', 'content', 'previous', 'existing', 'import', 'transfer'],
    hours: 4,
  },
  {
    match: /train|walkthrough|walk .* through|workshop|show (us|them|him|her) how|teach|onboarding session/,
    label: 'Training session',
    terms: ['training', 'session', 'workshop', 'walkthrough', 'teach'],
    hours: 1.5,
  },
  {
    match: /host|domain|dns|mailbox|email (setup|config)|server/,
    label: 'Hosting and domain work',
    terms: ['hosting', 'domain', 'renewal', 'email', 'configuration', 'account', 'server'],
    hours: 2,
  },
  {
    match: /seo|analytics|tracking|tag manager|rank/,
    label: 'Extra SEO work',
    terms: ['seo', 'meta', 'title', 'description', 'analytics', 'tracking'],
    hours: 3,
  },
  {
    match: /social|instagram|facebook|linkedin|twitter/,
    label: 'Social media assets',
    terms: ['social', 'media', 'asset', 'instagram'],
    hours: 2.5,
  },
  {
    match: /print|flyer|poster|brochure|business card|packaging|label/,
    label: 'Print collateral',
    terms: ['print', 'collateral', 'flyer', 'poster', 'brochure', 'packaging'],
    hours: 3,
  },
  {
    match: /(another|extra|additional|one more|sixth|new) (page|screen)|add a page/,
    label: 'Extra page',
    terms: ['page', 'five-page', 'deliverable', 'website'],
    hours: 5,
  },
  {
    match: /(third|another|extra|more|fourth) (round|revision)|revisit|redo the design|another pass/,
    label: 'Extra revision round',
    terms: ['revision', 'round', 'feedback', 'presentation'],
    hours: 2.5,
  },
  {
    match: /logo|favicon|wordmark|brand mark/,
    label: 'Logo change',
    terms: ['logo', 'concept', 'brand', 'favicon'],
    hours: 1,
  },
  {
    match: /photo|image|shoot|retouch|crop/,
    label: 'Extra image work',
    terms: ['photography', 'image', 'crop', 'optimise', 'supplied'],
    hours: 1.5,
  },
  {
    match: /colou?r|font|typeface|spacing|tweak|adjust|nudge|resize|shade/,
    label: 'Design tweak',
    terms: ['design', 'colour', 'concept', 'refined'],
    hours: 0.5,
  },
  {
    match: /copy ?writ|write the copy|rewrite .*(copy|text)|wording/,
    label: 'Copywriting',
    terms: ['copywriting', 'copy', 'supplied', 'write', 'rewrite'],
    hours: 4,
  },
];

const EXCLUSION_CUES = [
  'out of scope',
  'not listed',
  'not limited to',
  'not included',
  'excluded',
  'does not include',
  'will not',
  'remain the client',
  'client is responsible',
  'billed at',
  'quoted separately',
  'additional work',
  'anything not',
];

const INCLUSION_CUES = [
  'is included',
  'are included',
  'included:',
  'deliverable',
  'will deliver',
  'will design',
  'will build',
  'will place',
  'will connect',
  'will crop',
  'the designer will',
];

const MORE_CUES = [
  'third',
  'fourth',
  'another',
  'extra',
  'additional',
  'one more',
  'also',
  'as well',
  'on top',
  ' too',
];

export function analyseOffline({ sections, text, k = 4 }) {
  const excerpts = retrieve(sections, text, k);
  const lower = text.toLowerCase();
  const subject = SUBJECTS.find((s) => s.match.test(lower)) || null;

  /* The request's own words, plus the contract vocabulary for whatever it is
     asking for. The second half is what bridges client phrasing and legal
     phrasing. */
  const terms = new Set([...tokenize(text), ...(subject ? subject.terms.flatMap(tokenize) : [])]);

  const best = bestSentence(excerpts, terms);
  const label = subject ? subject.label : namePhrase(text);
  const wantsMore = MORE_CUES.some((c) => lower.includes(c));
  const hours = subject ? subject.hours : 2;

  if (!best) {
    return {
      raw: {
        verdict: 'creep',
        confidence: 0.55,
        summary: label,
        rationale: `Nothing in the agreement covers this. Work that was never written down was never priced, so it is new work however small it looks.`,
        evidence: [],
        nothing_in_agreement: true,
        estimated_hours: hours,
        client_message: clientMessage(label),
      },
      excerpts,
    };
  }

  let verdict;
  let confidence;
  let rationale;

  if (best.exclusion) {
    verdict = 'creep';
    confidence = 0.8;
    rationale = `The agreement puts this outside the fee. It is additional work, and the clause below is what you can point to if the client asks why.`;
  } else if (best.limited && wantsMore) {
    verdict = 'creep';
    confidence = 0.7;
    rationale = `The agreement sets a fixed number here and this request goes past it. Anything beyond the stated limit is extra work, not a continuation of what was agreed.`;
  } else if (best.inclusion && !wantsMore) {
    verdict = 'in_scope';
    confidence = 0.7;
    rationale = `The agreement lists this as a deliverable, so it is covered by the fee. Nothing to raise with the client.`;
  } else if (best.limited) {
    verdict = 'gray';
    confidence = 0.5;
    rationale = `The agreement sets a limit that this touches, but it is not clear whether the request stays inside it. Worth counting what has been used before you start.`;
  } else {
    verdict = 'gray';
    confidence = 0.45;
    rationale = `This is related to agreed work but is not spelled out anywhere. Decide now whether it counts as part of the fee — left alone, it settles as unpaid work by default.`;
  }

  return {
    raw: {
      verdict,
      confidence,
      summary: label,
      rationale,
      evidence: [{ excerpt_id: best.section.id, quote: best.sentence }],
      nothing_in_agreement: false,
      estimated_hours: verdict === 'in_scope' ? 0 : hours,
      client_message: verdict === 'in_scope' ? '' : clientMessage(label),
    },
    excerpts,
  };
}

/* ---------- helpers ---------- */

/**
 * Picks the sentence of the agreement that decides the case. An exclusion
 * clause outweighs a deliverables clause, because "we never agreed to this"
 * settles the question and "we agreed to something adjacent" does not.
 */
function bestSentence(excerpts, terms) {
  let best = null;

  for (const section of excerpts) {
    const sectionText = section.text.toLowerCase();
    const sectionExcludes = EXCLUSION_CUES.some((c) => sectionText.includes(c));

    for (const sentence of splitSentences(section.text)) {
      const sentenceTokens = tokenize(sentence);
      const overlap = sentenceTokens.filter((t) => terms.has(t));
      if (!overlap.length) continue;

      const sl = sentence.toLowerCase();
      const exclusion = sectionExcludes || EXCLUSION_CUES.some((c) => sl.includes(c));
      const inclusion = INCLUSION_CUES.some((c) => sl.includes(c));
      const limited = hasNumericLimit(sl);

      const weight =
        new Set(overlap).size + (exclusion ? 4 : 0) + (inclusion ? 2 : 0) + (limited ? 1 : 0);

      if (!best || weight > best.weight) {
        best = { section, sentence, exclusion, inclusion, limited, weight };
      }
    }
  }
  return best;
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

function hasNumericLimit(lower) {
  return /\b(one|two|three|four|five|six|up to|maximum|no more than|\d+)\b/.test(lower);
}

/** Fallback name for an ask that matches none of the known subjects. */
function namePhrase(text) {
  const words = text
    .replace(/^(hey|hi|hello|quick one|also|one more thing|another thing)[\s,!—-]*/i, '')
    .split(/\s+/)
    .filter(Boolean);
  const terms = tokenize(text);
  const start = Math.max(0, words.findIndex((w) => terms.includes(tokenize(w)[0])));
  const phrase = words.slice(start, start + 4).join(' ').replace(/[.,!?;:"']+$/, '');
  return phrase ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : 'This request';
}

function clientMessage(label) {
  return `Happy to take this on — ${label.toLowerCase()} sits outside what we scoped at the start, so it is extra rather than part of the fixed fee. Shall I quote it separately, or park it for a second phase after launch?`;
}
