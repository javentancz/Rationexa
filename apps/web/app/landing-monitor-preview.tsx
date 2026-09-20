"use client";

import { useState } from "react";
import { Check, FileSearch, Link2, RotateCcw } from "lucide-react";

const actions = [
  ["keep", "Keep decision"],
  ["clarify", "Request clarification"],
  ["amend", "Amend decision"],
  ["ticket", "Draft ticket"],
] as const;

export function LandingMonitorPreview() {
  const [choice, setChoice] = useState<(typeof actions)[number][0] | null>(null);
  const selectedLabel = actions.find(([value]) => value === choice)?.[1];

  return (
    <div className="landing-monitor-demo" aria-label="Interactive assumption monitoring example">
      <article className="landing-monitor-premise">
        <span>Monitored premise</span>
        <h3>SAML support will ship before the pilot.</h3>
        <p><Link2 aria-hidden="true" />Approved source: Vendor B roadmap</p>
      </article>

      <article className="landing-monitor-evidence">
        <div className="landing-monitor-evidence-heading">
          <span><FileSearch aria-hidden="true" />Grounded evidence</span>
          <strong>Conflicts with the premise</strong>
        </div>
        <blockquote>“SAML support has moved to next quarter.”</blockquote>
        <p>Exact source quote retained. The finalized decision is unchanged.</p>
      </article>

      <div className="landing-monitor-review">
        <div>
          <span>Human decision required</span>
          <strong>{choice ? `${selectedLabel} recorded` : "What should happen next?"}</strong>
        </div>
        {choice ? (
          <button type="button" onClick={() => setChoice(null)}><RotateCcw aria-hidden="true" />Choose again</button>
        ) : (
          <div className="landing-monitor-actions" aria-label="Review choices">
            {actions.map(([value, label]) => <button type="button" key={value} onClick={() => setChoice(value)}>{label}</button>)}
          </div>
        )}
        {choice ? <p className="landing-monitor-confirmation"><Check aria-hidden="true" />Human choice saved. No external action was taken.</p> : null}
      </div>
    </div>
  );
}
