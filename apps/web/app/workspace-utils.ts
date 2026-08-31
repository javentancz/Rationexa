import type {
  EvidenceDraft,
  PersistedWorkspaceSession,
  RevisitResult,
  Share,
  WorkspaceView,
} from "./workspace-types";

export const workspaceSessionKey = "rationexa-workspace-draft-v1";
export const evidenceDraftsKey = "rationexa-evidence-drafts-v1";
export const guestWorkspaceId = "guest-browser";

export const workspacePaths: Record<WorkspaceView, string> = {
  workspace: "/workspace",
  library: "/library",
  usage: "/usage",
  settings: "/settings",
};

export function workspaceViewFromPath(pathname: string): WorkspaceView {
  if (pathname.startsWith("/library")) return "library";
  if (pathname.startsWith("/usage")) return "usage";
  if (pathname.startsWith("/settings") || pathname.startsWith("/account/")) return "settings";
  return "workspace";
}

export function readEvidenceDraft(decisionId: string, workspaceId?: string): EvidenceDraft | null {
  try {
    if (!workspaceId) return null;
    const saved = window.localStorage.getItem(evidenceDraftsKey);
    if (!saved) return null;
    const draft = (JSON.parse(saved) as Record<string, EvidenceDraft>)[decisionId];
    return draft?.workspaceId === workspaceId ? draft : null;
  } catch {
    return null;
  }
}

export function writeEvidenceDraft(decisionId: string, draft: EvidenceDraft | null) {
  try {
    const saved = window.localStorage.getItem(evidenceDraftsKey);
    const drafts = saved ? JSON.parse(saved) as Record<string, EvidenceDraft> : {};
    if (draft?.content.trim()) drafts[decisionId] = draft;
    else delete drafts[decisionId];
    if (Object.keys(drafts).length) window.localStorage.setItem(evidenceDraftsKey, JSON.stringify(drafts));
    else window.localStorage.removeItem(evidenceDraftsKey);
  } catch {
    // Draft persistence must never block the decision workflow.
  }
}

export function clearPersistedDecision(decisionId: string) {
  writeEvidenceDraft(decisionId, null);
  try {
    const saved = window.localStorage.getItem(workspaceSessionKey);
    if (!saved) return;
    const state = JSON.parse(saved) as PersistedWorkspaceSession;
    if (state.decisionId === decisionId) window.localStorage.removeItem(workspaceSessionKey);
  } catch {
    window.localStorage.removeItem(workspaceSessionKey);
  }
}

export function provenanceLabel(result: RevisitResult) {
  const tokens = (result.input_tokens ?? 0) + (result.output_tokens ?? 0);
  const cost = result.estimated_cost_usd == null ? "cost pending" : `$${result.estimated_cost_usd.toFixed(4)}`;
  return `${result.provider ?? "unknown"}/${result.model ?? "unknown"} · ${result.prompt_version ?? "unknown prompt"} · ${result.latency_ms ?? 0} ms · ${tokens} tokens · ${cost}`;
}

export function formatDate(value?: string) {
  if (!value) return "Not revisited";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

export function formatDateTime(value?: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

export function browserShareUrl(share: Pick<Share, "token" | "url">) {
  if (typeof window !== "undefined") {
    return new URL(`/share/${encodeURIComponent(share.token)}`, window.location.origin).toString();
  }
  return share.url ?? `/share/${encodeURIComponent(share.token)}`;
}
