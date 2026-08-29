import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forwardedResponseHeaders = [
  "content-disposition",
  "content-type",
  "retry-after",
  "server-timing",
];

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const apiUrl = process.env.RATIONEXA_API_URL;
  if (!apiUrl) {
    return Response.json({ detail: "The staging API proxy is not configured." }, { status: 503 });
  }

  const { path } = await context.params;
  const target = new URL(path.join("/"), `${apiUrl.replace(/\/$/, "")}/`);
  target.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const method = request.method.toUpperCase();
  const response = await fetch(target, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
    cache: "no-store",
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  for (const name of forwardedResponseHeaders) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
