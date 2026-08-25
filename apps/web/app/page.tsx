"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Criticality = "routine" | "important" | "critical";
type ReviewAction = "confirm" | "unknown" | "reject";

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
    context: string;
    chosen_option?: string;
    rationale: string;
    suggested_criticality: Criticality;
    criticality_reason: string;
    premises: Premise[];
  };
};

type Decision = {
  id: string;
  title: string;
  question: string;
  criticality: Criticality;
  premises: Array<{ id: string; kind: string; statement: string; anchor?: { exact_excerpt: string } }>;
};

type Finding = {
  premise_id: string;
  premise_statement: string;
  relationship: string;
  confidence_band: string;
  explanation: string;
  missing_context_question?: string;
  new_excerpt: string;
  source_fallback_performed: boolean;
};

type PremiseReview = { action: ReviewAction; statement: string; kind: string };
type DecisionDraft = { title: string; question: string; context: string; chosenOption: string; rationale: string };
type ModelOption = { id: string; provider: string; model: string; label: string; location: "local" | "hosted"; best_for: string };
type ModelCatalog = { default_model_id: string; models: ModelOption[] };
type Job = { id: string; kind: "extraction" | "revisit"; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; phase: string; progress: number; result?: unknown; error?: string };
type RevisitResult = { findings: Finding[]; provider?: string; model?: string; prompt_version?: string; latency_ms?: number; input_tokens?: number; output_tokens?: number; estimated_cost_usd?: number };

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const attentionKinds = new Set(["assumption", "unknown", "hard_constraint", "material_claim", "revisit_condition"]);
const premiseKinds = ["requirement", "hard_constraint", "soft_constraint", "fact", "assumption", "unknown", "material_claim", "revisit_condition"];

async function responseJson(response: Response) {
  if (response.ok) return response.json();
  const payload = await response.json().catch(() => null);
  throw new Error(payload?.detail ?? `Request failed with status ${response.status}`);
}

