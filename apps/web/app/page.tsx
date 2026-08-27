"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUp, ChartNoAxesColumn, Check, ChevronDown, ChevronLeft, ChevronRight, Circle, CircleAlert, CircleDollarSign, Clock3, Cpu, Diamond, FileDown, FileText, Library, ListChecks, Plus, Save, Sparkles, Trash2 } from "lucide-react";

type Criticality = "routine" | "important" | "critical";
type ReviewAction = "confirm" | "unknown" | "reject";
type FindingJudgment = "worth_reviewing" | "not_material" | "needs_context" | "false_positive";
type WorkflowStep = 1 | 2 | 3 | 4;

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
  challenge?: DecisionChallenge | null;
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
   old_excerpt?: string;
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
type ChallengePoint = { premise_id: string; premise_statement: string; source_excerpt?: string; prompt: string; explanation: string };
type DecisionChallenge = {
  status: "draft" | "confirmed";
  weakest_assumption: ChallengePoint;
  missing_evidence: ChallengePoint;
  strongest_counterargument: ChallengePoint;
  reversal_condition: ChallengePoint;
  provider: string;
  model: string;
  prompt_version: string;
  latency_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  generated_at: string;
  confirmed_at?: string;
  reviewer_notes?: string;
};
type Job = { id: string; kind: "extraction" | "revisit" | "challenge"; status: "queued" | "running" | "succeeded" | "failed" | "cancelled"; phase: string; progress: number; result?: unknown; error?: string };
type RevisitResult = { id: string; decision_id: string; status: string; findings: Finding[]; provider?: string; model?: string; prompt_version?: string; latency_ms?: number; input_tokens?: number; output_tokens?: number; estimated_cost_usd?: number; evidence_filename?: string; created_at: string };
type ComparisonRun = { modelId: string; label: string; result: RevisitResult };
type Share = { id: string; decision_id: string; token: string; status: string; url: string | null; created_at: string; expires_at: string | null; revoked_at: string | null };
type AuditEvent = { id: string; kind: "decision" | "challenge" | "evidence" | "judgment"; title: string; detail: string; timestamp: string };
type UsageRun = { id: string; kind: "extraction" | "revisit" | "challenge"; provider: string; model: string; prompt_version: string; location: "local" | "hosted" | "unknown"; latency_ms?: number; input_tokens?: number; output_tokens?: number; estimated_cost_usd?: number; created_at: string; decision_id?: string };
type UsageModel = { provider: string; model: string; location: "local" | "hosted" | "unknown"; run_count: number; total_tokens: number; known_cost_usd: number; unpriced_run_count: number; average_latency_ms?: number };
type UsageSummary = { total_runs: number; extraction_runs: number; revisit_runs: number; challenge_runs: number; local_runs: number; hosted_runs: number; unknown_location_runs: number; total_tokens: number; tokenized_run_count: number; known_cost_usd: number; unpriced_run_count: number; models: UsageModel[]; recent_runs: UsageRun[] };

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

