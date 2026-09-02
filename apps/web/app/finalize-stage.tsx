"use client";

import { ArrowLeft, Check, FileCheck2, Library, LockKeyhole } from "lucide-react";

type FinalizePremise = { candidate_id: string };
type FinalizeReview = { action: "confirm" | "unknown" | "reject"; statement: string; kind: string };

export function FinalizeConfirmation({ title, question, chosenOption, rationale, criticality, counts, premises, reviews, busy, onBack, onFinalize }: {
  title: string;
  question: string;
  chosenOption: string;
  rationale: string;
  criticality: string;
  counts: { confirm: number; unknown: number; reject: number };
  premises: FinalizePremise[];
  reviews: Record<string, FinalizeReview>;
  busy: boolean;
  onBack: () => void;
  onFinalize: () => void;
}) {
  return <section className="card finalize-confirmation">
    <div className="finalize-hero"><span className="finalize-hero-icon"><FileCheck2 aria-hidden="true" /></span><div><span className="overline">Step 3 · Finalize</span><h2>Review the record before it becomes memory</h2><p>This is the exact human-reviewed record that will be saved. AI cannot change it after you confirm.</p></div><span className={`decision-badge ${criticality}`}>{criticality}</span></div>
    <div className="finalize-trust-strip" aria-label="Finalization guarantees"><span><Check aria-hidden="true" />Human judgments preserved</span><span><LockKeyhole aria-hidden="true" />Source excerpts retained</span><span><Library aria-hidden="true" />Saved to your library only</span></div>
    <div className="finalize-summary-grid"><div><span>Decision being recorded</span><strong>{title}</strong><p>{question}</p></div><div><span>Human-selected outcome</span><strong>{chosenOption || "Not established"}</strong><p>{rationale || "No rationale recorded."}</p></div></div>
    <div className="finalize-counts"><div><strong>{counts.confirm}</strong><span>premises preserved</span></div><div><strong>{counts.unknown}</strong><span>kept unknown</span></div><div><strong>{counts.reject}</strong><span>rejected</span></div><div><strong>{criticality}</strong><span>criticality</span></div></div>
    <section className="finalize-premises"><header><div><span className="overline">Preserved premises</span><h3>What this decision depends on</h3></div><small>{counts.confirm + counts.unknown} will be saved</small></header><div className="finalize-premise-preview">{premises.filter((premise) => reviews[premise.candidate_id]?.action !== "reject").map((premise, index) => <article key={premise.candidate_id}><span>P{index + 1} · {reviews[premise.candidate_id]?.kind.replaceAll("_", " ")}</span><p>{reviews[premise.candidate_id]?.statement}</p><em className={reviews[premise.candidate_id]?.action === "unknown" ? "unknown" : "confirmed"}>{reviews[premise.candidate_id]?.action === "unknown" ? "Unknown" : "Confirmed"}</em></article>)}</div></section>
    <div className="finalize-actions"><button type="button" className="text-button" onClick={onBack}><ArrowLeft aria-hidden="true" />Back to review</button><div><small>Finalizing creates the durable record and enables future evidence checks.</small><button type="button" className="primary" disabled={busy} onClick={onFinalize}>{busy ? <><span className="spinner" />Finalizing…</> : <><Check aria-hidden="true" />Finalize and save</>}</button></div></div>
  </section>;
}
