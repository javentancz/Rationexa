import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./api/backend/[...path]/route";

const context = (path = ["v1", "bootstrap"]) => ({ params: Promise.resolve({ path }) });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("backend proxy boundaries", () => {
  it("cannot redirect credentials to a path-supplied host", async () => {
    vi.stubEnv("RATIONEXA_API_URL", "https://api.example/");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const path of [["https:", "evil.example"], ["..", "admin"], ["\\evil.example"], ["/evil.example"]]) {
      expect((await GET(new NextRequest("http://localhost/api/backend/v1"), context(path))).status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves separate cookies and forbids caching private responses", async () => {
    vi.stubEnv("RATIONEXA_API_URL", "https://api.example/");
    const headers = new Headers();
    headers.append("Set-Cookie", "session=one; HttpOnly");
    headers.append("Set-Cookie", "guest=two; HttpOnly");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { headers })));
    const response = await GET(new NextRequest("http://localhost/api/backend/v1/bootstrap"), context());
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("bounds uploads even without a declared content length", async () => {
    vi.stubEnv("RATIONEXA_API_URL", "https://api.example/");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const request = new NextRequest("http://localhost/api/backend/v1/artifacts/upload", { method: "POST", body: new Uint8Array(12_000_001) });
    expect((await POST(request, context(["v1", "artifacts", "upload"]))).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a contextual error when the upstream is unavailable", async () => {
    vi.stubEnv("RATIONEXA_API_URL", "https://api.example/");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private infrastructure detail")));
    const response = await GET(new NextRequest("http://localhost/api/backend/v1/bootstrap"), context());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private infrastructure detail");
  });
});
