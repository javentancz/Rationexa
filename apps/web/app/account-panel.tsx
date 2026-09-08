"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, KeyRound, LogIn, LogOut, MailCheck, Monitor, ShieldCheck, Sparkles, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, confirmPasswordReset, login, logout, register, requestPasswordReset, setAuthenticatedState, setSessionToken } from "./api";
import { ConfirmDialog } from "./ui";
import { accountSettingsKey, fetchAccountSettings } from "./workspace-api";
import { readRefreshSnapshot, writeRefreshSnapshot } from "./refresh-cache";
import type { Account as AccountRead, AccountSettings as AccountSettingsSnapshot, PersonalWorkspace as WorkspaceRead, Secret as SecretRead, SessionSummary } from "./workspace-types";

type ProviderModels = { models: string[] };
type ProviderTest = { provider: string; ok: boolean; model_count: number; latency_ms: number };

const providerOptions = [
  { id: "openrouter", label: "OpenRouter", detail: "Many model companies through one compatible API" },
  { id: "openai", label: "OpenAI direct", detail: "Models available to your OpenAI project" },
  { id: "custom", label: "Custom compatible API", detail: "Your own OpenAI-compatible endpoint" },
] as const;

type AccountPanelProps = {
  workspaceId?: string;
  onConfigurationChanged?: (preserveGuestDraft?: boolean) => void;
  onModelConfigurationChanged?: () => void;
  onWorkspaceProfileChanged?: () => void;
};

