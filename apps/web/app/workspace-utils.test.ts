import { describe, expect, it } from "vitest";

import { guidedSamples, isGuidedSampleId } from "./guided-samples";
import { browserShareUrl, workspacePaths, workspaceViewFromPath } from "./workspace-utils";

describe("workspace routing", () => {
  it.each([
    ["/workspace", "workspace"],
    ["/library", "library"],
    ["/library/important", "library"],
    ["/usage", "usage"],
    ["/settings", "settings"],
    ["/account/reset", "settings"],
  ] as const)("maps %s to %s", (pathname, expected) => {
    expect(workspaceViewFromPath(pathname)).toBe(expected);
  });

  it("keeps every workspace view on a clean path", () => {
    expect(workspacePaths).toEqual({
      workspace: "/workspace",
      library: "/library",
      usage: "/usage",
      settings: "/settings",
    });
    expect(Object.values(workspacePaths).every((path) => !path.includes("#"))).toBe(true);
  });
});

describe("shared record URLs", () => {
  it("uses the API-provided URL during server rendering", () => {
    expect(browserShareUrl({ token: "a token/with symbols", url: "https://example.test/shared" })).toBe(
      "https://example.test/shared",
    );
  });

  it("falls back to an encoded application path when no public URL exists", () => {
    expect(browserShareUrl({ token: "a token/with symbols", url: null })).toBe(
      "/share/a%20token%2Fwith%20symbols",
    );
  });
});

describe("guided examples", () => {
  it("recognizes only registered cases", () => {
    expect(isGuidedSampleId("vendor-review")).toBe(true);
    expect(isGuidedSampleId("unknown-case")).toBe(false);
    expect(isGuidedSampleId(null)).toBe(false);
  });

  it("gives every case a decision, evidence, and revisit trigger", () => {
    for (const sample of Object.values(guidedSamples)) {
      expect(sample.source).toContain("Decision:");
      expect(sample.source).toContain("Revisit");
      expect(sample.evidence.length).toBeGreaterThan(40);
    }
  });
});
