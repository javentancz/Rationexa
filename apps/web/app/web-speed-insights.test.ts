import { describe, expect, it } from "vitest";

import { filterSpeedInsightEvent } from "./web-speed-insights";

describe("speed insights privacy filter", () => {
  it("keeps ordinary performance events", () => {
    const event = { type: "vital" as const, url: "https://rationexa.example/library" };

    expect(filterSpeedInsightEvent(event)).toBe(event);
  });

  it("drops share-token performance events", () => {
    const event = { type: "vital" as const, url: "https://rationexa.example/share/private-token" };

    expect(filterSpeedInsightEvent(event)).toBeNull();
  });
});
