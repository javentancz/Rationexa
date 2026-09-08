"use client";

import { FileText, MessageSquareText, ShieldCheck } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";

const steps = ["Import", "Review", "Finalize", "Revisit"] as const;

export function LandingWorkflowPreview() {
  const [activeStep, setActiveStep] = useState(4);
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([]);

  function selectAdjacentStep(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? steps.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + steps.length) % steps.length;
    setActiveStep(nextIndex + 1);
    tabsRef.current[nextIndex]?.focus();
  }

  return <div className="landing-product-stage" aria-label="Interactive decision review example">
    <div className="landing-stage-glow" />
    <div className="landing-app-window">
      <div className="landing-window-bar"><div><i /><i /><i /></div><span>Decision workflow / {steps[activeStep - 1]}</span><em>Human reviewed</em></div>
      <div className="landing-workflow-rail" role="tablist" aria-label="Decision workflow preview">
        {steps.map((step, index) => {
          const number = index + 1;
          return <button
            type="button"
            role="tab"
            id={`landing-step-tab-${number}`}
            aria-selected={activeStep === number}
            aria-controls="landing-workflow-panel"
            tabIndex={activeStep === number ? 0 : -1}
            className={activeStep === number ? "active" : number < activeStep ? "complete" : ""}
            key={step}
            onClick={() => setActiveStep(number)}
            onKeyDown={(event) => selectAdjacentStep(event, index)}
            ref={(element) => { tabsRef.current[index] = element; }}
          ><span>{number}</span><strong>{step}</strong></button>;
        })}
      </div>
      <div id="landing-workflow-panel" role="tabpanel" aria-labelledby={`landing-step-tab-${activeStep}`} className="landing-decision-panel">
        {activeStep === 1 ? <ImportPreview /> : null}
        {activeStep === 2 ? <ReviewPreview /> : null}
        {activeStep === 3 ? <FinalizePreview /> : null}
        {activeStep === 4 ? <RevisitPreview /> : null}
      </div>
    </div>
    <div className="landing-float-note"><ShieldCheck aria-hidden="true" /><span><strong>AI proposes</strong><small>A human confirms</small></span></div>
  </div>;
}

function PreviewHeading({ label, title, copy }: { label: string; title: string; copy: string }) {
  return <div className="landing-decision-heading"><div><span>{label}</span><h2>{title}</h2><p>{copy}</p></div><b>Important</b></div>;
}

function ImportPreview() {
  return <>
    <PreviewHeading label="Original source" title="Bring in a decision" copy="Start with the note that explains what was decided and why." />
    <article className="landing-source-card"><FileText aria-hidden="true" /><div><span>Decision note</span><strong>Choose Vendor B for the customer portal.</strong><p>It supports SAML, fits the approved budget, and is expected to add external-user administration before launch.</p></div></article>
    <div className="landing-preview-status"><span>Source retained exactly</span><strong>Ready to extract</strong></div>
  </>;
}

function ReviewPreview() {
  return <>
    <PreviewHeading label="Human review" title="Confirm what mattered" copy="Edit, confirm, reject, or preserve each proposed premise as unknown." />
    <div className="landing-premise-grid"><article><span>P1: Assumption</span><strong>External-user administration will ship before pilot launch.</strong><small>Confirm, keep unknown, or reject</small></article><article><span>P2: Hard constraint</span><strong>Audit logs must remain available for 12 months.</strong><small>Human confirmed</small></article></div>
    <div className="landing-preview-status"><span>2 source-grounded premises</span><strong>Reviewer controls the record</strong></div>
  </>;
}

function FinalizePreview() {
  return <>
    <PreviewHeading label="Confirmation summary" title="Save the reviewed record" copy="Check the decision, rationale, and preserved premises before finalizing." />
    <div className="landing-finalize-preview"><div><span>Chosen option</span><strong>Vendor B</strong></div><div><span>Premises</span><strong>2 reviewed</strong></div><div><span>Revisit when</span><strong>Delivery or retention changes</strong></div></div>
    <div className="landing-preview-status"><span>Provider and prompt provenance attached</span><strong>Ready to finalize</strong></div>
  </>;
}

function RevisitPreview() {
  return <>
    <PreviewHeading label="Saved decision" title="Choose an identity provider" copy="Which provider should power the customer portal?" />
    <div className="landing-premise-grid"><article><span>P1: Assumption</span><strong>External-user administration will ship before pilot launch.</strong><small>Source excerpt preserved</small></article><article><span>P2: Hard constraint</span><strong>Audit logs must remain available for 12 months.</strong><small>Human confirmed</small></article></div>
    <div className="landing-evidence-message"><div className="landing-message-icon"><MessageSquareText aria-hidden="true" /></div><div><span>New evidence, today</span><strong>External-user administration moved to next quarter.</strong><p>Conflicts with P1. Exact evidence retained.</p></div><em>Needs review</em></div>
  </>;
}
