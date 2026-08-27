"use client";

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
    <div className="section-heading"><div><span className="overline">Step 3 · Finalize</span><h2>Confirm the permanent record</h2><p>Nothing is saved to the decision library until you confirm this summary.</p></div><span className={`decision-badge ${criticality}`}>{criticality}</span></div>
    <div className="finalize-summary-grid"><div><span>Decision</span><strong>{title}</strong><p>{question}</p></div><div><span>Chosen option</span><strong>{chosenOption || "Not established"}</strong><p>{rationale || "No rationale recorded."}</p></div></div>
    <div className="finalize-counts"><div><strong>{counts.confirm}</strong><span>premises preserved</span></div><div><strong>{counts.unknown}</strong><span>kept unknown</span></div><div><strong>{counts.reject}</strong><span>rejected</span></div><div><strong>{criticality}</strong><span>criticality</span></div></div>
    <div className="finalize-premise-preview">{premises.filter((premise) => reviews[premise.candidate_id]?.action !== "reject").map((premise, index) => <article key={premise.candidate_id}><span>P{index + 1} · {reviews[premise.candidate_id]?.kind.replaceAll("_", " ")}</span><p>{reviews[premise.candidate_id]?.statement}</p><em>{reviews[premise.candidate_id]?.action === "unknown" ? "Preserved as unknown" : "Confirmed"}</em></article>)}</div>
    <div className="finalize-actions"><button type="button" className="text-button" onClick={onBack}>← Back to review</button><button type="button" className="primary" disabled={busy} onClick={onFinalize}>{busy ? <><span className="spinner" />Finalizing…</> : "Finalize decision"}</button></div>
  </section>;
}
