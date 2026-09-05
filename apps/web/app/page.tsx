import Link from "next/link";
import { ArrowRight, Check, CircleCheck, FileSearch, Fingerprint, History, KeyRound, LockKeyhole, ScanSearch, ShieldCheck, Sparkles, UserCheck, Waypoints } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { LandingWorkflowPreview } from "./landing-workflow-preview";

const workflow = [
  { number: "01", title: "Import", copy: "Start with a decision note, ADR, assessment, or proposal excerpt.", icon: FileSearch },
  { number: "02", title: "Review", copy: "Confirm the premises that actually mattered and preserve their source excerpts.", icon: UserCheck },
  { number: "03", title: "Finalize", copy: "Save a human-reviewed record with rationale, provenance, and revisit conditions.", icon: CircleCheck },
  { number: "04", title: "Revisit", copy: "Bring new evidence back to the original premises and decide what deserves action.", icon: History },
];

const assurances = ["No sign-up required", "Free deterministic trial", "Optional encrypted BYOK"];

export default function LandingPage() {
  return <main className="landing-page">
    <nav className="landing-nav" aria-label="Main navigation">
      <Link className="landing-brand" href="/" aria-label="Rationexa home"><span>R</span><strong>Rationexa</strong></Link>
      <div className="landing-nav-links"><a href="#product">Product</a><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a></div>
      <div className="landing-nav-actions"><ThemeToggle /><Link className="landing-nav-cta" href="/workspace">Open workspace <ArrowRight aria-hidden="true" /></Link></div>
    </nav>

    <section className="landing-hero" id="product">
      <div className="landing-hero-copy">
        <span className="landing-eyebrow"><Sparkles aria-hidden="true" /> Human judgment stays in control</span>
        <h1>Remember <em>why</em> a decision was made. See when it stops being true.</h1>
        <p>Rationexa turns a static decision into reviewable memory—preserving its assumptions, constraints, unknowns, and evidence so later changes can be evaluated in context.</p>
        <div className="landing-actions"><Link className="landing-primary" href="/workspace?sample=vendor-review">Try a sample decision <ArrowRight aria-hidden="true" /></Link><Link className="landing-secondary" href="/workspace">Review your own decision</Link></div>
        <div className="landing-assurances">{assurances.map((item) => <span key={item}><Check aria-hidden="true" />{item}</span>)}</div>
      </div>

      <LandingWorkflowPreview />
    </section>

    <section className="landing-trust-strip" aria-label="Product principles"><span><ScanSearch aria-hidden="true" /><strong>Source-grounded</strong><small>Exact excerpts stay attached</small></span><span><UserCheck aria-hidden="true" /><strong>Human-reviewed</strong><small>No silent decision changes</small></span><span><Fingerprint aria-hidden="true" /><strong>Traceable</strong><small>Model and prompt provenance</small></span><span><LockKeyhole aria-hidden="true" /><strong>Private by default</strong><small>Isolated guest and user workspaces</small></span></section>

    <section className="landing-contrast">
      <div className="landing-section-heading"><span className="landing-eyebrow">The missing layer</span><h2>Most tools preserve the answer. Rationexa preserves the reasoning that made it defensible.</h2></div>
      <div className="landing-contrast-grid">
        <article className="landing-static-card"><span>Without decision memory</span><div className="landing-document-lines"><i /><i /><i /><i /></div><h3>“We chose Vendor B.”</h3><ul><li>Rationale disappears into old documents</li><li>Assumptions become invisible facts</li><li>New evidence has no original context</li></ul></article>
        <div className="landing-contrast-arrow"><ArrowRight aria-hidden="true" /></div>
        <article className="landing-memory-card"><span>With Rationexa</span><Waypoints aria-hidden="true" /><h3>Every decision has a living trail.</h3><ul><li><Check aria-hidden="true" />Premises remain tied to evidence</li><li><Check aria-hidden="true" />Changes map to what they affect</li><li><Check aria-hidden="true" />Humans record the final judgment</li></ul></article>
      </div>
    </section>

    <section id="how-it-works" className="landing-how">
      <div className="landing-section-heading"><span className="landing-eyebrow">One continuous workflow</span><h2>From source material to a decision you can revisit.</h2><p>Each stage has one job. AI assists with structure and comparison; the reviewer controls what becomes part of the record.</p></div>
      <div className="landing-steps">{workflow.map(({ number, title, copy, icon: Icon }) => <article key={number}><div><span>{number}</span><Icon aria-hidden="true" /></div><h3>{title}</h3><p>{copy}</p></article>)}</div>
    </section>

    <section className="landing-authority">
      <div className="landing-authority-copy"><span className="landing-eyebrow">Built around the trust boundary</span><h2>AI can surface a concern. It cannot rewrite organizational truth.</h2><p>Every proposed premise and finding remains visibly provisional until a person confirms, rejects, or preserves it as unknown.</p><Link href="/workspace?sample=vendor-review">See the review workflow <ArrowRight aria-hidden="true" /></Link></div>
      <div className="landing-authority-list"><article><span>AI</span><strong>Extracts candidate premises</strong><small>From the decision source</small></article><article><span>AI</span><strong>Maps later evidence</strong><small>Against preserved premises</small></article><article className="human"><span>Human</span><strong>Confirms what is material</strong><small>With an explicit judgment and notes</small></article></div>
    </section>

    <section id="privacy" className="landing-privacy">
      <div className="landing-privacy-icon"><KeyRound aria-hidden="true" /></div>
      <div><span className="landing-eyebrow">Private from the first click</span><h2>Try the workflow before creating an account.</h2><p>A temporary guest workspace is isolated to your browser and expires automatically. Deterministic rules require no model key. Create a permanent workspace only when you want durable history or hosted models through encrypted BYOK.</p><div className="landing-privacy-points"><span><ShieldCheck aria-hidden="true" />Separate decision libraries</span><span><Fingerprint aria-hidden="true" />Provider provenance retained</span><span><LockKeyhole aria-hidden="true" />Keys never appear in shares</span></div></div>
      <Link className="landing-secondary" href="/workspace">Open private trial <ArrowRight aria-hidden="true" /></Link>
    </section>

    <section className="landing-final-cta"><span className="landing-eyebrow">Start with one real decision</span><h2>Make the next revisit easier than the original debate.</h2><p>No setup is required for the guided trial.</p><div className="landing-actions"><Link className="landing-primary" href="/workspace?sample=vendor-review">Try the guided sample <ArrowRight aria-hidden="true" /></Link><Link className="landing-secondary" href="/workspace">Start with my decision</Link></div></section>

    <footer className="landing-footer"><Link className="landing-brand" href="/"><span>R</span><strong>Rationexa</strong></Link><p>Human-reviewed decision memory.</p><div><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a><Link href="/workspace">Workspace</Link></div></footer>
  </main>;
}
