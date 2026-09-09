"use client";

import type { SpeedInsightsProps } from "@vercel/speed-insights";
import { SpeedInsights } from "@vercel/speed-insights/next";

type SpeedInsightEvent = Parameters<NonNullable<SpeedInsightsProps["beforeSend"]>>[0];

export function filterSpeedInsightEvent(event: SpeedInsightEvent): SpeedInsightEvent | null {
  const pathname = new URL(event.url, "https://rationexa.invalid").pathname;

  // Public share URLs contain revocable access tokens. Never send those paths
  // to performance telemetry, even though the shared response is scrubbed.
  return pathname.startsWith("/share/") ? null : event;
}

export function WebSpeedInsights() {
  return <SpeedInsights beforeSend={filterSpeedInsightEvent} />;
}
