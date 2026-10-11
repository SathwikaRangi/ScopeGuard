import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { projects } from './routes/projects.js';
import { requests } from './routes/requests.js';
import { notFound, errorHandler } from './middleware/errors.js';
import { isDemoMode } from './lib/analyst.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    keyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    demoMode: isDemoMode(),
  });
});

app.use('/api/projects', projects);
app.use('/api', requests);

/* In production the built frontend is served from the same origin. */
const staticDir = path.resolve(process.cwd(), '../web/dist');
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(staticDir, 'index.html')));
}

app.use(notFound);
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`ScopeLine API on http://localhost:${PORT}`);
    if (isDemoMode()) {
      console.warn('Demo mode: checks run on local rules, not the model. No API key needed.');
    }
  });
}

export default app;
