"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Criticality = "routine" | "important" | "critical";
type ReviewAction = "confirm" | "unknown" | "reject";
type FindingJudgment = "worth_reviewing" | "not_material" | "needs_context" | "false_positive";

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
  context: string;
  chosen_option?: string;
  rationale: string;
  criticality: Criticality;
  preservation_policy: string;
  status: string;
  created_at: string;
  premises: Array<{ id: string; kind: string; statement: string; anchor?: { exact_excerpt: string } }>;
};

type DecisionListItem = {
  id: string;
  title: string;
  question: string;
  chosen_option?: string;
  criticality: Criticality;
  status: string;
  premise_count: number;
  revisit_count: number;
  pending_revisit_count: number;
  last_revisited_at?: string;
  created_at: string;
};

type DecisionLibrary = { items: DecisionListItem[]; total: number };

type Finding = {
  premise_id: string;
  premise_statement: string;
  relationship: string;
  confidence_band: string;
  explanation: string;
  missing_context_question?: string;
  new_excerpt: string;
  source_fallback_performed: boolean;
  finding_type?: "premise_change" | "new_constraint";
  detection_source?: "model" | "deterministic_rules" | "deterministic_safety_net";
  human_judgment?: FindingJudgment;
  human_notes?: string;
  judged_at?: string;
};

type PremiseReview = { action: ReviewAction; statement: string; kind: string };
type DecisionDraft = { title: string; question: string; context: string; chosenOption: string; rationale: string };
type ModelOption = { id: string; provider: string; model: string; label: string; location: "local" | "hosted"; best_for: string };
type ModelCatalog = { default_model_id: string; models: ModelOption[] };
type Job = { id: string; kind: "extraction" | "revisit"; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; phase: string; progress: number; result?: unknown; error?: string };
type RevisitResult = { id: string; decision_id: string; status: string; findings: Finding[]; provider?: string; model?: string; prompt_version?: string; latency_ms?: number; input_tokens?: number; output_tokens?: number; estimated_cost_usd?: number; evidence_filename?: string; created_at: string };
type ComparisonRun = { modelId: string; label: string; result: RevisitResult };
type Share = { id: string; decision_id: string; token: string; status: string; url: string | null; created_at: string; expires_at: string | null; revoked_at: string | null };

const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const attentionKinds = new Set(["assumption", "unknown", "hard_constraint", "material_claim", "revisit_condition"]);
const premiseKinds = ["requirement", "hard_constraint", "soft_constraint", "fact", "assumption", "unknown", "material_claim", "revisit_condition"];

async function responseJson(response: Response) {
  if (response.ok) return response.json();
  const payload = await response.json().catch(() => null);
  throw new Error(payload?.detail ?? `Request failed with status ${response.status}`);
}

function provenanceLabel(result: RevisitResult) {
  const tokens = (result.input_tokens ?? 0) + (result.output_tokens ?? 0);
  const cost = result.estimated_cost_usd == null ? "cost pending" : `$${result.estimated_cost_usd.toFixed(4)}`;
  return `${result.provider ?? "unknown"}/${result.model ?? "unknown"} · ${result.prompt_version ?? "unknown prompt"} · ${result.latency_ms ?? 0} ms · ${tokens} tokens · ${cost}`;
}