function formatDateTime(value?: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

type ActionIconName = "markdown" | "pdf" | "delete" | "back";

function ActionIcon({ name }: { name: ActionIconName }) {
  if (name === "delete") return <Trash2 className="action-icon" aria-hidden="true" />;
  if (name === "back") return <ArrowLeft className="action-icon" aria-hidden="true" />;
  if (name === "pdf") return <FileDown className="action-icon" aria-hidden="true" />;
  return <FileText className="action-icon" aria-hidden="true" />;
}

function LibraryNavIcon({ value }: { value: "all" | Criticality }) {
  if (value === "critical") return <CircleAlert aria-hidden="true" />;
  if (value === "important") return <Diamond aria-hidden="true" />;
  if (value === "routine") return <Circle aria-hidden="true" />;
  return <Library aria-hidden="true" />;
}

type ModelPickerProps = {
  models: ModelOption[];
  selectedId: string;
  recommendedId: string;
  onSelect: (modelId: string) => void;
  disabled?: boolean;
  excludeId?: string;
  compact?: boolean;
  label?: string;
};

function ModelPicker({ models, selectedId, recommendedId, onSelect, disabled = false, excludeId, compact = false, label = "Model for next AI step" }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = models.find((model) => model.id === selectedId);
  const recommended = models.find((model) => model.id === recommendedId);
  const localModels = models.filter((model) => model.location === "local");
  const hostedModels = models.filter((model) => model.location === "hosted");

  function choose(modelId: string) {
    onSelect(modelId);
    setOpen(false);
  }

  const modelOption = (model: ModelOption, recommendedOption = false) => {
    const unavailable = model.id === excludeId;
    return <button type="button" role="option" aria-selected={model.id === selectedId} className={`model-option ${model.id === selectedId ? "selected" : ""}`} disabled={unavailable} onClick={() => choose(model.id)} key={`${recommendedOption ? "recommended" : "model"}-${model.id}`}>
      <span className="model-avatar">{model.label.slice(0, 1).toUpperCase()}</span>
      <span className="model-option-copy"><span><strong>{model.label}</strong>{recommendedOption ? <em>Recommended</em> : null}</span><small>{model.best_for}</small><span className="model-option-meta">{model.location === "local" ? "Private local runtime" : `${model.provider} hosted API`}</span></span>
      <span className="model-check">{model.id === selectedId ? <Check aria-hidden="true" /> : null}</span>
    </button>;
  };

  return <div className={`model-picker ${compact ? "compact" : ""} ${open ? "open" : ""}`}>
    <button type="button" className="model-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={disabled || !models.length} onClick={() => setOpen((current) => !current)}>
      <span className="model-trigger-icon"><Sparkles aria-hidden="true" /></span><span><small>{label}</small><strong>{selected?.label ?? "Loading models…"}</strong></span><span className="model-location">{selected?.location ?? ""}</span><span className="model-chevron"><ChevronDown aria-hidden="true" /></span>
    </button>
    {open ? <><button type="button" className="model-picker-scrim" aria-label="Close model menu" onClick={() => setOpen(false)} /><section className="model-menu" role="listbox" aria-label="Available AI models">
      <header><div><span className="overline">AI runtime</span><h3>Choose a model</h3></div><button type="button" aria-label="Close model menu" onClick={() => setOpen(false)}>×</button></header>
      {recommended ? <div className="model-group"><span>Recommended for this workspace</span>{modelOption(recommended, true)}</div> : null}
      {localModels.length ? <div className="model-group"><span>Local models</span>{localModels.map((model) => modelOption(model))}</div> : null}
      {hostedModels.length ? <div className="model-group"><span>Hosted models</span>{hostedModels.map((model) => modelOption(model))}</div> : null}
      <footer><span className="runtime-dot" />Only configured and available models are shown.</footer>
    </section></> : null}
  </div>;
}

export default function Home() {
  const [view, setView] = useState<"workspace" | "library" | "usage">("workspace");
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
  const [busyPhase, setBusyPhase] = useState<"extract" | "finalize" | "revisit" | "challenge" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [recommendedModelId, setRecommendedModelId] = useState("");
  const [lastRevisitModel, setLastRevisitModel] = useState<string | null>(null);
  const [lastRevisitProvenance, setLastRevisitProvenance] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [comparisonModelId, setComparisonModelId] = useState("");
  const [comparisonRuns, setComparisonRuns] = useState<ComparisonRun[]>([]);
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  const [activeRevisitId, setActiveRevisitId] = useState<string | null>(null);
  const [judgmentBusy, setJudgmentBusy] = useState<string | null>(null);
  const [judgmentNotes, setJudgmentNotes] = useState<Record<string, string>>({});
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
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [confirmingDeleteFor, setConfirmingDeleteFor] = useState<string | null>(null);
  const [deleteTitle, setDeleteTitle] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmingShareDelete, setConfirmingShareDelete] = useState<Share | null>(null);
  const [shareDeleteBusy, setShareDeleteBusy] = useState(false);
  const [workflowView, setWorkflowView] = useState<WorkflowStep>(1);
  const [libraryPaneCollapsed, setLibraryPaneCollapsed] = useState(false);
  const [workflowPaneCollapsed, setWorkflowPaneCollapsed] = useState(false);
  const [auditExpanded, setAuditExpanded] = useState(true);
  const [challenge, setChallenge] = useState<DecisionChallenge | null>(null);
  const [challengeNotes, setChallengeNotes] = useState("");
  const [challengeConfirmBusy, setChallengeConfirmBusy] = useState(false);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${api}/v1/models`)
      .then(responseJson)
      .then((catalog: ModelCatalog) => {
        if (cancelled) return;
        setModels(catalog.models);
        setRecommendedModelId(catalog.default_model_id);
        setSelectedModelId((current) => current || catalog.default_model_id);
        setComparisonModelId((current) => current || catalog.models.find((model) => model.id !== catalog.default_model_id)?.id || "");
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load model options");
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!compareMode || !selectedModelId) return;
    setComparisonModelId((current) => {
      if (current && current !== selectedModelId) return current;
      return models.find((model) => model.id !== selectedModelId)?.id ?? "";
    });
  }, [compareMode, models, selectedModelId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLibrary();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [libraryQuery, libraryCriticality]);

  useEffect(() => {
    if (view === "usage") void loadUsage();
  }, [view]);

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
  const auditEvents = useMemo<AuditEvent[]>(() => {
    if (!decision) return [];
    const events: AuditEvent[] = [{
      id: `decision-${decision.id}`,
      kind: "decision",
      title: "Decision finalized",
      detail: `${decision.premises.length} human-reviewed premise${decision.premises.length === 1 ? "" : "s"} preserved · ${decision.criticality} criticality`,
      timestamp: decision.created_at,
    }];
    if (challenge?.status === "confirmed" && challenge.confirmed_at) {
      events.push({
        id: `challenge-${decision.id}`,
        kind: "challenge",
        title: "Challenge brief confirmed",
        detail: challenge.reviewer_notes || `Reviewed with ${challenge.provider}/${challenge.model}`,
        timestamp: challenge.confirmed_at,
      });
    }
    revisitHistory.forEach((run) => {
      events.push({
        id: `evidence-${run.id}`,
        kind: "evidence",
        title: run.evidence_filename || "New evidence checked",
        detail: `${run.findings.length} finding${run.findings.length === 1 ? "" : "s"} · ${run.provider || "unknown"}/${run.model || "unknown"} · ${run.status.replaceAll("_", " ")}`,
        timestamp: run.created_at,
      });
      run.findings.forEach((finding, index) => {
        if (!finding.human_judgment || !finding.judged_at) return;
        events.push({
          id: `judgment-${run.id}-${finding.premise_id}-${index}`,
          kind: "judgment",
          title: `Human review: ${finding.human_judgment.replaceAll("_", " ")}`,
          detail: finding.human_notes || finding.premise_statement,
          timestamp: finding.judged_at,
        });
      });
    });
    return events.sort((first, second) => new Date(first.timestamp).getTime() - new Date(second.timestamp).getTime());
  }, [challenge, decision, revisitHistory]);
  const findingReviewProgress = useMemo(() => {
    const total = revisitHistory.reduce((count, run) => count + run.findings.length, 0);
    const reviewed = revisitHistory.reduce((count, run) => count + run.findings.filter((finding) => finding.human_judgment).length, 0);
    return { total, reviewed, pending: total - reviewed, percent: total ? Math.round((reviewed / total) * 100) : 100 };
  }, [revisitHistory]);
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
    setChallenge(null);
    setChallengeNotes("");
    setWorkflowView(2);
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
      setChallenge(saved.challenge ?? null);
      setRevisitHistory([]);
      setWorkflowView(3);
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

  async function generateChallenge() {
    if (!decision) return;
    setBusyPhase("challenge");
    setError(null);
    try {
      const created = await responseJson(await fetch(`${api}/v1/decisions/${decision.id}/challenge-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: selectedModelId || undefined }),
      })) as Job;
      const completed = await waitForJob(created);
      const next = completed.result as DecisionChallenge;
      setChallenge(next);
      setDecision((current) => current ? { ...current, challenge: next } : current);
      setChallengeNotes("");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Challenge generation failed";
      if (message !== "Operation cancelled") setError(message);
    } finally {
      setBusyPhase(null);
    }
  }

  async function confirmChallenge() {
    if (!decision || !challenge) return;
    setChallengeConfirmBusy(true);
    setError(null);
    try {
      const confirmed = await responseJson(await fetch(`${api}/v1/decisions/${decision.id}/challenge/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: challengeNotes || null }),
      })) as DecisionChallenge;
      setChallenge(confirmed);
      setDecision((current) => current ? { ...current, challenge: confirmed } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not confirm the challenge brief");
    } finally {
      setChallengeConfirmBusy(false);
    }
  }

  async function recordFindingJudgment(revisitId: string, premiseId: string, judgment: FindingJudgment) {
    const reviewKey = `${revisitId}:${premiseId}`;
    setJudgmentBusy(reviewKey);
    setError(null);
    try {
      const updated = await responseJson(await fetch(`${api}/v1/revisit-checks/${revisitId}/findings/${premiseId}/judgment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ judgment, notes: judgmentNotes[reviewKey] || null }),
      })) as RevisitResult;
      if (activeRevisitId === updated.id) setFindings(updated.findings);
      setRevisitHistory((current) => current.map((item) => item.id === updated.id ? updated : item));
      setJudgmentNotes((current) => ({ ...current, ...Object.fromEntries(updated.findings.map((finding) => [`${updated.id}:${finding.premise_id}`, finding.human_notes || ""])) }));
      void loadLibrary();
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

  async function loadUsage() {
    setUsageLoading(true);
    setError(null);
    try {
      setUsage(await responseJson(await fetch(`${api}/v1/usage`)) as UsageSummary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load workspace usage");
    } finally {
      setUsageLoading(false);
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
      setChallenge(record.challenge ?? null);
      setChallengeNotes(record.challenge?.reviewer_notes ?? "");
      setDraft({ title: record.title, question: record.question, context: record.context, chosenOption: record.chosen_option ?? "", rationale: record.rationale });
       setRevisitHistory(history);
       setExtraction(null);
       setFindings([]);
       setComparisonRuns([]);
       setRevisitCompleted(false);
       setActiveRevisitId(null);
       setEvidence("");
       setLibraryQuery("");
       setConfirmingDeleteFor(null);
       setExpandedHistoryId(null);
       setWorkflowView(4);
       setWorkflowPaneCollapsed(false);
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
    setConfirmingShareDelete(null);
    setChallenge(null);
    setChallengeNotes("");
    setWorkflowPaneCollapsed(false);
    setWorkflowView(1);
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

  async function deleteShareRecord() {
    if (!decision || !confirmingShareDelete) return;
    setShareDeleteBusy(true);
    setError(null);
    try {
      const response = await fetch(`${api}/v1/decisions/${decision.id}/shares/${confirmingShareDelete.id}/record`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? `Delete failed with status ${response.status}`);
      }
      setShares((current) => current.filter((share) => share.id !== confirmingShareDelete.id));
      setConfirmingShareDelete(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the share record");
    } finally {
      setShareDeleteBusy(false);
    }
  }

  async function deleteDecision(targetId: string) {
    setDeleteBusy(true);
    setError(null);
    try {
      const response = await fetch(`${api}/v1/decisions/${targetId}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? `Delete failed with status ${response.status}`);
         }
      if (view === "workspace") {
        setDecision(null);
        setExtraction(null);
        setFindings([]);
        setComparisonRuns([]);
        setRevisitHistory([]);
        setRevisitCompleted(false);
        setExpandedHistoryId(null);
        setShares([]);
        }
      setConfirmingDeleteFor(null);
      setDeleteTitle(null);
      setView("library");
      await loadLibrary();
       } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete this decision");
       } finally {
      setDeleteBusy(false);
       }
       }

  function findingReviewControls(revisitId: string, finding: Finding) {
    const reviewKey = `${revisitId}:${finding.premise_id}`;
    const noteValue = judgmentNotes[reviewKey] ?? finding.human_notes ?? "";
    const busy = judgmentBusy === reviewKey;
    return <div className={`judgment-panel ${finding.human_judgment ? "reviewed" : "pending"}`} role="group" aria-label="Human finding review">
      <header><span>{finding.human_judgment ? "Human review recorded" : "Human decision required"}</span>{finding.judged_at ? <time dateTime={finding.judged_at}>{formatDateTime(finding.judged_at)}</time> : null}</header>
      <label><span>Reviewer notes <small>Optional</small></span><textarea aria-label={`Reviewer notes for ${finding.premise_statement}`} rows={2} maxLength={4000} value={noteValue} onChange={(event) => setJudgmentNotes((current) => ({ ...current, [reviewKey]: event.target.value }))} placeholder="Record why this finding matters, what was checked, or what should happen next…" /></label>
      <div className="judgment-actions">{([
        ["worth_reviewing", "Worth reviewing"],
        ["not_material", "Not material"],
        ["needs_context", "Needs context"],
        ["false_positive", "False positive"],
      ] as [FindingJudgment, string][]).map(([value, label]) => <button type="button" key={value} className={finding.human_judgment === value ? "active" : ""} disabled={busy} onClick={() => recordFindingJudgment(revisitId, finding.premise_id, value)}>{label}</button>)}</div>
      {finding.human_judgment ? <button type="button" className="save-review" disabled={busy} onClick={() => recordFindingJudgment(revisitId, finding.premise_id, finding.human_judgment!)}><Save aria-hidden="true" />{busy ? "Saving…" : "Save note changes"}</button> : null}
    </div>;
  }

  const challengePanel = decision ? (
    <section className={`challenge-panel ${challenge?.status ?? "empty"}`}>
      <header className="challenge-heading">
        <div><span className="overline">Lightweight challenge</span><h2>Pressure-test the decision</h2><p>Surface the questions most likely to reveal a weak premise. AI proposes; a human confirms.</p></div>
        <span className={`challenge-status ${challenge?.status ?? "empty"}`}>{challenge?.status === "confirmed" ? <><Check aria-hidden="true" />Human confirmed</> : challenge ? "Human confirmation required" : "Not generated"}</span>
      </header>
      {challenge ? <>
        <div className="challenge-grid">{([
          ["weakest_assumption", "Weakest assumption"],
          ["missing_evidence", "Missing evidence"],
          ["strongest_counterargument", "Strongest counterargument"],
          ["reversal_condition", "Reversal condition"],
        ] as [keyof Pick<DecisionChallenge, "weakest_assumption" | "missing_evidence" | "strongest_counterargument" | "reversal_condition">, string][]).map(([key, label]) => {
          const point = challenge[key];
          return <article key={key}><span>{label}</span><h3>{point.prompt}</h3><p>{point.explanation}</p><div><small>Grounded in preserved premise</small><blockquote>{point.source_excerpt || point.premise_statement}</blockquote></div></article>;
        })}</div>
        <div className="challenge-provenance"><span>{challenge.provider}/{challenge.model} · {challenge.prompt_version} · {challenge.latency_ms ?? 0} ms</span><span>Generated {formatDateTime(challenge.generated_at)}</span></div>
        {challenge.status === "draft" ? <div className="challenge-confirm"><label><span>Reviewer notes <small>Optional</small></span><textarea rows={2} maxLength={4000} value={challengeNotes} onChange={(event) => setChallengeNotes(event.target.value)} placeholder="Record what you verified, what remains open, or why these challenge prompts are useful…" /></label><div><p>Confirming records that a person reviewed the prompts. It does not approve or reverse the decision.</p><button type="button" className="primary" disabled={challengeConfirmBusy} onClick={confirmChallenge}>{challengeConfirmBusy ? "Saving confirmation…" : <><Check aria-hidden="true" />Confirm reviewed challenge</>}</button></div></div> : <div className="challenge-confirmed"><Check aria-hidden="true" /><div><strong>Reviewed by a human {challenge.confirmed_at ? `· ${formatDateTime(challenge.confirmed_at)}` : ""}</strong>{challenge.reviewer_notes ? <p>{challenge.reviewer_notes}</p> : <p>No reviewer note was added.</p>}</div></div>}
      </> : <div className="challenge-empty"><span><Sparkles aria-hidden="true" /></span><div><strong>Generate four source-grounded challenge prompts</strong><p>The selected model will inspect only the preserved premises. It will not browse, change the decision, or run a multi-agent debate.</p></div><button type="button" className="primary" disabled={busyPhase !== null || !selectedModelId} onClick={generateChallenge}>{busyPhase === "challenge" ? <><span className="spinner" />Generating challenge…</> : <><Sparkles aria-hidden="true" />Generate challenge brief</>}</button></div>}
    </section>
  ) : null;

  const sharePanel = decision ? (
    <section className="share-panel">
      <div className="section-heading compact"><div><span className="overline">Sharing</span><h2>Share a read-only record</h2></div></div>
      <p className="share-note">A share link shows the finalized decision, its premises, and revisit history. It never includes provider keys or private source artifacts. New links expire automatically and can be revoked at any time.</p>
      <button className="primary" disabled={shareBusy} onClick={createShare}>{shareBusy ? <><span className="spinner" />Creating link…</> : <><Plus aria-hidden="true" />Create share link</>}</button>
      {shares.length ? <div className="share-list">{shares.map((share) => <div key={share.id} className={`share-item ${share.status}`}>
        <div><strong>{share.status === "active" ? "Active link" : "Revoked"}</strong><small>{formatDate(share.created_at)}{share.expires_at ? ` · expires ${formatDate(share.expires_at)}` : " · no expiry"}</small></div>
         {share.status === "active" ? <div className="share-link"><code>{share.url}</code><div><button className="text-button" onClick={() => copyLink(share.url)}>{copiedToken === share.url ? "Copied ✓" : "Copy"}</button><button className="text-button danger" disabled={shareBusy} onClick={() => revokeShare(share.id, share.token)}>Revoke</button></div></div> : <div className="share-retired-actions"><span className="share-expired">No longer usable</span><button type="button" className="share-delete icon-action" data-tooltip="Delete share record" aria-label="Delete revoked share record" onClick={() => setConfirmingShareDelete(share)}><ActionIcon name="delete" /></button></div>}
       </div>)}</div> : null}
     </section>
    ) : null;

  const recordActions = decision ? (
    <div className="record-actions" aria-label="Decision actions">
      <button type="button" className="record-action icon-action" data-tooltip={exportBusy ? "Preparing Markdown…" : "Export Markdown"} aria-label={exportBusy ? "Preparing Markdown export" : "Export Markdown"} disabled={exportBusy} onClick={downloadMarkdown}><ActionIcon name="markdown" /></button>
      <button type="button" className="record-action icon-action" data-tooltip={pdfExportBusy ? "Preparing PDF…" : "Export PDF"} aria-label={pdfExportBusy ? "Preparing PDF export" : "Export PDF"} disabled={pdfExportBusy} onClick={downloadPdf}><ActionIcon name="pdf" /></button>
      <button type="button" className="record-action icon-action danger" data-tooltip="Delete record" aria-label="Delete record" onClick={() => { setDeleteTitle(decision.title); setConfirmingDeleteFor(decision.id); }}><ActionIcon name="delete" /></button>
      <button type="button" className="record-action icon-action" data-tooltip="Back to library" aria-label="Back to library" onClick={() => setView("library")}><ActionIcon name="back" /></button>
    </div>
  ) : null;

   return (
       <div className={`app-shell ${libraryPaneCollapsed ? "library-collapsed" : ""} ${workflowPaneCollapsed ? "workflow-collapsed" : ""}`}>
      <aside className="sidebar library-pane">
        <header className="pane-brand"><div className="brand" data-tooltip="Rationexa"><span className="brand-mark">R</span><span className="pane-label">Rationexa</span></div></header>
        <button className="new-decision" data-tooltip="New decision review" onClick={resetWorkspace}><Plus aria-hidden="true" /><span className="pane-label">New decision review</span></button>
        <div className="pane-section pane-label"><span className="pane-kicker">Decision libraries</span></div>
        <nav className="library-nav" aria-label="Decision libraries">
          {(["all", "critical", "important", "routine"] as ("all" | Criticality)[]).map((value) => {
            const label = value === "all" ? "All decisions" : value[0].toUpperCase() + value.slice(1);
            return <button type="button" key={value} className={`nav-item ${view === "library" && libraryCriticality === value ? "active" : ""}`} data-tooltip={label} aria-label={label} onClick={() => { setLibraryCriticality(value); setView("library"); }}><span className="nav-icon"><LibraryNavIcon value={value} /></span><span className="pane-label">{label}</span>{value === "all" && libraryCriticality === "all" ? <small className="pane-label">{library.total}</small> : null}</button>;
          })}
          <button type="button" className={`nav-item usage-nav ${view === "usage" ? "active" : ""}`} data-tooltip="Usage and cost" aria-label="Usage and cost" onClick={() => setView("usage")}><span className="nav-icon"><ChartNoAxesColumn aria-hidden="true" /></span><span className="pane-label">Usage &amp; cost</span></button>
        </nav>
        <section className="decision-conversations pane-label" aria-label="Saved decisions">
          <div className="pane-section-heading"><span>Decision conversations</span>{libraryLoading ? <span className="spinner dark" /> : null}</div>
          <div className="conversation-list">{library.items.length ? library.items.map((item) => <button type="button" key={item.id} className={`conversation-row ${decision?.id === item.id ? "active" : ""}`} onClick={() => openDecision(item.id)}><span className={`conversation-dot ${item.criticality}`} /><span><strong>{item.title}</strong><small>{item.last_revisited_at ? formatDateTime(item.last_revisited_at) : `${item.premise_count} premises · not revisited`}</small></span>{item.pending_revisit_count ? <em>{item.pending_revisit_count}</em> : null}</button>) : <p>No saved decisions in this library.</p>}</div>
        </section>
      </aside>

      <button type="button" className="library-toggle" data-tooltip={libraryPaneCollapsed ? "Show decision libraries" : "Hide decision libraries"} aria-label={libraryPaneCollapsed ? "Expand decision libraries" : "Collapse decision libraries"} aria-expanded={!libraryPaneCollapsed} onClick={() => setLibraryPaneCollapsed((current) => !current)}><span>{libraryPaneCollapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}</span></button>
      <div className={`workbench-shell ${view !== "workspace" ? "library-overview" : ""}`}>
      <button type="button" className="workflow-toggle" data-tooltip={workflowPaneCollapsed ? "Show decision workflow" : "Hide decision workflow"} aria-label={workflowPaneCollapsed ? "Expand workflow" : "Collapse workflow"} aria-expanded={!workflowPaneCollapsed} onClick={() => setWorkflowPaneCollapsed((current) => !current)}><span>{workflowPaneCollapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}</span></button>
      <aside className="workflow-pane">
        <header className="workflow-pane-header"><div className="pane-label"><span className="pane-kicker">Decision workflow</span><strong>{view === "workspace" ? draft?.title || decision?.title || "New review" : "Select a decision"}</strong></div></header>
        <ol className="workflow-steps" aria-label="Decision workflow">
          {(["Import", "Review", "Finalize", "Revisit"] as const).map((label, index) => {
            const number = (index + 1) as WorkflowStep;
            const available = view === "workspace" && number <= stage;
            return <li key={label} className={number === workflowView && view === "workspace" ? "active" : number < stage ? "complete" : ""}><button type="button" disabled={!available} aria-current={number === workflowView && view === "workspace" ? "step" : undefined} aria-label={label} onClick={() => { setView("workspace"); setWorkflowView(number); }}><span>{number < stage ? <Check aria-hidden="true" /> : number}</span><span className="pane-label"><strong>{label}</strong><small>{label === "Import" ? "Original decision source" : label === "Review" ? "Human premise review" : label === "Finalize" ? "Saved record and sharing" : "Evidence conversations"}</small></span></button></li>;
          })}
        </ol>
        {decision ? <section className="workflow-conversations pane-label"><div className="pane-section-heading"><span>Revisit conversations</span><small>{revisitHistory.length}</small></div>{revisitHistory.length ? <div>{revisitHistory.map((run) => <button type="button" key={run.id} className={expandedHistoryId === run.id ? "active" : ""} onClick={() => { setView("workspace"); setWorkflowView(4); setExpandedHistoryId(run.id); }}><span className="workflow-conversation-copy"><strong>{run.evidence_filename || "New evidence"}</strong><small>{formatDateTime(run.created_at)}</small></span><em>{run.findings.length}</em></button>)}</div> : <p>No evidence checks yet.</p>}</section> : <div className="workflow-empty pane-label"><ListChecks aria-hidden="true" /><strong>{view === "library" ? "Choose a conversation" : "Start with Import"}</strong><p>{view === "library" ? "Select a saved decision from the library to inspect its workflow." : "Bring in a decision source to begin."}</p></div>}
        <button type="button" className="workflow-library-link" onClick={() => setView("library")}><Library aria-hidden="true" /><span className="pane-label">Open library overview</span></button>
      </aside>

      <main id="workspace" className="workspace">
        <header className="topbar">
          <div><span className="overline">{view === "library" ? "Decision memory / Library" : view === "usage" ? "Workspace / Usage" : `Decision memory / ${workflowView === 1 ? "Import" : workflowView === 2 ? "Review" : workflowView === 3 ? "Finalize" : "Revisit"}`}</span><h1>{view === "library" ? "Decision library" : view === "usage" ? "Usage & cost" : draft?.title || decision?.title || "New decision review"}</h1></div>
          {view === "workspace" ? <ModelPicker models={models} selectedId={selectedModelId} recommendedId={recommendedModelId} onSelect={setSelectedModelId} disabled={busyPhase !== null} /> : null}
        </header>

        {error ? <div className="error" role="alert"><strong>Something needs attention</strong><span>{error}</span></div> : null}

        {view === "library" ? <section className="library-view">
          <div className="library-toolbar">
            <label className="library-search"><span>⌕</span><input aria-label="Search decisions" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search title, question, context, or chosen option" /></label>
          </div>
          <div className="library-summary"><div><strong>{library.total}</strong><span>saved decisions</span></div><p>Reopen a record to review its premises, add new evidence, or inspect previous revisit checks.</p></div>
{libraryLoading ? <div className="library-empty"><span className="spinner dark" /><strong>Loading decision memory…</strong></div> : library.items.length ? <div className="decision-list">{library.items.map((item) => <div className="decision-card" key={item.id}>
            <button type="button" className="decision-row" onClick={() => openDecision(item.id)}>
              <div className="decision-row-main"><div><span className={`criticality-dot ${item.criticality}`} /> <span>{item.criticality}</span></div><h2>{item.title}</h2><p>{item.question}</p></div>
              <div className="decision-row-stats"><div><strong>{item.premise_count}</strong><span>premises</span></div><div><strong>{item.revisit_count}</strong><span>revisits</span></div>{item.pending_revisit_count ? <div className="pending-stat"><strong>{item.pending_revisit_count}</strong><span>need review</span></div> : null}</div>
              <div className="decision-row-date"><span>Last checked</span><strong>{item.last_revisited_at ? formatDateTime(item.last_revisited_at) : "Not revisited"}</strong><small>Saved {formatDateTime(item.created_at)}</small></div><span className="row-arrow">→</span>
            </button>
            <button type="button" className="decision-row-delete icon-action" data-tooltip="Delete decision" aria-label={`Delete ${item.title}`} onClick={() => { setDeleteTitle(item.title); setConfirmingDeleteFor(item.id); }}><ActionIcon name="delete" /></button>
          </div>)}</div> : <div className="library-empty"><span className="library-empty-icon"><Library aria-hidden="true" /></span><strong>{libraryQuery || libraryCriticality !== "all" ? "No matching decisions" : "Your decision memory starts here"}</strong><p>{libraryQuery || libraryCriticality !== "all" ? "Try a broader search or remove the criticality filter." : "Finalize your first decision review and it will appear here automatically."}</p><button className="primary" onClick={resetWorkspace}>Create a decision →</button></div>}
        </section> : null}

        {view === "usage" ? <section className="usage-view">
          <div className="usage-intro"><span className="usage-intro-icon"><ChartNoAxesColumn aria-hidden="true" /></span><div><strong>Workspace AI activity</strong><p>Usage is calculated from persisted extraction, revisit, and challenge provenance. Known cost excludes runs whose provider did not report a price.</p></div><button type="button" className="text-button" disabled={usageLoading} onClick={loadUsage}>{usageLoading ? "Refreshing…" : "Refresh usage"}</button></div>
          {usageLoading && !usage ? <div className="library-empty"><span className="spinner dark" /><strong>Calculating workspace usage…</strong></div> : usage ? <>
            <div className="usage-summary-grid">
              <article><span><Cpu aria-hidden="true" />AI runs</span><strong>{formatNumber(usage.total_runs)}</strong><p>{usage.extraction_runs} extraction · {usage.revisit_runs} revisit · {usage.challenge_runs} challenge</p></article>
              <article><span><CircleDollarSign aria-hidden="true" />Known estimated cost</span><strong>${usage.known_cost_usd.toFixed(4)}</strong><p>{usage.unpriced_run_count ? `${usage.unpriced_run_count} run${usage.unpriced_run_count === 1 ? " is" : "s are"} not included because pricing was unavailable` : "Every recorded run includes a cost estimate"}</p></article>
              <article><span><ChartNoAxesColumn aria-hidden="true" />Recorded tokens</span><strong>{formatNumber(usage.total_tokens)}</strong><p>Token counts available for {usage.tokenized_run_count} of {usage.total_runs} runs</p></article>
              <article><span><Clock3 aria-hidden="true" />Runtime location</span><strong>{usage.local_runs} local</strong><p>{usage.hosted_runs} hosted · {usage.unknown_location_runs} unknown · based on provider provenance</p></article>
            </div>
            <section className="usage-section"><div className="usage-section-heading"><div><span className="overline">Model breakdown</span><h2>Runs by model</h2></div><span>Known cost never estimates missing provider prices</span></div>{usage.models.length ? <div className="usage-models">{usage.models.map((model) => {
              const maxRuns = Math.max(...usage.models.map((item) => item.run_count), 1);
              return <article key={`${model.provider}/${model.model}`}><div className="usage-model-name"><span>{model.model.slice(0, 1).toUpperCase()}</span><div><strong>{model.model}</strong><small>{model.provider} · {model.location}</small></div></div><div className="usage-model-meter"><span style={{ width: `${Math.max(8, Math.round((model.run_count / maxRuns) * 100))}%` }} /></div><div className="usage-model-stats"><span><strong>{model.run_count}</strong> runs</span><span><strong>{formatNumber(model.total_tokens)}</strong> tokens</span><span><strong>{model.average_latency_ms == null ? "—" : `${formatNumber(model.average_latency_ms)} ms`}</strong> avg latency</span><span><strong>${model.known_cost_usd.toFixed(4)}</strong> known cost{model.unpriced_run_count ? ` · ${model.unpriced_run_count} unpriced` : ""}</span></div></article>;
            })}</div> : <div className="library-empty"><strong>No AI usage recorded yet</strong><p>Complete an extraction, revisit, or challenge to create the first usage record.</p></div>}</section>
            <section className="usage-section"><div className="usage-section-heading"><div><span className="overline">Recent activity</span><h2>Latest model runs</h2></div><span>Newest first</span></div>{usage.recent_runs.length ? <div className="usage-runs">{usage.recent_runs.map((run) => <button type="button" key={`${run.kind}-${run.id}`} disabled={!run.decision_id} onClick={() => run.decision_id && openDecision(run.decision_id)}><span className={`usage-kind ${run.kind}`}>{run.kind}</span><span className="usage-run-model"><strong>{run.model}</strong><small>{run.provider} · {run.prompt_version}</small></span><span><strong>{formatNumber((run.input_tokens ?? 0) + (run.output_tokens ?? 0))}</strong><small>tokens</small></span><span><strong>{run.latency_ms == null ? "—" : `${formatNumber(run.latency_ms)} ms`}</strong><small>latency</small></span><span><strong>{run.estimated_cost_usd == null ? "Unavailable" : `$${run.estimated_cost_usd.toFixed(4)}`}</strong><small>cost</small></span><time dateTime={run.created_at}>{formatDateTime(run.created_at)}</time></button>)}</div> : null}</section>
          </> : null}
        </section> : null}

        {view === "workspace" && runningJobs.length ? <section className="job-progress" aria-live="polite"><div><strong>{runningJobs.length > 1 ? `Comparing ${runningJobs.length} models` : runningJobs[0].phase}</strong><span>{activeProgress}% average progress · You can leave this running or cancel it.</span></div><div className="job-track"><span style={{ width: `${activeProgress}%` }} /></div><button type="button" onClick={cancelActiveJobs}>Cancel {runningJobs.length > 1 ? "both" : ""}</button></section> : null}

        {view === "workspace" && workflowView === 1 && !extraction && !decision ? (
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

        {view === "workspace" && workflowView === 1 && decision ? <section className="card stage-snapshot">
          <div className="snapshot-heading"><div><span className="snapshot-step">01</span><span className="overline">Import snapshot</span><h2>Original decision context</h2><p>This is the source-backed context preserved with the saved record.</p></div><button className="primary subtle-primary" type="button" onClick={() => setWorkflowView(2)}>View review →</button></div>
          <div className="snapshot-grid">
            <div><span>Decision</span><strong>{decision.title}</strong><p>{decision.question}</p></div>
            <div><span>Context</span><p>{decision.context || "No additional context was recorded."}</p></div>
            <div className="snapshot-wide"><span>Recorded rationale</span><p>{decision.rationale || "No rationale was recorded."}</p></div>
          </div>
          <div className="source-memory"><div><span className="overline">Preserved source excerpts</span><strong>{decision.premises.filter((premise) => premise.anchor?.exact_excerpt).length} available</strong></div>{decision.premises.map((premise, index) => premise.anchor?.exact_excerpt ? <blockquote key={premise.id}><span>P{index + 1}</span>{premise.anchor.exact_excerpt}</blockquote> : null)}</div>
        </section> : null}

        {view === "workspace" && workflowView === 2 && decision ? <section className="card stage-snapshot">
          <div className="snapshot-heading"><div><span className="snapshot-step">02</span><span className="overline">Human review snapshot</span><h2>Premises accepted for this decision</h2><p>These are the reviewed statements that were preserved at finalization.</p></div><button className="primary subtle-primary" type="button" onClick={() => setWorkflowView(3)}>View final record →</button></div>
          <div className="snapshot-premises">{decision.premises.map((premise, index) => <article key={premise.id}><span className="snapshot-premise-number">P{index + 1}</span><div><small>{premise.kind.replaceAll("_", " ")}</small><p>{premise.statement}</p>{premise.anchor?.exact_excerpt ? <blockquote>{premise.anchor.exact_excerpt}</blockquote> : <span className="snapshot-no-source">No preserved source excerpt</span>}</div><span className="reviewed-chip">Reviewed ✓</span></article>)}</div>
        </section> : null}

        {view === "workspace" && extraction && draft && (workflowView === 2 || workflowView === 3) ? (
          <>
            {!decision && workflowView === 2 ? <>
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
            </> : decision && workflowView === 3 ? <section className="card finalized-summary">
                           <div className="finalized-heading"><div className="finalized-check"><Check aria-hidden="true" /></div><div><span className="overline">Finalized decision</span><h2>{decision.title}</h2><p>{decision.question}</p></div>{recordActions}</div>
              <div className="record-meta"><div><span>Chosen option</span><strong>{draft.chosenOption || "Not established"}</strong></div><div><span>Criticality</span><strong>{decision.criticality}</strong></div><div><span>Preserved premises</span><strong>{decision.premises.length}</strong></div><div><span>Extracted by</span><strong>{extraction.model}</strong></div></div>
              <div className="preserved-premises">{decision.premises.map((premise, index) => <div key={premise.id}><span>P{index + 1} · {premise.kind.replaceAll("_", " ")}</span><p>{premise.statement}</p></div>)}</div>
                {challengePanel}
                {sharePanel}
              <div className="stage-continue"><span>The decision is saved. Revisit it whenever new evidence appears.</span><button type="button" className="primary" onClick={() => setWorkflowView(4)}>Continue to revisit →</button></div>
              </section> : null}
            </>
        ) : null}

        {view === "workspace" && workflowView === 3 && decision && !extraction ? <section className="card finalized-summary">
          <div className="finalized-heading"><div className="finalized-check"><Check aria-hidden="true" /></div><div><span className="overline">Saved decision</span><h2>{decision.title}</h2><p>{decision.question}</p></div>{recordActions}</div>
          <div className="record-meta"><div><span>Chosen option</span><strong>{decision.chosen_option || "Not established"}</strong></div><div><span>Criticality</span><strong>{decision.criticality}</strong></div><div><span>Preserved premises</span><strong>{decision.premises.length}</strong></div><div><span>Saved</span><strong>{formatDateTime(decision.created_at)}</strong></div></div>
           <div className="preserved-premises">{decision.premises.map((premise, index) => <div key={premise.id}><span>P{index + 1} · {premise.kind.replaceAll("_", " ")}</span><p>{premise.statement}</p></div>)}</div>
             {challengePanel}
             {sharePanel}
             <div className="stage-continue"><span>The decision is saved. Revisit it whenever new evidence appears.</span><button type="button" className="primary" onClick={() => setWorkflowView(4)}>Continue to revisit →</button></div>
           </section> : null}

        {view === "workspace" && workflowView === 4 && decision ? <section className="card revisit-card">
          <div className="section-heading"><div><span className="overline">Step 4 · Revisit</span><h2>What changed?</h2><p>Check one model or compare two models against the same preserved premises and evidence.</p></div><span className="decision-badge">{decision.criticality}</span></div>
          <section className={`audit-panel ${auditExpanded ? "expanded" : ""}`}>
            <button type="button" className="audit-toggle" aria-expanded={auditExpanded} onClick={() => setAuditExpanded((current) => !current)}>
              <span className="audit-icon"><ListChecks aria-hidden="true" /></span><span><small>Stage 2 trust record</small><strong>Decision audit trail</strong><em>{auditEvents.length} recorded event{auditEvents.length === 1 ? "" : "s"}</em></span><span className="audit-chevron"><ChevronDown aria-hidden="true" /></span>
            </button>
            {auditExpanded ? <div className="audit-timeline">{auditEvents.map((event, index) => <article className={`audit-event ${event.kind}`} key={event.id}>
              <span className="audit-marker">{event.kind === "decision" ? "✓" : event.kind === "evidence" ? "•" : "●"}</span>
              <div><small>{event.kind === "decision" ? "Human-reviewed record" : event.kind === "challenge" ? "Challenge review" : event.kind === "evidence" ? "Evidence check" : "Reviewer judgment"}</small><strong>{event.title}</strong><p>{event.detail}</p><time dateTime={event.timestamp}>{formatDateTime(event.timestamp)}</time></div>
              {index < auditEvents.length - 1 ? <span className="audit-line" /> : null}
            </article>)}</div> : null}
          </section>
          {findingReviewProgress.total ? <section className={`review-progress ${findingReviewProgress.pending === 0 ? "complete" : ""}`} aria-label="Human review progress">
            <div><span className="review-progress-icon">{findingReviewProgress.pending === 0 ? <Check aria-hidden="true" /> : <ListChecks aria-hidden="true" />}</span><span><strong>{findingReviewProgress.pending === 0 ? "Human review complete" : `${findingReviewProgress.pending} finding${findingReviewProgress.pending === 1 ? "" : "s"} awaiting judgment`}</strong><small>{findingReviewProgress.reviewed} of {findingReviewProgress.total} findings reviewed</small></span></div>
            <div className="review-progress-track"><span style={{ width: `${findingReviewProgress.percent}%` }} /></div>
          </section> : null}
            {revisitHistory.length ? <section className="history-strip"><div className="history-heading"><div><span className="overline">Decision conversation</span><h3>{revisitHistory.length} evidence check{revisitHistory.length === 1 ? "" : "s"}</h3></div><span>Newest first · open a message for findings</span></div><div className="history-list">{revisitHistory.map((run) => {
              const open = expandedHistoryId === run.id;
              return <article key={run.id} className={`history-message ${open ? "open" : ""}`}>
                <button type="button" className="history-message-toggle" aria-expanded={open} onClick={() => setExpandedHistoryId(open ? null : run.id)}>
                  <span className="history-bubble">
                    <span className="history-message-copy"><small>Evidence update</small><strong>{run.evidence_filename || "New evidence"}</strong><span className="history-model">Model · {run.provider || "unknown"} / {run.model || "unknown"}</span><time dateTime={run.created_at}>{formatDateTime(run.created_at)}</time></span>
                    <span className="history-message-result"><span><strong>{run.findings.length}</strong><small>finding{run.findings.length === 1 ? "" : "s"}</small></span><span className={`history-status ${run.status}`}>{run.status.replaceAll("_", " ")}</span><span className="chev"><ChevronDown aria-hidden="true" /></span></span>
                  </span>
                </button>
                {open ? <div className="history-detail">{run.findings.length ? run.findings.map((finding, findingIndex) => <div key={`${finding.premise_id}-${findingIndex}`} className={`finding ${finding.relationship}`}>
                    <div className="finding-status"><span>{finding.finding_type === "new_constraint" ? "new constraint" : finding.relationship}</span><small>{finding.confidence_band} confidence</small></div>
                    <h3>{finding.premise_statement}</h3><p>{finding.explanation}</p><blockquote>{finding.new_excerpt}</blockquote>
                    {finding.old_excerpt ? <div className="history-old"><strong>Original excerpt</strong><blockquote>{finding.old_excerpt}</blockquote></div> : null}
                    {finding.missing_context_question ? <p className="missing-context">Question: {finding.missing_context_question}</p> : null}
                    {findingReviewControls(run.id, finding)}
                   </div>) : <p className="history-empty">No material relationship was found.</p>}</div> : null}
               </article>;
             })}</div></section> : null}
          <section className={`revisit-composer ${busyPhase === "revisit" ? "is-busy" : ""}`} aria-busy={busyPhase === "revisit"}>
            <div className="composer-heading"><div><span className="overline">New message</span><h3>Add evidence to the decision</h3></div><div className="mode-toggle" aria-label="Revisit mode"><button type="button" className={!compareMode ? "active" : ""} aria-pressed={!compareMode} onClick={() => { setCompareMode(false); setComparisonRuns([]); }}>Single model</button><button type="button" className={compareMode ? "active" : ""} aria-pressed={compareMode} disabled={models.length < 2} onClick={() => { setCompareMode(true); setFindings([]); }}>Compare models</button></div></div>
            {compareMode ? <div className="compare-models"><div><span className="compare-label">Model A</span><ModelPicker compact models={models} selectedId={selectedModelId} recommendedId={recommendedModelId} onSelect={setSelectedModelId} excludeId={comparisonModelId} disabled={busyPhase !== null} label="First model" /></div><div className="versus">VS</div><div><span className="compare-label">Model B</span><ModelPicker compact models={models} selectedId={comparisonModelId} recommendedId={recommendedModelId} onSelect={setComparisonModelId} excludeId={selectedModelId} disabled={busyPhase !== null} label="Second model" /></div></div> : null}
            <label className="composer-input"><span className="composer-plus"><Plus aria-hidden="true" /></span><textarea aria-label="New evidence" value={evidence} onChange={(event) => { setEvidence(event.target.value); setRevisitCompleted(false); setFindings([]); setComparisonRuns([]); setActiveRevisitId(null); }} rows={4} placeholder="Paste a new fact, policy update, incident, or source excerpt…" /></label>
            <div className="composer-footer"><span>{compareMode ? "Both models receive identical premises and evidence." : `${selectedModel?.label ?? "The selected model"} maps evidence to premises; you decide whether action is warranted.`}</span><div>{compareMode ? <span className="composer-model">{selectedModel?.label ?? "Model A"} + {comparisonModel?.label ?? "Model B"}</span> : null}<button className="primary composer-send" onClick={revisit} disabled={busyPhase === "revisit" || !selectedModelId || (compareMode && !comparisonModelId) || !evidence.trim()} aria-label={compareMode ? "Compare model reasoning" : "Check evidence against premises"}>{busyPhase === "revisit" ? <><span className="spinner" />{compareMode ? "Comparing…" : "Checking…"}</> : <ArrowUp aria-hidden="true" />}</button></div></div>
          </section>
          {comparisonRuns.length === 2 ? <div className="comparison-results"><section className={`disagreement-summary ${disagreements.length ? "has-disagreements" : ""}`}><div><span className="overline">Agreement check</span><h3>{disagreements.length ? `${disagreements.length} disagreement${disagreements.length === 1 ? "" : "s"} need review` : "Models agree on all material relationships"}</h3></div>{disagreements.length ? <div className="disagreement-list">{disagreements.map(({ premise, firstRelationship, secondRelationship }) => <div key={premise.id}><strong>{premise.statement}</strong><span>{comparisonRuns[0].label}: {firstRelationship} · {comparisonRuns[1].label}: {secondRelationship}</span></div>)}</div> : null}</section><div className="comparison-grid">{comparisonRuns.map((run) => <section className="comparison-column" key={run.modelId}><header><div><span className="overline">Model result</span><h3>{run.label}</h3></div><strong>{run.result.findings.length} finding{run.result.findings.length === 1 ? "" : "s"}</strong></header><div className="run-provenance">{provenanceLabel(run.result)}</div>{run.result.findings.length ? run.result.findings.map((finding) => <article key={finding.premise_id} className={`finding ${finding.relationship}`}><div className="finding-status"><span>{finding.finding_type === "new_constraint" ? "new constraint" : finding.relationship}</span><small>{finding.confidence_band} confidence</small></div>{finding.finding_type === "new_constraint" ? <div className="safety-net-badge">New constraint · human review required</div> : null}<h3>{finding.premise_statement}</h3><p>{finding.explanation}</p><blockquote>{finding.new_excerpt}</blockquote>{findingReviewControls(run.result.id, finding)}</article>) : <div className="empty-findings"><strong>No material relationship found</strong><span>This model found no effect on the preserved premises.</span></div>}</section>)}</div></div> : null}
          {!comparisonRuns.length && findings.length ? <div className="findings">
            <div className="findings-heading"><h3>Review findings</h3><span>{findings.length} material relationship{findings.length === 1 ? "" : "s"} found · {lastRevisitModel}</span></div>
            {lastRevisitProvenance ? <div className="finding-provenance">Run provenance: {lastRevisitProvenance}</div> : null}
            {findings.map((finding) => <article key={finding.premise_id} className={`finding ${finding.relationship}`}>
              <div className="finding-status"><span>{finding.finding_type === "new_constraint" ? "new constraint" : finding.relationship}</span><small>{finding.confidence_band} confidence</small></div>
              {finding.finding_type === "new_constraint" ? <div className="safety-net-badge">New constraint · human review required</div> : finding.detection_source === "deterministic_safety_net" ? <div className="safety-net-badge">Safety-net candidate · human confirmation required</div> : null}
              <h3>{finding.premise_statement}</h3><p>{finding.explanation}</p><blockquote>{finding.new_excerpt}</blockquote>
              {finding.source_fallback_performed ? <div className="finding-provenance">Original source anchor verified</div> : null}
              {finding.missing_context_question ? <div className="missing-context">Question: {finding.missing_context_question}</div> : null}
              {activeRevisitId ? findingReviewControls(activeRevisitId, finding) : null}
            </article>)}
          </div> : !comparisonRuns.length && revisitCompleted ? <div className="empty-findings"><strong>No material relationship found</strong><span>{lastRevisitModel} found no material effect on the consequential premises preserved in this decision.</span>{lastRevisitProvenance ? <span>Run provenance: {lastRevisitProvenance}</span> : null}</div> : null}
          </section> : null}
        </main>
      </div>

         {confirmingDeleteFor ? <div className="modal-backdrop" onClick={() => { setConfirmingDeleteFor(null); setDeleteTitle(null); }}>
           <div className="confirm-modal" onClick={(event) => event.stopPropagation()}>
             <h3>Delete this decision?</h3>
             <p>This permanently removes <strong>{deleteTitle || "this decision"}</strong>, its preserved premises, source excerpts, revisit history, and any share links. This cannot be undone.</p>
             <div className="modal-actions"><button className="text-button" onClick={() => { setConfirmingDeleteFor(null); setDeleteTitle(null); }} disabled={deleteBusy}>Cancel</button><button className="primary danger" disabled={deleteBusy} onClick={() => void deleteDecision(confirmingDeleteFor)}>{deleteBusy ? "Deleting…" : "Delete permanently"}</button></div>
            </div>
          </div> : null}

         {confirmingShareDelete ? <div className="modal-backdrop" onClick={() => { if (!shareDeleteBusy) setConfirmingShareDelete(null); }}>
           <div className="confirm-modal" onClick={(event) => event.stopPropagation()}>
             <h3>Delete this revoked share record?</h3>
             <p>This removes the old link from the sharing history. The finalized decision and its revisit history will remain unchanged.</p>
             <div className="modal-actions"><button className="text-button" onClick={() => setConfirmingShareDelete(null)} disabled={shareDeleteBusy}>Cancel</button><button className="primary danger" disabled={shareDeleteBusy} onClick={() => void deleteShareRecord()}>{shareDeleteBusy ? "Deleting…" : "Delete share record"}</button></div>
           </div>
         </div> : null}
      </div>
    );
}
