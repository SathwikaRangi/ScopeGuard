import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * SQLite via Node's built-in driver (node:sqlite, Node 22.13+).
 *
 * Chosen over better-sqlite3 for one practical reason: that one is a native
 * addon, so `npm install` must download a prebuilt binary or compile C++. On a
 * machine without build tools, or a Node version too new to have a prebuilt
 * binary, the install fails. The built-in driver has nothing to install.
 *
 * The small wrapper keeps the interface the rest of the app uses (`prepare`,
 * `exec`, `transaction`), so store.js does not care which driver is underneath.
 */

const file = process.env.DATABASE_FILE || path.join(process.cwd(), 'data', 'scopeline.db');
fs.mkdirSync(path.dirname(file), { recursive: true });

const raw = new DatabaseSync(file);
raw.exec('PRAGMA journal_mode = WAL;');
raw.exec('PRAGMA foreign_keys = ON;');

export const db = {
  exec: (sql) => raw.exec(sql),
  prepare: (sql) => raw.prepare(sql),
  /** Wraps fn so it runs atomically: all of it commits, or none of it does. */
  transaction(fn) {
    return (...args) => {
      raw.exec('BEGIN');
      try {
        const result = fn(...args);
        raw.exec('COMMIT');
        return result;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    };
  },
};

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  client      TEXT NOT NULL DEFAULT '',
  rate        REAL NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'USD',
  scope_text  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  id          TEXT NOT NULL,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  text        TEXT NOT NULL,
  PRIMARY KEY (project_id, id)
);

CREATE TABLE IF NOT EXISTS requests (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  text                 TEXT NOT NULL,
  source               TEXT NOT NULL DEFAULT 'manual',
  created_at           INTEGER NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending',
  error                TEXT,
  verdict              TEXT,
  override_verdict     TEXT,
  confidence           REAL,
  summary              TEXT,
  rationale            TEXT,
  hours                REAL NOT NULL DEFAULT 0,
  client_message       TEXT,
  nothing_in_agreement INTEGER NOT NULL DEFAULT 0,
  retrieved            TEXT,
  settled              INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS evidence (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  section_id  TEXT NOT NULL,
  quote       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_project ON requests(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_request ON evidence(request_id);
`);

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
