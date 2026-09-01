"use client";

import { Library, Save, Trash2 } from "lucide-react";
import { Hint } from "./ui";
import type { Criticality, DecisionLibrary } from "./workspace-types";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  criticality: "all" | Criticality;
  onCriticalityChange: (value: "all" | Criticality) => void;
  hasCurrentDraft: boolean;
  currentDraftTitle: string;
  currentDraftStep: string;
  onResumeDraft: () => void;
  onDiscardDraft: () => void;
  library: DecisionLibrary;
  loading: boolean;
  refreshing: boolean;
  guest: boolean;
  onOpenAccount: () => void;
  onOpenDecision: (id: string) => void;
  onPrefetchDecision: (id: string) => void;
  onDeleteDecision: (id: string, title: string) => void;
  onCreateDecision: () => void;
  formatDateTime: (value?: string) => string;
};

export function DecisionLibraryView({ query, onQueryChange, criticality, onCriticalityChange, hasCurrentDraft, currentDraftTitle, currentDraftStep, onResumeDraft, onDiscardDraft, library, loading, refreshing, guest, onOpenAccount, onOpenDecision, onPrefetchDecision, onDeleteDecision, onCreateDecision, formatDateTime }: Props) {
  const hasFilter = Boolean(query || criticality !== "all");
  return <section className="library-view">
    <div className="library-toolbar"><label className="library-search"><span>⌕</span><Input className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:border-transparent focus-visible:ring-0" aria-label="Search decisions" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search title, question, context, or chosen option" /></label>{refreshing ? <span className="library-refreshing"><span className="spinner dark" />Updating results…</span> : null}</div>
    <div className="mobile-library-filters" aria-label="Filter decisions by criticality">
      {(["all", "critical", "important", "routine"] as ("all" | Criticality)[]).map((value) => <button type="button" key={value} className={criticality === value ? "active" : ""} aria-pressed={criticality === value} onClick={() => onCriticalityChange(value)}>{value === "all" ? "All" : value[0].toUpperCase() + value.slice(1)}</button>)}
    </div>
    {hasCurrentDraft ? <div className="library-draft-card"><button type="button" className="library-draft-resume" onClick={onResumeDraft}><span><Save aria-hidden="true" /></span><div><strong>Continue current draft</strong><small>{currentDraftTitle} · {currentDraftStep}</small></div><em>Resume →</em></button><Hint label="Discard draft" side="left"><button type="button" className="library-draft-discard icon-action" aria-label={`Discard ${currentDraftTitle} draft`} onClick={onDiscardDraft}><Trash2 className="action-icon" aria-hidden="true" /></button></Hint></div> : null}
    {guest ? <div className="guest-access-card"><div><strong>Your temporary library is private to this browser</strong><p>Try deterministic extraction and the complete review flow. Create a permanent workspace to keep these decisions and connect BYOK models.</p></div><button className="primary" onClick={onOpenAccount}>Keep decisions &amp; add BYOK →</button></div> : null}
    <div className="library-summary"><div><strong>{library.total}</strong><span>saved decisions</span></div><p>{guest ? "Other browsers and devices receive separate guest libraries. Guest data expires automatically." : "Reopen a record to review its premises, add new evidence, or inspect previous revisit checks."}</p></div>
    {loading ? <div className="library-skeleton" role="status" aria-label="Loading decision memory"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div> : library.items.length ? <div className="decision-list">{library.items.map((item) => <div className="decision-card" key={item.id}>
      <button type="button" className="decision-row" onMouseEnter={() => onPrefetchDecision(item.id)} onFocus={() => onPrefetchDecision(item.id)} onClick={() => onOpenDecision(item.id)}>
        <div className="decision-row-main"><div><span className={`criticality-dot ${item.criticality}`} /> <span>{item.criticality}</span></div><h2>{item.title}</h2><p>{item.question}</p></div>
        <div className="decision-row-stats"><div><strong>{item.premise_count}</strong><span>premises</span></div><div><strong>{item.revisit_count}</strong><span>revisits</span></div>{item.pending_revisit_count ? <div className="pending-stat"><strong>{item.pending_revisit_count}</strong><span>need review</span></div> : null}</div>
        <div className="decision-row-date"><span>Last checked</span><strong>{item.last_revisited_at ? formatDateTime(item.last_revisited_at) : "Not revisited"}</strong><small>Saved {formatDateTime(item.created_at)}</small></div><span className="row-arrow">→</span>
      </button>
      <Hint label="Delete decision" side="left"><button type="button" className="decision-row-delete icon-action" aria-label={`Delete ${item.title}`} onClick={() => onDeleteDecision(item.id, item.title)}><Trash2 className="action-icon" aria-hidden="true" /></button></Hint>
    </div>)}</div> : <div className="library-empty"><span className="library-empty-icon"><Library aria-hidden="true" /></span><strong>{hasFilter ? "No matching decisions" : guest ? "Your private trial library starts here" : "Your decision memory starts here"}</strong><p>{hasFilter ? "Try a broader search or remove the criticality filter." : guest ? "Run deterministic extraction and save temporary decisions without creating an account." : "Finalize your first decision review and it will appear here automatically."}</p><button className="primary" onClick={onCreateDecision}>Start a decision draft →</button></div>}
  </section>;
}
