import { Router } from 'express';
import multer from 'multer';
import * as store from '../store.js';
import { extractText } from '../lib/extract.js';
import { draftRecap } from '../lib/analyst.js';
import { wordCount } from '../lib/chunk.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
export const projects = Router();

const notFound = () => {
  const e = new Error('No project with that id.');
  e.status = 404;
  return e;
};

projects.get('/', (req, res) => {
  res.json({ projects: store.listProjects() });
});

projects.post('/', (req, res) => {
  const { name, client, rate, currency, scopeText } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'A project needs a name.' });
  }
  if (!scopeText || !String(scopeText).trim()) {
    return res.status(400).json({ error: 'Add the agreement text. It is what everything is measured against.' });
  }
  const project = store.createProject({ name, client, rate, currency, scopeText });
  res.status(201).json({ project, summary: store.summarise(project.id) });
});

projects.get('/:id', (req, res, next) => {
  const project = store.getProject(req.params.id);
  if (!project) return next(notFound());
  res.json({
    project,
    requests: store.listRequests(project.id),
    summary: store.summarise(project.id),
    meta: { words: wordCount(project.scope_text), sections: project.sections.length },
  });
});

projects.patch('/:id', (req, res, next) => {
  const project = store.updateProject(req.params.id, req.body || {});
  if (!project) return next(notFound());
  res.json({ project, summary: store.summarise(project.id) });
});

projects.delete('/:id', (req, res, next) => {
  if (!store.deleteProject(req.params.id)) return next(notFound());
  res.status(204).end();
});

/* replacing the agreement re-indexes it; existing verdicts are left alone
   so the freelancer can see what was judged against the old version */
projects.put('/:id/scope', (req, res, next) => {
  const { scopeText } = req.body || {};
  if (!scopeText || !String(scopeText).trim()) {
    return res.status(400).json({ error: 'The agreement cannot be empty.' });
  }
  const project = store.replaceScope(req.params.id, scopeText);
  if (!project) return next(notFound());
  res.json({ project, meta: { words: wordCount(scopeText), sections: project.sections.length } });
});

projects.post('/:id/scope/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file arrived. Attach a .docx, .pdf, .txt or .md.' });
    const text = await extractText(req.file.buffer, req.file.originalname, req.file.mimetype);
    const project = store.replaceScope(req.params.id, text);
    if (!project) return next(notFound());
    res.json({ project, meta: { words: wordCount(text), sections: project.sections.length } });
  } catch (err) {
    next(err);
  }
});

projects.get('/:id/summary', (req, res, next) => {
  const summary = store.summarise(req.params.id);
  if (!summary) return next(notFound());
  res.json({ summary });
});

projects.post('/:id/recap', async (req, res, next) => {
  try {
    const project = store.getProject(req.params.id);
    if (!project) return next(notFound());
    const summary = store.summarise(project.id);
    const items = store
      .listRequests(project.id)
      .filter((r) => r.effectiveVerdict === 'creep' && !r.settled)
      .map((r) => ({ ...r, created_at: r.createdAt }))
      .reverse();

    if (!items.length) {
      return res.status(400).json({ error: 'Nothing is outstanding. There is no message to write yet.' });
    }

    const message = await draftRecap({
      project,
      items,
      totals: summary,
      currencySymbol: summary.currencySymbol,
    });
    res.json({ message, items: items.length, summary });
  } catch (err) {
    next(err);
  }
});
