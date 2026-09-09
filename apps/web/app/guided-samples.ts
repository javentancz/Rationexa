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
  "release-rollout": {
    label: "Release rollout",
    audience: "Product & reliability",
    title: "Roll out a new checkout",
    summary: "Revisit a launch plan when a small rollout reveals more payment failures.",
    source: "Decision: Roll out the new checkout to 10% of customers before expanding to everyone.\n\nWe chose a gradual rollout because the staging tests passed and payment failures were expected to stay below 1%. Checkout completion must remain above 65%, and the team must be able to restore the previous checkout within 15 minutes.\n\nRevisit the rollout if payment failures exceed 1%, completion drops below 65%, or rollback takes longer than 15 minutes.",
    evidence: "During the first day of the rollout, payment failures reached 3.2% and checkout completion fell to 59%.",
  },
  "support-coverage": {
    label: "Support coverage",
    audience: "Customer operations",
    title: "Keep support on business hours",
    summary: "Check a staffing decision when more urgent requests arrive overnight.",
    source: "Decision: Keep customer support on business hours instead of adding an overnight shift.\n\nWe chose this schedule because fewer than 5% of urgent requests were expected outside business hours and an on-call engineer could handle those requests. Urgent requests must receive a response within two hours.\n\nRevisit coverage if more than 5% of urgent requests arrive overnight or response times exceed two hours.",
    evidence: "Last month, 18% of urgent requests arrived overnight and their median first response took five hours.",
  },
  "data-retention": {
    label: "Data retention",
    audience: "Security & operations",
    title: "Keep audit logs for one year",
    summary: "Review a retention policy when a new customer requirement changes the timeline.",
    source: "Decision: Retain audit logs for 12 months in the primary log store.\n\nWe chose one year because current customer contracts require no more than 12 months of searchable history and monthly storage cost was expected to remain below $2,000. Logs must remain searchable throughout the retention period.\n\nRevisit retention if a customer contract requires more than 12 months or monthly storage cost exceeds $2,000.",
    evidence: "A newly signed customer contract requires 24 months of searchable audit history.",
  },
} as const;

export type GuidedSampleId = keyof typeof guidedSamples;

export function isGuidedSampleId(value: string | null): value is GuidedSampleId {
  return value !== null && Object.hasOwn(guidedSamples, value);
}
