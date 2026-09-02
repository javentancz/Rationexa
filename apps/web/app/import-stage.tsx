"use client";

import type { FormEventHandler } from "react";
import { FileUp, ListChecks, Save, ShieldCheck, Sparkles } from "lucide-react";
import { ModelPicker } from "./model-picker";
import type { ModelOption } from "./workspace-types";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  sourceMode: "paste" | "file";
  onSourceModeChange: (mode: "paste" | "file") => void;
  source: string;
  onSourceChange: (value: string) => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
  models: ModelOption[];
  selectedModelId: string;
  recommendedModelId: string;
  onModelSelect: (id: string) => void;
  selectedModel?: ModelOption;
  extracting: boolean;
  draftSavedAt: string | null;
  guest: boolean;
  formatDateTime: (value?: string) => string;
  onExtract: FormEventHandler<HTMLFormElement>;
};

export function ImportStage({ sourceMode, onSourceModeChange, source, onSourceChange, file, onFileChange, models, selectedModelId, recommendedModelId, onModelSelect, selectedModel, extracting, draftSavedAt, guest, formatDateTime, onExtract }: Props) {
  return <section className="card import-card">
    <div className="import-heading"><span className="stage-number">01</span><div><span className="stage-label">Start with the source</span><h2>Bring in a decision</h2><p>Use the original note, ADR, assessment, or proposal. Rationexa will suggest structure without changing the source.</p></div><Badge variant="secondary" className="privacy-badge"><ShieldCheck aria-hidden="true" />{guest ? "Private browser trial" : "Private workspace"}</Badge></div>
    <div className="import-workspace">
      <form onSubmit={onExtract} className="import-source-panel">
        <div className="import-source-toolbar"><div><strong>Decision source</strong><small>Paste text or upload one supported document</small></div><Tabs value={sourceMode} onValueChange={(value) => onSourceModeChange(value as "paste" | "file")}><TabsList className="source-tabs"><TabsTrigger value="paste">Paste text</TabsTrigger><TabsTrigger value="file">Upload file</TabsTrigger></TabsList></Tabs></div>
        {sourceMode === "paste" ? <label className="field import-source-field"><span className="sr-only">Decision source</span><Textarea aria-label="Decision source" value={source} onChange={(event) => onSourceChange(event.target.value)} rows={13} placeholder="Paste the original decision context here. Include the decision, rationale, constraints, assumptions, unknowns, and revisit conditions when available…" /><small>{source.trim() ? `${source.trim().length.toLocaleString()} characters` : "Your draft stays on this device until you submit it."}</small></label> : <label className={`upload-zone ${file ? "has-file" : ""}`}><input aria-label="Decision file" type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} /><span className="upload-icon"><FileUp aria-hidden="true" /></span><strong>{file ? file.name : "Choose a PDF, Markdown, or text file"}</strong><small>{file ? "Ready to extract" : "Maximum file size: 10 MB"}</small></label>}
        <div className="import-action-bar"><div className="import-model-choice"><span>AI step</span><ModelPicker compact models={models} selectedId={selectedModelId} recommendedId={recommendedModelId} onSelect={onModelSelect} disabled={extracting} label="Extraction model" /></div><span className="draft-assurance"><span>{guest ? "Free deterministic extraction. No model key is required." : selectedModel?.availability_reason ?? `${selectedModel?.label ?? "The selected model"} proposes structure; you review every premise.`}</span>{source.trim() && draftSavedAt ? <small><Save aria-hidden="true" />Draft saved · {formatDateTime(draftSavedAt)}</small> : null}</span><button className="primary import-submit" disabled={extracting || !selectedModelId || selectedModel?.available === false || (sourceMode === "paste" ? !source.trim() : !file)}>{extracting ? <><span className="spinner" />Extracting with {selectedModel?.label ?? "model"}…</> : guest ? "Try deterministic extraction →" : "Extract decision →"}</button></div>
      </form>
      <aside className="import-explainer" aria-label="What Rationexa extracts"><span className="import-explainer-icon"><Sparkles aria-hidden="true" /></span><div><span className="overline">What happens next</span><h3>A review draft—not a final decision</h3><p>Rationexa separates the source into candidate premises. Nothing is preserved until you review it.</p></div><ul><li><ListChecks aria-hidden="true" /><span><strong>Decision context</strong><small>Question, option, and rationale</small></span></li><li><ListChecks aria-hidden="true" /><span><strong>Material premises</strong><small>Assumptions, constraints, and unknowns</small></span></li><li><ListChecks aria-hidden="true" /><span><strong>Source anchors</strong><small>Exact excerpts for human verification</small></span></li></ul></aside>
    </div>
  </section>;
}
