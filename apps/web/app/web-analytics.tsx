"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

export function filterAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  const pathname = new URL(event.url, "https://rationexa.invalid").pathname;

  // Public share URLs contain revocable access tokens. Never send those paths
  // to analytics, even though the shared response itself is already scrubbed.
  return pathname.startsWith("/share/") ? null : event;
}

export function WebAnalytics() {
  return <Analytics beforeSend={filterAnalyticsEvent} />;
}