export default function Home() {
  const [source, setSource] = useState("We decided to use Vendor B because it was assumed that Vendor B does not support external users. The service must support SAML. Revisit if Vendor B introduces external-user support.");
  const [sourceMode, setSourceMode] = useState<"paste" | "file">("paste");
  const [file, setFile] = useState<File | null>(null);
  const [evidence, setEvidence] = useState("Vendor B now supports external users and continues to support SAML for enterprise tenants.");
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [revisitCompleted, setRevisitCompleted] = useState(false);
  const [reviews, setReviews] = useState<Record<string, PremiseReview>>({});
  const [draft, setDraft] = useState<DecisionDraft | null>(null);
  const [criticality, setCriticality] = useState<Criticality>("important");
  const [selectedPremise, setSelectedPremise] = useState<string | null>(null);
  const [busyPhase, setBusyPhase] = useState<"extract" | "finalize" | "revisit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [lastRevisitModel, setLastRevisitModel] = useState<string | null>(null);
  const [lastRevisitProvenance, setLastRevisitProvenance] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${api}/v1/models`)
      .then(responseJson)
      .then((catalog: ModelCatalog) => {
        if (cancelled) return;
        setModels(catalog.models);
        setSelectedModelId((current) => current || catalog.default_model_id);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load model options");
      });
    return () => { cancelled = true; };
  }, []);

  const premises = extraction?.result.premises ?? [];
  const counts = useMemo(() => {
    const values = Object.values(reviews);
    return {
      confirm: values.filter((item) => item.action === "confirm").length,
      unknown: values.filter((item) => item.action === "unknown").length,
      reject: values.filter((item) => item.action === "reject").length,
      attention: premises.filter((premise) => premise.attention_reason || attentionKinds.has(reviews[premise.candidate_id]?.kind ?? premise.kind)).length,
    };
  }, [premises, reviews]);
  const unanchoredCritical = useMemo(() => criticality === "critical" ? premises.filter((premise) => {
    const review = reviews[premise.candidate_id];
    return review?.action === "confirm" && attentionKinds.has(review.kind) && !premise.anchor;
  }) : [], [criticality, premises, reviews]);
  const activePremise = premises.find((premise) => premise.candidate_id === selectedPremise) ?? premises[0];
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const stage = decision ? 4 : extraction ? 2 : 1;

  function initializeExtraction(next: Extraction) {
    setExtraction(next);
    setDraft({ title: next.result.title, question: next.result.decision_question, context: next.result.context ?? "", chosenOption: next.result.chosen_option ?? "", rationale: next.result.rationale ?? "" });
    setCriticality(next.result.suggested_criticality);
    setReviews(Object.fromEntries(next.result.premises.map((premise) => [premise.candidate_id, { action: "confirm", statement: premise.statement, kind: premise.kind }])));
    setSelectedPremise(next.result.premises[0]?.candidate_id ?? null);
    setDecision(null);
    setFindings([]);
    setRevisitCompleted(false);
  }

  async function waitForJob(created: Job): Promise<Job> {
    let current = created;
    setActiveJob(current);
    while (!(["succeeded", "failed", "cancelled"] as string[]).includes(current.status)) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      current = await responseJson(await fetch(`${api}/v1/jobs/${created.id}`));
      setActiveJob(current);
    }
    if (current.status === "failed") throw new Error(current.error || "Background job failed");
    if (current.status === "cancelled") throw new Error("Operation cancelled");
    return current;
  }

  async function cancelActiveJob() {
    if (!activeJob) return;
    const cancelled = await responseJson(await fetch(`${api}/v1/jobs/${activeJob.id}`, { method: "DELETE" }));
    setActiveJob(cancelled);
    setBusyPhase(null);
  }

  async function extract(event: FormEvent) {
    event.preventDefault();
    setBusyPhase("extract");
    setError(null);
    try {
      let artifact;
      if (sourceMode === "file" && file) {
        const body = new FormData();
        body.append("file", file);
        artifact = await responseJson(await fetch(`${api}/v1/artifacts/upload`, { method: "POST", body }));
      } else {
        artifact = await responseJson(await fetch(`${api}/v1/artifacts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "decision-note.txt", media_type: "text/plain", content: source }) }));
      }
      const created = await responseJson(await fetch(`${api}/v1/decisions/extractions/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artifact_id: artifact.id, model_id: selectedModelId || undefined }) }));
      const completed = await waitForJob(created);
      initializeExtraction(completed.result as Extraction);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Extraction failed";
      if (message !== "Operation cancelled") setError(message);
    } finally {
      setBusyPhase(null);
    }
  }

  function updateReview(candidateId: string, update: Partial<PremiseReview>) {
    setReviews((current) => ({ ...current, [candidateId]: { ...current[candidateId], ...update } }));
  }

  function updateDraft(field: keyof DecisionDraft, value: string) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
  }

  async function reviewAndFinalize() {
    if (!extraction || !draft) return;
    setBusyPhase("finalize");
    setError(null);
    try {
      const reviewed = await responseJson(await fetch(`${api}/v1/extractions/${extraction.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          decision_question: draft.question,
          context: draft.context,
          chosen_option: draft.chosenOption,
          rationale: draft.rationale,
          reviews: premises.map((premise) => ({ candidate_id: premise.candidate_id, action: reviews[premise.candidate_id].action, statement: reviews[premise.candidate_id].statement, kind: reviews[premise.candidate_id].kind })),
        }),
      }));
      setExtraction(reviewed);
      setDecision(await responseJson(await fetch(`${api}/v1/extractions/${extraction.id}/finalize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ criticality }) })));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Finalization failed");
    } finally {
      setBusyPhase(null);
    }
  }

  async function revisit() {
    if (!decision) return;
    setBusyPhase("revisit");
    setError(null);
    try {
      const created = await responseJson(await fetch(`${api}/v1/decisions/${decision.id}/revisit-jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "new-evidence.txt", content: evidence, model_id: selectedModelId || undefined }) }));
      const completed = await waitForJob(created);
      const result = completed.result as RevisitResult;
      setFindings(result.findings);
      setRevisitCompleted(true);
      setLastRevisitModel(selectedModel?.label ?? selectedModelId);
      const tokens = (result.input_tokens ?? 0) + (result.output_tokens ?? 0);
      const cost = result.estimated_cost_usd == null ? "cost pending" : `$${result.estimated_cost_usd.toFixed(4)}`;
      setLastRevisitProvenance(`${result.provider ?? "unknown"}/${result.model ?? "unknown"} · ${result.prompt_version ?? "unknown prompt"} · ${result.latency_ms ?? 0} ms · ${tokens} tokens · ${cost}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Revisit failed";
      if (message !== "Operation cancelled") setError(message);
    } finally {
      setBusyPhase(null);
    }
  }

  function resetWorkspace() {
    setExtraction(null); setDecision(null); setFindings([]); setRevisitCompleted(false); setLastRevisitModel(null); setLastRevisitProvenance(null); setReviews({}); setDraft(null); setSelectedPremise(null); setActiveJob(null); setBusyPhase(null); setError(null);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">R</span><span>Rationexa</span></div>
        <button className="new-decision" onClick={resetWorkspace}>＋ New decision review</button>
        <nav aria-label="Workspace navigation">
          <a className="nav-item active" href="#workspace"><span>◇</span>Decision workspace</a>
          <span className="nav-item disabled"><span>▤</span>Decision library <small>Next</small></span>
        </nav>
        <div className="sidebar-note"><strong>Local-first prototype</strong><span>Choose an installed Ollama model for each AI-assisted step.</span></div>
      </aside>

      <main id="workspace" className="workspace">
        <header className="topbar">
          <div><span className="overline">Decision intelligence</span><h1>{draft?.title || "New decision review"}</h1></div>
          <div className="model-control">
            <label htmlFor="model-select">Model for next AI step</label>
            <select id="model-select" aria-label="AI model" value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)} disabled={busyPhase !== null || models.length === 0}>
              {models.length ? models.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.location}</option>) : <option>Loading models…</option>}
            </select>
            <small>{selectedModel?.best_for ?? "Loading configured model options…"}</small>
          </div>
        </header>

        <ol className="stepper" aria-label="Decision workflow">
          {["Import", "Review", "Finalize", "Revisit"].map((label, index) => {
            const number = index + 1;
            return <li key={label} className={number === stage ? "active" : number < stage ? "complete" : ""}><span>{number < stage ? "✓" : number}</span>{label}</li>;
          })}
        </ol>

        {error ? <div className="error" role="alert"><strong>Something needs attention</strong><span>{error}</span></div> : null}

        {activeJob && ["queued", "running"].includes(activeJob.status) ? <section className="job-progress" aria-live="polite"><div><strong>{activeJob.phase}</strong><span>{activeJob.progress}% · You can leave this running or cancel it.</span></div><div className="job-track"><span style={{ width: `${activeJob.progress}%` }} /></div><button type="button" onClick={cancelActiveJob}>Cancel</button></section> : null}

        {!extraction ? (
          <section className="card import-card">
            <div className="section-heading"><div><span className="overline">Step 1</span><h2>Bring in a decision</h2><p>Start with a short decision note, ADR, assessment, or proposal excerpt.</p></div><span className="privacy-badge">Private · processed locally</span></div>
            <div className="source-tabs" role="tablist">
              <button type="button" className={sourceMode === "paste" ? "active" : ""} onClick={() => setSourceMode("paste")}>Paste text</button>
              <button type="button" className={sourceMode === "file" ? "active" : ""} onClick={() => setSourceMode("file")}>Upload file</button>
            </div>
            <form onSubmit={extract}>
              {sourceMode === "paste" ? <label className="field"><span>Decision source</span><textarea aria-label="Decision source" value={source} onChange={(event) => setSource(event.target.value)} rows={10} placeholder="Paste the source material here…" /></label> : <label className="upload-zone"><input aria-label="Decision file" type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span className="upload-icon">⇧</span><strong>{file ? file.name : "Choose a PDF, Markdown, or text file"}</strong><small>Maximum file size: 10 MB</small></label>}
              <div className="form-footer"><span>{selectedModel?.label ?? "The selected model"} will suggest structure. You remain the reviewer.</span><button className="primary" disabled={busyPhase === "extract" || !selectedModelId || (sourceMode === "paste" ? !source.trim() : !file)}>{busyPhase === "extract" ? <><span className="spinner" />Extracting with {selectedModel?.label ?? "model"}…</> : "Extract decision →"}</button></div>
            </form>
          </section>
        ) : null}

        {extraction && draft ? (
          <>
            {!decision ? <>
              <section className="review-layout">
              <div className="review-main">
                <section className="card decision-summary">
                  <div className="section-heading compact"><div><span className="overline">Decision record · {extraction.model}</span><h2>Review the extracted decision</h2></div><button className="text-button" onClick={resetWorkspace}>Start over</button></div>
                  <div className="field-grid">
                    <label className="field full"><span>Decision title</span><input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} /></label>
                    <label className="field full"><span>Decision question</span><input value={draft.question} onChange={(event) => updateDraft("question", event.target.value)} /></label>
                    <label className="field"><span>Chosen option</span><input value={draft.chosenOption} onChange={(event) => updateDraft("chosenOption", event.target.value)} placeholder="Not established" /></label>
                    <label className="field"><span>Criticality</span><select value={criticality} onChange={(event) => setCriticality(event.target.value as Criticality)}><option value="routine">Routine</option><option value="important">Important</option><option value="critical">Critical</option></select></label>
                    <label className="field full"><span>Rationale</span><textarea rows={3} value={draft.rationale} onChange={(event) => updateDraft("rationale", event.target.value)} placeholder="Why was this option selected?" /></label>
                  </div>
                </section>

                <section className="premise-section">
                  <div className="section-heading compact"><div><span className="overline">Premise review</span><h2>Verify what the decision depends on</h2></div><div className="review-counts"><span>{counts.confirm} confirmed</span><span>{counts.attention} need attention</span></div></div>
                  <div className="premise-list">
                    {premises.map((premise, index) => {
                      const review = reviews[premise.candidate_id];
                      const attention = Boolean(premise.attention_reason || attentionKinds.has(review.kind));
                      return <article key={premise.candidate_id} className={`premise-card ${selectedPremise === premise.candidate_id ? "selected" : ""} action-${review.action}`} onClick={() => setSelectedPremise(premise.candidate_id)}>
                        <div className="premise-top"><span className="premise-number">P{index + 1}</span><select aria-label={`Premise ${index + 1} type`} value={review.kind} onClick={(event) => event.stopPropagation()} onChange={(event) => updateReview(premise.candidate_id, { kind: event.target.value })}>{premiseKinds.map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select>{attention ? <span className="attention-badge">Review carefully</span> : null}</div>
                        <textarea aria-label={`Premise ${index + 1} statement`} rows={2} value={review.statement} onClick={(event) => event.stopPropagation()} onChange={(event) => updateReview(premise.candidate_id, { statement: event.target.value })} />
                        <div className="premise-actions" onClick={(event) => event.stopPropagation()}>{(["confirm", "unknown", "reject"] as ReviewAction[]).map((action) => <button key={action} type="button" className={review.action === action ? "active" : ""} onClick={() => updateReview(premise.candidate_id, { action })}>{action === "confirm" ? "✓ Confirm" : action === "unknown" ? "? Keep unknown" : "× Reject"}</button>)}</div>
                      </article>;
                    })}
                  </div>
                </section>
              </div>

              <aside className="source-panel card">
                <span className="overline">Source evidence</span><h3>{activePremise ? `Premise ${premises.indexOf(activePremise) + 1}` : "No premise selected"}</h3>
                {activePremise?.anchor ? <blockquote>{activePremise.anchor.exact_excerpt}</blockquote> : <div className="no-anchor">No validated source anchor</div>}
                {activePremise?.attention_reason ? <p className="attention-reason">{activePremise.attention_reason}</p> : null}
                <div className="source-help"><strong>Why this matters</strong><p>Compare the extracted statement with the exact source before confirming it.</p></div>
              </aside>
              </section>
              <section className="finalize-bar"><div><strong>{unanchoredCritical.length ? "Critical premises need evidence" : "Ready to finalize?"}</strong><span>{unanchoredCritical.length ? `${unanchoredCritical.length} confirmed consequential premise${unanchoredCritical.length === 1 ? " has" : "s have"} no validated source anchor. Mark unknown or reject before finalizing.` : `${counts.confirm} premises will be preserved · ${counts.unknown} unknown · ${counts.reject} rejected`}</span></div><button className="primary" disabled={busyPhase === "finalize" || !draft.title.trim() || !draft.question.trim() || counts.confirm === 0 || unanchoredCritical.length > 0} onClick={reviewAndFinalize}>{busyPhase === "finalize" ? <><span className="spinner" />Saving decision…</> : "Save reviewed decision →"}</button></section>
            </> : <section className="card finalized-summary">
              <div className="finalized-heading"><div className="finalized-check">✓</div><div><span className="overline">Finalized decision</span><h2>{decision.title}</h2><p>{decision.question}</p></div><button className="text-button" onClick={resetWorkspace}>New review</button></div>
              <div className="record-meta"><div><span>Chosen option</span><strong>{draft.chosenOption || "Not established"}</strong></div><div><span>Criticality</span><strong>{decision.criticality}</strong></div><div><span>Preserved premises</span><strong>{decision.premises.length}</strong></div><div><span>Extracted by</span><strong>{extraction.model}</strong></div></div>
              <div className="preserved-premises">{decision.premises.map((premise, index) => <div key={premise.id}><span>P{index + 1} · {premise.kind.replaceAll("_", " ")}</span><p>{premise.statement}</p></div>)}</div>
            </section>}
          </>
        ) : null}

        {decision ? <section className="card revisit-card">
          <div className="section-heading"><div><span className="overline">Step 4 · Revisit</span><h2>What changed?</h2><p>Compare new evidence with the premises you preserved using {selectedModel?.label ?? "the selected model"}.</p></div><span className="decision-badge">{decision.criticality}</span></div>
          <label className="field"><span>New evidence</span><textarea aria-label="New evidence" value={evidence} onChange={(event) => { setEvidence(event.target.value); setRevisitCompleted(false); }} rows={5} /></label>
          <div className="form-footer"><span>This check flags relationships; it does not overturn the decision.</span><button className="primary" onClick={revisit} disabled={busyPhase === "revisit" || !selectedModelId || !evidence.trim()}>{busyPhase === "revisit" ? <><span className="spinner" />Checking with {selectedModel?.label ?? "model"}…</> : "Check against premises →"}</button></div>
          {findings.length ? <div className="findings"><div className="findings-heading"><h3>Review findings</h3><span>{findings.length} material relationship{findings.length === 1 ? "" : "s"} found · {lastRevisitModel}</span></div>{lastRevisitProvenance ? <div className="finding-provenance">Run provenance: {lastRevisitProvenance}</div> : null}{findings.map((finding) => <article key={finding.premise_id} className={`finding ${finding.relationship}`}><div className="finding-status"><span>{finding.relationship}</span><small>{finding.confidence_band} confidence</small></div><h3>{finding.premise_statement}</h3><p>{finding.explanation}</p><blockquote>{finding.new_excerpt}</blockquote>{finding.source_fallback_performed ? <div className="finding-provenance">Original source anchor verified</div> : null}{finding.missing_context_question ? <div className="missing-context">Question: {finding.missing_context_question}</div> : null}</article>)}</div> : revisitCompleted ? <div className="empty-findings"><strong>No material relationship found</strong><span>{lastRevisitModel} found no material effect on the consequential premises preserved in this decision.</span>{lastRevisitProvenance ? <span>Run provenance: {lastRevisitProvenance}</span> : null}</div> : null}
        </section> : null}
      </main>
    </div>
  );
}
