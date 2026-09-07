import { apiResponse, responseJson } from "./api";
import type { AccountSettings, DecisionWorkspace, UsageDashboard } from "./workspace-types";

// Only one workspace can be active in a browser session, and workspace changes
// clear the QueryClient. Keeping this key stable prevents an early hover from
// fetching once as "anonymous" and again after bootstrap resolves the ID.
export const accountSettingsKey = (_workspaceId?: string) => ["account-settings"] as const;
export const usageDashboardKey = (workspaceId?: string) => ["usage-dashboard", workspaceId ?? "anonymous"] as const;
export const decisionWorkspaceKey = (workspaceId: string | undefined, decisionId: string) => ["decision-workspace", workspaceId ?? "anonymous", decisionId] as const;

export async function fetchAccountSettings(): Promise<AccountSettings> {
  return responseJson(await apiResponse("/v1/account-settings")) as Promise<AccountSettings>;
}

export async function fetchUsageDashboard(): Promise<UsageDashboard> {
  return responseJson(await apiResponse("/v1/usage-dashboard")) as Promise<UsageDashboard>;
}

export async function fetchDecisionWorkspace(decisionId: string): Promise<DecisionWorkspace> {
  return responseJson(await apiResponse(`/v1/decisions/${decisionId}/workspace`)) as Promise<DecisionWorkspace>;
}
