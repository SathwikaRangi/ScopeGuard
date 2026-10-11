import { useState, useEffect, useCallback, useRef } from 'react';
import { api, money, hoursLabel } from './lib/api.js';
import { Onboarding } from './components/Onboarding.jsx';
import { TopBar, Tally, RequestCard } from './components/Pieces.jsx';

const LAST_PROJECT = 'scopeline:last';

const SAMPLE_REQUESTS = [
  'Hey! Love the homepage. Could we get a blog section going too? Nothing fancy, just somewhere to post our roast notes each month.',
  'Quick one — can you tweak the green in the logo? Feels a bit dark on screen.',
  'Also our office manager will need a walkthrough of how to update the site. Maybe an hour on Zoom next week?',
  "One more thing, we'd like to sell bags directly on the site by launch. Just a simple checkout.",
];

export default function App() {
  const [booted, setBooted] = useState(false);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [requests, setRequests] = useState([]);
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState('requests');
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoMode, setDemoMode] = useState(false);

  const say = useCallback((msg) => setToast(msg), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const open = useCallback(async (id) => {
    const data = await api.getProject(id);
    setProject(data.project);
    setRequests(data.requests);
    setSummary(data.summary);
    setTab('requests');
    try {
      window.localStorage.setItem(LAST_PROJECT, id);
    } catch {
      /* private browsing */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const health = await api.health().catch(() => null);
        setDemoMode(Boolean(health?.demoMode));
        const { projects: list } = await api.listProjects();
        setProjects(list);
        let last = null;
        try {
          last = window.localStorage.getItem(LAST_PROJECT);
        } catch {
          /* ignore */
        }
        const target = list.find((p) => p.id === last) || list[0];
        if (target) await open(target.id);
      } catch (e) {
        setError(`Cannot reach the API. Is the server running? (${e.message})`);
      } finally {
        setBooted(true);
      }
    })();
  }, [open]);

  async function refreshProjects() {
    const { projects: list } = await api.listProjects();
    setProjects(list);
  }

  async function createProject(body) {
    setBusy(true);
    setError('');
    try {
      const { project: created } = await api.createProject(body);
      await refreshProjects();
      await open(created.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!booted) return <div className="boot">Opening your projects…</div>;

  if (!project) {
    return (
      <Onboarding
        projects={projects}
        onOpen={open}
        onCreate={createProject}
        busy={busy}
        error={error}
      />
    );
  }

  return (
    <>
      <TopBar
        project={project}
        projects={projects}
        onOpen={open}
        onNew={() => {
          setProject(null);
          setError('');
        }}
      />
      <Tally summary={summary} currency={project.currency} />
      {demoMode && (
        <p className="demo-banner">
          Demo mode — verdicts come from local rules, not the model. Add an API key in
          server/.env to switch.
        </p>
      )}
      <nav className="tabs" role="tablist">
        {[
          ['requests', 'Requests'],
          ['agreement', 'Agreement'],
          ['recap', 'Recap'],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'on' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'requests' && (
          <Requests
            project={project}
            requests={requests}
            setRequests={setRequests}
            setSummary={setSummary}
            say={say}
          />
        )}
        {tab === 'agreement' && (
          <Agreement
            project={project}
            setProject={setProject}
            say={say}
            onDeleted={async () => {
              setProject(null);
              await refreshProjects();
            }}
            onSaved={refreshProjects}
          />
        )}
        {tab === 'recap' && <Recap project={project} requests={requests} summary={summary} say={say} />}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

/* ---------------- requests ---------------- */

function Requests({ project, requests, setRequests, setSummary, say }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('all');
  const [showHistory, setShowHistory] = useState(false);
  /* Ids logged during this visit. On a fresh load this is empty, so the screen
     opens on the composer and the running total rather than on a wall of old
     cards. The history is one click away and the total always counts all of
     it — hidden is not the same as gone. */
  const [thisSession, setThisSession] = useState(() => new Set());

  async function log() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      const { request, summary } = await api.logRequest(project.id, text);
      setRequests((rs) => [request, ...rs]);
      setThisSession((ids) => new Set(ids).add(request.id));
      setSummary(summary);
      setDraft('');
      if (request.effectiveVerdict === 'creep') say('Logged as outside scope.');
    } catch (e) {
      if (e.payload?.request) {
        setRequests((rs) => [e.payload.request, ...rs]);
        setThisSession((ids) => new Set(ids).add(e.payload.request.id));
        setDraft('');
      }
      say(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function recheck(r) {
    setRequests((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: 'checking' } : x)));
    try {
      const { request, summary } = await api.recheck(r.id);
      setRequests((rs) => rs.map((x) => (x.id === r.id ? request : x)));
      if (summary) setSummary(summary);
    } catch (e) {
      if (e.payload?.request) {
        setRequests((rs) => rs.map((x) => (x.id === r.id ? e.payload.request : x)));
      }
      say(e.message);
    }
  }

  async function patch(id, body) {
    const { request, summary } = await api.patchRequest(id, body);
    setRequests((rs) => rs.map((x) => (x.id === id ? request : x)));
    setSummary(summary);
  }

  async function remove(id) {
    const { summary } = await api.deleteRequest(id);
    setRequests((rs) => rs.filter((x) => x.id !== id));
    setSummary(summary);
  }

  /* Choosing a filter is an explicit request to go looking through the record,
     so it opens the history rather than fighting it. */
  const browsing = showHistory || filter !== 'all';
  const matching = requests.filter((r) => filter === 'all' || r.effectiveVerdict === filter);
  const visible = browsing ? matching : matching.filter((r) => thisSession.has(r.id));
  const hiddenCount = matching.length - visible.length;

  return (
    <>
      <section className="card">
        <h2 className="h">Log a request</h2>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste what the client wrote, or type it in your own words…"
        />
        <div className="actions">
          <button className="btn" disabled={!draft.trim() || busy} onClick={log}>
            {busy ? 'Checking…' : 'Check against the agreement'}
          </button>
        </div>
      </section>

      {requests.length === 0 && (
        <section className="empty">
          <p>Nothing logged yet. The next "quick favour" that lands in your inbox goes here.</p>
          <div className="samples">
            {SAMPLE_REQUESTS.map((s, i) => (
              <button key={i} onClick={() => setDraft(s)}>
                {s.length > 78 ? `${s.slice(0, 78)}…` : s}
              </button>
            ))}
          </div>
        </section>
      )}

      {browsing && requests.length > 0 && (
        <div className="filters">
          {[
            ['all', 'All'],
            ['creep', 'Outside scope'],
            ['gray', 'Unclear'],
            ['in_scope', 'Agreed'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`chipbtn${filter === key ? ' on' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {visible.map((r) => (
        <RequestCard
          key={r.id}
          request={r}
          project={project}
          onPatch={patch}
          onDelete={remove}
          onRecheck={recheck}
          say={say}
        />
      ))}

      {!browsing && hiddenCount > 0 && (
        <button className="reveal" onClick={() => setShowHistory(true)}>
          Show {hiddenCount} earlier {hiddenCount === 1 ? 'request' : 'requests'}
        </button>
      )}

      {browsing && (
        <button
          className="reveal"
          onClick={() => {
            setShowHistory(false);
            setFilter('all');
          }}
        >
          Hide earlier requests
        </button>
      )}
    </>
  );
}

/* ---------------- agreement ---------------- */

function Agreement({ project, setProject, say, onDeleted, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(project.scope_text);
  const [rate, setRate] = useState(String(project.rate));
  const [currency, setCurrency] = useState(project.currency);
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef(null);

  async function save() {
    const { project: updated } = await api.replaceScope(project.id, text);
    setProject(updated);
    setEditing(false);
    say('Agreement updated. New checks use this version.');
  }

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { project: updated } = await api.uploadScope(project.id, file);
      setProject(updated);
      setText(updated.scope_text);
      say(`Read ${file.name} — ${updated.sections.length} sections indexed.`);
    } catch (err) {
      say(err.message);
    } finally {
      e.target.value = '';
    }
  }

  async function saveRate() {
    const { project: updated } = await api.updateProject(project.id, { rate, currency });
    setProject(updated);
    await onSaved();
    say('Rate updated.');
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2 className="h">The agreement</h2>
          {!editing && (
            <button className="link" onClick={() => setEditing(true)}>
              Replace
            </button>
          )}
        </div>

        {editing ? (
          <>
            <textarea className="tall" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="actions">
              <button className="btn" onClick={save} disabled={!text.trim()}>
                Save agreement
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  setText(project.scope_text);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="note">
              {project.sections.length} sections indexed. Every request is matched against these.
            </p>
            <div className="doc">
              {project.sections.map((s) => (
                <div key={s.id} className="doc-section">
                  <span className="id">{s.id}</span>
                  <p>{s.text}</p>
                </div>
              ))}
            </div>
            <div className="actions">
              <button className="btn ghost small" onClick={() => fileRef.current?.click()}>
                Upload a .docx, .pdf, .txt or .md
              </button>
              <input ref={fileRef} type="file" accept=".docx,.pdf,.txt,.md" onChange={upload} hidden />
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="h">Your rate</h2>
        <div className="row">
          <label className="field grow">
            Hourly rate
            <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
          </label>
          <label className="field">
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="actions">
          <button className="btn small" onClick={saveRate}>
            Save rate
          </button>
        </div>
      </section>

      <section className="card danger">
        <h2 className="h">Delete this project</h2>
        <p className="note">The agreement and every logged request go with it.</p>
        <div className="actions">
          {confirm ? (
            <>
              <button
                className="btn danger"
                onClick={async () => {
                  await api.deleteProject(project.id);
                  await onDeleted();
                }}
              >
                Yes, delete {project.name}
              </button>
              <button className="btn ghost" onClick={() => setConfirm(false)}>
                Keep it
              </button>
            </>
          ) : (
            <button className="btn ghost" onClick={() => setConfirm(true)}>
              Delete project
            </button>
          )}
        </div>
      </section>
    </>
  );
}

/* ---------------- recap ---------------- */

function Recap({ project, requests, summary, say }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [demoMode, setDemoMode] = useState(false);

  const items = requests.filter((r) => r.effectiveVerdict === 'creep' && !r.settled);
  const grays = requests.filter((r) => r.effectiveVerdict === 'gray' && !r.settled);

  async function write() {
    setBusy(true);
    setError('');
    try {
      const { message } = await api.recap(project.id);
      setDraft(message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      say('Copied.');
    } catch {
      say('Select the text to copy it.');
    }
  }

  return (
    <>
      <section className="card">
        <h2 className="h">Where the project stands</h2>
        <dl className="stats">
          <div>
            <dt>Outside scope, unsettled</dt>
            <dd>{summary?.openCreepItems ?? 0}</dd>
          </div>
          <div>
            <dt>Extra hours</dt>
            <dd>{hoursLabel(summary?.hours ?? 0)}</dd>
          </div>
          <div>
            <dt>At {money(project.rate, project.currency)}/hr</dt>
            <dd className="hero">{money(summary?.cost ?? 0, project.currency)}</dd>
          </div>
        </dl>
        {grays.length > 0 && (
          <p className="note" style={{ marginTop: '1rem', marginBottom: 0 }}>
            {grays.length} more {grays.length === 1 ? 'request sits' : 'requests sit'} in the unclear
            column, worth roughly {hoursLabel(summary?.grayHours ?? 0)}. Worth deciding on before
            they settle by default.
          </p>
        )}
      </section>

      {items.length > 0 && (
        <section className="card">
          <h2 className="h">The evidence</h2>
          <ol className="evlist">
            {items.map((r) => (
              <li key={r.id}>
                <p className="sum">{r.summary || r.text.slice(0, 50)}</p>
                <p className="when">
                  {new Date(r.createdAt).toLocaleDateString()} · {hoursLabel(r.hours)}
                </p>
                <p className="said">{r.text}</p>
                {r.evidence[0] && <blockquote className="quote">{r.evidence[0].quote}</blockquote>}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="card">
        <h2 className="h">Raise it with the client</h2>
        {items.length === 0 ? (
          <p className="note tight">
            Nothing outstanding. When something lands outside the agreement, the recap message shows
            up here.
          </p>
        ) : (
          <>
            <p className="note">
              One message covering all {items.length} items, with the totals already worked out.
            </p>
            <div className="actions">
              <button className="btn" onClick={write} disabled={busy}>
                {busy ? 'Writing…' : draft ? 'Write another version' : 'Draft the message'}
              </button>
            </div>
            {error && <p className="note" style={{ color: 'var(--outside)' }}>{error}</p>}
            {draft && (
              <div style={{ marginTop: '.8rem' }}>
                <textarea className="tall" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <div className="actions">
                  <button className="btn small ghost" onClick={copy}>
                    Copy message
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
