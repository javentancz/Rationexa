import Link from "next/link";
import {
  ArrowRight,
  Check,
  FileSearch,
  Fingerprint,
  History,
  LockKeyhole,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { guidedSamples } from "./guided-samples";
import { LandingWorkflowPreview } from "./landing-workflow-preview";

const workflow = [
  { title: "Import", copy: "Add the note or proposal.", icon: FileSearch },
  { title: "Review", copy: "Verify each premise.", icon: UserCheck },
  { title: "Finalize", copy: "Save the reviewed record.", icon: Check },
  { title: "Revisit", copy: "Test new evidence.", icon: History },
];

export default function LandingPage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Main navigation">
        <Link className="landing-brand" href="/" aria-label="Rationexa home">
          <span>R</span><strong>Rationexa</strong>
        </Link>
        <div className="landing-nav-links">
          <a href="#example">Examples</a>
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Privacy</a>
        </div>
        <div className="landing-nav-actions">
          <ThemeToggle />
          <Link className="landing-nav-cta" href="/workspace">Open workspace <ArrowRight aria-hidden="true" /></Link>
        </div>
      </nav>

      <section className="landing-hero" id="product">
        <div className="landing-hero-copy">
          <span className="landing-eyebrow">Decision memory for teams</span>
          <h1>Know why you chose it. Know when to revisit it.</h1>
          <p>Preserve the reasoning behind a decision, then test new evidence against it.</p>
          <div className="landing-actions">
            <Link className="landing-primary" href="/workspace?sample=vendor-review">Try a sample decision <ArrowRight aria-hidden="true" /></Link>
            <Link className="landing-secondary" href="/workspace">Use my own decision</Link>
          </div>
        </div>
        <LandingWorkflowPreview />
      </section>

      <section className="landing-tr-strip" aria-label="Product principles">
        <span><Fingerprint aria-hidden="true" /><strong>Source grounded</strong><small>Exact excerpts stay attached</small></span>
        <span><UserCheck aria-hidden="true" /><strong>Human reviewed</strong><small>You control the record</small></span>
        <span><LockKeyhole aria-hidden="true" /><strong>Private by default</strong><small>No key needed to try it</small></span>
      </section>

      <section id="example" className="landing-example">
        <div className="landing-section-heading">
          <span className="landing-eyebrow">Guided examples</span>
          <h2>Start with a decision you recognize.</h2>
          <p>Choose a case. The source and later evidence are ready to review.</p>
        </div>
        <div className="landing-case-showcase" role="region" aria-label="Guided decision cases">
          {Object.entries(guidedSamples).map(([id, sample], index) => (
            <Link key={id} href={`/workspace?sample=${id}`} className={index === 0 ? "landing-case-card featured" : "landing-case-card"}>
              <span>{sample.audience}</span>
              <strong>{sample.title}</strong>
              <p>{sample.summary}</p>
              <em>Open case <ArrowRight aria-hidden="true" /></em>
            </Link>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="landing-how">
        <div className="landing-section-heading">
          <span className="landing-eyebrow">How it works</span>
          <h2>One record. Four clear actions.</h2>
        </div>
        <ol className="landing-steps">
          {workflow.map(({ title, copy, icon: Icon }, index) => (
            <li key={title}>
              <span>{index + 1}</span>
              <Icon aria-hidden="true" />
              <div><h3>{title}</h3><p>{copy}</p></div>
            </li>
          ))}
        </ol>
        <div className="landing-authority">
          <div className="landing-authority-copy">
            <h2>AI proposes. A person decides.</h2>
            <p>Rationexa can extract premises and flag conflicts. It cannot silently change the accepted record.</p>
          </div>
          <div className="landing-authority-list">
            <span><Check aria-hidden="true" />Review every premise</span>
            <span><Check aria-hidden="true" />Keep model provenance</span>
            <span><Check aria-hidden="true" />Record human judgment</span>
          </div>
        </div>
      </section>

      <section id="privacy" className="landing-privacy">
        <span className="landing-privacy-icon"><ShieldCheck aria-hidden="true" /></span>
        <div>
          <h2>Try it without an account or model key.</h2>
          <p>Your guest workspace is isolated and expires automatically. Create an account only when you want durable history or encrypted BYOK.</p>
        </div>
        <Link className="landing-primary" href="/workspace">Start a private trial <ArrowRight aria-hidden="true" /></Link>
      </section>

      <footer className="landing-footer">
        <Link className="landing-brand" href="/"><span>R</span><strong>Rationexa</strong></Link>
        <p>Human-reviewed decision memory.</p>
        <div><Link href="/privacy">Privacy &amp; data</Link><a href="mailto:javentanzhe@gmail.com?subject=Rationexa%20support">Support</a><Link href="/workspace">Workspace</Link></div>
      </footer>
    </main>
  );
}
