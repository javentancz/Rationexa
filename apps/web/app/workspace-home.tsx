"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AccountPanel } from "./account-panel";
import { ArrowLeft, ArrowUp, ChartNoAxesColumn, Check, ChevronDown, ChevronLeft, ChevronRight, Circle, CircleAlert, Diamond, FileDown, FileText, Library, ListChecks, PanelLeftClose, PanelLeftOpen, Plus, Save, Settings, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog, Disclosure, Hint } from "./ui";
import { ApiError, apiResponse as req, handleAuthenticationResponse, responseJson, setAuthenticatedState } from "./api";
import { ModelPicker } from "./model-picker";
import { FinalizeConfirmation } from "./finalize-stage";
import { DecisionLibraryView } from "./decision-library-view";
import { ImportStage } from "./import-stage";
import { UsageView } from "./usage-view";
import { accountSettingsKey, decisionWorkspaceKey, fetchAccountSettings, fetchDecisionWorkspace, fetchUsageDashboard, usageDashboardKey } from "./workspace-api";
import { browserShareUrl, clearPersistedDecision, evidenceDraftsKey, formatDate, formatDateTime, guestWorkspaceId, provenanceLabel, readEvidenceDraft, workspacePaths, workspaceSessionKey, workspaceViewFromPath, writeEvidenceDraft } from "./workspace-utils";
import type { AuditEvent, ComparisonRun, Criticality, Decision, DecisionChallenge, DecisionDraft, DecisionLibrary, Extraction, Finding, FindingJudgment, Job, ModelCatalog, ModelOption, PersonalWorkspace, PersistedWorkspaceSession, PremiseReview, RevisitResult, ReviewAction, Share, UsageSummary, PilotMetrics, WorkflowStep, WorkspaceBootstrap, WorkspaceView } from "./workspace-types";
import { ThemeToggle } from "@/components/theme-toggle";
import { readRefreshSnapshot, writeRefreshSnapshot } from "./refresh-cache";

declare global {
  interface Window {
    __rationexaBootstrapPromise?: Promise<Response>;
  }
}

async function loadWorkspaceBootstrap(): Promise<WorkspaceBootstrap> {
  const preloaded = window.__rationexaBootstrapPromise;
  if (preloaded) {
    delete window.__rationexaBootstrapPromise;
    const response = await preloaded;
    handleAuthenticationResponse(response);
    return responseJson(response) as Promise<WorkspaceBootstrap>;
  }
  return responseJson(await req("/v1/bootstrap")) as Promise<WorkspaceBootstrap>;
}

