"use client";

import type { FormEventHandler } from "react";
import { ArrowRight, FileUp, Save, ShieldCheck } from "lucide-react";
import { guidedSamples, type GuidedSampleId } from "./guided-samples";
import { RulesDemoNotice } from "./rules-demo-notice";
import { ModelPicker } from "./model-picker";
import type { ModelOption } from "./workspace-types";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  onChooseSample: (id: GuidedSampleId) => void;
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

export function ImportStage({ onChooseSample, sourceMode, onSourceModeChange, source, onSourceChange, file, onFileChange, models, selectedModelId, recommendedModelId, onModelSelect, selectedModel, extracting, draftSavedAt, guest, formatDateTime, onExtract }: Props) {
  const rulesDemo = selectedModel?.provider === "deterministic";
  return <section className="card import-card">
    <div className="import-heading"><span className="stage-number">1</span><div><span className="stage-label">Import</span><h2>Bring in a decision</h2><p>What did you choose, and why? Start with the original note.</p></div><Badge variant="secondary" className="privacy-badge"><ShieldCheck aria-hidden="true" />{guest ? "Private trial" : "Private workspace"}</Badge></div>
    {rulesDemo ? <RulesDemoNotice /> : null}
    <div className="import-workspace">
      <form onSubmit={onExtract} className="import-source-panel">
        <div className="import-source-toolbar"><div><strong>Decision source</strong></div><Tabs value={sourceMode} onValueChange={(value) => onSourceModeChange(value as "paste" | "file")}><TabsList className="source-tabs"><TabsTrigger value="paste">Paste text</TabsTrigger><TabsTrigger value="file">Upload file</TabsTrigger></TabsList></Tabs></div>
        {sourceMode === "paste" ? <label className="field import-source-field"><span className="sr-only">Decision source</span><Textarea aria-label="Decision source" value={source} onChange={(event) => onSourceChange(event.target.value)} rows={10} placeholder="We chose… because…

This depends on…

Revisit if…" /><small>{source.trim() ? `${source.trim().length.toLocaleString()} characters` : "Your draft stays on this device until you submit it."}</small></label> : <label className={`upload-zone ${file ? "has-file" : ""}`}><input aria-label="Decision file" type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} /><span className="upload-icon"><FileUp aria-hidden="true" /></span><strong>{file ? file.name : "Choose a PDF, Markdown, or text file"}</strong><small>{file ? "Ready to extract" : "Maximum file size: 10 MB"}</small></label>}
        {!source.trim() && !file ? <div className="import-samples" aria-label="Sample decisions"><span>Or start with an example</span>{Object.entries(guidedSamples).map(([id, sample]) => <button type="button" key={id} onClick={() => onChooseSample(id as GuidedSampleId)}>{sample.label}<ArrowRight aria-hidden="true" /></button>)}</div> : null}
        <div className="import-action-bar"><div className="import-model-choice"><span>Run with</span><ModelPicker compact models={models} selectedId={selectedModelId} recommendedId={recommendedModelId} onSelect={onModelSelect} disabled={extracting} label="Extraction model" /></div><span className="draft-assurance"><span>{rulesDemo ? "Fixed rules. No model or key used." : selectedModel?.availability_reason ?? `${selectedModel?.label ?? "The selected model"} proposes structure; you review every premise.`}</span>{source.trim() && draftSavedAt ? <small><Save aria-hidden="true" />Draft saved · {formatDateTime(draftSavedAt)}</small> : null}</span><button className="primary import-submit" aria-label={extracting ? `Extracting with ${selectedModel?.label ?? "model"}` : undefined} aria-live="polite" disabled={extracting || !selectedModelId || selectedModel?.available === false || (sourceMode === "paste" ? !source.trim() : !file)}>{extracting ? <><span className="spinner" />Extracting…</> : rulesDemo ? "Try rules demo →" : "Extract decision →"}</button></div>
      </form>

    </div>
    <p className="import-review-note"><ShieldCheck aria-hidden="true" />Extraction creates a draft. Only your review makes it a decision record.</p>
  </section>;
}
