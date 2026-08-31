import Link from "next/link";
import { ArrowRight, Check, FileSearch, History, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

const steps = [
  { number: "01", title: "Import the decision", copy: "Paste a decision note, ADR, assessment, or proposal excerpt." },
  { number: "02", title: "Review its premises", copy: "Confirm assumptions, constraints, unknowns, and the exact source evidence." },
  { number: "03", title: "Revisit when facts change", copy: "Map later evidence to preserved premises while a person keeps control." },
];

export default function LandingPage() {
  return <main className="landing-page">
    <nav className="landing-nav" aria-label="Main navigation">
      <Link className="landing-brand" href="/"><span>R</span><strong>Rationexa</strong></Link>
      <div><a href="#how-it-works">How it works</a><a href="#privacy">Privacy</a><ThemeToggle /><Link className="landing-nav-cta" href="/workspace">Open workspace</Link></div>
    </nav>

    <section className="landing-hero">
      <div className="landing-hero-copy">
        <span className="landing-eyebrow"><Sparkles aria-hidden="true" /> Human-reviewed decision memory</span>
        <h1>Remember <em>why</em> a decision was made—and know when to revisit it.</h1>
        <p>Rationexa preserves the assumptions, constraints, unknowns, and source evidence behind important decisions. When new evidence arrives, AI maps what changed and a person decides what happens next.</p>
        <div className="landing-actions">
          <Link className="landing-primary" href="/workspace?sample=vendor-review">Try a sample decision <ArrowRight aria-hidden="true" /></Link>
          <Link className="landing-secondary" href="/workspace">Review your own decision</Link>
        </div>
        <div className="landing-assurances"><span><Check aria-hidden="true" /> No sign-up required</span><span><Check aria-hidden="true" /> Free deterministic trial</span><span><Check aria-hidden="true" /> Optional BYOK</span></div>
      </div>

      <div className="landing-product-preview" aria-label="Example decision review">
        <div className="preview-top"><span>Decision memory</span><span className="preview-status">Human reviewed</span></div>
        <h2>Choose an identity provider</h2>
        <p>Which provider should power the customer portal?</p>
        <div className="preview-premises">
          <article><span>Assumption</span><strong>External-user administration will ship before pilot launch.</strong></article>
          <article><span>Hard constraint</span><strong>Audit logs must remain available for 12 months.</strong></article>
          <article><span>Revisit condition</span><strong>Annual pricing rises above $24,000.</strong></article>
        </div>
        <div className="preview-update"><History aria-hidden="true" /><div><span>Later evidence</span><strong>External-user administration moved to next quarter.</strong></div><em>Needs review</em></div>
      </div>
    </section>

    <section className="landing-problem">
      <div><span className="landing-eyebrow">The missing layer</span><h2>A decision document records the answer. Rationexa preserves the reasoning.</h2></div>
      <div className="landing-benefits">
        <article><FileSearch aria-hidden="true" /><h3>Evidence, not summaries</h3><p>Every consequential premise stays connected to the exact source excerpt a reviewer confirmed.</p></article>
        <article><History aria-hidden="true" /><h3>A living timeline</h3><p>Decision creation, new evidence, model provenance, and human judgments remain in one audit trail.</p></article>
        <article><ShieldCheck aria-hidden="true" /><h3>Human authority</h3><p>AI can extract, compare, and challenge. It cannot silently change the saved decision.</p></article>
      </div>
    </section>

    <section id="how-it-works" className="landing-how">
      <div className="landing-section-heading"><span className="landing-eyebrow">How it works</span><h2>From forgotten rationale to reviewable memory.</h2></div>
      <div className="landing-steps">{steps.map((step) => <article key={step.number}><span>{step.number}</span><h3>{step.title}</h3><p>{step.copy}</p></article>)}</div>
    </section>

    <section id="privacy" className="landing-privacy">
      <div className="landing-privacy-icon"><KeyRound aria-hidden="true" /></div>
      <div><span className="landing-eyebrow">Start privately</span><h2>Try it without creating an account.</h2><p>Your guest workspace is isolated to your browser and expires automatically. Built-in deterministic rules need no model key. Create a private workspace only when you want permanent history or hosted models through your own provider key.</p></div>
      <Link className="landing-secondary" href="/workspace">Open private trial <ArrowRight aria-hidden="true" /></Link>
    </section>

    <section className="landing-final-cta"><span className="landing-eyebrow">Make the next revisit easier</span><h2>Put one real decision into memory today.</h2><div className="landing-actions"><Link className="landing-primary" href="/workspace?sample=vendor-review">Try the guided sample <ArrowRight aria-hidden="true" /></Link><Link className="landing-secondary" href="/workspace">Start with my decision</Link></div></section>

    <footer className="landing-footer"><Link className="landing-brand" href="/"><span>R</span><strong>Rationexa</strong></Link><p>Decision intelligence with human judgment kept in control.</p><Link href="/workspace">Workspace</Link></footer>
  </main>;
}
