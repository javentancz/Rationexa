import { ChartNoAxesColumn, CircleDollarSign, Clock3, Cpu } from "lucide-react";

import type { PilotMetrics, UsageSummary } from "./workspace-types";
import { formatDateTime, formatNumber } from "./workspace-utils";

type UsageViewProps = {
  guest: boolean;
  usage: UsageSummary | null;
  pilotMetrics: PilotMetrics | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenDecision: (decisionId: string) => void;
};

export function UsageView({ guest, usage, pilotMetrics, loading, onRefresh, onOpenSettings, onOpenDecision }: UsageViewProps) {
  return <section className="usage-view">
    {guest ? <div className="guest-access-card"><div><strong>Temporary guest usage</strong><p>Only deterministic runs from this browser’s isolated guest workspace appear here. Create a permanent workspace to retain history and connect BYOK models.</p></div><button className="primary" onClick={onOpenSettings}>Keep history &amp; add BYOK →</button></div> : null}
    <div className="usage-intro"><span className="usage-intro-icon"><ChartNoAxesColumn aria-hidden="true" /></span><div><strong>Workspace AI activity</strong><p>Usage is calculated from persisted extraction, revisit, and challenge provenance. Known cost excludes runs whose provider did not report a price.</p></div><button type="button" className="text-button" disabled={loading} onClick={onRefresh}>{loading ? "Refreshing…" : "Refresh usage"}</button></div>
    {loading && !usage ? <div className="library-empty"><span className="spinner dark" /><strong>Calculating workspace usage…</strong></div> : usage ? <>
      <div className="usage-summary-grid">
        <article><span><Cpu aria-hidden="true" />AI runs</span><strong>{formatNumber(usage.total_runs)}</strong><p>{usage.extraction_runs} extraction · {usage.revisit_runs} revisit · {usage.challenge_runs} challenge</p></article>
        <article><span><CircleDollarSign aria-hidden="true" />Known estimated cost</span><strong>${usage.known_cost_usd.toFixed(4)}</strong><p>{usage.unpriced_run_count ? `${usage.unpriced_run_count} run${usage.unpriced_run_count === 1 ? " is" : "s are"} not included because pricing was unavailable` : "Every recorded run includes a cost estimate"}</p></article>
        <article><span><ChartNoAxesColumn aria-hidden="true" />Recorded tokens</span><strong>{formatNumber(usage.total_tokens)}</strong><p>Token counts available for {usage.tokenized_run_count} of {usage.total_runs} runs</p></article>
        <article><span><Clock3 aria-hidden="true" />Runtime location</span><strong>{usage.local_runs} local</strong><p>{usage.hosted_runs} hosted · {usage.unknown_location_runs} unknown · based on provider provenance</p></article>
      </div>
      <section className="usage-section"><div className="usage-section-heading"><div><span className="overline">Model breakdown</span><h2>Runs by model</h2></div><span>Known cost never estimates missing provider prices</span></div>{usage.models.length ? <div className="usage-models">{usage.models.map((model) => {
        const maxRuns = Math.max(...usage.models.map((item) => item.run_count), 1);
        return <article key={`${model.provider}/${model.model}`}><div className="usage-model-name"><span>{model.model.slice(0, 1).toUpperCase()}</span><div><strong>{model.model}</strong><small>{model.provider} · {model.location}</small></div></div><div className="usage-model-meter"><span style={{ width: `${Math.max(8, Math.round((model.run_count / maxRuns) * 100))}%` }} /></div><div className="usage-model-stats"><span><strong>{model.run_count}</strong> runs</span><span><strong>{formatNumber(model.total_tokens)}</strong> tokens</span><span><strong>{model.average_latency_ms == null ? "—" : `${formatNumber(model.average_latency_ms)} ms`}</strong> avg latency</span><span><strong>${model.known_cost_usd.toFixed(4)}</strong> known cost{model.unpriced_run_count ? ` · ${model.unpriced_run_count} unpriced` : ""}</span></div></article>;
      })}</div> : <div className="library-empty"><strong>No AI usage recorded yet</strong><p>Complete an extraction, revisit, or challenge to create the first usage record.</p></div>}</section>
      {pilotMetrics ? <section className="usage-section"><div className="usage-section-heading"><div><span className="overline">Supervised pilot</span><h2>Repeat-use signals</h2></div><span>{pilotMetrics.repeat_use_observed ? "Repeat use observed" : "More real-user sessions needed"}</span></div><div className="pilot-metrics-grid"><article><strong>{pilotMetrics.decision_count}</strong><span>decisions</span></article><article><strong>{pilotMetrics.revisit_count}</strong><span>evidence checks</span></article><article><strong>{pilotMetrics.judgment_count}</strong><span>human judgments</span></article><article><strong>{pilotMetrics.share_count + pilotMetrics.export_count}</strong><span>shares &amp; exports</span></article><article><strong>{pilotMetrics.challenge_confirmation_count}</strong><span>confirmed challenges</span></article><article><strong>{pilotMetrics.active_days}</strong><span>active days</span></article></div><p className="pilot-note">Pilot readiness requires activity from real reviewers across multiple days; these measurements describe behavior and do not claim model accuracy.</p></section> : null}
      <section className="usage-section"><div className="usage-section-heading"><div><span className="overline">Recent activity</span><h2>Latest model runs</h2></div><span>Newest first</span></div>{usage.recent_runs.length ? <div className="usage-runs">{usage.recent_runs.map((run) => <button type="button" key={`${run.kind}-${run.id}`} disabled={!run.decision_id} onClick={() => run.decision_id && onOpenDecision(run.decision_id)}><span className={`usage-kind ${run.kind}`}>{run.kind}</span><span className="usage-run-model"><strong>{run.model}</strong><small>{run.provider} · {run.prompt_version}</small></span><span><strong>{formatNumber((run.input_tokens ?? 0) + (run.output_tokens ?? 0))}</strong><small>tokens</small></span><span><strong>{run.latency_ms == null ? "—" : `${formatNumber(run.latency_ms)} ms`}</strong><small>latency</small></span><span><strong>{run.estimated_cost_usd == null ? "Unavailable" : `$${run.estimated_cost_usd.toFixed(4)}`}</strong><small>cost</small></span><time dateTime={run.created_at}>{formatDateTime(run.created_at)}</time></button>)}</div> : null}</section>
    </> : null}
  </section>;
}
