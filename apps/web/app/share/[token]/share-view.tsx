"use client";

import { useEffect, useState } from "react";

type Finding = {
  premise_id: string;
  premise_statement: string;
  relationship: string;
  confidence_band: string;
  explanation: string;
  missing_context_question?: string;
  new_excerpt: string;
  old_excerpt?: string;
  human_judgment?: string;
  human_notes?: string;
  judged_at?: string;
};

type SharedPremise = {
  id: string;
  kind: string;
  statement: string;
  importance: string;
  claim_status: string;
  anchor?: { exact_excerpt: string; page_number?: number };
};

type SharedRevisit = {
  id: string;
  status: string;
  findings: Finding[];
  provider?: string;
  model?: string;
  prompt_version?: string;
  created_at: string;
};

type SharedDecision = {
  id: string;
  title: string;
  question: string;
  context: string;
  chosen_option: string | null;
  rationale: string;
  criticality: string;
  status: string;
  premises: SharedPremise[];
  revisits: SharedRevisit[];
  shared_at: string;
};

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function formatDate(value?: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function formatDateTime(value?: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function ShareView({ token }: { token: string }) {
  const [record, setRecord] = useState<SharedDecision | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${api}/v1/shares/${encodeURIComponent(token)}`)
      .then((response) => {
        if (!response.ok) {
          return response.json().catch(() => null).then((payload) => {
            throw new Error(payload?.detail ?? `This shared record is unavailable (status ${response.status}).`);
          });
        }
        return response.json();
      })
      .then((data: SharedDecision) => {
        if (!cancelled) setRecord(data);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load this shared record");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
        <main className="share-body">
          <section className="share-error">
            <h1>This link is no longer available</h1>
            <p>{error}</p>
            <p className="share-hint">The owner may have revoked or expired this link, or the record was deleted.</p>
           </section>
      </main>
     );
    }

  if (!record) {
    return <main className="share-body"><div className="share-loading">Loading shared decision…</div></main>;
    }

  return (
      <main className="share-body">
        <section className="share-summary">
          <div className="share-summary-head">
            <div>
              <span className="overline">Shared decision record</span>
              <h1>{record.title}</h1>
              <p>{record.question}</p>
             </div>
             <span className={`criticality-badge ${record.criticality}`}>{record.criticality}</span>
           </div>
          <div className="record-meta share-meta">
            <div><span>Chosen option</span><strong>{record.chosen_option || "Not established"}</strong></div>
            <div><span>Criticality</span><strong>{record.criticality}</strong></div>
            <div><span>Preserved premises</span><strong>{record.premises.length}</strong></div>
            <div><span>Shared</span><strong>{formatDate(record.shared_at)}</strong></div>
           </div>
          <p className="share-disclaimer">
            Read-only copy of a human-reviewed Rationexa decision. AI findings are evidence-review aids, not decisions.
            Verify source evidence before acting.
           </p>
        </section>

        <section className="share-section">
          <h2>Rationale</h2>
          <p>{record.rationale || "Not recorded."}</p>
          {record.context ? <div className="share-sub"><h3>Context</h3><p>{record.context}</p></div> : null}
        </section>

        <section className="share-section">
          <h2>Preserved premises</h2>
          {record.premises.length ? (
              <div className="share-premise-list">
                {record.premises.map((premise, index) => (
                    <article key={premise.id} className="share-premise">
                      <header><span className="premise-number">P{index + 1}</span><span className="share-kind">{premise.kind.replaceAll("_", " ")}</span></header>
                      <p>{premise.statement}</p>
                      <div className="share-kv"><span>Importance: {premise.importance}</span><span>Claim status: {premise.claim_status}</span></div>
                      {premise.anchor ? <blockquote>{premise.anchor.exact_excerpt}</blockquote> : null}
                    </article>
                 ))}
              </div>
          ) : <p>No premises were preserved.</p>}
        </section>

        <section className="share-section">
          <h2>Revisit history</h2>
          {record.revisits.length ? (
              <div className="share-revisit-list">
                {record.revisits.map((revisit, index) => (
                    <article key={revisit.id} className="share-revisit">
                      <header><strong>Revisit {index + 1} · {formatDateTime(revisit.created_at)}</strong><span className={`history-status ${revisit.status}`}>{revisit.status.replaceAll("_", " ")}</span></header>
                      <p className="share-revisit-meta">{revisit.provider || "unknown"} / {revisit.model || "unknown"} · {revisit.prompt_version || "unknown prompt"}</p>
                      {revisit.findings.length ? revisit.findings.map((finding, findingIndex) => (
                          <div key={`${finding.premise_id}-${findingIndex}`} className={`finding ${finding.relationship}`}>
                            <div className="finding-status"><span>{finding.relationship}</span><small>{finding.confidence_band} confidence</small></div>
                            <h3>{finding.premise_statement}</h3>
                            <p>{finding.explanation}</p>
                            <blockquote>{finding.new_excerpt}</blockquote>
                            {finding.old_excerpt ? <div className="share-old"><strong>Original excerpt</strong><blockquote>{finding.old_excerpt}</blockquote></div> : null}
                            {finding.missing_context_question ? <p className="missing-context">Question: {finding.missing_context_question}</p> : null}
                            {finding.human_judgment ? <p className="share-judgment">Reviewer judgment: {finding.human_judgment.replaceAll("_", " ")}{finding.human_notes ? ` — ${finding.human_notes}` : ""}</p> : null}
                          </div>
                       )) : <p>No material relationship was found.</p>}
                    </article>
                 ))}
              </div>
          ) : <p>No revisit checks have been recorded.</p>}
        </section>
      </main>
     );
    }
