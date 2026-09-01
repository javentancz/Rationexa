"use client";

import type { FormEventHandler } from "react";
import { Save } from "lucide-react";
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
    <div className="section-heading"><div><span className="overline">Step 1</span><h2>Bring in a decision</h2><p>Start with a short decision note, ADR, assessment, or proposal excerpt.</p></div><Badge variant="secondary" className="privacy-badge">{guest ? "Temporary private guest workspace" : "Private workspace"}</Badge></div>
    <Tabs value={sourceMode} onValueChange={(value) => onSourceModeChange(value as "paste" | "file")}>
      <TabsList className="source-tabs">
        <TabsTrigger value="paste">Paste text</TabsTrigger>
        <TabsTrigger value="file">Upload file</TabsTrigger>
      </TabsList>
    </Tabs>
    <form onSubmit={onExtract}>
      {sourceMode === "paste" ? <label className="field"><span>Decision source</span><Textarea aria-label="Decision source" value={source} onChange={(event) => onSourceChange(event.target.value)} rows={10} placeholder="Paste the source material here…" /></label> : <label className="upload-zone"><input aria-label="Decision file" type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" onChange={(event) => onFileChange(event.target.files?.[0] ?? null)} /><span className="upload-icon">⇧</span><strong>{file ? file.name : "Choose a PDF, Markdown, or text file"}</strong><small>Maximum file size: 10 MB</small></label>}
      <div className="form-footer model-action-footer"><ModelPicker compact models={models} selectedId={selectedModelId} recommendedId={recommendedModelId} onSelect={onModelSelect} disabled={extracting} label="Extraction model" /><span className="draft-assurance"><span>{guest ? "Deterministic rules are free to try. This temporary library is isolated to this browser and expires after 24 hours." : selectedModel?.availability_reason ?? `${selectedModel?.label ?? "The selected model"} will suggest structure. You remain the reviewer.`}</span>{source.trim() && draftSavedAt ? <small><Save aria-hidden="true" />Draft saved locally · {formatDateTime(draftSavedAt)}</small> : null}</span><button className="primary" disabled={extracting || !selectedModelId || selectedModel?.available === false || (sourceMode === "paste" ? !source.trim() : !file)}>{extracting ? <><span className="spinner" />Extracting with {selectedModel?.label ?? "model"}…</> : guest ? "Try deterministic extraction →" : "Extract decision →"}</button></div>
    </form>
  </section>;
}
