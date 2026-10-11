import { retrieve } from './retrieve.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

/* The SDK is loaded on first use. Prompt building, validation and retrieval
   are pure, and the test suite exercises them without a key or a network. */
let client;
async function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
    err.status = 503;
    throw err;
  }
  if (!client) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export const ANALYST_SYSTEM = `You review whether a new client request falls inside a freelancer's signed scope of work.

You are given numbered excerpts retrieved from the ORIGINAL agreement, and one NEW REQUEST from the client.

Judge only against the excerpts. If the excerpts contain nothing about the subject of the request, that absence is itself the finding: the work was never agreed to.

Verdicts:
- "in_scope": the agreement plainly covers this, including reasonable execution of a listed deliverable.
- "gray": related to agreed work but stretches it, exceeds a stated limit slightly, or the agreement is genuinely ambiguous.
- "creep": a new deliverable, a new responsibility, or work past a stated numeric limit.

Rules:
- Quote verbatim from the excerpts. Never invent agreement text. Maximum 25 words per quote.
- If nothing relevant exists in the excerpts, return an empty evidence array and set "nothing_in_agreement": true.
- estimated_hours is your honest estimate of the extra work this single request creates. Use 0 when in_scope.
- client_message is 1-3 sentences the freelancer could send: warm, specific, no apology, names the extra work and asks how they would like to handle it. Empty string when in_scope.
- Address the freelancer as "you".

Reply with JSON only. No prose, no markdown fences.
{"verdict":"in_scope|gray|creep","confidence":0.0,"summary":"6 words or fewer naming the ask","rationale":"2-3 plain sentences","evidence":[{"excerpt_id":"s3","quote":"verbatim words"}],"nothing_in_agreement":false,"estimated_hours":0,"client_message":""}`;

export const RECAP_SYSTEM = `You write short, professional messages for freelancers raising out-of-scope work with a client.

Warm and matter-of-fact. No apology, no blame, no filler. Lead with the good state of the project, present the extra items as a plain list, give the total hours and amount, and close by offering two ways forward: add it to the invoice, or park it for a later phase.

Plain text, no markdown, under 220 words. Do not add a signature line.`;

export function buildAnalystPrompt({ project, excerpts, request }) {
  const body = excerpts.map((e) => `[${e.id}]\n${e.text}`).join('\n\n');
  return `PROJECT: ${project.name}${project.client ? ` for ${project.client}` : ''}

EXCERPTS RETRIEVED FROM THE ORIGINAL AGREEMENT:
${body || '(the agreement is empty)'}

NEW REQUEST FROM THE CLIENT:
"""${request}"""`;
}

export function parseJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) {
    const err = new Error('The analysis came back in an unreadable shape.');
    err.status = 502;
    throw err;
  }
  return JSON.parse(t.slice(start, end + 1));
}

const VERDICTS = new Set(['in_scope', 'gray', 'creep']);

/**
 * Validates the model's output against what was actually retrieved.
 * Any quote attributed to a section we did not send is dropped — the tool's
 * whole value is that its evidence is real.
 */
export function normalise(raw, excerpts) {
  const valid = new Map(excerpts.map((e) => [e.id, e.text]));
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence
        .filter((e) => e && valid.has(e.excerpt_id) && typeof e.quote === 'string' && e.quote.trim())
        .map((e) => ({
          sectionId: e.excerpt_id,
          quote: e.quote.trim().split(/\s+/).slice(0, 25).join(' '),
        }))
    : [];

  return {
    verdict: VERDICTS.has(raw.verdict) ? raw.verdict : 'gray',
    confidence: clamp(Number(raw.confidence), 0, 1, 0.5),
    summary: String(raw.summary || '').slice(0, 80),
    rationale: String(raw.rationale || '').trim(),
    evidence,
    nothingInAgreement: Boolean(raw.nothing_in_agreement) || evidence.length === 0,
    hours: clamp(Number(raw.estimated_hours), 0, 500, 0),
    clientMessage: String(raw.client_message || '').trim(),
    retrieved: excerpts.map((e) => e.id),
  };
}

function clamp(n, min, max, fallback) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function analyseRequest({ project, sections, text }) {
  const excerpts = retrieve(sections, text, Number(process.env.RETRIEVAL_K || 4));

  if (isDemoMode()) {
    const { analyseOffline } = await import('./offline.js');
    const { raw } = analyseOffline({ sections, text, k: Number(process.env.RETRIEVAL_K || 4) });
    return { ...normalise(raw, excerpts), engine: 'rules' };
  }

  const prompt = buildAnalystPrompt({ project, excerpts, request: text });

  const sdk = await anthropic();
  const res = await sdk.messages.create({
    model: MODEL,
    max_tokens: 900,
    system: ANALYST_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  const out = res.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  return { ...normalise(parseJson(out), excerpts), engine: 'model' };
}

/* Demo mode runs the whole pipeline with rules instead of a model, so the app
   is fully usable with no key, no billing and no internet. If no key is set at
   all, we fall into it automatically rather than failing every check. */
export function isDemoMode() {
  if (String(process.env.DEMO_MODE || '').toLowerCase() === 'true') return true;
  return !process.env.ANTHROPIC_API_KEY;
}

export async function draftRecap({ project, items, totals, currencySymbol }) {
  const list = items
    .map((r, i) => {
      const when = new Date(r.created_at).toLocaleDateString('en-GB');
      return `${i + 1}. ${r.summary || r.text.slice(0, 60)} — requested ${when}, about ${r.hours} hrs. Client's words: "${r.text.slice(0, 220)}"`;
    })
    .join('\n');

  const prompt = `Freelancer's rate: ${currencySymbol}${project.rate} per hour.
Project: ${project.name}${project.client ? ` for ${project.client}` : ''}.
Out-of-scope items logged: ${items.length}, totalling ${totals.hours} hrs = ${currencySymbol}${Math.round(totals.cost)}.

Items:
${list}

Write the message to the client.`;

  if (isDemoMode()) {
    return offlineRecap({ project, items, totals, currencySymbol });
  }

  const sdk = await anthropic();
  const res = await sdk.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: RECAP_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });

  return res.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

/* The offline equivalent of the recap: a template filled from the real logged
   items. Plain, and honest about being assembled rather than written. */
function offlineRecap({ project, items, totals, currencySymbol }) {
  const lines = items
    .map((r) => `  - ${r.summary || r.text.slice(0, 50)} (about ${r.hours} hrs)`)
    .join('\n');

  return `Hi${project.client ? ` ${project.client.split(' ')[0]}` : ''},

The ${project.name} work is coming along well and we're on track.

One thing worth flagging before it gets away from us. A few requests have come in since we agreed the scope that sit outside what we originally priced:

${lines}

Together that's about ${totals.hours} hours, which comes to ${currencySymbol}${Math.round(totals.cost)} at my usual rate.

None of it is a problem and I'm glad to do it. I'd just rather raise it now than surprise you at invoicing. Two options: I add it to the final invoice, or we park it and pick it up as a second phase after launch. Happy either way — let me know which suits.`;
}
