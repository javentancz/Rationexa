import { describe, expect, it } from "vitest";

import { filterAnalyticsEvent } from "./web-analytics";

describe("web analytics privacy filter", () => {
  it("keeps ordinary page views", () => {
    const event = { type: "pageview" as const, url: "https://rationexa.example/library" };

    expect(filterAnalyticsEvent(event)).toBe(event);
  });

  it("drops share-token page views", () => {
    const event = { type: "pageview" as const, url: "https://rationexa.example/share/private-token" };

    expect(filterAnalyticsEvent(event)).toBeNull();
  });
});
