import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocument, wordCount } from '../src/lib/chunk.js';
import { retrieve, tokenize, stem } from '../src/lib/retrieve.js';
import { normalise, parseJson, buildAnalystPrompt } from '../src/lib/analyst.js';

const AGREEMENT = `PROJECT BRIEF — Marigold Coffee Roasters website

1. DELIVERABLES
A five-page marketing website: Home, Our Coffee, Wholesale, About, Contact.

Logo design is included: up to three initial concepts, one selected concept refined to final files.

2. REVISIONS
Two rounds of revisions are included after the first full design presentation. A third round is billed at the hourly rate.

3. OUT OF SCOPE
Anything not listed above, including e-commerce or checkout functionality, blog set-up, and training sessions.`;

test('chunking keeps the source text verbatim', () => {
  const sections = chunkDocument(AGREEMENT);
  assert.ok(sections.length >= 3, 'expected several sections');
  for (const s of sections) {
    assert.ok(
      AGREEMENT.includes(s.text.split('\n')[0]),
      `section ${s.id} was rewritten rather than copied`
    );
  }
});

test('chunking gives stable, ordered ids', () => {
  const sections = chunkDocument(AGREEMENT);
  assert.equal(sections[0].id, 's1');
  assert.deepEqual(
    sections.map((s) => s.idx),
    sections.map((_, i) => i)
  );
});

test('empty documents produce no sections', () => {
  assert.deepEqual(chunkDocument('   \n\n '), []);
  assert.equal(wordCount(''), 0);
});

test('a long unbroken block is split by sentence, not mid-word', () => {
  const long = 'The designer will deliver the work. '.repeat(60);
  const sections = chunkDocument(long);
  assert.ok(sections.length > 1);
  for (const s of sections) assert.ok(s.text.trim().endsWith('.'));
});

test('tokenizer drops stopwords and folds plurals', () => {
  assert.deepEqual(tokenize('The revisions are included'), ['revision', 'includ']);
  assert.equal(stem('pages'), 'page');
  assert.equal(stem('hosting'), 'host');
});

test('retrieval surfaces the clause that decides the case', () => {
  const sections = chunkDocument(AGREEMENT);
  const hits = retrieve(sections, 'can we add a third round of revisions?');
  assert.ok(hits[0].text.toLowerCase().includes('revision'), 'revisions clause should rank first');
});

test('a request with no lexical overlap still returns sections to reason over', () => {
  const sections = chunkDocument(AGREEMENT);
  const hits = retrieve(sections, 'please handle our payroll filings');
  assert.ok(hits.length > 0, 'the model must never be handed an empty prompt');
});

test('quotes attributed to sections we did not retrieve are dropped', () => {
  const excerpts = [{ id: 's2', text: 'Two rounds of revisions are included.' }];
  const result = normalise(
    {
      verdict: 'creep',
      confidence: 0.9,
      summary: 'Third revision round',
      rationale: 'Beyond the agreed two rounds.',
      evidence: [
        { excerpt_id: 's2', quote: 'Two rounds of revisions are included.' },
        { excerpt_id: 's9', quote: 'invented clause that was never sent to the model' },
      ],
      estimated_hours: 3,
      client_message: 'Happy to do it, shall I add it to the invoice?',
    },
    excerpts
  );
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].sectionId, 's2');
});

test('quotes are capped at 25 words', () => {
  const excerpts = [{ id: 's1', text: 'x' }];
  const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
  const result = normalise({ verdict: 'creep', evidence: [{ excerpt_id: 's1', quote: long }] }, excerpts);
  assert.equal(result.evidence[0].quote.split(' ').length, 25);
});

test('a junk verdict falls back to gray rather than a confident wrong answer', () => {
  const result = normalise({ verdict: 'definitely_creep', estimated_hours: 'lots' }, []);
  assert.equal(result.verdict, 'gray');
  assert.equal(result.hours, 0);
  assert.equal(result.nothingInAgreement, true);
});

test('fenced JSON from the model is parsed', () => {
  const parsed = parseJson('```json\n{"verdict":"in_scope"}\n```');
  assert.equal(parsed.verdict, 'in_scope');
});

test('unparseable model output raises a 502, not a crash', () => {
  assert.throws(() => parseJson('I think this is fine, actually'), /unreadable/i);
});

test('the prompt carries the excerpt ids the model must cite', () => {
  const prompt = buildAnalystPrompt({
    project: { name: 'Marigold', client: 'Dana' },
    excerpts: [{ id: 's2', text: 'Two rounds of revisions are included.' }],
    request: 'a third round please',
  });
  assert.match(prompt, /\[s2\]/);
  assert.match(prompt, /a third round please/);
});

/* ---- offline analyst: the path an examiner will run without a key ---- */

import { analyseOffline } from '../src/lib/offline.js';

const SEED_SCOPE = `1. DELIVERABLES

A five-page marketing website: Home, Our Coffee, Wholesale, About, Contact.

Logo design is included: up to three initial concepts, one selected concept refined to final files.

2. REVISIONS

Two rounds of revisions are included after the first full design presentation. A third round is billed at the hourly rate.

4. TECHNICAL

Ongoing hosting, domain renewal and email configuration remain the client's responsibility.

5. OUT OF SCOPE

Anything not listed above, including but not limited to: e-commerce or checkout functionality, blog set-up, content migration from the previous site, and training sessions.`;

const offline = (text) => analyseOffline({ sections: chunkDocument(SEED_SCOPE), text }).raw;

test('an excluded deliverable is caught and the exclusion clause is quoted', () => {
  const r = offline('Could we get a blog section going too? Somewhere to post roast notes.');
  assert.equal(r.verdict, 'creep');
  assert.match(r.evidence[0].quote.toLowerCase(), /not limited to|blog/);
});

test('client phrasing reaches contract phrasing it shares no words with', () => {
  const r = offline('Our office manager needs a walkthrough of how to update the site.');
  assert.equal(r.verdict, 'creep');
  assert.equal(r.summary, 'Training session');
});

test('work past a stated numeric limit is flagged', () => {
  const r = offline('Can we do a third round of revisions on the wholesale page?');
  assert.equal(r.verdict, 'creep');
  assert.match(r.evidence[0].quote.toLowerCase(), /two rounds|third round/);
});

test('a listed deliverable is not flagged', () => {
  const r = offline('Can you tweak the green in the logo? Feels a bit dark.');
  assert.equal(r.verdict, 'in_scope');
  assert.equal(r.estimated_hours, 0);
});

test('an ask the agreement never mentions returns no evidence, not a fabricated quote', () => {
  const r = offline('Could you handle our payroll filings this quarter?');
  assert.equal(r.verdict, 'creep');
  assert.equal(r.evidence.length, 0);
  assert.equal(r.nothing_in_agreement, true);
});
