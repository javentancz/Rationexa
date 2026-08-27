"use client";

import { FormEvent, useEffect, useState } from "react";
import { KeyRound, LogIn, LogOut, Plus, Trash2, UserRound } from "lucide-react";
import { apiFetch, getSessionToken, login, logout, setSessionToken } from "./api";

type AccountRead = { id: string; name: string; email?: string; has_password: boolean; created_at: string };
type SecretRead = { provider: string; configured: boolean; last_updated_at?: string; source: string };

export function AccountPanel() {
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
      const who = await apiFetch("/v1/account");
      setAuthenticated(true);
      setAccount(who as AccountRead);
      const stored = await apiFetch("/v1/secrets");
      setSecrets((stored as SecretRead[]) ?? []);
    } catch (caught) {
      setAuthenticated(false);
      setAccount(null);
      setSecrets([]);
      setError(caught instanceof Error ? caught.message : "Could not load account");
    }
  }

  useEffect(() => {
    const token = getSessionToken();
    if (!token) {
      setAuthenticated(false);
      setAccount(null);
     } else {
      void refresh();
     }
  }, []);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setError(null);
    try {
      const session = await login(email, password);
      setSessionToken(session.session_token);
      setAuthenticated(true);
      await refresh();
     } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed");
     } finally {
      setAuthBusy(false);
     }
  }

  async function handleLogout() {
    await logout();
    setAuthenticated(false);
    setAccount(null);
    setSecrets([]);
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
     } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove the key");
     } finally {
      setSecretBusy(false);
     }
  }

  return (
     <section className="usage-section account-section">
       <div className="usage-section-heading"><div><span className="overline">Account &amp; provider keys</span><h2>Your workspace</h2></div><span>Encrypted, per-workspace, never shared</span></div>
       {error ? <p className="account-error">{error}</p> : null}
       {authenticated && account ? (
          <div className="account-body">
             <div className="account-identity"><span className="account-avatar"><UserRound aria-hidden="true" /></span><div><strong>{account.name}</strong><small>{account.email ?? "No email on file"}</small></div></div>
             <div className="account-actions"><button type="button" className="text-button danger" disabled={secretBusy} onClick={handleLogout}><LogOut aria-hidden="true" />Sign out</button></div>
             <div className="account-secrets">
               <form onSubmit={handleStoreKey} className="account-key-form">
                 <label><span>Provider key <small>OpenAI · stored encrypted</small></span><input type="password" autoComplete="off" value={keyEntry} onChange={(event) => setKeyEntry(event.target.value)} placeholder="sk-…" /></label>
                 <button type="submit" className="primary" disabled={secretBusy || !keyEntry}><KeyRound aria-hidden="true" />Store key</button>
               </form>
               {secrets.length ? <ul className="account-key-list">{secrets.map((secret) => <li key={secret.provider}><span><strong>{secret.provider}</strong><small>{secret.configured ? "Configured" : "Empty"}</small></span><button type="button" className="icon-action danger" aria-label={`Remove ${secret.provider} key`} disabled={secretBusy || !secret.configured} onClick={() => handleRemoveKey(secret.provider)}><Trash2 aria-hidden="true" /></button></li>)}</ul> : <p className="account-empty">No provider keys stored. Local models need none.</p>}
            </div>
          </div>
     ) : (
          <form onSubmit={handleLogin} className="account-login">
            <label><span>Email</span><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
            <label><span>Password</span><input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></label>
            <button type="submit" className="primary" disabled={authBusy}>{authBusy ? "Signing in…" : <><LogIn aria-hidden="true" />Sign in</>}</button>
            <p className="account-hint"><Plus aria-hidden="true" />New here? Create an account on the API or use the local session to continue without one.</p>
          </form>
        )}
     </section>
  );
}
