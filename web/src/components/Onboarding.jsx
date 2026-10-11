import { useState, useRef } from 'react';
import { CURRENCIES } from '../lib/api.js';

export function Onboarding({ projects, onOpen, onCreate, busy, error }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: '', client: '', rate: '', currency: 'USD' });
  const [scopeText, setScopeText] = useState('');
  const fileRef = useRef(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function readFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setScopeText(await file.text());
  }

  return (
    <div className="onboard">
      <header className="hero">
        <div className="hero-mark" aria-hidden="true">
          <i className="in" />
          <i className="rule" />
          <i className="out" />
        </div>
        <h1>
          Every request, checked
          <br />
          against what you signed.
        </h1>
        <p>
          Scope creep rarely arrives as one big argument. It arrives as twelve small favours across
          six weeks. Put the agreement in once, log requests as they land, and keep a running count
          of the work nobody is paying you for.
        </p>
      </header>

      {projects.length > 0 && step === 1 && (
        <section className="card">
          <h2 className="h">Your projects</h2>
          <ul className="projects">
            {projects.map((p) => (
              <li key={p.id}>
                <button onClick={() => onOpen(p.id)}>
                  <span className="name">{p.name}</span>
                  <span className="meta">
                    {p.client ? `${p.client} · ` : ''}
                    {p.request_count} logged
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 1 && (
        <section className="card">
          <h2 className="h">Start a project</h2>
          <label className="field">
            Project
            <input value={form.name} onChange={set('name')} placeholder="Marigold Coffee website" />
          </label>
          <label className="field">
            Client
            <input value={form.client} onChange={set('client')} placeholder="Dana Whitfield" />
          </label>
          <div className="row">
            <label className="field grow">
              Your hourly rate
              <input inputMode="decimal" value={form.rate} onChange={set('rate')} placeholder="85" />
            </label>
            <label className="field">
              Currency
              <select value={form.currency} onChange={set('currency')}>
                {Object.keys(CURRENCIES).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions">
            <button className="btn" disabled={!form.name.trim()} onClick={() => setStep(2)}>
              Next: add the agreement
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="card">
          <h2 className="h">Paste the agreement</h2>
          <p className="note">
            The brief, proposal, contract or statement of work — whatever the two of you actually
            agreed to. This becomes the thing every later request is measured against.
          </p>
          <textarea
            className="tall"
            value={scopeText}
            onChange={(e) => setScopeText(e.target.value)}
            placeholder="Paste the full text of the signed scope here…"
          />
          <div className="actions">
            <button className="btn ghost small" onClick={() => fileRef.current?.click()}>
              Read from a .txt or .md file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,text/plain"
              onChange={readFile}
              hidden
            />
            {scopeText && (
              <span className="note tight">{scopeText.trim().split(/\s+/).length} words</span>
            )}
          </div>
          <p className="note tight" style={{ marginTop: '.6rem' }}>
            Got a .docx or .pdf? Create the project, then upload it from the Agreement tab.
          </p>
          {error && <p className="note" style={{ color: 'var(--outside)' }}>{error}</p>}
          <div className="actions">
            <button
              className="btn"
              disabled={!scopeText.trim() || busy}
              onClick={() => onCreate({ ...form, scopeText })}
            >
              {busy ? 'Setting up…' : 'Start tracking'}
            </button>
            <button className="btn ghost" onClick={() => setStep(1)}>
              Back
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
