export const guidedSamples = {
  "vendor-review": {
    label: "Identity platform",
    audience: "Product & security",
    title: "Choose an identity provider",
    summary: "Revisit a vendor choice when a launch-critical capability slips.",
    source: "Decision: Choose an identity provider for the customer portal.\n\nWe selected Vendor B because it supports SAML, fits the current budget, and is expected to add external-user administration before the pilot launches. The security team requires audit logs to remain available for at least 12 months.\n\nRevisit this decision if Vendor B delays external-user administration, changes its audit-log retention, or increases annual pricing above $24,000.",
    evidence: "Vendor B delayed external-user administration until next quarter, after the planned pilot launch.",
  },
  "pricing-launch": {
    label: "Launch pricing",
    audience: "Growth & finance",
    title: "Launch an annual starter plan",
    summary: "Check a pricing decision when early conversion evidence misses the forecast.",
    source: "Decision: Launch the starter plan at $240 per year with a 20% annual discount.\n\nWe chose this price because interviews suggested small teams would accept a $20 monthly equivalent and annual billing was expected to keep first-year churn below 12%. Gross margin must remain above 70%, and support cost must stay below $18 per account each month.\n\nRevisit the price if conversion falls below 8%, churn exceeds 12%, or support cost rises above the limit.",
    evidence: "After the first 60 days, starter-plan conversion is 5.4% and projected first-year churn is 18%.",
  },
  "build-or-buy": {
    label: "Build or buy",
    audience: "Engineering leaders",
    title: "Adopt a managed search service",
    summary: "Reassess an architecture choice after its operating-cost assumption changes.",
    source: "Decision: Use a managed search service instead of building and operating our own cluster.\n\nWe selected the managed service because the platform team has no search specialist, launch is required within eight weeks, and monthly usage was expected to remain below $6,000. Customer data must stay in the EU region and exports must be available for audit recovery.\n\nRevisit this decision if monthly cost exceeds $6,000, EU residency changes, or the platform team hires a search specialist.",
    evidence: "The latest usage forecast puts managed-search cost at $9,200 per month for the next two quarters.",
  },
} as const;

export type GuidedSampleId = keyof typeof guidedSamples;

export function isGuidedSampleId(value: string | null): value is GuidedSampleId {
  return value !== null && Object.hasOwn(guidedSamples, value);
}
