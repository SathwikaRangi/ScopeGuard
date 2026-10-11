import { useState } from 'react';
import { VERDICTS, money, hoursLabel } from '../lib/api.js';

export function TopBar({ project, projects, onOpen, onNew }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="top">
      <div className="main">
        <h1>{project.name}</h1>
        <p>
          {project.client ? `${project.client} · ` : ''}
          {money(project.rate, project.currency)}/hr
        </p>
      </div>
      <button className="switch" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Switch
      </button>
      {open && (
        <div className="menu">
          {projects.map((p) => (
            <button
              key={p.id}
              className={p.id === project.id ? 'on' : ''}
              onClick={() => {
                setOpen(false);
                onOpen(p.id);
              }}
            >
              {p.name}
            </button>
          ))}
          <button
            className="new"
            onClick={() => {
              setOpen(false);
              onNew();
            }}
          >
            New project
          </button>
        </div>
      )}
    </header>
  );
}

export function Tally({ summary, currency }) {
  if (!summary) return null;
  const { counts, total, hours, cost } = summary;
  const pct = (n) => (total ? (n / total) * 100 : 0);
  return (
    <section className="tally">
      <div className="big">
        <strong>{money(cost, currency)}</strong>
        <span>
          of unbilled work logged{hours > 0 ? ` · ${hoursLabel(hours)}` : ''}
        </span>
      </div>
      <div
        className="bar"
        role="img"
        aria-label={`${counts.in_scope} agreed, ${counts.gray} unclear, ${counts.creep} outside scope`}
      >
        <span className="agreed" style={{ width: `${pct(counts.in_scope)}%` }} />
        <span className="unclear" style={{ width: `${pct(counts.gray)}%` }} />
        <span className="outside" style={{ width: `${pct(counts.creep)}%` }} />
      </div>
      <div className="legend">
        <span><i className="dot agreed" />{counts.in_scope} agreed</span>
        <span><i className="dot unclear" />{counts.gray} unclear</span>
        <span><i className="dot outside" />{counts.creep} outside scope</span>
      </div>
    </section>
  );
}

export function RequestCard({ request: r, project, onPatch, onDelete, onRecheck, say }) {
  const [showMessage, setShowMessage] = useState(false);
  const verdict = r.effectiveVerdict;
  const meta = verdict ? VERDICTS[verdict] : null;

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      say('Copied.');
    } catch {
      say('Select the text to copy it.');
    }
  }

  return (
    <article className={['req', meta?.cls, r.settled ? 'settled' : ''].filter(Boolean).join(' ')}>
      <div className="req-head">
        {r.status === 'pending' && <span className="chip pending">Not checked yet</span>}
        {r.status === 'checking' && <span className="chip pending">Checking…</span>}
        {r.status === 'failed' && <span className="chip failed">Check failed</span>}
        {r.status === 'analysed' && meta && (
          <span className={`chip ${meta.cls}`}>
            {meta.label}
            {r.override && <em> · your call</em>}
          </span>
        )}
        <time dateTime={new Date(r.createdAt).toISOString()}>
          {new Date(r.createdAt).toLocaleDateString()}
        </time>
      </div>

      <p className="req-text">{r.text}</p>

      {r.status === 'pending' && (
        <div className="actions">
          <button className="btn small" onClick={() => onRecheck(r)}>
            Check against the agreement
          </button>
        </div>
      )}

      {r.status === 'failed' && (
        <div className="errbox">
          <p>{r.error || 'Something went wrong.'}</p>
          <button className="btn small" onClick={() => onRecheck(r)}>
            Try again
          </button>
        </div>
      )}

      {r.status === 'analysed' && (
        <>
          <p className="rationale">{r.rationale}</p>

          {r.evidence.length > 0 ? (
            <div className="evidence">
              <p className="lead">From the agreement:</p>
              {r.evidence.map((e, i) => (
                <blockquote key={i} className="quote">
                  {e.quote}
                </blockquote>
              ))}
            </div>
          ) : (
            r.nothingInAgreement && (
              <div className="evidence none">
                <p>The agreement says nothing about this.</p>
              </div>
            )
          )}

          <div className="req-foot">
            {r.hours > 0 && (
              <span className="cost">
                {hoursLabel(r.hours)} · {money(r.hours * project.rate, project.currency)}
              </span>
            )}
            {r.clientMessage && verdict !== 'in_scope' && (
              <button className="link" onClick={() => setShowMessage((s) => !s)}>
                {showMessage ? 'Hide reply' : 'Draft a reply'}
              </button>
            )}
          </div>

          {showMessage && r.clientMessage && (
            <div className="msgbox">
              <p>{r.clientMessage}</p>
              <button className="btn small ghost" onClick={() => copy(r.clientMessage)}>
                Copy message
              </button>
            </div>
          )}

          <details className="more">
            <summary>Change this</summary>
            <div className="more-body">
              <div className="overrides">
                {Object.entries(VERDICTS).map(([key, m]) => (
                  <button
                    key={key}
                    className={`chipbtn ${m.cls}${verdict === key ? ' on' : ''}`}
                    onClick={() => onPatch(r.id, { override: key === r.verdict ? null : key })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <label className="field">
                Hours
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  defaultValue={r.hours}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v !== r.hours) onPatch(r.id, { hours: v });
                  }}
                />
              </label>
              <div className="more-row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={r.settled}
                    onChange={(e) => onPatch(r.id, { settled: e.target.checked })}
                  />
                  Invoiced or written off
                </label>
                <button className="link danger" onClick={() => onDelete(r.id)}>
                  Delete
                </button>
              </div>
              {r.retrieved?.length > 0 && (
                <p className="note tight">
                  Checked against sections {r.retrieved.join(', ')} · confidence{' '}
                  {Math.round((r.confidence || 0) * 100)}%
                </p>
              )}
            </div>
          </details>
        </>
      )}
    </article>
  );
}