const attentionKinds = new Set(["assumption", "unknown", "hard_constraint", "material_claim", "revisit_condition"]);
const premiseKinds = ["requirement", "hard_constraint", "soft_constraint", "fact", "assumption", "unknown", "material_claim", "revisit_condition"];

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

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [view, setView] = useState<WorkspaceView>(() => workspaceViewFromPath(pathname));
  const [source, setSource] = useState("");
  const [sourceMode, setSourceMode] = useState<"paste" | "file">("paste");
  const [file, setFile] = useState<File | null>(null);
  const [evidence, setEvidence] = useState("");
  const [guidedSample, setGuidedSample] = useState(false);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [revisitCompleted, setRevisitCompleted] = useState(false);
  const [reviews, setReviews] = useState<Record<string, PremiseReview>>({});
  const [draft, setDraft] = useState<DecisionDraft | null>(null);
  const [criticality, setCriticality] = useState<Criticality>("important");
  const [selectedPremise, setSelectedPremise] = useState<string | null>(null);
  const [busyPhase, setBusyPhase] = useState<"extract" | "review" | "finalize" | "revisit" | "challenge" | null>(null);
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
  const [libraryQuery, setLibraryQuery] = useState("");
  const [debouncedLibraryQuery, setDebouncedLibraryQuery] = useState("");
  const [libraryCriticality, setLibraryCriticality] = useState<"all" | Criticality>("all");
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
  const [challenge, setChallenge] = useState<DecisionChallenge | null>(null);
  const [challengeNotes, setChallengeNotes] = useState("");
  const [challengeConfirmBusy, setChallengeConfirmBusy] = useState(false);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [pilotMetrics, setPilotMetrics] = useState<PilotMetrics | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [personalWorkspace, setPersonalWorkspace] = useState<PersonalWorkspace | null>(null);
  const [confirmingNewDecision, setConfirmingNewDecision] = useState(false);
  const [confirmingDraftDiscard, setConfirmingDraftDiscard] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const restoredSession = useRef(false);
  const cachedBootstrap = useRef<{ savedAt: number; value: WorkspaceBootstrap } | null>(null);
  const [bootstrapCacheChecked, setBootstrapCacheChecked] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    if (media.matches) setLibraryPaneCollapsed(true);
  }, []);

  const navigateTo = useCallback((nextView: WorkspaceView, replace = false) => {
    setView(nextView);
    const nextPath = workspacePaths[nextView];
    if (pathname === nextPath) return;
    if (replace) router.replace(nextPath);
    else router.push(nextPath);
  }, [pathname, router]);

  useEffect(() => {
    setView(workspaceViewFromPath(pathname));
  }, [pathname, router]);

  useEffect(() => {
    const isRequested = new URLSearchParams(window.location.search).get("sample") === "vendor-review";
    const isActive = window.sessionStorage.getItem("rationexa-guided-sample-v1") === "active";
    if (!isRequested && !isActive) return;
    setGuidedSample(true);
    window.sessionStorage.setItem("rationexa-guided-sample-v1", "active");
    if (!isRequested) return;
    setSource("Decision: Choose an identity provider for the customer portal.\n\nWe selected Vendor B because it supports SAML, fits the current budget, and is expected to add external-user administration before the pilot launches. The security team requires audit logs to remain available for at least 12 months.\n\nRevisit this decision if Vendor B delays external-user administration, changes its audit-log retention, or increases annual pricing above $24,000.");
    setSourceMode("paste");
    setWorkflowView(1);
    router.replace("/workspace");
    toast.info("Sample decision loaded — review or edit it before extraction");
  }, [router]);

  useEffect(() => {
    const cached = readRefreshSnapshot<WorkspaceBootstrap>("workspace-bootstrap");
    cachedBootstrap.current = cached;
    if (cached) queryClient.setQueryData(["workspace-bootstrap"], cached.value, { updatedAt: cached.savedAt });
    setBootstrapCacheChecked(true);
  }, [queryClient]);

  const bootstrapQuery = useQuery({
    queryKey: ["workspace-bootstrap"],
    queryFn: loadWorkspaceBootstrap,
    enabled: bootstrapCacheChecked,
    refetchOnMount: false,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const cached = cachedBootstrap.current;
    if (bootstrapQuery.data && (!cached || bootstrapQuery.dataUpdatedAt > cached.savedAt)) {
      writeRefreshSnapshot("workspace-bootstrap", bootstrapQuery.data);
      cachedBootstrap.current = { savedAt: bootstrapQuery.dataUpdatedAt, value: bootstrapQuery.data };
    }
  }, [bootstrapQuery.data, bootstrapQuery.dataUpdatedAt]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedLibraryQuery(libraryQuery.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [libraryQuery]);

  useEffect(() => {
    if (bootstrapQuery.error) {
      if (bootstrapQuery.error instanceof ApiError && bootstrapQuery.error.status === 401) {
        if (pathname.startsWith("/account/reset")) setView("settings");
        else navigateTo("settings", true);
        setError(null);
      } else {
        setError(bootstrapQuery.error instanceof Error ? bootstrapQuery.error.message : "Could not load workspace");
      }
    }
    if (!bootstrapQuery.data) return;
    const { models: catalog, workspace, library: initialLibrary } = bootstrapQuery.data;
    if (bootstrapQuery.data.guest) setAuthenticatedState(false);
    setModels(catalog.models);
    setPersonalWorkspace(workspace);
    if (workspace) queryClient.setQueryData<DecisionLibrary>(["decisions", workspace.id, ""], initialLibrary);
    setRecommendedModelId(catalog.default_model_id);
    setSelectedModelId((current) => catalog.models.some((model) => model.id === current) ? current : catalog.default_model_id);
    setComparisonModelId((current) => catalog.models.some((model) => model.id === current)
      ? current
      : catalog.models.find((model) => model.id !== catalog.default_model_id)?.id || "");
  }, [bootstrapQuery.data, bootstrapQuery.error, navigateTo, pathname, queryClient]);

  const libraryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (debouncedLibraryQuery) params.set("q", debouncedLibraryQuery);
    return params.toString();
  }, [debouncedLibraryQuery]);
  const activeWorkspaceId = bootstrapQuery.data?.workspace?.id ?? personalWorkspace?.id;
  const guestMode = bootstrapQuery.data?.guest === true;
  const draftWorkspaceId = activeWorkspaceId ?? guestWorkspaceId;
  const decisionLibraryQuery = useQuery({
    queryKey: ["decisions", activeWorkspaceId ?? "pending", libraryParams],
    queryFn: async ({ signal }) => responseJson(await req(`/v1/decisions${libraryParams ? `?${libraryParams}` : ""}`, { signal })) as Promise<DecisionLibrary>,
    enabled: Boolean(activeWorkspaceId),
    initialData: libraryParams ? undefined : bootstrapQuery.data?.library,
    initialDataUpdatedAt: bootstrapQuery.dataUpdatedAt,
    placeholderData: (previous) => previous,
    staleTime: 5 * 60_000,
  });
  const unfilteredLibrary = decisionLibraryQuery.data ?? { items: [], total: 0 };
  const library = useMemo<DecisionLibrary>(() => {
    if (libraryCriticality === "all") return unfilteredLibrary;
    const items = unfilteredLibrary.items.filter((item) => item.criticality === libraryCriticality);
    return { items, total: items.length };
  }, [libraryCriticality, unfilteredLibrary]);
  const libraryLoading = decisionLibraryQuery.isPending && library.items.length === 0;

  const modelCatalogQuery = useQuery({
    queryKey: ["model-catalog"],
    queryFn: async () => req(`/v1/models`).then(responseJson) as Promise<ModelCatalog>,
    enabled: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (modelCatalogQuery.error) setError(modelCatalogQuery.error instanceof Error ? modelCatalogQuery.error.message : "Could not load models");
    if (!modelCatalogQuery.data) return;
    const catalog = modelCatalogQuery.data;
    setModels(catalog.models);
    setRecommendedModelId(catalog.default_model_id);
    setSelectedModelId((current) => catalog.models.some((model) => model.id === current) ? current : catalog.default_model_id);
    setComparisonModelId((current) => catalog.models.some((model) => model.id === current)
      ? current
      : catalog.models.find((model) => model.id !== catalog.default_model_id)?.id || "");
  }, [modelCatalogQuery.data, modelCatalogQuery.error]);

  const workspaceQuery = useQuery({
    queryKey: ["personal-workspace"],
    queryFn: async () => req(`/v1/workspace`).then(responseJson) as Promise<PersonalWorkspace>,
    enabled: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (workspaceQuery.error) setError(workspaceQuery.error instanceof Error ? workspaceQuery.error.message : "Could not load workspace");
    if (workspaceQuery.data) setPersonalWorkspace(workspaceQuery.data);
  }, [workspaceQuery.data, workspaceQuery.error]);

  useEffect(() => {
    const recoverLocalWorkspace = () => {
      window.localStorage.removeItem(workspaceSessionKey);
      window.localStorage.removeItem(evidenceDraftsKey);
      resetWorkspace();
      queryClient.removeQueries({ queryKey: ["decisions"] });
      queryClient.removeQueries({ queryKey: ["decision"] });
      void req("/v1/auth/logout", { method: "POST" }).finally(() => { void bootstrapQuery.refetch(); });
      if (pathname.startsWith("/account/reset")) setView("settings");
      toast.info("Your session expired. You can keep browsing as a guest or sign in again.");
    };
    window.addEventListener("rationexa-auth-expired", recoverLocalWorkspace);
    return () => window.removeEventListener("rationexa-auth-expired", recoverLocalWorkspace);
  }, [bootstrapQuery, navigateTo, pathname, queryClient]);

  useEffect(() => {
    if (restoredSession.current) return;
    if (!bootstrapCacheChecked || bootstrapQuery.isLoading) return;
    restoredSession.current = true;
    const restore = async () => {
      try {
        if (window.location.pathname.startsWith("/account/reset")) {
          setView("settings");
          return;
        }
        const activeWorkspace = bootstrapQuery.data?.workspace;
        const restoredWorkspaceId = activeWorkspace?.id ?? (bootstrapQuery.data?.guest ? guestWorkspaceId : null);
        if (!restoredWorkspaceId) return;
        const saved = window.localStorage.getItem(workspaceSessionKey);
        if (!saved) return;
        const state = JSON.parse(saved) as PersistedWorkspaceSession;
        const legacyLocalDraft = !state.workspaceId && activeWorkspace?.mode === "local_personal";
        if (!legacyLocalDraft && state.workspaceId !== restoredWorkspaceId) {
          window.localStorage.removeItem(workspaceSessionKey);
          window.localStorage.removeItem(evidenceDraftsKey);
          return;
        }
        setSource(state.source ?? "");
        setSourceMode(state.sourceMode === "file" ? "paste" : state.sourceMode ?? "paste");
        if (state.selectedModelId) setSelectedModelId(state.selectedModelId);
        if (state.comparisonModelId) setComparisonModelId(state.comparisonModelId);
        setCompareMode(Boolean(state.compareMode));
        if (state.decisionId) {
          const restored = await openDecision(state.decisionId, state.workflowView ?? 4, { restoredView: workspaceViewFromPath(window.location.pathname), legacyEvidence: state.evidence, clearIfMissing: true });
          if (restored) toast.info("Decision workspace restored");
        } else if (state.extraction && state.draft) {
          setExtraction(state.extraction);
          setDraft(state.draft);
          setReviews(state.reviews ?? {});
          setCriticality(state.criticality ?? state.extraction.result.suggested_criticality);
          setSelectedPremise(state.selectedPremise ?? state.extraction.result.premises[0]?.candidate_id ?? null);
          setWorkflowView(state.workflowView === 3 ? 3 : 2);
          navigateTo(workspaceViewFromPath(window.location.pathname), true);
          toast.info("Unfinished review restored");
        } else {
          setEvidence(state.evidence ?? "");
          setWorkflowView(1);
          navigateTo(workspaceViewFromPath(window.location.pathname), true);
          if (state.source?.trim()) toast.info("Unfinished import restored");
        }
      } catch {
        window.localStorage.removeItem(workspaceSessionKey);
      } finally {
        setSessionRestored(true);
      }
    };
    void restore();
  }, [bootstrapCacheChecked, bootstrapQuery.data, bootstrapQuery.isLoading, navigateTo]);

  useEffect(() => {
    if (!sessionRestored || !bootstrapQuery.data) return;
    const savedAt = new Date().toISOString();
    const state: PersistedWorkspaceSession = { workspaceId: draftWorkspaceId, source, evidence: decision ? undefined : evidence, sourceMode, view, workflowView, selectedModelId, comparisonModelId, compareMode, decisionId: decision?.id, extraction: decision ? undefined : extraction ?? undefined, draft: decision ? undefined : draft ?? undefined, reviews: decision ? undefined : reviews, criticality, selectedPremise: selectedPremise ?? undefined };
    window.localStorage.setItem(workspaceSessionKey, JSON.stringify(state));
    setDraftSavedAt(savedAt);
  }, [bootstrapQuery.data, compareMode, comparisonModelId, criticality, decision, draft, draftWorkspaceId, evidence, extraction, reviews, selectedModelId, selectedPremise, sessionRestored, source, sourceMode, view, workflowView]);

  useEffect(() => {
    if (!sessionRestored || !decision) return;
    const savedAt = new Date().toISOString();
    writeEvidenceDraft(decision.id, evidence.trim() && personalWorkspace ? { workspaceId: personalWorkspace.id, content: evidence, selectedModelId, comparisonModelId, compareMode, updatedAt: savedAt } : null);
    if (evidence.trim()) setDraftSavedAt(savedAt);
  }, [compareMode, comparisonModelId, decision, evidence, personalWorkspace, selectedModelId, sessionRestored]);

  useEffect(() => {
    const hasUnsavedWork = !decision && Boolean(source.trim() || evidence.trim() || extraction || draft);
    if (!hasUnsavedWork) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [decision, draft, evidence, extraction, source]);

  useEffect(() => {
    if (!compareMode || !selectedModelId) return;
    setComparisonModelId((current) => {
      if (current && current !== selectedModelId) return current;
      return models.find((model) => model.id !== selectedModelId)?.id ?? "";
    });
  }, [compareMode, models, selectedModelId]);

  useEffect(() => {
    if (view === "usage" && activeWorkspaceId && !usage) void loadUsage();
  }, [activeWorkspaceId, usage, view]);

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
  const hasCurrentDraft = !decision && Boolean(source.trim() || extraction || draft);
  const currentDraftTitle = draft?.title?.trim() || file?.name || source.trim().split("\n")[0]?.slice(0, 56) || "Untitled decision";
  const currentDraftStep = extraction ? (workflowView === 3 ? "Finalize" : "Review") : "Import";
  const guidedStep = [
    { title: "Start with the original reasoning", copy: "The example source is ready. Read it, then run deterministic extraction to identify the decision and its premises." },
    { title: "Decide what belongs in the record", copy: "Check every proposed premise against its source. Confirm it, preserve it as unknown, or reject it—each judgment is valid." },
    { title: "Confirm the human-reviewed record", copy: "Review the summary before saving. This is the point where the draft becomes durable decision memory." },
    { title: "Test the decision against change", copy: "Add the delayed delivery update below. Rationexa will map it to the preserved assumption; you make the final judgment." },
  ][workflowView - 1];
  function openWorkflowStep(number: WorkflowStep) {
    navigateTo("workspace");
    if (number <= stage) {
      setWorkflowView(number);
      return;
    }
    const requiredStep = stage === 1 ? "Import" : stage === 2 ? "Review" : "Finalize";
    toast.info(`Complete ${requiredStep} to unlock this step`, {
      description: "Your current work is preserved while you finish the required stage.",
    });
  }
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
      current = await Promise.all(created.map(async (job) => responseJson(await req(`/v1/jobs/${job.id}`))));
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
    const cancelled = await Promise.all(running.map(async (job) => responseJson(await req(`/v1/jobs/${job.id}`, { method: "DELETE" }))));
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
        artifact = await responseJson(await req(`/v1/artifacts/upload`, { method: "POST", body }));
      } else {
        artifact = await responseJson(await req(`/v1/artifacts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "decision-note.txt", media_type: "text/plain", content: source }) }));
      }
      const created = await responseJson(await req(`/v1/decisions/extractions/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artifact_id: artifact.id, model_id: selectedModelId || undefined }) }));
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

  async function saveReview() {
    if (!extraction || !draft) return;
    setBusyPhase("review");
    setError(null);
    try {
      const reviewed = await responseJson(await req(`/v1/extractions/${extraction.id}/review`, {
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
      setWorkflowView(3);
      toast.success("Review saved", { description: "Check the summary before finalizing the decision." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the review");
    } finally {
      setBusyPhase(null);
    }
  }

  async function finalizeDecision() {
    if (!extraction) return;
    setBusyPhase("finalize");
    setError(null);
    try {
      const saved = await responseJson(await req(`/v1/extractions/${extraction.id}/finalize`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ criticality }) })) as Decision;
      setDecision(saved);
      queryClient.setQueryData(["decision", activeWorkspaceId, saved.id], saved);
      setChallenge(saved.challenge ?? null);
      setRevisitHistory([]);
      setWorkflowView(3);
      toast.success("Decision finalized", { description: "The reviewed record is now available in the library." });
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
      const created = await Promise.all(modelIds.map(async (modelId) => responseJson(await req(`/v1/decisions/${decision.id}/revisit-jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filename: "new-evidence.txt", content: evidence, model_id: modelId }) }))));
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
      await loadRevisitHistory(decision.id, true);
      setEvidence("");
      toast.success(compareMode ? "Comparison complete" : "Evidence check complete", { description: `${runs.reduce((total, run) => total + run.result.findings.length, 0)} finding(s) ready for human review.` });
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
      const created = await responseJson(await req(`/v1/decisions/${decision.id}/challenge-jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: selectedModelId || undefined }),
      })) as Job;
      const completed = await waitForJob(created);
      const next = completed.result as DecisionChallenge;
      setChallenge(next);
      setDecision((current) => current ? { ...current, challenge: next } : current);
      queryClient.setQueryData<Decision>(["decision", activeWorkspaceId, decision.id], (current) => current ? { ...current, challenge: next } : current);
      setChallengeNotes("");
      toast.success("Challenge brief ready", { description: "Human confirmation is still required." });
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
      const confirmed = await responseJson(await req(`/v1/decisions/${decision.id}/challenge/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: challengeNotes || null }),
      })) as DecisionChallenge;
      setChallenge(confirmed);
      setDecision((current) => current ? { ...current, challenge: confirmed } : current);
      queryClient.setQueryData<Decision>(["decision", activeWorkspaceId, decision.id], (current) => current ? { ...current, challenge: confirmed } : current);
      toast.success("Challenge review confirmed");
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
      const updated = await responseJson(await req(`/v1/revisit-checks/${revisitId}/findings/${premiseId}/judgment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ judgment, notes: judgmentNotes[reviewKey] || null }),
      })) as RevisitResult;
      if (activeRevisitId === updated.id) setFindings(updated.findings);
      setRevisitHistory((current) => current.map((item) => item.id === updated.id ? updated : item));
      queryClient.setQueryData<RevisitResult[]>(["revisits", activeWorkspaceId, updated.decision_id], (current = []) => current.map((item) => item.id === updated.id ? updated : item));
      setJudgmentNotes((current) => ({ ...current, ...Object.fromEntries(updated.findings.map((finding) => [`${updated.id}:${finding.premise_id}`, finding.human_notes || ""])) }));
      toast.success("Judgment saved");
      void loadLibrary();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save finding judgment");
    } finally {
      setJudgmentBusy(null);
    }
  }

  async function loadLibrary() {
    if (!activeWorkspaceId) return;
    await queryClient.invalidateQueries({ queryKey: ["decisions", activeWorkspaceId] });
  }

  async function loadUsage(force = false) {
    const cacheResource = `usage-dashboard:${activeWorkspaceId ?? "anonymous"}`;
    const cached = readRefreshSnapshot<Awaited<ReturnType<typeof fetchUsageDashboard>>>(cacheResource);
    if (!usage && cached) {
      setUsage(cached.value.usage);
      setPilotMetrics(cached.value.pilot_metrics);
    }
    setUsageLoading(true);
    setError(null);
    try {
      if (force) await queryClient.invalidateQueries({ queryKey: usageDashboardKey(activeWorkspaceId), exact: true, refetchType: "none" });
      const dashboard = await queryClient.fetchQuery({ queryKey: usageDashboardKey(activeWorkspaceId), queryFn: fetchUsageDashboard, staleTime: 5 * 60_000 });
      setUsage(dashboard.usage);
      setPilotMetrics(dashboard.pilot_metrics);
      writeRefreshSnapshot(cacheResource, dashboard);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load workspace usage");
    } finally {
      setUsageLoading(false);
    }
  }

  async function loadRevisitHistory(decisionId: string, force = false) {
    const queryKey = ["revisits", activeWorkspaceId, decisionId];
    if (force) await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
    const history = await queryClient.fetchQuery({ queryKey, queryFn: async () => responseJson(await req(`/v1/decisions/${decisionId}/revisit-checks`)) as Promise<RevisitResult[]>, staleTime: 5 * 60_000 });
    setRevisitHistory(history);
  }

  async function openDecision(decisionId: string, targetStep: WorkflowStep = 4, restore?: { restoredView?: WorkspaceView; legacyEvidence?: string; clearIfMissing?: boolean }) {
    setError(null);
    try {
      const bundle = await queryClient.fetchQuery({ queryKey: decisionWorkspaceKey(activeWorkspaceId, decisionId), queryFn: () => fetchDecisionWorkspace(decisionId), staleTime: 5 * 60_000 });
      const { decision: record, revisits: history } = bundle;
      queryClient.setQueryData(["decision", activeWorkspaceId, decisionId], record);
      queryClient.setQueryData(["revisits", activeWorkspaceId, decisionId], history);
      queryClient.setQueryData(["shares", activeWorkspaceId, decisionId], bundle.shares);
      setDecision(record);
      setChallenge(record.challenge ?? null);
      setChallengeNotes(record.challenge?.reviewer_notes ?? "");
      setDraft({ title: record.title, question: record.question, context: record.context, chosenOption: record.chosen_option ?? "", rationale: record.rationale });
       setRevisitHistory(history);
       setShares(bundle.shares);
       setExtraction(null);
       setFindings([]);
       setComparisonRuns([]);
       setRevisitCompleted(false);
       setActiveRevisitId(null);
       const evidenceDraft = readEvidenceDraft(decisionId, personalWorkspace?.id);
       setEvidence(evidenceDraft?.content ?? restore?.legacyEvidence ?? "");
       if (evidenceDraft?.selectedModelId) setSelectedModelId(evidenceDraft.selectedModelId);
       if (evidenceDraft?.comparisonModelId) setComparisonModelId(evidenceDraft.comparisonModelId);
       if (evidenceDraft) setCompareMode(evidenceDraft.compareMode);
       setLibraryQuery("");
       setConfirmingDeleteFor(null);
       setExpandedHistoryId(null);
      setWorkflowView(targetStep);
       setWorkflowPaneCollapsed(false);
       navigateTo(restore?.restoredView ?? "workspace", Boolean(restore));
       return true;
    } catch (caught) {
      if (restore?.clearIfMissing && caught instanceof ApiError && caught.status === 404) {
        clearPersistedDecision(decisionId);
        navigateTo("library", true);
        setWorkflowView(1);
        toast.info("The deleted decision was removed from your restored workspace", { id: `deleted-restored-decision-${decisionId}` });
        return false;
      }
      setError(caught instanceof Error ? caught.message : "Could not open the decision");
      return false;
    }
  }

  function prefetchDecision(decisionId: string) {
    void queryClient.prefetchQuery({ queryKey: decisionWorkspaceKey(activeWorkspaceId, decisionId), queryFn: () => fetchDecisionWorkspace(decisionId), staleTime: 5 * 60_000 });
  }

  function prefetchUsage() {
    void queryClient.prefetchQuery({ queryKey: usageDashboardKey(activeWorkspaceId), queryFn: fetchUsageDashboard, staleTime: 5 * 60_000 });
  }

  function prefetchAccountSettings() {
    void queryClient.prefetchQuery({ queryKey: accountSettingsKey(activeWorkspaceId), queryFn: fetchAccountSettings, staleTime: 5 * 60_000 });
  }

  async function downloadMarkdown() {
    if (!decision) return;
    setExportBusy(true);
    setError(null);
    try {
      const response = await req(`/v1/decisions/${decision.id}/export/markdown`);
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
      toast.success("Markdown export ready");
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
      const response = await req(`/v1/decisions/${decision.id}/export/pdf`);
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
      toast.success("PDF export ready");
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
    setSource("");
    setSourceMode("paste");
    setFile(null);
    setEvidence("");
     }

  async function handleWorkspaceChanged(preserveGuestDraft = false) {
    const keepSettingsOpen = view === "settings";
    if (!guestMode || !preserveGuestDraft) {
      window.localStorage.removeItem(workspaceSessionKey);
      window.localStorage.removeItem(evidenceDraftsKey);
      resetWorkspace();
    }
    if (keepSettingsOpen) setView("settings");
    queryClient.clear();
    await bootstrapQuery.refetch();
  }

  async function handleModelConfigurationChanged() {
    await modelCatalogQuery.refetch();
  }

  function requestNewDecision() {
    const hasUnsavedWork = !decision && Boolean(source.trim() || evidence.trim() || extraction || draft);
    if (hasUnsavedWork) setConfirmingNewDecision(true);
    else {
      resetWorkspace();
      navigateTo("workspace");
    }
  }

  function discardCurrentDraft() {
    window.localStorage.removeItem(workspaceSessionKey);
    if (decision) writeEvidenceDraft(decision.id, null);
    resetWorkspace();
    setConfirmingDraftDiscard(false);
    navigateTo("library");
    toast.success("Draft discarded");
  }

  async function loadShares(decisionId: string) {
    setShares(await queryClient.fetchQuery({ queryKey: ["shares", activeWorkspaceId, decisionId], queryFn: async () => responseJson(await req(`/v1/decisions/${decisionId}/shares`)) as Promise<Share[]>, staleTime: 5 * 60_000 }));
   }

  async function createShare() {
    if (!decision) return;
    setShareBusy(true);
    setError(null);
    try {
      const created = await responseJson(await req(`/v1/decisions/${decision.id}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
        })) as Share;
      await queryClient.invalidateQueries({ queryKey: ["shares", activeWorkspaceId, decision.id], exact: true, refetchType: "none" });
      await loadShares(decision.id);
      await copyLink(browserShareUrl(created), false);
      toast.success("Share link created", { description: "Copied to the clipboard." });
     } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create a share link");
     } finally {
      setShareBusy(false);
     }
    }

  async function copyLink(value: string | null, notify = true) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      window.prompt("Copy this link:", value);
     }
    setCopiedToken(value);
    if (notify) toast.success("Link copied");
    window.setTimeout(() => setCopiedToken((current) => (current === value ? null : current)), 2500);
   }

  async function revokeShare(shareId: string, token: string) {
    if (!decision) return;
    setShareBusy(true);
    setError(null);
    try {
      await responseJson(await req(`/v1/decisions/${decision.id}/shares/${shareId}`, { method: "DELETE" }));
      await queryClient.invalidateQueries({ queryKey: ["shares", activeWorkspaceId, decision.id], exact: true, refetchType: "none" });
      await loadShares(decision.id);
        setCopiedToken((current) => (current === token ? null : current));
        toast.success("Share link revoked");
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
      const response = await req(`/v1/decisions/${decision.id}/shares/${confirmingShareDelete.id}/record`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? `Delete failed with status ${response.status}`);
      }
      setShares((current) => current.filter((share) => share.id !== confirmingShareDelete.id));
      queryClient.setQueryData<Share[]>(["shares", activeWorkspaceId, decision.id], (current = []) => current.filter((share) => share.id !== confirmingShareDelete.id));
      setConfirmingShareDelete(null);
      toast.success("Share record deleted");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the share record");
    } finally {
      setShareDeleteBusy(false);
    }
  }

  async function deleteDecision(targetId: string) {
    setDeleteBusy(true);
    setError(null);
    const cachedLibraries = queryClient.getQueriesData<DecisionLibrary>({ queryKey: ["decisions", activeWorkspaceId] });
    queryClient.setQueriesData<DecisionLibrary>({ queryKey: ["decisions", activeWorkspaceId] }, (current) => current ? {
      items: current.items.filter((item) => item.id !== targetId),
      total: Math.max(0, current.total - (current.items.some((item) => item.id === targetId) ? 1 : 0)),
    } : current);
    setConfirmingDeleteFor(null);
    setDeleteTitle(null);
    if (decision?.id === targetId) {
      clearPersistedDecision(targetId);
      resetWorkspace();
      navigateTo("library");
    }
    try {
      const response = await req(`/v1/decisions/${targetId}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail ?? `Delete failed with status ${response.status}`);
         }
      clearPersistedDecision(targetId);
      queryClient.removeQueries({ queryKey: ["decision", activeWorkspaceId, targetId] });
      queryClient.removeQueries({ queryKey: ["revisits", activeWorkspaceId, targetId] });
      queryClient.removeQueries({ queryKey: ["shares", activeWorkspaceId, targetId] });
      toast.success("Decision deleted");
       } catch (caught) {
      cachedLibraries.forEach(([key, value]) => queryClient.setQueryData(key, value));
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
      </> : <div className="challenge-empty"><span><Sparkles aria-hidden="true" /></span><div><strong>Generate four source-grounded challenge prompts</strong><p>{selectedModel?.availability_reason ?? "The selected model will inspect only the preserved premises. It will not browse, change the decision, or run a multi-agent debate."}</p></div><ModelPicker compact models={models} selectedId={selectedModelId} recommendedId={recommendedModelId} onSelect={setSelectedModelId} disabled={busyPhase !== null} label="Challenge model" /><button type="button" className="primary" disabled={busyPhase !== null || !selectedModelId || selectedModel?.available === false} onClick={generateChallenge}>{busyPhase === "challenge" ? <><span className="spinner" />Generating challenge…</> : <><Sparkles aria-hidden="true" />Generate challenge brief</>}</button></div>}
    </section>
  ) : null;

  const sharePanel = decision ? (
    <section className="share-panel">
      <div className="section-heading compact"><div><span className="overline">Sharing</span><h2>Share a read-only record</h2></div></div>
      <p className="share-note">A share link shows the finalized decision, its premises, and revisit history. It never includes provider keys or private source artifacts. New links expire automatically and can be revoked at any time.</p>
      <button className="primary" disabled={shareBusy} onClick={createShare}>{shareBusy ? <><span className="spinner" />Creating link…</> : <><Plus aria-hidden="true" />Create share link</>}</button>
      {shares.length ? <div className="share-list">{shares.map((share) => <div key={share.id} className={`share-item ${share.status}`}>
        <div><strong>{share.status === "active" ? "Active link" : "Revoked"}</strong><small>{formatDate(share.created_at)}{share.expires_at ? ` · expires ${formatDate(share.expires_at)}` : " · no expiry"}</small></div>
         {share.status === "active" ? <div className="share-link"><code>{browserShareUrl(share)}</code><div><button className="text-button" onClick={() => copyLink(browserShareUrl(share))}>{copiedToken === browserShareUrl(share) ? "Copied ✓" : "Copy"}</button><button className="text-button danger" disabled={shareBusy} onClick={() => revokeShare(share.id, share.token)}>Revoke</button></div></div> : <div className="share-retired-actions"><span className="share-expired">No longer usable</span><Hint label="Delete share record" side="left"><button type="button" className="share-delete icon-action" aria-label="Delete revoked share record" onClick={() => setConfirmingShareDelete(share)}><ActionIcon name="delete" /></button></Hint></div>}
       </div>)}</div> : null}
     </section>
    ) : null;

  const recordActions = decision ? (
    <div className="record-actions" aria-label="Decision actions">
      <Hint label={exportBusy ? "Preparing Markdown…" : "Export Markdown"} side="bottom"><button type="button" className="record-action icon-action" aria-label={exportBusy ? "Preparing Markdown export" : "Export Markdown"} disabled={exportBusy} onClick={downloadMarkdown}><ActionIcon name="markdown" /></button></Hint>
      <Hint label={pdfExportBusy ? "Preparing PDF…" : "Export PDF"} side="bottom"><button type="button" className="record-action icon-action" aria-label={pdfExportBusy ? "Preparing PDF export" : "Export PDF"} disabled={pdfExportBusy} onClick={downloadPdf}><ActionIcon name="pdf" /></button></Hint>
      <Hint label="Delete record" side="bottom"><button type="button" className="record-action icon-action danger" aria-label="Delete record" onClick={() => { setDeleteTitle(decision.title); setConfirmingDeleteFor(decision.id); }}><ActionIcon name="delete" /></button></Hint>
      <Hint label="Back to library" side="bottom"><button type="button" className="record-action icon-action" aria-label="Back to library" onClick={() => navigateTo("library")}><ActionIcon name="back" /></button></Hint>
    </div>
  ) : null;

   return (
       <div className={`app-shell ${libraryPaneCollapsed ? "library-collapsed" : ""} ${workflowPaneCollapsed ? "workflow-collapsed" : ""}`}>
      {libraryPaneCollapsed ? <Hint label="Open navigation" side="right"><button type="button" className="library-hover-zone" aria-label="Open navigation" aria-expanded="false" onClick={() => setLibraryPaneCollapsed(false)}><PanelLeftOpen aria-hidden="true" /></button></Hint> : null}
      {!libraryPaneCollapsed ? <button type="button" className="mobile-library-scrim" aria-label="Close navigation" onClick={() => setLibraryPaneCollapsed(true)} /> : null}
      <aside className="sidebar library-pane">
        <header className="pane-brand"><Hint label="Back to Rationexa home" side="bottom"><Link className="brand" href="/" aria-label="Rationexa home"><span className="brand-mark">R</span><span className="pane-label">Rationexa</span></Link></Hint><Hint label="Collapse navigation" side="bottom"><button type="button" className="library-panel-toggle" aria-label="Collapse navigation" aria-expanded={!libraryPaneCollapsed} onClick={() => setLibraryPaneCollapsed(true)}><PanelLeftClose aria-hidden="true" /></button></Hint></header>
        <button className="new-decision" onClick={requestNewDecision}><Plus aria-hidden="true" /><span className="pane-label">New decision review</span></button>
        <div className="pane-section pane-label"><span className="pane-kicker">Decision libraries</span></div>
        <nav className="library-nav" aria-label="Decision libraries">
          {(["all", "critical", "important", "routine"] as ("all" | Criticality)[]).map((value) => {
            const label = value === "all" ? "All decisions" : value[0].toUpperCase() + value.slice(1);
            return <button key={value} type="button" className={`nav-item ${view === "library" && libraryCriticality === value ? "active" : ""}`} aria-label={label} onClick={() => { setLibraryCriticality(value); navigateTo("library"); }}><span className="nav-icon"><LibraryNavIcon value={value} /></span><span className="pane-label">{label}</span>{value === "all" && libraryCriticality === "all" ? <small className="pane-label">{library.total}</small> : null}</button>;
          })}
          <button type="button" className={`nav-item usage-nav ${view === "usage" ? "active" : ""}`} aria-label="Usage and cost" onMouseEnter={prefetchUsage} onFocus={prefetchUsage} onClick={() => navigateTo("usage")}><span className="nav-icon"><ChartNoAxesColumn aria-hidden="true" /></span><span className="pane-label">Usage &amp; cost</span></button>
          <button type="button" className={`nav-item usage-nav ${view === "settings" ? "active" : ""}`} aria-label="Account and provider keys" onMouseEnter={prefetchAccountSettings} onFocus={prefetchAccountSettings} onClick={() => navigateTo("settings")}><span className="nav-icon"><Settings aria-hidden="true" /></span><span className="pane-label">Account &amp; keys</span></button>
        </nav>
        <section className="decision-conversations pane-label" aria-label="Saved decisions">
          <div className="pane-section-heading"><span>Decision conversations</span>{libraryLoading ? <span className="spinner dark" /> : null}</div>
          <div className="conversation-list">
            {hasCurrentDraft ? <button type="button" className={`conversation-row draft-row ${view === "workspace" ? "active" : ""}`} onClick={() => navigateTo("workspace")}><span className="conversation-dot draft" /><span><strong>{currentDraftTitle}</strong><small>{currentDraftStep} draft · saved on this device</small></span><em>Draft</em></button> : null}
            {library.items.map((item) => <button type="button" key={item.id} className={`conversation-row ${decision?.id === item.id ? "active" : ""}`} onMouseEnter={() => prefetchDecision(item.id)} onFocus={() => prefetchDecision(item.id)} onClick={() => openDecision(item.id)}><span className={`conversation-dot ${item.criticality}`} /><span><strong>{item.title}</strong><small>{item.last_revisited_at ? formatDateTime(item.last_revisited_at) : `${item.premise_count} premises · not revisited`}</small></span>{item.pending_revisit_count ? <em>{item.pending_revisit_count}</em> : null}</button>)}
            {!hasCurrentDraft && !library.items.length ? <p>No saved decisions in this library.</p> : null}
          </div>
        </section>
        <section className="workspace-identity" aria-label={personalWorkspace ? `${personalWorkspace.name}, owned by ${personalWorkspace.account_name}` : "Guest workspace"}>
          <span className="workspace-avatar"><UserRound aria-hidden="true" /></span>
          <span className="workspace-identity-copy pane-label"><strong>{personalWorkspace?.name || "Guest workspace"}</strong><small>{personalWorkspace ? `${personalWorkspace.account_name} · ${personalWorkspace.mode === "authenticated_personal" ? "Private pilot" : personalWorkspace.mode === "guest_personal" ? "Private 24-hour trial" : "Local profile"}` : "Preparing private trial…"}</small></span>
          <ThemeToggle compact />
        </section>
      </aside>

      <div className={`workbench-shell ${view !== "workspace" ? "library-overview" : ""}`}>
      <Hint label={workflowPaneCollapsed ? "Show decision workflow" : "Hide decision workflow"}><button type="button" className="workflow-toggle" aria-label={workflowPaneCollapsed ? "Expand workflow" : "Collapse workflow"} aria-expanded={!workflowPaneCollapsed} onClick={() => setWorkflowPaneCollapsed((current) => !current)}><span>{workflowPaneCollapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}</span></button></Hint>
      <aside className="workflow-pane">
        <header className="workflow-pane-header"><div className="pane-label"><span className="pane-kicker">Decision workflow</span><strong>{view === "workspace" ? draft?.title || decision?.title || "New review" : "Select a decision"}</strong></div></header>
        <ol className="workflow-steps" aria-label="Decision workflow">
          {(["Import", "Review", "Finalize", "Revisit"] as const).map((label, index) => {
            const number = (index + 1) as WorkflowStep;
            const available = view === "workspace" && number <= stage;
            return <li key={label} className={number === workflowView && view === "workspace" ? "active" : number < stage ? "complete" : !available ? "locked" : ""}><button type="button" data-locked={!available || undefined} aria-current={number === workflowView && view === "workspace" ? "step" : undefined} aria-label={`${label}${available ? "" : " (locked)"}`} onClick={() => openWorkflowStep(number)}><span>{number < stage ? <Check aria-hidden="true" /> : number}</span><span className="pane-label"><strong>{label}</strong><small>{label === "Import" ? "Original decision source" : label === "Review" ? "Human premise review" : label === "Finalize" ? "Saved record and sharing" : "Evidence conversations"}</small></span></button></li>;
          })}
        </ol>
        {decision ? <section className="workflow-conversations pane-label"><div className="pane-section-heading"><span>Revisit conversations</span><small>{revisitHistory.length}</small></div>{revisitHistory.length ? <div>{revisitHistory.map((run) => <button type="button" key={run.id} className={expandedHistoryId === run.id ? "active" : ""} onClick={() => { navigateTo("workspace"); setWorkflowView(4); setExpandedHistoryId(run.id); }}><span className="workflow-conversation-copy"><strong>{run.evidence_filename || "New evidence"}</strong><small>{formatDateTime(run.created_at)}</small></span><em>{run.findings.length}</em></button>)}</div> : <p>No evidence checks yet.</p>}</section> : <div className="workflow-empty pane-label"><ListChecks aria-hidden="true" /><strong>{view === "library" ? "Choose a conversation" : "Start with Import"}</strong><p>{view === "library" ? "Select a saved decision from the library to inspect its workflow." : "Bring in a decision source to begin."}</p></div>}
        <button type="button" className="workflow-library-link" onClick={() => navigateTo("library")}><Library aria-hidden="true" /><span className="pane-label">Open library overview</span></button>
      </aside>

      <main id="workspace" className="workspace">
        <header className="topbar">
          <div><span className="workspace-context">{view === "library" ? "Your saved decisions" : view === "usage" ? "Workspace insights" : view === "settings" ? "Workspace settings" : `Step ${workflowView} of 4 · ${workflowView === 1 ? "Import" : workflowView === 2 ? "Review" : workflowView === 3 ? "Finalize" : "Revisit"}`}</span><h1>{view === "library" ? "Decision library" : view === "usage" ? "Usage & cost" : view === "settings" ? "Account & keys" : draft?.title || decision?.title || "New decision review"}</h1></div>
        </header>

        {error ? <div className="error" role="alert"><strong>Something needs attention</strong><span>{error}</span></div> : null}

        {view === "workspace" && guidedSample ? <section className="guided-sample-banner" aria-label="Guided example"><span className="guided-sample-step">{workflowView}</span><div><small>Guided example · Step {workflowView} of 4</small><strong>{guidedStep.title}</strong><p>{guidedStep.copy}</p>{workflowView === 4 && decision ? <button type="button" onClick={() => setEvidence("Vendor B delayed external-user administration until next quarter, after the planned pilot launch.")}>Use the sample evidence →</button> : null}</div><button type="button" className="guided-sample-exit" aria-label="Exit guided example" onClick={() => { setGuidedSample(false); window.sessionStorage.removeItem("rationexa-guided-sample-v1"); }}><X aria-hidden="true" /></button></section> : null}

        {view === "library" ? <DecisionLibraryView query={libraryQuery} onQueryChange={setLibraryQuery} criticality={libraryCriticality} onCriticalityChange={setLibraryCriticality} hasCurrentDraft={hasCurrentDraft} currentDraftTitle={currentDraftTitle} currentDraftStep={currentDraftStep} onResumeDraft={() => navigateTo("workspace")} onDiscardDraft={() => setConfirmingDraftDiscard(true)} library={library} loading={libraryLoading} refreshing={decisionLibraryQuery.isFetching && !decisionLibraryQuery.isPending} guest={guestMode} onOpenAccount={() => navigateTo("settings")} onOpenDecision={(id) => { void openDecision(id); }} onPrefetchDecision={prefetchDecision} onDeleteDecision={(id, title) => { setDeleteTitle(title); setConfirmingDeleteFor(id); }} onCreateDecision={() => { resetWorkspace(); navigateTo("workspace"); }} formatDateTime={formatDateTime} /> : null}

        {view === "usage" ? <UsageView guest={guestMode} usage={usage} pilotMetrics={pilotMetrics} loading={usageLoading} onRefresh={() => { void loadUsage(true); }} onOpenSettings={() => navigateTo("settings")} onOpenDecision={(id) => { void openDecision(id); }} /> : null}

        {view === "settings" ? <section className="usage-view account-view"><AccountPanel workspaceId={activeWorkspaceId} onConfigurationChanged={(preserveGuestDraft) => { void handleWorkspaceChanged(preserveGuestDraft); }} onModelConfigurationChanged={() => { void handleModelConfigurationChanged(); }} onWorkspaceProfileChanged={() => { void workspaceQuery.refetch(); }} /></section> : null}

        {view === "workspace" && runningJobs.length ? <section className="job-progress" aria-live="polite"><div><strong>{runningJobs.length > 1 ? `Comparing ${runningJobs.length} models` : runningJobs[0].phase}</strong><span>{activeProgress}% average progress · You can leave this running or cancel it.</span></div><div className="job-track"><span style={{ width: `${activeProgress}%` }} /></div><button type="button" onClick={cancelActiveJobs}>Cancel {runningJobs.length > 1 ? "both" : ""}</button></section> : null}

        {view === "workspace" && workflowView === 1 && !extraction && !decision ? <ImportStage sourceMode={sourceMode} onSourceModeChange={setSourceMode} source={source} onSourceChange={setSource} file={file} onFileChange={setFile} models={models} selectedModelId={selectedModelId} recommendedModelId={recommendedModelId} onModelSelect={setSelectedModelId} selectedModel={selectedModel} extracting={busyPhase === "extract"} draftSavedAt={draftSavedAt} guest={guestMode} formatDateTime={formatDateTime} onExtract={extract} /> : null}

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
              <section className="review-layout review-layout-aligned">
              <div className="review-main">
                <section className="card decision-summary">
                  <div className="review-stage-heading"><span className="stage-number">02</span><div><span className="overline">Human review · extracted by {extraction.model}</span><h2>Review the extracted decision</h2><p>Correct the record fields first, then review every premise against its exact source excerpt.</p></div><button className="text-button" onClick={requestNewDecision}>Start over</button></div>
                  <div className="field-grid">
                    <label className="field full"><span>Decision title</span><input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} /></label>
                    <label className="field full"><span>Decision question</span><input value={draft.question} onChange={(event) => updateDraft("question", event.target.value)} /></label>
                    <label className="field"><span>Chosen option</span><input value={draft.chosenOption} onChange={(event) => updateDraft("chosenOption", event.target.value)} placeholder="Not established" /></label>
                    <label className="field"><span>Criticality</span><select value={criticality} onChange={(event) => setCriticality(event.target.value as Criticality)}><option value="routine">Routine</option><option value="important">Important</option><option value="critical">Critical</option></select></label>
                    <label className="field full"><span>Rationale</span><textarea rows={3} value={draft.rationale} onChange={(event) => updateDraft("rationale", event.target.value)} placeholder="Why was this option selected?" /></label>
                  </div>
                </section>

                <section className="premise-section">
                  <div className="premise-section-heading"><div><span className="overline">Premise review</span><h2>Verify what the decision depends on</h2><p>AI suggestions remain provisional. Compare each statement with its source, then record your judgment.</p></div><div className="review-counts"><span>{counts.confirm} confirmed</span><span>{counts.unknown} unknown</span><span>{counts.attention} need attention</span></div></div>
                  <div className="premise-list">
                    {premises.map((premise, index) => {
                      const review = reviews[premise.candidate_id];
                      const attention = Boolean(premise.attention_reason || attentionKinds.has(review.kind));
                      return <article key={premise.candidate_id} className={`premise-card premise-review-card ${selectedPremise === premise.candidate_id ? "selected" : ""} action-${review.action}`} onFocus={() => setSelectedPremise(premise.candidate_id)}>
                        <header className="premise-review-header"><span className="premise-number">P{index + 1}</span><div><small>AI-suggested premise</small><select aria-label={`Premise ${index + 1} type`} value={review.kind} onChange={(event) => updateReview(premise.candidate_id, { kind: event.target.value })}>{premiseKinds.map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select></div>{attention ? <span className="attention-badge">Needs careful review</span> : <span className="source-anchored-badge">Source anchored</span>}</header>
                        <label className="premise-statement-field"><span>Editable statement</span><textarea aria-label={`Premise ${index + 1} statement`} rows={2} value={review.statement} onChange={(event) => updateReview(premise.candidate_id, { statement: event.target.value })} /></label>
                        <div className={`premise-source-preview ${premise.anchor ? "anchored" : "missing"}`}><div><span>Exact source excerpt</span>{premise.anchor ? <em>Verified anchor</em> : <em>No anchor</em>}</div>{premise.anchor ? <blockquote>{premise.anchor.exact_excerpt}</blockquote> : <p>No validated source excerpt was found. Preserve this as unknown or reject it if the source does not support the statement.</p>}{premise.attention_reason ? <p className="attention-reason">{premise.attention_reason}</p> : null}</div>
                        <div className="premise-judgment"><div><strong>Your judgment</strong><small>This controls whether the premise is preserved.</small></div><div className="premise-actions">{(["confirm", "unknown", "reject"] as ReviewAction[]).map((action) => <button key={action} type="button" aria-pressed={review.action === action} className={review.action === action ? "active" : ""} onClick={() => updateReview(premise.candidate_id, { action })}><span>{action === "confirm" ? "✓" : action === "unknown" ? "?" : "×"}</span>{action === "confirm" ? "Confirm" : action === "unknown" ? "Keep unknown" : "Reject"}</button>)}</div></div>
                      </article>;
                    })}
                  </div>
                </section>
              </div>
              </section>
              <section className="finalize-bar"><div><strong>{unanchoredCritical.length ? "Critical premises need evidence" : "Review complete?"}</strong><span>{unanchoredCritical.length ? `${unanchoredCritical.length} confirmed consequential premise${unanchoredCritical.length === 1 ? " has" : "s have"} no validated source anchor. Mark unknown or reject before continuing.` : `${counts.confirm} premises confirmed · ${counts.unknown} preserved as unknown · ${counts.reject} rejected`}</span></div><button className="primary" disabled={busyPhase === "review" || !draft.title.trim() || !draft.question.trim() || unanchoredCritical.length > 0} onClick={saveReview}>{busyPhase === "review" ? <><span className="spinner" />Saving review…</> : "Continue to finalize →"}</button></section>
            </> : !decision && workflowView === 3 ? <FinalizeConfirmation title={draft.title} question={draft.question} chosenOption={draft.chosenOption} rationale={draft.rationale} criticality={criticality} counts={counts} premises={premises} reviews={reviews} busy={busyPhase === "finalize"} onBack={() => setWorkflowView(2)} onFinalize={finalizeDecision} /> : null}
            </>
        ) : null}

        {view === "workspace" && workflowView === 3 && decision ? <section className="card finalized-summary">
          <div className="finalized-heading"><div className="finalized-check"><Check aria-hidden="true" /></div><div><span className="overline">Saved decision</span><h2>{decision.title}</h2><p>{decision.question}</p></div>{recordActions}</div>
          <div className="record-meta"><div><span>Chosen option</span><strong>{decision.chosen_option || "Not established"}</strong></div><div><span>Criticality</span><strong>{decision.criticality}</strong></div><div><span>Preserved premises</span><strong>{decision.premises.length}</strong></div><div><span>Saved</span><strong>{formatDateTime(decision.created_at)}</strong></div></div>
           <div className="preserved-premises">{decision.premises.map((premise, index) => <div key={premise.id}><span>P{index + 1} · {premise.kind.replaceAll("_", " ")}</span><p>{premise.statement}</p></div>)}</div>
             {challengePanel}
             {sharePanel}
             <div className="stage-continue"><span>The decision is saved. Revisit it whenever new evidence appears.</span><button type="button" className="primary" onClick={() => setWorkflowView(4)}>Continue to revisit →</button></div>
           </section> : null}

        {view === "workspace" && workflowView === 4 && decision ? <section className="card revisit-card">
          <div className="revisit-hero"><div><span className="overline">Step 4 · Revisit</span><h2>Continue the decision conversation</h2><p>Add new evidence, inspect how it relates to preserved premises, then record the human judgment beside each finding.</p></div><span className="decision-badge">{decision.criticality}</span></div>
          <div className="revisit-trust-strip" aria-label="Evidence review process"><span><strong>1</strong>Add evidence</span><span><strong>2</strong>AI maps relationships</span><span><strong>3</strong>You decide what matters</span></div>
          {findingReviewProgress.total ? <section className={`review-progress ${findingReviewProgress.pending === 0 ? "complete" : ""}`} aria-label="Human review progress">
            <div><span className="review-progress-icon">{findingReviewProgress.pending === 0 ? <Check aria-hidden="true" /> : <ListChecks aria-hidden="true" />}</span><span><strong>{findingReviewProgress.pending === 0 ? "Human review complete" : `${findingReviewProgress.pending} finding${findingReviewProgress.pending === 1 ? "" : "s"} awaiting judgment`}</strong><small>{findingReviewProgress.reviewed} of {findingReviewProgress.total} findings reviewed</small></span></div>
            <div className="review-progress-track"><span style={{ width: `${findingReviewProgress.percent}%` }} /></div>
          </section> : null}
            <section className="history-strip"><div className="history-heading"><div><span className="overline">Decision conversation</span><h3>{revisitHistory.length + 1} message{revisitHistory.length ? "s" : ""}</h3><p>The original decision starts the thread. Every later evidence check stays attached to it.</p></div><span>Oldest first · open a message to review findings</span></div><div className="history-list conversation-timeline">
              <article className="history-message decision-origin"><div className="history-bubble"><span className="history-message-copy"><small>Decision created</small><strong>{decision.title}</strong><span>{decision.question}</span><time dateTime={decision.created_at}>{formatDateTime(decision.created_at)}</time></span><span className="history-message-result"><span className="history-status confirmed">Human reviewed</span></span></div></article>
              {[...revisitHistory].reverse().map((run) => {
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
             })}</div></section>
          <section className={`revisit-composer ${busyPhase === "revisit" ? "is-busy" : ""}`} aria-busy={busyPhase === "revisit"}>
            <div className="composer-heading"><div><span className="overline">Continue the thread</span><h3>What new evidence appeared?</h3><p>Paste the smallest useful excerpt. Rationexa compares it with the preserved record; it does not change the decision.</p></div><div className="mode-toggle" aria-label="Revisit mode"><button type="button" className={!compareMode ? "active" : ""} aria-pressed={!compareMode} onClick={() => { setCompareMode(false); setComparisonRuns([]); }}>Single model</button><button type="button" className={compareMode ? "active" : ""} aria-pressed={compareMode} disabled={models.length < 2} onClick={() => { setCompareMode(true); setFindings([]); }}>Compare models</button></div></div>
            {compareMode ? <div className="compare-models"><div><span className="compare-label">Model A</span><ModelPicker compact models={models} selectedId={selectedModelId} recommendedId={recommendedModelId} onSelect={setSelectedModelId} excludeId={comparisonModelId} disabled={busyPhase !== null} label="First model" /></div><div className="versus">VS</div><div><span className="compare-label">Model B</span><ModelPicker compact models={models} selectedId={comparisonModelId} recommendedId={recommendedModelId} onSelect={setComparisonModelId} excludeId={selectedModelId} disabled={busyPhase !== null} label="Second model" /></div></div> : null}
            <label className="composer-input"><span className="composer-plus"><Plus aria-hidden="true" /></span><textarea aria-label="New evidence" value={evidence} onChange={(event) => { setEvidence(event.target.value); setRevisitCompleted(false); setFindings([]); setComparisonRuns([]); setActiveRevisitId(null); }} rows={4} placeholder="Paste a fact, policy update, incident, or source excerpt…" /></label>
            <div className="composer-footer"><span className="draft-assurance"><span>{selectedModel?.availability_reason ?? (compareMode ? "Both models receive identical premises and evidence." : "AI maps evidence to premises; you decide whether action is warranted.")}</span>{evidence.trim() && draftSavedAt ? <small><Save aria-hidden="true" />Evidence draft saved locally · {formatDateTime(draftSavedAt)}</small> : null}</span><div>{compareMode ? <span className="composer-model">{selectedModel?.label ?? "Model A"} + {comparisonModel?.label ?? "Model B"}</span> : <ModelPicker compact models={models} selectedId={selectedModelId} recommendedId={recommendedModelId} onSelect={setSelectedModelId} disabled={busyPhase !== null} label="Evidence model" />}<button className="primary composer-send" onClick={revisit} disabled={busyPhase === "revisit" || !selectedModelId || selectedModel?.available === false || (compareMode && (!comparisonModelId || comparisonModel?.available === false)) || !evidence.trim()} aria-label={compareMode ? "Compare model reasoning" : "Check evidence against premises"}>{busyPhase === "revisit" ? <><span className="spinner" />{compareMode ? "Comparing…" : "Checking…"}</> : <ArrowUp aria-hidden="true" />}</button></div></div>
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
          <section className="conversation-drawers" aria-label="Decision details">
            <Disclosure title="Audit trail" summary={`${auditEvents.length} recorded events`}>
              <div className="audit-timeline">{auditEvents.map((event, index) => <article className={`audit-event ${event.kind}`} key={event.id}><span className="audit-marker">{event.kind === "decision" ? "✓" : event.kind === "evidence" ? "•" : "●"}</span><div><small>{event.kind === "decision" ? "Human-reviewed record" : event.kind === "challenge" ? "Challenge review" : event.kind === "evidence" ? "Evidence check" : "Reviewer judgment"}</small><strong>{event.title}</strong><p>{event.detail}</p><time dateTime={event.timestamp}>{formatDateTime(event.timestamp)}</time></div>{index < auditEvents.length - 1 ? <span className="audit-line" /> : null}</article>)}</div>
            </Disclosure>
            <Disclosure title="Challenge brief" summary={challenge?.status === "confirmed" ? "Human confirmed" : challenge ? "Needs confirmation" : "Not generated"}>{challengePanel}</Disclosure>
            <Disclosure title="Sharing" summary={`${shares.filter((share) => share.status === "active").length} active links`}>{sharePanel}</Disclosure>
            <Disclosure title="Run provenance" summary={`${revisitHistory.length} evidence runs`}><div className="provenance-list">{revisitHistory.map((run) => <div key={run.id}><strong>{formatDateTime(run.created_at)}</strong><span>{provenanceLabel(run)}</span></div>)}</div></Disclosure>
          </section>
          </section> : null}
        </main>
      </div>

         <ConfirmDialog open={Boolean(confirmingDeleteFor)} title="Delete this decision?" description={`This permanently removes ${deleteTitle || "this decision"}, its premises, source excerpts, revisit history, and share links. This cannot be undone.`} confirmLabel="Delete permanently" busyLabel="Deleting…" busy={deleteBusy} onOpenChange={(open) => { if (!open) { setConfirmingDeleteFor(null); setDeleteTitle(null); } }} onConfirm={() => { if (confirmingDeleteFor) void deleteDecision(confirmingDeleteFor); }} />
         <ConfirmDialog open={Boolean(confirmingShareDelete)} title="Delete this revoked share record?" description="This removes the old link from sharing history. The decision and its revisit history remain unchanged." confirmLabel="Delete share record" busyLabel="Deleting…" busy={shareDeleteBusy} onOpenChange={(open) => { if (!open) setConfirmingShareDelete(null); }} onConfirm={() => void deleteShareRecord()} />
         <ConfirmDialog open={confirmingDraftDiscard} title="Discard this draft?" description={`This removes ${currentDraftTitle} from this browser. No finalized decision records will be changed.`} confirmLabel="Discard draft" busyLabel="Discarding…" onOpenChange={setConfirmingDraftDiscard} onConfirm={discardCurrentDraft} />
         <ConfirmDialog open={confirmingNewDecision} title="Start a new decision?" description="Your unfinished import or review draft is saved locally, but starting over will clear it from this workspace." confirmLabel="Start new decision" busyLabel="Starting…" onOpenChange={setConfirmingNewDecision} onConfirm={() => { setConfirmingNewDecision(false); window.localStorage.removeItem(workspaceSessionKey); resetWorkspace(); navigateTo("workspace"); }} />
      </div>
    );
}
