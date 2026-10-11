# ScopeLine

Checks every client request against the scope the freelancer actually signed.

A fixed scope is agreed once, in a brief or contract. Then the project moves to WhatsApp, email
and calls, and the client asks for "just one more small thing" — an extra page, a different colour
scheme, help with the hosting. Each request looks minor. Nobody checks any of them against the
signed agreement, so the additions pile up silently, and by the time the freelancer notices, it is
awkward to raise and there is no organised record to point to.

ScopeLine sits in that gap. The agreement goes in once. Requests get logged as they arrive. Each
one is retrieved against the agreement and classified, with the exact clause quoted back — or with
a plain statement that the agreement says nothing about it. A running total shows how much
unbilled work has accumulated.

---

## Quick start

```bash
git clone <your-remote> scopeline && cd scopeline
npm install                          # root dev tooling
npm run install:all                  # server + web dependencies
cp .env.example server/.env          # ships with DEMO_MODE=true — runs free
npm run seed                         # optional: a sample project with 5 requests
npm run dev                          # API on :4000, web on :5173
```

Open http://localhost:5173. Requires **Node 22.13 or newer** (`node -v` to check).

On Windows Command Prompt, use `copy .env.example server\.env` in place of `cp`.

No compiler or build tools are needed: the database uses Node's built-in SQLite, so
`npm install` downloads plain JavaScript only.

### Demo mode

Out of the box `DEMO_MODE=true`, and **no API key is needed**. Every part of the app is real —
the agreement index, BM25 retrieval, the database, the running totals, the whole interface — but
the verdict comes from a local rule engine (`server/src/lib/offline.js`) instead of the model.
It recognises the asks that recur in client work, expands each into the vocabulary a contract
would use for it, and reads the retrieved sections for exclusion clauses, numeric limits and
deliverables lists.

It is weaker than the model and the code says so plainly: phrasing it has not seen falls to
"unclear" rather than guessing. Closing that gap is the argument for using a model at all.

