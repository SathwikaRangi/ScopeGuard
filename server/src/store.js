import { db, newId } from './db.js';
import { chunkDocument } from './lib/chunk.js';

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', INR: '₹', CAD: 'C$', AUD: 'A$' };
export const symbolFor = (c) => CURRENCY_SYMBOLS[c] || '$';

/* ---------- projects ---------- */

export function listProjects() {
  return db
    .prepare(
      `SELECT p.id, p.name, p.client, p.rate, p.currency, p.created_at,
              (SELECT COUNT(*) FROM requests r WHERE r.project_id = p.id) AS request_count
       FROM projects p ORDER BY p.created_at DESC`
    )
    .all();
}

export function createProject({ name, client = '', rate = 0, currency = 'USD', scopeText = '' }) {
  const id = newId('prj');
  const now = Date.now();
  const insert = db.transaction(() => {
    db.prepare(
      `INSERT INTO projects (id, name, client, rate, currency, scope_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name.trim(), client.trim(), Number(rate) || 0, currency, scopeText, now);
    writeSections(id, scopeText);
  });
  insert();
  return getProject(id);
}

export function getProject(id) {
  const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
  if (!project) return null;
  return { ...project, sections: getSections(id) };
}

export function updateProject(id, patch) {
  const current = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id);
  if (!current) return null;
  const next = {
    name: patch.name !== undefined ? String(patch.name).trim() : current.name,
    client: patch.client !== undefined ? String(patch.client).trim() : current.client,
    rate: patch.rate !== undefined ? Number(patch.rate) || 0 : current.rate,
    currency: patch.currency !== undefined ? patch.currency : current.currency,
  };
  db.prepare(`UPDATE projects SET name = ?, client = ?, rate = ?, currency = ? WHERE id = ?`).run(
    next.name,
    next.client,
    next.rate,
    next.currency,
    id
  );
  return getProject(id);
}

export function deleteProject(id) {
  return db.prepare(`DELETE FROM projects WHERE id = ?`).run(id).changes > 0;
}

/* ---------- the agreement ---------- */

export function getSections(projectId) {
  return db
    .prepare(`SELECT id, idx, text FROM sections WHERE project_id = ? ORDER BY idx`)
    .all(projectId);
}

function writeSections(projectId, scopeText) {
  db.prepare(`DELETE FROM sections WHERE project_id = ?`).run(projectId);
  const stmt = db.prepare(`INSERT INTO sections (id, project_id, idx, text) VALUES (?, ?, ?, ?)`);
  for (const s of chunkDocument(scopeText)) stmt.run(s.id, projectId, s.idx, s.text);
}

export function replaceScope(projectId, scopeText) {
  const exists = db.prepare(`SELECT id FROM projects WHERE id = ?`).get(projectId);
  if (!exists) return null;
  const run = db.transaction(() => {
    db.prepare(`UPDATE projects SET scope_text = ? WHERE id = ?`).run(scopeText, projectId);
    writeSections(projectId, scopeText);
  });
  run();
  return getProject(projectId);
}

/* ---------- requests ---------- */

export function listRequests(projectId) {
  const rows = db
    .prepare(`SELECT * FROM requests WHERE project_id = ? ORDER BY created_at DESC`)
    .all(projectId);
  const ev = db.prepare(`SELECT section_id, quote FROM evidence WHERE request_id = ?`);
  return rows.map((r) => hydrate(r, ev.all(r.id)));
}

export function getRequest(id) {
  const row = db.prepare(`SELECT * FROM requests WHERE id = ?`).get(id);
  if (!row) return null;
  const ev = db.prepare(`SELECT section_id, quote FROM evidence WHERE request_id = ?`).all(id);
  return hydrate(row, ev);
}

export function createRequest(projectId, { text, source = 'manual' }) {
  const id = newId('req');
  db.prepare(
    `INSERT INTO requests (id, project_id, text, source, created_at, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`
  ).run(id, projectId, text.trim(), source, Date.now());
  return getRequest(id);
}

export function saveAnalysis(requestId, analysis) {
  const run = db.transaction(() => {
    db.prepare(
      `UPDATE requests SET status='analysed', error=NULL, verdict=?, confidence=?, summary=?,
       rationale=?, hours=?, client_message=?, nothing_in_agreement=?, retrieved=?
       WHERE id = ?`
    ).run(
      analysis.verdict,
      analysis.confidence,
      analysis.summary,
      analysis.rationale,
      analysis.hours,
      analysis.clientMessage,
      analysis.nothingInAgreement ? 1 : 0,
      JSON.stringify(analysis.retrieved),
      requestId
    );
    db.prepare(`DELETE FROM evidence WHERE request_id = ?`).run(requestId);
    const stmt = db.prepare(`INSERT INTO evidence (request_id, section_id, quote) VALUES (?, ?, ?)`);
    for (const e of analysis.evidence) stmt.run(requestId, e.sectionId, e.quote);
  });
  run();
  return getRequest(requestId);
}

export function failRequest(requestId, message) {
  db.prepare(`UPDATE requests SET status='failed', error=? WHERE id = ?`).run(message, requestId);
  return getRequest(requestId);
}

export function patchRequest(id, patch) {
  const row = db.prepare(`SELECT * FROM requests WHERE id = ?`).get(id);
  if (!row) return null;
  const override =
    patch.override === undefined
      ? row.override_verdict
      : patch.override === null
        ? null
        : String(patch.override);
  const settled = patch.settled === undefined ? row.settled : patch.settled ? 1 : 0;
  const hours = patch.hours === undefined ? row.hours : Math.max(0, Number(patch.hours) || 0);
  db.prepare(`UPDATE requests SET override_verdict = ?, settled = ?, hours = ? WHERE id = ?`).run(
    override,
    settled,
    hours,
    id
  );
  return getRequest(id);
}

export function deleteRequest(id) {
  return db.prepare(`DELETE FROM requests WHERE id = ?`).run(id).changes > 0;
}

function hydrate(row, evidence) {
  return {
    id: row.id,
    projectId: row.project_id,
    text: row.text,
    source: row.source,
    createdAt: row.created_at,
    status: row.status,
    error: row.error,
    verdict: row.verdict,
    override: row.override_verdict,
    effectiveVerdict: row.override_verdict || row.verdict,
    confidence: row.confidence,
    summary: row.summary,
    rationale: row.rationale,
    hours: row.hours,
    clientMessage: row.client_message,
    nothingInAgreement: !!row.nothing_in_agreement,
    retrieved: row.retrieved ? JSON.parse(row.retrieved) : [],
    settled: !!row.settled,
    evidence: evidence.map((e) => ({ sectionId: e.section_id, quote: e.quote })),
  };
}

/* ---------- the number that matters ---------- */

export function summarise(projectId) {
  const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId);
  if (!project) return null;
  const rows = listRequests(projectId);

  const counts = { in_scope: 0, gray: 0, creep: 0 };
  let hours = 0;
  let grayHours = 0;
  let open = 0;

  for (const r of rows) {
    const v = r.effectiveVerdict;
    if (!v || !(v in counts)) continue;
    counts[v] += 1;
    if (r.settled) continue;
    if (v === 'creep') {
      hours += r.hours;
      open += 1;
    }
    if (v === 'gray') grayHours += r.hours;
  }

  const round = (n) => Math.round(n * 10) / 10;
  return {
    projectId,
    counts,
    total: counts.in_scope + counts.gray + counts.creep,
    openCreepItems: open,
    hours: round(hours),
    grayHours: round(grayHours),
    cost: round(hours * project.rate),
    grayCost: round(grayHours * project.rate),
    rate: project.rate,
    currency: project.currency,
    currencySymbol: symbolFor(project.currency),
  };
}
