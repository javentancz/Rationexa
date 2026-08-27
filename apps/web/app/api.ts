"use client";

export const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const SESSION_KEY = "rationexa-session-token";

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(SESSION_KEY, token);
  } else {
    window.localStorage.removeItem(SESSION_KEY);
  }
}

async function responseJson(response: Response) {
  if (response.ok) return response.json();
  const payload = await response.json().catch(() => null);
  throw new Error(payload?.detail ?? `Request failed with status ${response.status}`);
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await apiResponse(path, options);
  if (response.status === 204) return undefined;
  return responseJson(response);
}

export async function apiResponse(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getSessionToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${api}${path}`, { ...options, cache: options.cache ?? "no-store", headers });
}

export async function login(email: string, password: string): Promise<{ session_token: string }> {
  const response = await fetch(`${api}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return responseJson(response);
}

export async function logout(): Promise<void> {
  await apiFetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined);
  setSessionToken(null);
}

export { responseJson };
