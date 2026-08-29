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
  let response: Response;
  try {
    response = await fetch(`${api}${path}`, { ...options, cache: options.cache ?? "no-store", headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Rationexa could not reach the API. Check the service connection and try again.", { cause: error });
  }
  if (response.status === 401 && token) {
    setSessionToken(null);
    window.dispatchEvent(new Event("rationexa-auth-expired"));
  }
  return response;
}

export async function login(email: string, password: string): Promise<{ session_token: string }> {
  const response = await fetch(`${api}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return responseJson(response);
}

export async function register(name: string, email: string, password: string): Promise<{ session_token: string }> {
  const response = await fetch(`${api}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  return responseJson(response);
}

export async function requestPasswordReset(email: string): Promise<{ message: string; development_token?: string }> {
  const response = await fetch(`${api}/v1/auth/password-reset/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return responseJson(response);
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<{ session_token: string }> {
  const response = await fetch(`${api}/v1/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  return responseJson(response);
}

export async function logout(): Promise<void> {
  await apiFetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined);
  setSessionToken(null);
}

export { responseJson };