function formatDate(value?: string) {
  if (!value) return "Not revisited";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export default function Home() {
  const [view, setView] = useState<"workspace" | "library">("workspace");
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
  const [compareMode, setCompareMode] = useState(false);
  const [comparisonModelId, setComparisonModelId] = useState("");
  const [comparisonRuns, setComparisonRuns] = useState<ComparisonRun[]>([]);
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [activeRevisitId, setActiveRevisitId] = useState<string | null>(null);
  const [judgmentBusy, setJudgmentBusy] = useState<string | null>(null);
  const [library, setLibrary] = useState<DecisionLibrary>({ items: [], total: 0 });
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryCriticality, setLibraryCriticality] = useState<"all" | Criticality>("all");
  const [libraryLoading, setLibraryLoading] = useState(false);
   const [revisitHistory, setRevisitHistory] = useState<RevisitResult[]>([]);
   const [exportBusy, setExportBusy] = useState(false);
   const [pdfExportBusy, setPdfExportBusy] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [shareBusy, setShareBusy] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${api}/v1/models`)
      .then(responseJson)
      .then((catalog: ModelCatalog) => {
        if (cancelled) return;
        setModels(catalog.models);
        setSelectedModelId((current) => current || catalog.default_model_id);
        setComparisonModelId((current) => current || catalog.models.find((model) => model.id !== catalog.default_model_id)?.id || "");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load model options");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (view !== "library") return;
    const timer = window.setTimeout(() => {
      void loadLibrary();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [view, libraryQuery, libraryCriticality]);

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
  const comparisonModel = models.find((model) => model.id === comparisonModelId);
  const runningJobs = activeJobs.filter((job) => ["queued", "running"].includes(job.status));
  const activeProgress = runningJobs.length ? Math.round(runningJobs.reduce((total, job) => total + job.progress, 0) / runningJobs.length) : 0;
  const disagreements = useMemo(() => {
    if (comparisonRuns.length !== 2 || !decision) return [];
    const [first, second] = comparisonRuns;
    const firstByPremise = new Map(first.result.findings.map((finding) => [finding.premise_id, finding.relationship]));
    const secondByPremise = new Map(second.result.findings.map((finding) => [finding.premise_id, finding.relationship]));
    return decision.premises.flatMap((premise) => {
      const firstRelationship = firstByPremise.get(premise.id) ?? "no material finding";
      const secondRelationship = secondByPremise.get(premise.id) ?? "no material finding";
      return firstRelationship === secondRelationship ? [] : [{ premise, firstRelationship, secondRelationship }];
    });
  }, [comparisonRuns, decision]);
  const stage = decision ? 4 : extraction ? 2 : 1;

  function initializeExtraction(next: Extraction) {
    setExtraction(next);
    setDraft({ title: next.result.title, question: next.result.decision_question, context: next.result.context ?? "", chosenOption: next.result.chosen_option ?? "", rationale: next.result.rationale ?? "" });
    setCriticality(next.result.suggested_criticality);
    setReviews(Object.fromEntries(next.result.premises.map((premise) => [premise.candidate_id, { action: "confirm", statement: premise.statement, kind: premise.kind }])));
    setSelectedPremise(next.result.premises[0]?.candidate_id ?? null);
    setDecision(null);
    setFindings([]);
    setComparisonRuns([]);
    setActiveRevisitId(null);
    setRevisitCompleted(false);
  }

  async function waitForJobs(created: Job[]): Promise<Job[]> {
    let current = created;
    setActiveJobs(current);
    while (current.some((job) => !(["succeeded", "failed", "cancelled"] as string[]).includes(job.status))) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      current = await Promise.all(created.map(async (job) => responseJson(await fetch(`${api}/v1/jobs/${job.id}`))));
      setActiveJobs(current);
    }
    const failed = current.find((job) => job.status === "failed");
    if (failed) throw new Error(failed.error || "Background job failed");
    if (current.some((job) => job.status === "cancelled")) throw new Error("Operation cancelled");
    return current;
  }

  async function waitForJob(created: Job): Promise<Job> {
    return (await waitForJobs([created]))[0];
  }

  async function cancelActiveJobs() {
    const running = activeJobs.filter((job) => ["queued", "running"].includes(job.status));
    if (!running.length) return;
    const cancelled = await Promise.all(running.map(async (job) => responseJson(await fetch(`${api}/v1/jobs/${job.id}`, { method: "DELETE" }))));
    setActiveJobs(cancelled);
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
      const saved = await responseJson(await fetch(`${api}/v1/extractions/${extraction.id}/finalize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ criticality }) })) as Decision;
      setDecision(saved);
      setRevisitHistory([]);
      void loadLibrary();
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
      const modelIds = compareMode ? [selectedModelId, comparisonModelId] : [selectedModelId];
      if (new Set(modelIds).size !== modelIds.length) throw new Error("Choose two different models to compare");
      const created = await Promise.all(modelIds.map(async (modelId) => responseJson(await fetch(`${api}/v1/decisions/${decision.id}/revisit-jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "new-evidence.txt", content: evidence, model_id: modelId }) }))));
      const completed = await waitForJobs(created);
      const runs = completed.map((job, index) => ({ modelId: modelIds[index], label: models.find((model) => model.id === modelIds[index])?.label ?? modelIds[index], result: job.result as RevisitResult }));
      setRevisitCompleted(true);
      if (compareMode) {
        setComparisonRuns(runs);
        setFindings([]);
      } else {
        const result = runs[0].result;
        setComparisonRuns([]);
        setFindings(result.findings);
        setActiveRevisitId(result.id);
        setLastRevisitModel(runs[0].label);
        setLastRevisitProvenance(provenanceLabel(result));
      }
      await loadRevisitHistory(decision.id);
      void loadLibrary();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Revisit failed";
      if (message !== "Operation cancelled") setError(message);
    } finally {
      setBusyPhase(null);
    }
  }

  async function recordFindingJudgment(premiseId: string, judgment: FindingJudgment) {
    if (!activeRevisitId) return;
    setJudgmentBusy(premiseId);
    setError(null);
    try {
      const updated = await responseJson(await fetch(`${api}/v1/revisit-checks/${activeRevisitId}/findings/${premiseId}/judgment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ judgment }),
      })) as RevisitResult;
      setFindings(updated.findings);
      setRevisitHistory((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save finding judgment");
    } finally {
      setJudgmentBusy(null);
    }
  }

  async function loadLibrary() {
    setLibraryLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (libraryQuery.trim()) params.set("q", libraryQuery.trim());
      if (libraryCriticality !== "all") params.set("criticality", libraryCriticality);
      const query = params.size ? `?${params.toString()}` : "";
      setLibrary(await responseJson(await fetch(`${api}/v1/decisions${query}`)) as DecisionLibrary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the decision library");
    } finally {
      setLibraryLoading(false);
    }
  }

  async function loadRevisitHistory(decisionId: string) {
    const history = await responseJson(await fetch(`${api}/v1/decisions/${decisionId}/revisit-checks`)) as RevisitResult[];
    setRevisitHistory(history);
  }

  async function openDecision(decisionId: string) {
    setError(null);
    try {
      const [record, history] = await Promise.all([
        fetch(`${api}/v1/decisions/${decisionId}`).then(responseJson),
        fetch(`${api}/v1/decisions/${decisionId}/revisit-checks`).then(responseJson),
      ]) as [Decision, RevisitResult[]];
      setDecision(record);
      setDraft({ title: record.title, question: record.question, context: record.context, chosenOption: record.chosen_option ?? "", rationale: record.rationale });
       setRevisitHistory(history);
       setExtraction(null);
       setFindings([]);
       setComparisonRuns([]);
       setRevisitCompleted(false);
       setActiveRevisitId(null);
       setEvidence("");
       setLibraryQuery("");
       setView("workspace");
       void loadShares(decisionId).catch(() => { setShares([]); });
       window.location.hash = "workspace";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open the decision");
    }
  }

  async function downloadMarkdown() {
    if (!decision) return;
    setExportBusy(true);
    setError(null);
    try {
      const response = await fetch(`${api}/v1/decisions/${decision.id}/export/markdown`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? `Export failed with status ${response.status}`);
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "decision-record.md";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
       } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not export this decision");
        } finally {
        setExportBusy(false);
        }
    }

  async function downloadPdf() {
    if (!decision) return;
    setPdfExportBusy(true);
    setError(null);
    try {
      const response = await fetch(`${api}/v1/decisions/${decision.id}/export/pdf`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? `PDF export failed with status ${response.status}`);
        }
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? "decision-record.pdf";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not export this decision as PDF");
        } finally {
        setPdfExportBusy(false);
        }
    }

  function resetWorkspace() {
    setView("workspace"); setExtraction(null); setDecision(null); setFindings([]); setComparisonRuns([]); setRevisitHistory([]); setRevisitCompleted(false); setLastRevisitModel(null); setLastRevisitProvenance(null); setActiveRevisitId(null); setReviews({}); setDraft(null); setSelectedPremise(null); setActiveJobs([]); setBusyPhase(null); setExportBusy(false); setPdfExportBusy(false); setError(null); setShares([]); setCopiedToken(null);
     }

  async function loadShares(decisionId: string) {
    setShares(await responseJson(await fetch(`${api}/v1/decisions/${decisionId}/shares`)) as Share[]);
   }

  async function createShare() {
    if (!decision) return;
    setShareBusy(true);
    setError(null);
    try {
      const created = await responseJson(await fetch(`${api}/v1/decisions/${decision.id}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        })) as Share;
      await loadShares(decision.id);
      await copyLink(created.url ?? created.token);
     } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create a share link");
     } finally {
      setShareBusy(false);
     }
    }

  async function copyLink(value: string | null) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      window.prompt("Copy this link:", value);
     }
    setCopiedToken(value);
    window.setTimeout(() => setCopiedToken((current) => (current === value ? null : current)), 2500);
   }

  async function revokeShare(shareId: string, token: string) {
    if (!decision) return;
    setShareBusy(true);
    setError(null);
    try {
      await responseJson(await fetch(`${api}/v1/decisions/${decision.id}/shares/${shareId}`, { method: "DELETE" }));
      await loadShares(decision.id);
       setCopiedToken((current) => (current === token ? null : current));
       } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke the share link");
       } finally {
       setShareBusy(false);
       }
      }

  const sharePanel = decision ? (
    <section className="share-panel">
      <div className="section-heading compact"><div><span className="overline">Sharing</span><h2>Share a read-only record</h2></div></div>
      <p className="share-note">A share link shows the finalized decision, its premises, and revisit history. It never includes provider keys or private source artifacts. You can revoke any link at any time.</p>
      <button className="primary" disabled={shareBusy} onClick={createShare}>{shareBusy ? <><span className="spinner" />Creating link…</> : "＋ Create share link"}</button>
      {shares.length ? <div className="share-list">{shares.map((share) => <div key={share.id} className={`share-item ${share.status}`}>
        <div><strong>{share.status === "active" ? "Active link" : "Revoked"}</strong><small>{formatDate(share.created_at)}{share.expires_at ? ` · expires ${formatDate(share.expires_at)}` : " · no expiry"}</small></div>
         {share.status === "active" ? <div className="share-link"><code>{share.url}</code><div><button className="text-button" onClick={() => copyLink(share.url)}>{copiedToken === share.url ? "Copied ✓" : "Copy"}</button><button className="text-button danger" disabled={shareBusy} onClick={() => revokeShare(share.id, share.token)}>Revoke</button></div></div> : <span className="share-expired">No longer usable</span>}
       </div>)}</div> : null}
     </section>
    ) : null;

   return (
       <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">R</span><span>Rationexa</span></div>
        <button className="new-decision" onClick={resetWorkspace}>＋ New decision review</button>
        <nav aria-label="Workspace navigation">
          <button className={`nav-item ${view === "workspace" ? "active" : ""}`} onClick={() => setView("workspace")}><span>◇</span>Decision workspace</button>
          <button className={`nav-item ${view === "library" ? "active" : ""}`} onClick={() => setView("library")}><span>▤</span>Decision library</button>
        </nav>
        <div className="sidebar-note"><strong>Stage 2 workspace</strong><span>Your finalized decisions and revisit history stay available between sessions.</span></div>
      </aside>

      <main id="workspace" className="workspace">
        <header className="topbar">
          <div><span className="overline">{view === "library" ? "Persistent decision memory" : "Decision intelligence"}</span><h1>{view === "library" ? "Decision library" : draft?.title || "New decision review"}</h1></div>
          {view === "workspace" ? <div className="model-control">
            <label htmlFor="model-select">Model for next AI step</label>
            <select id="model-select" aria-label="AI model" value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)} disabled={busyPhase !== null || models.length === 0}>
              {models.length ? models.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.location}</option>) : <option>Loading models…</option>}
            </select>
            <small>{selectedModel?.best_for ?? "Loading configured model options…"}</small>
          </div> : <button className="primary" onClick={resetWorkspace}>＋ New decision</button>}
        </header>

        {view === "workspace" ? <ol className="stepper" aria-label="Decision workflow">
          {["Import", "Review", "Finalize", "Revisit"].map((label, index) => {
            const number = index + 1;
            return <li key={label} className={number === stage ? "active" : number < stage ? "complete" : ""}><span>{number < stage ? "✓" : number}</span>{label}</li>;
          })}
        </ol> : null}

        {error ? <div className="error" role="alert"><strong>Something needs attention</strong><span>{error}</span></div> : null}

        {view === "library" ? <section className="library-view">
          <div className="library-toolbar">
            <label className="library-search"><span>⌕</span><input aria-label="Search decisions" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search title, question, context, or chosen option" /></label>
            <label className="field library-filter"><span>Criticality</span><select value={libraryCriticality} onChange={(event) => setLibraryCriticality(event.target.value as "all" | Criticality)}><option value="all">All decisions</option><option value="critical">Critical</option><option value="important">Important</option><option value="routine">Routine</option></select></label>
          </div>
          <div className="library-summary"><div><strong>{library.total}</strong><span>saved decisions</span></div><p>Reopen a record to review its premises, add new evidence, or inspect previous revisit checks.</p></div>
          {libraryLoading ? <div className="library-empty"><span className="spinner dark" /><strong>Loading decision memory…</strong></div> : library.items.length ? <div className="decision-list">{library.items.map((item) => <button type="button" className="decision-row" key={item.id} onClick={() => openDecision(item.id)}>
            <div className="decision-row-main"><div><span className={`criticality-dot ${item.criticality}`} /> <span>{item.criticality}</span></div><h2>{item.title}</h2><p>{item.question}</p></div>
            <div className="decision-row-stats"><div><strong>{item.premise_count}</strong><span>premises</span></div><div><strong>{item.revisit_count}</strong><span>revisits</span></div>{item.pending_revisit_count ? <div className="pending-stat"><strong>{item.pending_revisit_count}</strong><span>need review</span></div> : null}</div>
            <div className="decision-row-date"><span>Last checked</span><strong>{formatDate(item.last_revisited_at)}</strong><small>Saved {formatDate(item.created_at)}</small></div><span className="row-arrow">→</span>
          </button>)}</div> : <div className="library-empty"><span className="library-empty-icon">▤</span><strong>{libraryQuery || libraryCriticality !== "all" ? "No matching decisions" : "Your decision memory starts here"}</strong><p>{libraryQuery || libraryCriticality !== "all" ? "Try a broader search or remove the criticality filter." : "Finalize your first decision review and it will appear here automatically."}</p><button className="primary" onClick={resetWorkspace}>Create a decision →</button></div>}
        </section> : null}

        {view === "workspace" && runningJobs.length ? <section className="job-progress" aria-live="polite"><div><strong>{runningJobs.length > 1 ? `Comparing ${runningJobs.length} models` : runningJobs[0].phase}</strong><span>{activeProgress}% average progress · You can leave this running or cancel it.</span></div><div className="job-track"><span style={{ width: `${activeProgress}%` }} /></div><button type="button" onClick={cancelActiveJobs}>Cancel {runningJobs.length > 1 ? "both" : ""}</button></section> : null}

        {view === "workspace" && !extraction && !decision ? (
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

        {view === "workspace" && extraction && draft ? (
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
              <div className="finalized-heading"><div className="finalized-check">✓</div><div><span className="overline">Finalized decision</span><h2>{decision.title}</h2><p>{decision.question}</p></div><div className="record-actions"><button className="text-button" disabled={exportBusy} onClick={downloadMarkdown}>{exportBusy ? "Preparing export…" : "Export Markdown"}</button><button className="text-button" disabled={pdfExportBusy} onClick={downloadPdf}>{pdfExportBusy ? "Preparing PDF…" : "Export PDF"}</button><button className="text-button" onClick={resetWorkspace}>New review</button></div></div>
              <div className="record-meta"><div><span>Chosen option</span><strong>{draft.chosenOption || "Not established"}</strong></div><div><span>Criticality</span><strong>{decision.criticality}</strong></div><div><span>Preserved premises</span><strong>{decision.premises.length}</strong></div><div><span>Extracted by</span><strong>{extraction.model}</strong></div></div>
              <div className="preserved-premises">{decision.premises.map((premise, index) => <div key={premise.id}><span>P{index + 1} · {premise.kind.replaceAll("_", " ")}</span><p>{premise.statement}</p></div>)}</div>
                {sharePanel}
              </section>}
            </>
        ) : null}

        {view === "workspace" && decision && !extraction ? <section className="card finalized-summary">
          <div className="finalized-heading"><div className="finalized-check">✓</div><div><span className="overline">Saved decision</span><h2>{decision.title}</h2><p>{decision.question}</p></div><div className="record-actions"><button className="text-button" disabled={exportBusy} onClick={downloadMarkdown}>{exportBusy ? "Preparing export…" : "Export Markdown"}</button><button className="text-button" disabled={pdfExportBusy} onClick={downloadPdf}>{pdfExportBusy ? "Preparing PDF…" : "Export PDF"}</button><button className="text-button" onClick={() => setView("library")}>Back to library</button></div></div>
          <div className="record-meta"><div><span>Chosen option</span><strong>{decision.chosen_option || "Not established"}</strong></div><div><span>Criticality</span><strong>{decision.criticality}</strong></div><div><span>Preserved premises</span><strong>{decision.premises.length}</strong></div><div><span>Saved</span><strong>{formatDate(decision.created_at)}</strong></div></div>
           <div className="preserved-premises">{decision.premises.map((premise, index) => <div key={premise.id}><span>P{index + 1} · {premise.kind.replaceAll("_", " ")}</span><p>{premise.statement}</p></div>)}</div>
             {sharePanel}
           </section> : null}

        {view === "workspace" && decision ? <section className="card revisit-card">
          <div className="section-heading"><div><span className="overline">Step 4 · Revisit</span><h2>What changed?</h2><p>Check one model or compare two models against the same preserved premises and evidence.</p></div><span className="decision-badge">{decision.criticality}</span></div>
          {revisitHistory.length ? <section className="history-strip"><div className="history-heading"><div><span className="overline">Revisit history</span><h3>{revisitHistory.length} previous check{revisitHistory.length === 1 ? "" : "s"}</h3></div><span>Newest first</span></div><div className="history-list">{revisitHistory.map((run) => <article key={run.id} className="history-item"><div><strong>{run.evidence_filename || "New evidence"}</strong><span>{run.provider || "unknown"}/{run.model || "unknown"} · {formatDate(run.created_at)}</span></div><div><strong>{run.findings.length}</strong><span>findings</span></div><span className={`history-status ${run.status}`}>{run.status.replaceAll("_", " ")}</span></article>)}</div></section> : null}
          <div className="mode-toggle" aria-label="Revisit mode"><button type="button" className={!compareMode ? "active" : ""} aria-pressed={!compareMode} onClick={() => { setCompareMode(false); setComparisonRuns([]); }}>Single model</button><button type="button" className={compareMode ? "active" : ""} aria-pressed={compareMode} disabled={models.length < 2} onClick={() => { setCompareMode(true); setFindings([]); }}>Compare models</button></div>
          {compareMode ? <div className="compare-models"><label className="field"><span>Model A</span><select aria-label="Comparison model A" value={selectedModelId} onChange={(event) => setSelectedModelId(event.target.value)} disabled={busyPhase !== null}>{models.map((model) => <option key={model.id} value={model.id} disabled={model.id === comparisonModelId}>{model.label} · {model.location}</option>)}</select></label><div className="versus">VS</div><label className="field"><span>Model B</span><select aria-label="Comparison model B" value={comparisonModelId} onChange={(event) => setComparisonModelId(event.target.value)} disabled={busyPhase !== null}>{models.map((model) => <option key={model.id} value={model.id} disabled={model.id === selectedModelId}>{model.label} · {model.location}</option>)}</select></label></div> : null}
          <label className="field"><span>New evidence</span><textarea aria-label="New evidence" value={evidence} onChange={(event) => { setEvidence(event.target.value); setRevisitCompleted(false); setFindings([]); setComparisonRuns([]); setActiveRevisitId(null); }} rows={5} /></label>
          <div className="form-footer"><span>{compareMode ? "Both models receive identical premises and evidence." : "This check flags relationships; it does not overturn the decision."}</span><button className="primary" onClick={revisit} disabled={busyPhase === "revisit" || !selectedModelId || (compareMode && !comparisonModelId) || !evidence.trim()}>{busyPhase === "revisit" ? <><span className="spinner" />{compareMode ? "Comparing models…" : `Checking with ${selectedModel?.label ?? "model"}…`}</> : compareMode ? "Compare model reasoning →" : "Check against premises →"}</button></div>
          {comparisonRuns.length === 2 ? <div className="comparison-results"><section className={`disagreement-summary ${disagreements.length ? "has-disagreements" : ""}`}><div><span className="overline">Agreement check</span><h3>{disagreements.length ? `${disagreements.length} disagreement${disagreements.length === 1 ? "" : "s"} need review` : "Models agree on all material relationships"}</h3></div>{disagreements.length ? <div className="disagreement-list">{disagreements.map(({ premise, firstRelationship, secondRelationship }) => <div key={premise.id}><strong>{premise.statement}</strong><span>{comparisonRuns[0].label}: {firstRelationship} · {comparisonRuns[1].label}: {secondRelationship}</span></div>)}</div> : null}</section><div className="comparison-grid">{comparisonRuns.map((run) => <section className="comparison-column" key={run.modelId}><header><div><span className="overline">Model result</span><h3>{run.label}</h3></div><strong>{run.result.findings.length} finding{run.result.findings.length === 1 ? "" : "s"}</strong></header><div className="run-provenance">{provenanceLabel(run.result)}</div>{run.result.findings.length ? run.result.findings.map((finding) => <article key={finding.premise_id} className={`finding ${finding.relationship}`}><div className="finding-status"><span>{finding.finding_type === "new_constraint" ? "new constraint" : finding.relationship}</span><small>{finding.confidence_band} confidence</small></div>{finding.finding_type === "new_constraint" ? <div className="safety-net-badge">New constraint · human review required</div> : null}<h3>{finding.premise_statement}</h3><p>{finding.explanation}</p><blockquote>{finding.new_excerpt}</blockquote></article>) : <div className="empty-findings"><strong>No material relationship found</strong><span>This model found no effect on the preserved premises.</span></div>}</section>)}</div></div> : null}
          {!comparisonRuns.length && findings.length ? <div className="findings">
            <div className="findings-heading"><h3>Review findings</h3><span>{findings.length} material relationship{findings.length === 1 ? "" : "s"} found · {lastRevisitModel}</span></div>
            {lastRevisitProvenance ? <div className="finding-provenance">Run provenance: {lastRevisitProvenance}</div> : null}
            {findings.map((finding) => <article key={finding.premise_id} className={`finding ${finding.relationship}`}>
              <div className="finding-status"><span>{finding.finding_type === "new_constraint" ? "new constraint" : finding.relationship}</span><small>{finding.confidence_band} confidence</small></div>
              {finding.finding_type === "new_constraint" ? <div className="safety-net-badge">New constraint · human review required</div> : finding.detection_source === "deterministic_safety_net" ? <div className="safety-net-badge">Safety-net candidate · human confirmation required</div> : null}
              <h3>{finding.premise_statement}</h3><p>{finding.explanation}</p><blockquote>{finding.new_excerpt}</blockquote>
              {finding.source_fallback_performed ? <div className="finding-provenance">Original source anchor verified</div> : null}
              {finding.missing_context_question ? <div className="missing-context">Question: {finding.missing_context_question}</div> : null}
              <div className="judgment-panel" aria-label="Record your judgment">
                <span>{finding.human_judgment ? "Judgment saved" : "Does this finding deserve action?"}</span>
                <div>{([
                  ["worth_reviewing", "Worth reviewing"],
                  ["not_material", "Not material"],
                  ["needs_context", "Needs context"],
                  ["false_positive", "False positive"],
                ] as [FindingJudgment, string][]).map(([value, label]) => <button type="button" key={value} className={finding.human_judgment === value ? "active" : ""} disabled={judgmentBusy === finding.premise_id} onClick={() => recordFindingJudgment(finding.premise_id, value)}>{label}</button>)}</div>
              </div>
            </article>)}
          </div> : !comparisonRuns.length && revisitCompleted ? <div className="empty-findings"><strong>No material relationship found</strong><span>{lastRevisitModel} found no material effect on the consequential premises preserved in this decision.</span>{lastRevisitProvenance ? <span>Run provenance: {lastRevisitProvenance}</span> : null}</div> : null}
        </section> : null}
      </main>
    </div>
  );
}