export function AccountPanel({ workspaceId, onConfigurationChanged, onModelConfigurationChanged, onWorkspaceProfileChanged }: AccountPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [authenticated, setAuthenticated] = useState(false);
  const [account, setAccount] = useState<AccountRead | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceRead | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [secrets, setSecrets] = useState<SecretRead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register" | "reset">("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [keyEntry, setKeyEntry] = useState("");
  const [providerEntry, setProviderEntry] = useState("openrouter");
  const [baseUrlEntry, setBaseUrlEntry] = useState("");
  const [secretBusy, setSecretBusy] = useState(false);
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [providerModelSelection, setProviderModelSelection] = useState<Record<string, string>>({});
  const [modelBusyFor, setModelBusyFor] = useState<string | null>(null);
  const [providerErrors, setProviderErrors] = useState<Record<string, string>>({});
  const [providerTests, setProviderTests] = useState<Record<string, ProviderTest>>({});
  const [removeProvider, setRemoveProvider] = useState<string | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [confirmingAccountDelete, setConfirmingAccountDelete] = useState(false);
  const [accountDeleteBusy, setAccountDeleteBusy] = useState(false);
  const selectedProvider = providerOptions.find((provider) => provider.id === providerEntry) ?? providerOptions[0];
  const settingsCacheResource = `account-settings:${workspaceId ?? "anonymous"}`;

  function applySnapshot(snapshot: AccountSettingsSnapshot) {
    setAuthenticated(snapshot.authenticated);
    if (snapshot.authenticated) setAuthenticatedState(true);
    setAccount(snapshot.account);
    setWorkspace(snapshot.workspace);
    setSessions(snapshot.sessions);
    setProfileName(snapshot.account.name);
    setWorkspaceName(snapshot.workspace?.name ?? "");
    setSecrets(snapshot.secrets);
    setProviderModelSelection((current) => snapshot.secrets.reduce<Record<string, string>>((next, entry) => {
      if (entry.selected_model) next[entry.provider] = entry.selected_model;
      return next;
    }, { ...current }));
  }

  function invalidateAccountSettings() {
    void queryClient.invalidateQueries({ queryKey: accountSettingsKey(workspaceId), exact: true, refetchType: "none" });
  }

  async function refresh(force = false) {
    setError(null);
    try {
      const queryKey = accountSettingsKey(workspaceId);
      if (force) await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
      const snapshot = await queryClient.fetchQuery<AccountSettingsSnapshot>({
        queryKey,
        staleTime: 5 * 60_000,
        queryFn: fetchAccountSettings,
      });
      applySnapshot(snapshot);
      writeRefreshSnapshot(settingsCacheResource, snapshot);
    } catch (caught) {
      setAccount(null);
      setWorkspace(null);
      setSessions([]);
      setSecrets([]);
      setError(caught instanceof Error ? caught.message : "Could not load workspace settings");
    }
  }

  useEffect(() => {
    const resetTokenFromUrl = window.location.pathname === "/account/reset"
      ? new URLSearchParams(window.location.search).get("token")
      : null;
    if (resetTokenFromUrl) {
      setResetToken(resetTokenFromUrl);
      setAuthMode("reset");
    }
    const cached = readRefreshSnapshot<AccountSettingsSnapshot>(settingsCacheResource);
    if (cached) applySnapshot(cached.value);
    void refresh();
    const recover = () => { void refresh(true); };
    window.addEventListener("rationexa-auth-expired", recover);
    return () => window.removeEventListener("rationexa-auth-expired", recover);
  }, []);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setError(null);
    try {
      await login(email, password);
      await refresh(true);
      onConfigurationChanged?.(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleRegister(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setError(null);
    try {
      await register(name, email, password);
      setName("");
      setEmail("");
      setPassword("");
      await refresh(true);
      onConfigurationChanged?.(true);
      toast.success("Pilot workspace created");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Account creation failed");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleResetRequest(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setError(null);
    setResetMessage(null);
    try {
      const result = await requestPasswordReset(email);
      setResetMessage(result.message);
      if (result.development_token) setResetToken(result.development_token);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare password reset");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleResetConfirm(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmNewPassword) {
      setError("The new passwords do not match");
      return;
    }
    setAuthBusy(true);
    setError(null);
    try {
      await confirmPasswordReset(resetToken, newPassword);
      setResetToken("");
      setNewPassword("");
      setConfirmNewPassword("");
      setResetMessage(null);
      setAuthMode("login");
      router.replace("/settings");
      await refresh(true);
      onConfigurationChanged?.(false);
      toast.success("Password reset complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Password reset failed");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleProfileSave(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setError(null);
    try {
      await apiFetch("/v1/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: profileName }) });
      await apiFetch("/v1/workspace", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: workspaceName }) });
      await refresh(true);
      onWorkspaceProfileChanged?.();
      toast.success("Workspace profile updated");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update workspace profile");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handlePasswordChange(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setError(null);
    try {
      await apiFetch("/v1/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
      setCurrentPassword("");
      setNewPassword("");
      await refresh(true);
      toast.success("Password changed. Other sessions were signed out.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change password");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogoutOthers() {
    setAuthBusy(true);
    setError(null);
    try {
      await apiFetch("/v1/auth/logout-others", { method: "POST" });
      await refresh(true);
      toast.success("Other sessions signed out");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign out other sessions");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    await logout();
    await refresh(true);
    onConfigurationChanged?.(false);
  }

  async function handleStoreKey(event: FormEvent) {
    event.preventDefault();
    setSecretBusy(true);
    setError(null);
    try {
      const connected = await apiFetch("/v1/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerEntry, key: keyEntry, base_url: providerEntry === "custom" ? baseUrlEntry : undefined }),
      }) as SecretRead;
      setKeyEntry("");
      if (providerEntry === "custom") setBaseUrlEntry("");
      setSecrets((current) => [...current.filter((entry) => entry.provider !== connected.provider), connected].sort((a, b) => a.provider.localeCompare(b.provider)));
      invalidateAccountSettings();
      await loadProviderModels(providerEntry);
      toast.success("Provider connected. Choose an active model.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not store the key");
    } finally {
      setSecretBusy(false);
    }
  }

  async function loadProviderModels(provider: string) {
    setModelBusyFor(provider);
    setProviderErrors((current) => ({ ...current, [provider]: "" }));
    try {
      const payload = await apiFetch(`/v1/secrets/${provider}/models`) as ProviderModels;
      setProviderModels((current) => ({ ...current, [provider]: payload.models }));
      setProviderModelSelection((current) => ({
        ...current,
        [provider]: current[provider] || secrets.find((secret) => secret.provider === provider)?.selected_model || payload.models[0] || "",
      }));
    } catch (caught) {
      setProviderErrors((current) => ({ ...current, [provider]: caught instanceof Error ? caught.message : "Could not load provider models" }));
    } finally {
      setModelBusyFor(null);
    }
  }

  async function testProvider(provider: string) {
    setModelBusyFor(provider);
    setProviderErrors((current) => ({ ...current, [provider]: "" }));
    try {
      const result = await apiFetch(`/v1/secrets/${provider}/test`, { method: "POST" }) as ProviderTest;
      setProviderTests((current) => ({ ...current, [provider]: result }));
      toast.success(`Connection verified · ${result.model_count} models`);
    } catch (caught) {
      setProviderErrors((current) => ({ ...current, [provider]: caught instanceof Error ? caught.message : "Connection test failed" }));
    } finally {
      setModelBusyFor(null);
    }
  }

  async function activateProviderModel(provider: string) {
    const model = providerModelSelection[provider];
    if (!model) return;
    setModelBusyFor(provider);
    setError(null);
    try {
      const activated = await apiFetch(`/v1/secrets/${provider}/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      }) as SecretRead;
      setSecrets((current) => current.map((entry) => entry.provider === provider ? activated : entry));
      invalidateAccountSettings();
      onModelConfigurationChanged?.();
      toast.success("Hosted model activated");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not activate the hosted model");
    } finally {
      setModelBusyFor(null);
    }
  }

  async function handleRemoveKey(provider: string) {
    setSecretBusy(true);
    setError(null);
    try {
      await apiFetch(`/v1/secrets/${provider}`, { method: "DELETE" });
      setProviderModels((current) => { const next = { ...current }; delete next[provider]; return next; });
      setProviderModelSelection((current) => { const next = { ...current }; delete next[provider]; return next; });
      setSecrets((current) => current.filter((entry) => entry.provider !== provider));
      invalidateAccountSettings();
      onModelConfigurationChanged?.();
      setRemoveProvider(null);
      toast.success("Provider key removed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the key");
    } finally {
      setSecretBusy(false);
    }
  }

  async function handleDeleteAccount() {
    setAccountDeleteBusy(true);
    setError(null);
    try {
      await apiFetch("/v1/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });
      setSessionToken(null);
      setDeletePassword("");
      setConfirmingAccountDelete(false);
      await refresh(true);
      onConfigurationChanged?.(false);
      toast.success("Account and workspace deleted");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the account");
    } finally {
      setAccountDeleteBusy(false);
    }
  }

  if (!account) {
    return (
      <section className="usage-section account-section">
        <p className="account-loading">Loading workspace settings…</p>
        {error ? <p className="account-error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="usage-section account-section">
      <div className="account-page-heading">
        <div><h2>Workspace settings</h2><p>Profile, security, and model access.</p></div>
        <span className="account-status"><ShieldCheck aria-hidden="true" />{authenticated ? "Encrypted BYOK" : workspace?.mode === "guest_personal" ? "Private guest trial" : workspace ? "Local development" : "Sign in required"}</span>
      </div>
      {error ? <p className="account-error">{error}</p> : null}
      <div className={`account-body ${authenticated ? "authenticated" : "guest"}`}>
        {!authenticated ? <section className="onboarding-path" aria-label="Workspace onboarding progress">
          <article className={workspace ? "complete" : "current"}><span>{workspace ? <Check aria-hidden="true" /> : "1"}</span><div><strong>Try privately</strong><p>Use deterministic rules in an isolated guest workspace.</p></div></article>
          <article className={authenticated ? "complete" : workspace?.mode === "guest_personal" ? "current" : ""}><span>{authenticated ? <Check aria-hidden="true" /> : "2"}</span><div><strong>Keep your workspace</strong><p>Create an account only when you want durable history.</p></div></article>
          <article className={secrets.some((secret) => secret.configured) ? "complete" : authenticated ? "current" : ""}><span>{secrets.some((secret) => secret.configured) ? <Check aria-hidden="true" /> : "3"}</span><div><strong>Connect a model</strong><p>Add one provider key, verify it, then choose an available model.</p></div></article>
        </section> : null}
        <div className="account-identity">
          <span className="account-avatar"><UserRound aria-hidden="true" /></span>
          <div>
            <strong>{account.name}</strong>
            <small>{authenticated
              ? account.email ?? "Signed-in workspace"
              : workspace?.mode === "guest_personal"
                ? "Isolated browser trial · expires after 24 hours"
                : workspace
                  ? "Local workspace · no signup required"
                : "Sign in to open a private workspace"}</small>
          </div>
        </div>
        {authenticated ? (
          <div className="account-actions">
            <button type="button" className="text-button danger" disabled={secretBusy} onClick={handleLogout}><LogOut aria-hidden="true" />Sign out</button>
          </div>
        ) : null}
        {authenticated ? (
          <div className="pilot-account-grid">
            <section className="account-management-card">
              <div className="byok-heading"><UserRound aria-hidden="true" /><div><strong>Profile</strong><p>Your workspace display names.</p></div></div>
              <form className="account-login" onSubmit={handleProfileSave}>
                <label><span>Display name</span><input required value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label>
                <label><span>Workspace name</span><input required value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} /></label>
                <button type="submit" className="secondary" disabled={authBusy || !workspace}>Save profile</button>
              </form>
            </section>
            <section className="account-management-card">
              <div className="byok-heading"><ShieldCheck aria-hidden="true" /><div><strong>Password</strong><p>A change signs out other sessions.</p></div></div>
              <form className="account-login" onSubmit={handlePasswordChange}>
                <label><span>Current password</span><input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
                <label><span>New password</span><input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
                <button type="submit" className="secondary" disabled={authBusy}>Change password</button>
              </form>
            </section>
            <section className="account-management-card account-sessions">
              <div className="byok-heading"><Monitor aria-hidden="true" /><div><strong>Sessions</strong><p>Review signed-in browsers.</p></div></div>
              <ul>{sessions.map((session) => <li key={session.id}><span><strong>{session.current ? "This browser" : "Signed-in browser"}</strong><small>Started {new Date(session.created_at).toLocaleString()} · expires {new Date(session.expires_at).toLocaleString()}</small></span>{session.current ? <em>Current</em> : null}</li>)}</ul>
              <button type="button" className="text-button danger" disabled={authBusy || sessions.every((session) => session.current)} onClick={handleLogoutOthers}>Sign out other sessions</button>
            </section>
          </div>
        ) : null}
        <div className="account-secrets">
          <div className="byok-heading">
            <Sparkles aria-hidden="true" />
            <div>
              <strong>Connect a model</strong>
              <p>{authenticated ? "Add a provider key, then choose a model." : workspace?.mode === "guest_personal" ? "Create an account to keep decisions and use encrypted BYOK." : workspace ? "Built-in models work without a shared key." : "Sign in to connect a provider."}</p>
              {authenticated ? <small className="byok-safety-note">Public preview: use a restricted, revocable provider key with a spending limit. Do not use a privileged production key.</small> : null}
            </div>
          </div>
          {authenticated ? <><form onSubmit={handleStoreKey} className="account-key-form">
            <label><span>Provider platform</span><select value={providerEntry} onChange={(event) => setProviderEntry(event.target.value)}>{providerOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select><small className="provider-choice-note">{selectedProvider.detail}</small></label>
            {providerEntry === "custom" ? <label><span>Compatible API base URL <small>HTTPS, or localhost for development</small></span><input type="url" required value={baseUrlEntry} onChange={(event) => setBaseUrlEntry(event.target.value)} placeholder="https://api.example.com/v1" /></label> : null}
            <label><span>Provider API key <small>Encrypted for this workspace</small></span><input type="password" autoComplete="off" value={keyEntry} onChange={(event) => setKeyEntry(event.target.value)} placeholder="Paste this provider's API key" /></label>
            <button type="submit" className="primary" disabled={secretBusy || !keyEntry || (providerEntry === "custom" && !baseUrlEntry)}><KeyRound aria-hidden="true" />{secretBusy ? "Connecting…" : "Connect provider"}</button>
          </form>
          {secrets.length ? (
            <ul className="account-key-list">
              {secrets.map((secret) => (
                <li key={secret.provider} className="provider-connection">
                  <div className="provider-connection-heading"><span><strong>{secret.label ?? secret.provider}</strong><small>{secret.selected_model ? `Active model · ${secret.selected_model}` : "Connected · choose a model"}</small>{providerTests[secret.provider] ? <small className="provider-test-ok">Verified · {providerTests[secret.provider].model_count} models · {providerTests[secret.provider].latency_ms} ms</small> : null}</span><div className="provider-row-actions"><button type="button" className="text-button" disabled={modelBusyFor === secret.provider} onClick={() => testProvider(secret.provider)}>Test</button><button type="button" className="icon-action danger" aria-label={`Remove ${secret.provider} key`} disabled={secretBusy || !secret.configured} onClick={() => setRemoveProvider(secret.provider)}><Trash2 aria-hidden="true" /></button></div></div>
                  {providerErrors[secret.provider] ? <p className="account-error provider-error">{providerErrors[secret.provider]}</p> : null}
                  {providerModels[secret.provider] ? <div className="provider-model-choice"><select aria-label={`${secret.label ?? secret.provider} model`} value={providerModelSelection[secret.provider] ?? secret.selected_model ?? ""} onChange={(event) => setProviderModelSelection((current) => ({ ...current, [secret.provider]: event.target.value }))}>{providerModels[secret.provider].map((model) => <option key={model} value={model}>{model}</option>)}</select><button type="button" className="primary" disabled={modelBusyFor === secret.provider || !(providerModelSelection[secret.provider] ?? secret.selected_model)} onClick={() => activateProviderModel(secret.provider)}>{modelBusyFor === secret.provider ? "Activating…" : "Use this model"}</button></div> : <button type="button" className="secondary provider-load-models" disabled={modelBusyFor === secret.provider} onClick={() => loadProviderModels(secret.provider)}>{modelBusyFor === secret.provider ? "Loading models…" : "Choose a model"}</button>}
                </li>
              ))}
            </ul>
          ) : <p className="account-empty">No hosted-provider keys stored. Built-in deterministic rules remain available without one.</p>}</> : <p className="account-empty">{workspace?.mode === "guest_personal" ? "BYOK is disabled during the temporary trial. Create this workspace permanently below to connect a provider without losing your trial decisions." : workspace ? "BYOK is disabled in the local development workspace." : "Sign in to access your private library and provider keys."}</p>}
        </div>
        {authenticated ? <section className="account-danger-zone">
          <div><strong>Delete account and workspace</strong><p>Permanently removes your decisions, evidence, shares, provider keys, sessions, and account. This cannot be undone.</p></div>
          <label><span>Current password</span><input type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} placeholder="Required to delete" /></label>
          <button type="button" className="secondary danger" disabled={!deletePassword || accountDeleteBusy} onClick={() => setConfirmingAccountDelete(true)}><Trash2 aria-hidden="true" />Delete account</button>
        </section> : null}
        {!authenticated ? (
          <details className="optional-sign-in" open={!workspace || workspace.mode === "guest_personal"}>
            <summary>{workspace?.mode === "guest_personal" ? "Keep this trial workspace and add BYOK" : workspace ? "Optional: use a private pilot workspace" : "Sign in or create your private workspace"}</summary>
            {authMode === "reset" ? <div className="password-reset-heading">{!resetMessage || resetToken ? <button type="button" className="text-button" onClick={() => { setAuthMode("login"); setResetMessage(null); setError(null); }}><ArrowLeft aria-hidden="true" />Back to sign in</button> : null}<div><strong>{resetToken ? "Create a new password" : "Reset your password"}</strong><p>{resetToken ? "Choose a new password for your private workspace. Every other signed-in session will be revoked." : "Enter your account email and we’ll send a single-use reset link that expires in 30 minutes."}</p></div></div> : <div className="auth-mode-toggle" role="tablist" aria-label="Account action"><button type="button" role="tab" aria-selected={authMode === "login"} className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>Sign in</button><button type="button" role="tab" aria-selected={authMode === "register"} className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>Create workspace</button></div>}
            {authMode === "reset" && resetMessage && !resetToken ? <div className="password-reset-sent" role="status"><MailCheck aria-hidden="true" /><div><strong>Check your email</strong><p>{resetMessage} If it exists, open the link in that email to create a new password.</p></div><button type="button" className="secondary" onClick={() => { setResetMessage(null); setAuthMode("login"); }}>Back to sign in</button></div> : <form onSubmit={authMode === "login" ? handleLogin : authMode === "register" ? handleRegister : resetToken ? handleResetConfirm : handleResetRequest} className="account-login">
              {authMode === "register" ? <label><span>Display name</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Pilot reviewer" /></label> : null}
              {authMode !== "reset" || !resetToken ? <label><span>Email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label> : null}
              {authMode === "reset" && resetToken ? <label><span>One-time reset token</span><input required value={resetToken} onChange={(event) => setResetToken(event.target.value)} /></label> : null}
              {authMode === "reset" && resetToken ? <label><span>New password</span><input type="password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters" /></label> : null}
              {authMode === "reset" && resetToken ? <label><span>Confirm new password</span><input type="password" minLength={8} required value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} placeholder="Enter the new password again" /></label> : null}
              {authMode !== "reset" ? <label><span>Password</span><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></label> : null}
              {authMode === "login" ? <button type="button" className="forgot-password-link" onClick={() => { setAuthMode("reset"); setResetToken(""); setResetMessage(null); setError(null); }}>Forgot password?</button> : null}
              <button type="submit" className="primary" disabled={authBusy}>{authBusy ? "Working…" : <><LogIn aria-hidden="true" />{authMode === "login" ? "Sign in" : authMode === "register" ? "Create private workspace" : resetToken ? "Set new password" : "Send reset link"}</>}</button>
            </form>
            }
          </details>
        ) : null}
      </div>
      <ConfirmDialog open={Boolean(removeProvider)} title="Remove this provider key?" description="The encrypted key and its activated hosted model will be removed from this workspace. Built-in deterministic rules remain available." confirmLabel="Remove provider" busyLabel="Removing…" busy={secretBusy} onOpenChange={(open) => { if (!open) setRemoveProvider(null); }} onConfirm={() => { if (removeProvider) void handleRemoveKey(removeProvider); }} />
      <ConfirmDialog open={confirmingAccountDelete} title="Permanently delete this account?" description="Every decision, evidence file, share link, provider key, active session, and workspace record will be deleted. This action cannot be undone." confirmLabel="Delete everything" busyLabel="Deleting…" busy={accountDeleteBusy} onOpenChange={setConfirmingAccountDelete} onConfirm={() => { void handleDeleteAccount(); }} />
    </section>
  );
}
