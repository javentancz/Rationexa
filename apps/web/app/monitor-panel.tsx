"use client";

import { FormEvent, useState } from "react";
import { ExternalLink, Pause, Play, Radar, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiResponse as req, responseJson } from "./api";
import type { AssumptionMonitor, Decision, MonitorEvidence } from "./workspace-types";

const humanActions = [
  ["keep_decision", "Keep decision"],
  ["request_clarification", "Request clarification"],
  ["amend_decision", "Amend decision"],
  ["replace_option", "Replace option"],
  ["create_draft_ticket", "Create draft ticket"],
] as const;

type Props = {
  decision: Decision;
  monitors: AssumptionMonitor[];
  onChange: (monitors: AssumptionMonitor[]) => void;
};

export function MonitorPanel({ decision, monitors, onChange }: Props) {
  const [creating, setCreating] = useState(false);
  const [premiseId, setPremiseId] = useState(decision.premises[0]?.id ?? "");
  const [name, setName] = useState("Monitor this assumption");
  const [sourceUrl, setSourceUrl] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function createMonitor(event: FormEvent) {
    event.preventDefault();
    if (!premiseId || !sourceUrl.trim()) return;
    setBusy("create");
    try {
      const created = await responseJson(await req(`/v1/decisions/${decision.id}/monitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          premise_id: premiseId,
          name: name.trim() || "Monitor this assumption",
          instructions: instructions.trim(),
          source_urls: [sourceUrl.trim()],
        }),
      })) as AssumptionMonitor;
      onChange([created, ...monitors]);
      setCreating(false);
      setSourceUrl("");
      setInstructions("");
      toast.success("Premise monitor created", { description: "Agents may submit grounded evidence from the approved source." });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the monitor");
    } finally {
      setBusy(null);
    }
  }

  async function toggleMonitor(monitor: AssumptionMonitor) {
    setBusy(monitor.id);
    try {
      const updated = await responseJson(await req(`/v1/monitors/${monitor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: monitor.status === "active" ? "paused" : "active" }),
      })) as AssumptionMonitor;
      onChange(monitors.map((item) => item.id === updated.id ? updated : item));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the monitor");
    } finally {
      setBusy(null);
    }
  }

  async function recordAction(monitor: AssumptionMonitor, proposal: MonitorEvidence, action: string) {
    setBusy(proposal.id);
    try {
      const updated = await responseJson(await req(`/v1/monitor-evidence-proposals/${proposal.id}/human-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })) as MonitorEvidence;
      onChange(monitors.map((item) => item.id === monitor.id
        ? { ...item, proposals: item.proposals.map((candidate) => candidate.id === updated.id ? updated : candidate) }
        : item));
      toast.success(action === "create_draft_ticket" ? "Ticket draft created" : "Human choice recorded", {
        description: "The finalized decision was not changed.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the human choice");
    } finally {
      setBusy(null);
    }
  }

  const premiseById = new Map(decision.premises.map((premise, index) => [premise.id, { premise, index }]));

  return <section className="monitor-panel">
    <header className="monitor-heading">
      <div><span className="overline">Agent skill</span><h3>Monitor an assumption</h3><p>Agents may investigate approved sources and propose evidence. Only a human decides what happens next.</p></div>
      <button type="button" className="secondary" onClick={() => setCreating((value) => !value)}>{creating ? "Cancel" : "+ Add monitor"}</button>
    </header>

    {creating ? <form className="monitor-form" onSubmit={createMonitor}>
      <label><span>Premise to monitor</span><select value={premiseId} onChange={(event) => setPremiseId(event.target.value)}>{decision.premises.map((premise, index) => <option key={premise.id} value={premise.id}>P{index + 1} · {premise.statement}</option>)}</select></label>
      <label><span>Skill name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} /></label>
      <label className="monitor-form-wide"><span>Approved source URL</span><input type="url" required placeholder="https://vendor.example/roadmap" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /><small>HTTPS only. Evidence proposals from any other URL are rejected.</small></label>
      <label className="monitor-form-wide"><span>What should the agent watch for?</span><textarea rows={2} placeholder="Watch for changes to the delivery date or scope." value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
      <div className="monitor-form-actions"><span><ShieldCheck aria-hidden="true" />Read-only investigation. No decision or external system is changed.</span><button className="primary" disabled={busy === "create" || !sourceUrl.trim()}>{busy === "create" ? "Creating…" : "Create monitor"}</button></div>
    </form> : null}

    {monitors.length ? <div className="monitor-list">{monitors.map((monitor) => {
      const context = premiseById.get(monitor.premise_id);
      return <article className="monitor-card" key={monitor.id}>
        <header><span className="monitor-icon"><Radar aria-hidden="true" /></span><div><small>{context ? `P${context.index + 1} · ${context.premise.kind.replaceAll("_", " ")}` : "Preserved premise"}</small><strong>{monitor.name}</strong><p>{context?.premise.statement}</p></div><button type="button" className="monitor-status" disabled={busy === monitor.id} onClick={() => toggleMonitor(monitor)}>{monitor.status === "active" ? <><Pause aria-hidden="true" />Pause</> : <><Play aria-hidden="true" />Resume</>}</button></header>
        <div className="monitor-sources"><span>Approved sources</span>{monitor.source_urls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}<ExternalLink aria-hidden="true" /></a>)}</div>
        {monitor.proposals.length ? <div className="monitor-proposals">{monitor.proposals.map((proposal) => <section key={proposal.id} className={`monitor-proposal ${proposal.status}`}>
          <div className="monitor-proposal-meta"><span>{proposal.relationship}</span><small>{proposal.confidence_band} confidence · proposed by {proposal.submitted_by}</small></div>
          <strong>{proposal.source_title}</strong>
          <blockquote>{proposal.exact_excerpt}</blockquote>
          <p>{proposal.explanation}</p>
          <div className="monitor-recommendation"><span>Agent proposal</span>{proposal.recommendation}</div>
          {proposal.status === "needs_review" ? <div className="monitor-human-actions"><span>Human chooses</span>{humanActions.map(([value, label]) => <button type="button" key={value} disabled={busy === proposal.id} onClick={() => recordAction(monitor, proposal, value)}>{label}</button>)}</div> : <div className="monitor-reviewed"><CheckMark />Human chose: {proposal.human_action?.replaceAll("_", " ")}{proposal.draft_action ? " · draft only" : ""}</div>}
        </section>)}</div> : <p className="monitor-empty">Waiting for grounded evidence from an approved source.</p>}
      </article>;
    })}</div> : !creating ? <div className="monitor-zero"><Radar aria-hidden="true" /><div><strong>No premise monitors yet</strong><span>Add one after finalization to give an agent a narrow, read-only investigation brief.</span></div></div> : null}
  </section>;
}

function CheckMark() {
  return <span aria-hidden="true">✓</span>;
}
