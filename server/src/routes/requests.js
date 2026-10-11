import { Router } from 'express';
import * as store from '../store.js';
import { analyseRequest } from '../lib/analyst.js';
import { retrieve } from '../lib/retrieve.js';

export const requests = Router();

const MAX_LEN = 4000;

/**
 * Log a request and check it against the agreement in one call.
 * The row is written before the model runs, so a failed analysis still
 * leaves the request on the record — losing the client's words is worse
 * than losing the verdict.
 */
requests.post('/projects/:id/requests', async (req, res, next) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) {
      const e = new Error('No project with that id.');
      e.status = 404;
      throw e;
    }
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Paste what the client asked for.' });
    if (text.length > MAX_LEN) {
      return res.status(400).json({ error: `Keep a single request under ${MAX_LEN} characters.` });
    }

    const row = store.createRequest(project.id, { text, source: req.body?.source });

    try {
      const analysis = await analyseRequest({ project, sections: project.sections, text });
      const saved = store.saveAnalysis(row.id, analysis);
      return res.status(201).json({ request: saved, summary: store.summarise(project.id) });
    } catch (err) {
      const failed = store.failRequest(row.id, err.message || 'The check did not complete.');
      return res.status(err.status === 503 ? 503 : 502).json({
        request: failed,
        summary: store.summarise(project.id),
        error: err.message,
      });
    }
  } catch (err) {
    next(err);
  }
});

requests.get('/projects/:id/requests', (req, res, next) => {
  if (!store.getProject(req.params.id)) {
    const e = new Error('No project with that id.');
    e.status = 404;
    return next(e);
  }
  res.json({ requests: store.listRequests(req.params.id) });
});

/** Re-run a failed check, or re-check against a replaced agreement. */
requests.post('/requests/:id/recheck', async (req, res, next) => {
  try {
    const existing = store.getRequest(req.params.id);
    if (!existing) {
      const e = new Error('No request with that id.');
      e.status = 404;
      throw e;
    }
    const project = store.getProject(existing.projectId);
    try {
      const analysis = await analyseRequest({
        project,
        sections: project.sections,
        text: existing.text,
      });
      const saved = store.saveAnalysis(existing.id, analysis);
      res.json({ request: saved, summary: store.summarise(project.id) });
    } catch (err) {
      const failed = store.failRequest(existing.id, err.message);
      res.status(502).json({ request: failed, error: err.message });
    }
  } catch (err) {
    next(err);
  }
});

/** The freelancer's judgment beats the model's: override, settle, adjust hours. */
requests.patch('/requests/:id', (req, res, next) => {
  const allowed = ['in_scope', 'gray', 'creep'];
  const { override } = req.body || {};
  if (override !== undefined && override !== null && !allowed.includes(override)) {
    return res.status(400).json({ error: `override must be null or one of ${allowed.join(', ')}.` });
  }
  const updated = store.patchRequest(req.params.id, req.body || {});
  if (!updated) {
    const e = new Error('No request with that id.');
    e.status = 404;
    return next(e);
  }
  res.json({ request: updated, summary: store.summarise(updated.projectId) });
});

requests.delete('/requests/:id', (req, res, next) => {
  const existing = store.getRequest(req.params.id);
  if (!existing) {
    const e = new Error('No request with that id.');
    e.status = 404;
    return next(e);
  }
  store.deleteRequest(existing.id);
  res.json({ summary: store.summarise(existing.projectId) });
});

/** Inspect retrieval on its own — useful when tuning the index. */
requests.post('/projects/:id/retrieve', (req, res, next) => {
  const project = store.getProject(req.params.id);
  if (!project) {
    const e = new Error('No project with that id.');
    e.status = 404;
    return next(e);
  }
  const query = String(req.body?.text || '');
  res.json({ hits: retrieve(project.sections, query, Number(req.body?.k) || 4) });
});
