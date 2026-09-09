import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forwardedResponseHeaders = [
  "content-disposition", "content-type", "retry-after", "server-timing", "x-request-id",
];
const maxBodyBytes = 12_000_000; // Includes multipart framing around a 10 MB artifact.

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
  const error = (detail: string, status: number) => Response.json({ detail }, { status, headers: privateHeaders });
  const apiUrl = process.env.RATIONEXA_API_URL;
  if (!apiUrl) return error("The API connection is not configured.", 503);

  const { path } = await context.params;
  // Never allow a catch-all parameter to become an absolute URL or escape the API base.
  if (path.some((part) => !part || part === "." || part === ".." || /[\\/:?#]/.test(part))) {
    return error("Invalid API path.", 400);
  }
  const target = new URL(path.map(encodeURIComponent).join("/"), `${apiUrl.replace(/\/$/, "")}/`);
  target.search = request.nextUrl.search;
  const headers = new Headers(request.headers);
  for (const name of ["host", "content-length", "connection", "transfer-encoding", "upgrade"]) headers.delete(name);

  const method = request.method.toUpperCase();
  let body: Uint8Array<ArrayBuffer> | undefined;
  if (method !== "GET" && method !== "HEAD" && request.body) {
    if (Number(request.headers.get("content-length")) > maxBodyBytes) return error("Request exceeds the 12 MB limit.", 413);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBodyBytes) {
          await reader.cancel();
          return error("Request exceeds the 12 MB limit.", 413);
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  }

  try {
    const response = await fetch(target, {
      method, headers, body, cache: "no-store", redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(240_000)]),
    });
    const responseHeaders = new Headers(privateHeaders);
    for (const name of forwardedResponseHeaders) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    for (const cookie of response.headers.getSetCookie()) responseHeaders.append("set-cookie", cookie);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return error("The API could not be reached. Your draft is still here; please try again.", 502);
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
