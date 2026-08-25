"use client";

import { FormEvent, useMemo, useState } from "react";

type Premise = {
  candidate_id: string;
  kind: string;
  statement: string;
  quality_state: string;
  attention_reason?: string;
  anchor?: { exact_excerpt: string };
};

type Extraction = {
  id: string;
  status: string;
  provider: string;
  model: string;
  result: {
    title: string;
    decision_question: string;
    suggested_criticality: "routine" | "important" | "critical";
    criticality_reason: string;
    premises: Premise[];
  };
};

type Decision = {
  id: string;
  title: string;
  question: string;
  criticality: string;
  premises: Array<{ id: string; kind: string; statement: string; anchor?: { exact_excerpt: string } }>;
};

type Finding = {
  premise_id: string;
  premise_statement: string;
  relationship: string;
  explanation: string;
  missing_context_question?: string;
  new_excerpt: string;
  source_fallback_performed: boolean;
};

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function Home() {
  const [source, setSource] = useState("We decided to use Vendor B because it was assumed that Vendor B does not support external users. The service must support SAML. Revisit if Vendor B introduces external-user support.");
  const [evidence, setEvidence] = useState("Vendor B now supports external users and continues to support SAML for enterprise tenants.");
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const highAttention = useMemo(
    () => extraction?.result.premises.filter((premise) => premise.attention_reason) ?? [],
    [extraction],
  );

  async function extract(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const artifactResponse = await fetch(`${api}/v1/artifacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: "decision-note.txt", media_type: "text/plain", content: source }),
      });
      if (!artifactResponse.ok) throw new Error(await artifactResponse.text());
      const artifact = await artifactResponse.json();
      const response = await fetch(`${api}/v1/decisions/extractions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifact_id: artifact.id }),
      });
      if (!response.ok) throw new Error(await response.text());
      setExtraction(await response.json());
      setDecision(null);
      setFindings([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAndFinalize() {
    if (!extraction) return;
    setBusy(true);
    setError(null);
    try {
      const reviews = extraction.result.premises.map((premise) => ({ candidate_id: premise.candidate_id, action: "confirm" }));
      const reviewedResponse = await fetch(`${api}/v1/extractions/${extraction.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviews }),
      });
      if (!reviewedResponse.ok) throw new Error(await reviewedResponse.text());
      const reviewed = await reviewedResponse.json();
      setExtraction(reviewed);
      const response = await fetch(`${api}/v1/extractions/${extraction.id}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criticality: extraction.result.suggested_criticality }),
      });
      if (!response.ok) throw new Error(await response.text());
      setDecision(await response.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Finalization failed");
    } finally {
      setBusy(false);
    }
  }

  async function revisit() {
    if (!decision) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${api}/v1/decisions/${decision.id}/revisit-checks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: "new-evidence.txt", content: evidence }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      setFindings(result.findings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Revisit failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <div className="eyebrow">Stage 1 · human-in-the-loop</div>
        <h1>Remember why you decided.</h1>
        <p className="lede">Preserve the evidence that made the reasoning valid. Know when a premise may no longer hold.</p>
      </header>

      <section className="workflow" aria-label="Stage 1 workflow">
        <span className="active">1 Import</span><span>2 Review premises</span><span>3 Finalize</span><span>4 Revisit</span>
      </section>

      <section className="panel">
        <div className="panel-heading"><div><div className="step">01</div><h2>Import an existing decision</h2></div><p>Paste an ADR, assessment, or architecture note.</p></div>
        <form onSubmit={extract}>
          <textarea value={source} onChange={(event) => setSource(event.target.value)} rows={7} aria-label="Decision source" />
          <button disabled={busy || !source.trim()}>{busy ? "Working…" : "Extract decision"}</button>
        </form>
      </section>

      {error ? <div className="error">{error}</div> : null}

      {extraction ? (
        <section className="panel">
          <div className="panel-heading"><div><div className="step">02</div><h2>{extraction.result.title}</h2></div><p>{extraction.provider} · {extraction.model}</p></div>
          <div className="question">{extraction.result.decision_question}</div>
          <div className="criticality"><strong>Suggested: {extraction.result.suggested_criticality}</strong><span>{extraction.result.criticality_reason}</span></div>
          <h3>{highAttention.length} high-attention premise{highAttention.length === 1 ? "" : "s"}</h3>
          <div className="premises">
            {extraction.result.premises.map((premise) => (
              <article key={premise.candidate_id} className={premise.attention_reason ? "attention" : ""}>
                <div><span className="kind">{premise.kind.replaceAll("_", " ")}</span><span className="state">{premise.quality_state}</span></div>
                <p>{premise.statement}</p>
                {premise.anchor ? <blockquote>{premise.anchor.exact_excerpt}</blockquote> : <div className="unanchored">No validated source anchor</div>}
              </article>
            ))}
          </div>
          {!decision ? <button onClick={confirmAndFinalize} disabled={busy}>Confirm premises and finalize</button> : <div className="success">Decision finalized as {decision.criticality}.</div>}
        </section>
      ) : null}

      {decision ? (
        <section className="panel">
          <div className="panel-heading"><div><div className="step">03</div><h2>Revisit against new evidence</h2></div><p>On demand, never an automatic verdict.</p></div>
          <textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} rows={5} aria-label="New evidence" />
          <button onClick={revisit} disabled={busy || !evidence.trim()}>Check premises</button>
          {findings.length ? <div className="findings">{findings.map((finding) => <article key={finding.premise_id}><div className="relationship">{finding.relationship}</div><h3>{finding.premise_statement}</h3><p>{finding.explanation}</p><blockquote>{finding.new_excerpt}</blockquote>{finding.missing_context_question ? <p className="question">Missing context: {finding.missing_context_question}</p> : null}<div className="fallback">Original-source fallback: {finding.source_fallback_performed ? "performed" : "not required"}</div></article>)}</div> : null}
        </section>
      ) : null}
    </main>
  );
}
