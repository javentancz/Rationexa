import { api } from "./api";

type ErrorContext = {
  category: "react_error" | "global_error" | "unhandled_rejection";
  component?: string;
};

const reported = new Set<string>();

function normalizedRoute() {
  if (typeof window === "undefined") return "/unknown";
  if (window.location.pathname.startsWith("/share/")) return "/share/[token]";
  return window.location.pathname || "/";
}

async function digestFor(error: unknown) {
  const candidate = error instanceof Error
    ? `${error.name}:${error.stack ?? error.message}`
    : Object.prototype.toString.call(error);
  const bytes = new TextEncoder().encode(candidate);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function reportClientError(error: unknown, context: ErrorContext) {
  if (typeof window === "undefined") return;
  try {
    const digest = await digestFor(error);
    const dedupeKey = `${context.category}:${normalizedRoute()}:${digest}`;
    if (reported.has(dedupeKey)) return;
    reported.add(dedupeKey);
    await fetch(`${api}/v1/telemetry/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        category: context.category,
        route: normalizedRoute(),
        digest,
        component: context.component,
      }),
    });
  } catch {
    // Monitoring must never create another user-visible failure.
  }
}