For the full version, set `DEMO_MODE=false` in `server/.env` and add a key from
[console.anthropic.com](https://console.anthropic.com). Nothing else changes — same retrieval,
same output shape, same validation, same UI.

### Docker

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up --build
```

One container, frontend served from the API on port 4000, SQLite on a named volume.

---

## How the check works

```
client request
      │
      ▼
┌─────────────────┐   the agreement, split at its own clause
│  chunk.js       │   boundaries, stored verbatim
└────────┬────────┘
         ▼
┌─────────────────┐   BM25 over the sections; the top 4 go to the model.
│  retrieve.js    │   A request with no lexical overlap still returns
└────────┬────────┘   sections — "nothing covers this" is a finding, and
         ▼            the model should reach it from evidence.
┌─────────────────┐
│  analyst.js     │   Claude reads only those sections and returns JSON:
│                 │   verdict, rationale, verbatim quote, hours, reply draft
└────────┬────────┘
         ▼
┌─────────────────┐   quotes attributed to sections that were never sent
│  normalise()    │   are discarded; an unknown verdict falls back to
└────────┬────────┘   "unclear" rather than a confident wrong answer
         ▼
    SQLite  →  running total of unbilled hours × rate
```

### Verdicts

| Verdict | Meaning |
| --- | --- |
| `in_scope` | The agreement plainly covers this. |
| `gray` | Related to agreed work but stretches it, or the agreement is genuinely ambiguous. |
| `creep` | A new deliverable, a new responsibility, or work past a stated limit. |

The freelancer can override any verdict. Their call is what the totals use — the model is a first
pass, not an arbiter. An item can also be marked invoiced or written off, which takes it out of
the running total without deleting the record.

### Why BM25 rather than embeddings

Contracts turn on specific nouns: *checkout*, *blog*, *training*, *hosting*. Lexical match finds
those reliably, runs in-process, and keeps a check to a single network hop. Swapping in a vector
store means replacing `retrieve()` — its signature is the entire contract with the rest of the app.

---

## Layout

```
server/
  src/
    index.js              express app, serves web/dist in production
    db.js                 SQLite schema and connection
    store.js              data access + the totals calculation
    seed.js               sample project
    lib/
      chunk.js            clause-aware splitting of the agreement
      retrieve.js         BM25 index and scoring
      analyst.js          prompts, Claude calls, response validation
      extract.js          text out of .docx / .pdf / .txt / .md
    routes/
      projects.js         projects, the agreement, the recap message
      requests.js         logging, checking, overrides
    middleware/errors.js
  test/pipeline.test.js   13 tests, no key or network needed
web/
  src/
    App.jsx               tabs, state, data flow
    components/           onboarding, top bar, tally, request card
    lib/api.js            typed-ish API client
    styles.css
```

---

## API

Base path `/api`.

| Method | Path | Does |
| --- | --- | --- |
| GET | `/health` | Liveness, model name, whether a key is configured |
| GET | `/projects` | List projects |
| POST | `/projects` | Create one (`name`, `client`, `rate`, `currency`, `scopeText`) |
| GET | `/projects/:id` | Project, sections, all requests, totals |
| PATCH | `/projects/:id` | Rename, change rate or currency |
| DELETE | `/projects/:id` | Delete, cascading to requests |
| PUT | `/projects/:id/scope` | Replace the agreement text and re-index |
| POST | `/projects/:id/scope/upload` | Same, from an uploaded `.docx` / `.pdf` / `.txt` / `.md` |
| GET | `/projects/:id/summary` | Counts, unbilled hours, cost |
| POST | `/projects/:id/recap` | Draft one client message covering every open item |
| POST | `/projects/:id/requests` | Log a request and check it |
| GET | `/projects/:id/requests` | List requests |
| POST | `/projects/:id/retrieve` | Retrieval only — useful when tuning the index |
| POST | `/requests/:id/recheck` | Re-run a failed check, or re-check against a new agreement |
| PATCH | `/requests/:id` | `override`, `settled`, `hours` |
| DELETE | `/requests/:id` | Remove a request |

Example:

```bash
curl -s localhost:4000/api/projects/prj_xxx/requests \
  -H 'Content-Type: application/json' \
  -d '{"text":"Could we add a blog section too? Nothing fancy."}' | jq
```

```json
{
  "request": {
    "verdict": "creep",
    "summary": "Blog section added",
    "rationale": "A blog is named in the out-of-scope list, so this is new work...",
    "evidence": [{ "sectionId": "s9", "quote": "including but not limited to: e-commerce or checkout functionality, blog set-up" }],
    "hours": 6,
    "clientMessage": "Happy to build the blog — it sits outside our original five pages..."
  },
  "summary": { "counts": { "in_scope": 1, "gray": 1, "creep": 1 }, "hours": 6, "cost": 510 }
}
```

---

## Tests

```bash
npm test
```

Thirteen tests covering the parts where a mistake is expensive: that chunking never rewrites the
source, that retrieval surfaces the deciding clause, that a request with no overlap still gets
sections to reason over, that quotes attributed to sections the model never saw are discarded,
and that malformed model output degrades to "unclear" rather than crashing. No API key or network
needed — the SDK is imported lazily so the pure logic tests in isolation.

---

## Notes and limits

- **Requests you have settled** collapse behind a toggle rather than filling the list. They stay in the database because the running total and the recap are built from them.
- **Single user.** There is no auth. Put it behind a reverse proxy with basic auth, or add a
  session layer, before exposing it. The data model already partitions by project, so adding a
  `user_id` column is the main change.
- **Estimated hours are estimates.** The model guesses; the freelancer edits. Treat the total as a
  conversation starter with a client, not an invoice.
- **Scanned PDFs** have no text layer and will be rejected with a message asking for a paste. OCR
  is not wired in.
- **Replacing an agreement** re-indexes it but leaves existing verdicts alone, so you can see what
  was judged against the old version. Use recheck to re-run them.

## Possible next steps

- Email or WhatsApp export ingestion, so requests are captured without copy-paste.
- A shared read-only link for the recap, so the client sees the same evidence.
- Multi-user accounts with per-client reporting across projects.
