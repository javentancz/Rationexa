"use client";

export const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const SESSION_KEY = "rationexa-session-token";
const AUTH_MARKER_KEY = "rationexa-authenticated";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string | null): void {
  if (typeof window === "undefined") return;
  // New sessions use an HttpOnly cookie. This only clears or temporarily
  // supports bearer sessions issued before the cookie migration.
  if (token) window.sessionStorage.setItem(SESSION_KEY, token);
  else {
    window.localStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(AUTH_MARKER_KEY);
  }
}

export function setAuthenticatedState(authenticated: boolean): void {
  if (typeof window === "undefined") return;
  if (authenticated) window.localStorage.setItem(AUTH_MARKER_KEY, "true");
  else setSessionToken(null);
}

export function handleAuthenticationResponse(response: Response): void {
  if (typeof window === "undefined") return;
  const token = getSessionToken() ?? window.sessionStorage.getItem(SESSION_KEY);
  const expectedSession = Boolean(token) || window.localStorage.getItem(AUTH_MARKER_KEY) === "true";
  if (response.status === 401 && expectedSession) {
    setSessionToken(null);
    window.dispatchEvent(new Event("rationexa-auth-expired"));
  }
}

async function responseJson(response: Response) {
  if (response.ok) return response.json();
  const payload = await response.json().catch(() => null);
  throw new ApiError(payload?.detail ?? `Request failed with status ${response.status}`, response.status);
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const response = await apiResponse(path, options);
  if (response.status === 204) return undefined;
  return responseJson(response);
}

export async function apiResponse(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getSessionToken() ?? (typeof window !== "undefined" ? window.sessionStorage.getItem(SESSION_KEY) : null);
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${api}${path}`, {
      ...options,
      cache: options.cache ?? "no-store",
      credentials: "include",
      headers,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("Rationexa could not reach the API. Check the service connection and try again.", { cause: error });
  }
  handleAuthenticationResponse(response);
  return response;
}

export async function login(email: string, password: string): Promise<{ session_token: string }> {
  const response = await fetch(`${api}/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    credentials: "include",
  });
  const result = await responseJson(response);
  setAuthenticatedState(true);
  return result;
}

export async function register(name: string, email: string, password: string): Promise<{ session_token: string }> {
  const response = await fetch(`${api}/v1/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
    credentials: "include",
  });
  const result = await responseJson(response);
  setAuthenticatedState(true);
  return result;
}

export async function requestPasswordReset(email: string): Promise<{ message: string; development_token?: string }> {
  const response = await fetch(`${api}/v1/auth/password-reset/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    credentials: "include",
  });
  const result = await responseJson(response);
  return result;
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<{ session_token: string }> {
  const response = await fetch(`${api}/v1/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, new_password: newPassword }),
    credentials: "include",
  });
  const result = await responseJson(response);
  setAuthenticatedState(true);
  return result;
}

export async function logout(): Promise<void> {
  await apiFetch("/v1/auth/logout", { method: "POST" }).catch(() => undefined);
  setSessionToken(null);
}

export { responseJson };
