"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, LogIn, LogOut, Monitor, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, confirmPasswordReset, getSessionToken, login, logout, register, requestPasswordReset, setSessionToken } from "./api";
import { ConfirmDialog } from "./ui";

type AccountRead = { id: string; name: string; email?: string; has_password: boolean; created_at: string };
type WorkspaceRead = { id: string; name: string; account_name: string };
type SessionSummary = { id: string; created_at: string; expires_at: string; current: boolean };
type SecretRead = { provider: string; configured: boolean; label?: string; base_url?: string; selected_model?: string; protocol?: string; last_updated_at?: string; source: string };
type ProviderModels = { models: string[] };
type ProviderTest = { provider: string; ok: boolean; model_count: number; latency_ms: number };

const providerOptions = [
  { id: "openrouter", label: "OpenRouter", detail: "Many model companies through one compatible API" },
  { id: "openai", label: "OpenAI direct", detail: "Models available to your OpenAI project" },
  { id: "custom", label: "Custom compatible API", detail: "Your own OpenAI-compatible endpoint" },
] as const;

type AccountPanelProps = {
  onConfigurationChanged?: () => void;
  onWorkspaceProfileChanged?: () => void;
};

export function AccountPanel({ onConfigurationChanged, onWorkspaceProfileChanged }: AccountPanelProps) {
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

  async function refresh() {
    setError(null);
    const startedWithToken = Boolean(getSessionToken());
    try {
      const token = getSessionToken();
      if (token) {
        const [who, currentWorkspace, activeSessions] = await Promise.all([
          apiFetch("/v1/account") as Promise<AccountRead>,
          apiFetch("/v1/workspace") as Promise<WorkspaceRead>,
          apiFetch("/v1/auth/sessions") as Promise<SessionSummary[]>,
        ]);
        setAuthenticated(true);
        setAccount(who);
        setWorkspace(currentWorkspace);
        setSessions(activeSessions);
        setProfileName(who.name);
        setWorkspaceName(currentWorkspace.name);
      } else {
        const workspace = (await apiFetch("/v1/workspace")) as WorkspaceRead;
        setAuthenticated(false);
        setAccount({
          id: workspace.id,
          name: workspace.account_name,
          has_password: false,
          created_at: "",
        });
        setWorkspace(workspace);
        setSessions([]);
      }
      const entries = token ? ((await apiFetch("/v1/secrets")) as SecretRead[]) ?? [] : [];
      setSecrets(entries);
      setProviderModelSelection((current) => entries.reduce<Record<string, string>>((next, entry) => {
        if (entry.selected_model) next[entry.provider] = entry.selected_model;
        return next;
      }, { ...current }));
    } catch (caught) {
      if (startedWithToken && getSessionToken() === null) {
        const workspace = (await apiFetch("/v1/workspace")) as WorkspaceRead;
        setAuthenticated(false);
        setAccount({ id: workspace.id, name: workspace.account_name, has_password: false, created_at: "" });
        setWorkspace(workspace);
        setSessions([]);
        setSecrets([]);
        return;
      }
      setAccount(null);
      setWorkspace(null);
      setSessions([]);
      setSecrets([]);
      setError(caught instanceof Error ? caught.message : "Could not load workspace settings");
    }
  }

  useEffect(() => {
    const resetHash = window.location.hash.match(/^#account-reset=(.+)$/);
    if (resetHash) {
      setResetToken(decodeURIComponent(resetHash[1]));
      setAuthMode("reset");
    }
    void refresh();
    const recover = () => { void refresh(); };
    window.addEventListener("rationexa-auth-expired", recover);
    return () => window.removeEventListener("rationexa-auth-expired", recover);
  }, []);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setError(null);
    try {
      const session = await login(email, password);
      setSessionToken(session.session_token);
      await refresh();
      onConfigurationChanged?.();
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
      const session = await register(name, email, password);
      setSessionToken(session.session_token);
      setName("");
      setEmail("");
      setPassword("");
      await refresh();
      onConfigurationChanged?.();
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
    setAuthBusy(true);
    setError(null);
    try {
      const session = await confirmPasswordReset(resetToken, newPassword);
      setSessionToken(session.session_token);
      setResetToken("");
      setNewPassword("");
      setResetMessage(null);
      setAuthMode("login");
      await refresh();
      onConfigurationChanged?.();
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
      await refresh();
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
      await refresh();
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
      await refresh();
      toast.success("Other sessions signed out");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign out other sessions");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleLogout() {
    await logout();
    await refresh();
    onConfigurationChanged?.();
  }

  async function handleStoreKey(event: FormEvent) {
    event.preventDefault();
    setSecretBusy(true);
    setError(null);
    try {
      await apiFetch("/v1/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerEntry, key: keyEntry, base_url: providerEntry === "custom" ? baseUrlEntry : undefined }),
      });
      setKeyEntry("");
      if (providerEntry === "custom") setBaseUrlEntry("");
      await refresh();
      await loadProviderModels(providerEntry);
      onConfigurationChanged?.();
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
      await apiFetch(`/v1/secrets/${provider}/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      await refresh();
      onConfigurationChanged?.();
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
      await refresh();
      onConfigurationChanged?.();
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
      await refresh();
      onConfigurationChanged?.();
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
      <div className="usage-section-heading">
        <div><span className="overline">Models &amp; provider keys</span><h2>Your AI runtime</h2></div>
        <span>{authenticated ? "Private workspace · encrypted BYOK" : "Local models · sign in for BYOK"}</span>
      </div>
      {error ? <p className="account-error">{error}</p> : null}
      <div className="account-body">
        <div className="account-identity">
          <span className="account-avatar"><UserRound aria-hidden="true" /></span>
          <div>
            <strong>{account.name}</strong>
            <small>{authenticated ? account.email ?? "Signed-in workspace" : "Local personal workspace · no signup required"}</small>
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
              <div className="byok-heading"><UserRound aria-hidden="true" /><div><strong>Workspace profile</strong><p>Names shown only inside this private pilot workspace.</p></div></div>
              <form className="account-login" onSubmit={handleProfileSave}>
                <label><span>Display name</span><input required value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label>
                <label><span>Workspace name</span><input required value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} /></label>
                <button type="submit" className="secondary" disabled={authBusy || !workspace}>Save profile</button>
              </form>
            </section>
            <section className="account-management-card">
              <div className="byok-heading"><ShieldCheck aria-hidden="true" /><div><strong>Password security</strong><p>Changing your password signs out every other active session.</p></div></div>
              <form className="account-login" onSubmit={handlePasswordChange}>
                <label><span>Current password</span><input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
                <label><span>New password</span><input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
                <button type="submit" className="secondary" disabled={authBusy}>Change password</button>
              </form>
            </section>
            <section className="account-management-card account-sessions">
              <div className="byok-heading"><Monitor aria-hidden="true" /><div><strong>Active sessions</strong><p>Review access to this workspace and sign out other browsers.</p></div></div>
              <ul>{sessions.map((session) => <li key={session.id}><span><strong>{session.current ? "This browser" : "Signed-in browser"}</strong><small>Started {new Date(session.created_at).toLocaleString()} · expires {new Date(session.expires_at).toLocaleString()}</small></span>{session.current ? <em>Current</em> : null}</li>)}</ul>
              <button type="button" className="text-button danger" disabled={authBusy || sessions.every((session) => session.current)} onClick={handleLogoutOthers}>Sign out other sessions</button>
            </section>
          </div>
        ) : null}
        <div className="account-secrets">
          <div className="byok-heading">
            <KeyRound aria-hidden="true" />
            <div>
              <strong>Bring your own API key</strong>
              <p>{authenticated ? "Connect a platform, load its live model catalog, then activate the model you want. The key is isolated to this signed-in workspace." : "Sign in or create a private workspace before connecting a hosted provider. Anonymous browsers can use local models but cannot store or use BYOK credentials."}</p>
            </div>
          </div>
          {authenticated ? <><form onSubmit={handleStoreKey} className="account-key-form">
            <label><span>Provider platform</span><select value={providerEntry} onChange={(event) => setProviderEntry(event.target.value)}>{providerOptions.map((provider) => <option key={provider.id} value={provider.id}>{provider.label} — {provider.detail}</option>)}</select></label>
            {providerEntry === "custom" ? <label><span>Compatible API base URL <small>HTTPS, or localhost for development</small></span><input type="url" required value={baseUrlEntry} onChange={(event) => setBaseUrlEntry(event.target.value)} placeholder="https://api.example.com/v1" /></label> : null}
            <label><span>Provider API key <small>Encrypted on this machine</small></span><input type="password" autoComplete="off" value={keyEntry} onChange={(event) => setKeyEntry(event.target.value)} placeholder="Paste this provider's API key" /></label>
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
          ) : <p className="account-empty">No hosted-provider keys stored. Local models are ready without one.</p>}</> : <p className="account-empty">BYOK is disabled in the anonymous local workspace to prevent one visitor's key from being shared with other browsers.</p>}
        </div>
        {authenticated ? <section className="account-danger-zone">
          <div><strong>Delete account and workspace</strong><p>Permanently removes your decisions, evidence, shares, provider keys, sessions, and account. This cannot be undone.</p></div>
          <label><span>Current password</span><input type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} placeholder="Required to delete" /></label>
          <button type="button" className="secondary danger" disabled={!deletePassword || accountDeleteBusy} onClick={() => setConfirmingAccountDelete(true)}><Trash2 aria-hidden="true" />Delete account</button>
        </section> : null}
        {!authenticated ? (
          <details className="optional-sign-in">
            <summary>Optional: use a private pilot workspace</summary>
            <div className="auth-mode-toggle" role="tablist" aria-label="Account action"><button type="button" role="tab" aria-selected={authMode === "login"} className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>Sign in</button><button type="button" role="tab" aria-selected={authMode === "register"} className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>Create workspace</button><button type="button" role="tab" aria-selected={authMode === "reset"} className={authMode === "reset" ? "active" : ""} onClick={() => setAuthMode("reset")}>Reset password</button></div>
            <form onSubmit={authMode === "login" ? handleLogin : authMode === "register" ? handleRegister : resetToken ? handleResetConfirm : handleResetRequest} className="account-login">
              {authMode === "register" ? <label><span>Display name</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Pilot reviewer" /></label> : null}
              {authMode !== "reset" || !resetToken ? <label><span>Email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label> : null}
              {authMode === "reset" && resetToken ? <label><span>One-time reset token</span><input required value={resetToken} onChange={(event) => setResetToken(event.target.value)} /></label> : null}
              {authMode === "reset" && resetToken ? <label><span>New password</span><input type="password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters" /></label> : null}
              {authMode !== "reset" ? <label><span>Password</span><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></label> : null}
              {resetMessage ? <p className="account-hint">{resetMessage}</p> : null}
              <button type="submit" className="primary" disabled={authBusy}>{authBusy ? "Working…" : <><LogIn aria-hidden="true" />{authMode === "login" ? "Sign in" : authMode === "register" ? "Create private workspace" : resetToken ? "Set new password" : "Send reset link"}</>}</button>
            </form>
          </details>
        ) : null}
      </div>
      <ConfirmDialog open={Boolean(removeProvider)} title="Remove this provider key?" description="The encrypted key and its activated model will be removed from this workspace. Local Ollama models remain available." confirmLabel="Remove provider" busyLabel="Removing…" busy={secretBusy} onOpenChange={(open) => { if (!open) setRemoveProvider(null); }} onConfirm={() => { if (removeProvider) void handleRemoveKey(removeProvider); }} />
      <ConfirmDialog open={confirmingAccountDelete} title="Permanently delete this account?" description="Every decision, evidence file, share link, provider key, active session, and workspace record will be deleted. This action cannot be undone." confirmLabel="Delete everything" busyLabel="Deleting…" busy={accountDeleteBusy} onOpenChange={setConfirmingAccountDelete} onConfirm={() => { void handleDeleteAccount(); }} />
    </section>
  );
}
