"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, LogIn, LogOut, Trash2, UserRound } from "lucide-react";
import { apiFetch, getSessionToken, login, logout, setSessionToken } from "./api";

type AccountRead = { id: string; name: string; email?: string; has_password: boolean; created_at: string };
type WorkspaceRead = { id: string; name: string; account_name: string };
type SecretRead = { provider: string; configured: boolean; last_updated_at?: string; source: string };

type AccountPanelProps = {
  onConfigurationChanged?: () => void;
};

export function AccountPanel({ onConfigurationChanged }: AccountPanelProps) {
  const [authenticated, setAuthenticated] = useState(false);
  const [account, setAccount] = useState<AccountRead | null>(null);
  const [secrets, setSecrets] = useState<SecretRead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [keyEntry, setKeyEntry] = useState("");
  const [secretBusy, setSecretBusy] = useState(false);

  async function refresh() {
    setError(null);
    try {
      const token = getSessionToken();
      if (token) {
        const who = (await apiFetch("/v1/account")) as AccountRead;
        setAuthenticated(true);
        setAccount(who);
      } else {
        const workspace = (await apiFetch("/v1/workspace")) as WorkspaceRead;
        setAuthenticated(false);
        setAccount({
          id: workspace.id,
          name: workspace.account_name,
          has_password: false,
          created_at: "",
        });
      }
      const stored = await apiFetch("/v1/secrets");
      setSecrets((stored as SecretRead[]) ?? []);
    } catch (caught) {
      setAccount(null);
      setSecrets([]);
      setError(caught instanceof Error ? caught.message : "Could not load workspace settings");
    }
  }

  useEffect(() => {
    void refresh();
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
        body: JSON.stringify({ provider: "openai", key: keyEntry }),
      });
      setKeyEntry("");
      await refresh();
      onConfigurationChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not store the key");
    } finally {
      setSecretBusy(false);
    }
  }

  async function handleRemoveKey(provider: string) {
    setSecretBusy(true);
    setError(null);
    try {
      await apiFetch(`/v1/secrets/${provider}`, { method: "DELETE" });
      await refresh();
      onConfigurationChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the key");
    } finally {
      setSecretBusy(false);
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
        <span>Local-first · BYOK optional</span>
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
        <div className="account-secrets">
          <div className="byok-heading">
            <KeyRound aria-hidden="true" />
            <div>
              <strong>Bring your own API key</strong>
              <p>Add a hosted provider for faster or deeper runs. Qwen, Gemma, and Ornith remain available through Ollama without a key.</p>
            </div>
          </div>
          <form onSubmit={handleStoreKey} className="account-key-form">
            <label><span>OpenAI API key <small>Encrypted on this machine</small></span><input type="password" autoComplete="off" value={keyEntry} onChange={(event) => setKeyEntry(event.target.value)} placeholder="sk-…" /></label>
            <button type="submit" className="primary" disabled={secretBusy || !keyEntry}><KeyRound aria-hidden="true" />{secretBusy ? "Saving…" : "Store key"}</button>
          </form>
          {secrets.length ? (
            <ul className="account-key-list">
              {secrets.map((secret) => (
                <li key={secret.provider}>
                  <span><strong>{secret.provider}</strong><small>{secret.configured ? "Configured" : "Empty"}</small></span>
                  <button type="button" className="icon-action danger" aria-label={`Remove ${secret.provider} key`} disabled={secretBusy || !secret.configured} onClick={() => handleRemoveKey(secret.provider)}><Trash2 aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          ) : <p className="account-empty">No hosted-provider keys stored. Local models are ready without one.</p>}
        </div>
        {!authenticated ? (
          <details className="optional-sign-in">
            <summary>Optional: sign in for another workspace</summary>
            <form onSubmit={handleLogin} className="account-login">
              <label><span>Email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
              <label><span>Password</span><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></label>
              <button type="submit" className="primary" disabled={authBusy}>{authBusy ? "Signing in…" : <><LogIn aria-hidden="true" />Sign in</>}</button>
            </form>
          </details>
        ) : null}
      </div>
    </section>
  );
}
