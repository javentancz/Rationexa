"use client";

import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";

export type ModelOption = { id: string; provider: string; model: string; label: string; location: "local" | "hosted"; best_for: string };

type ModelPickerProps = {
  models: ModelOption[];
  selectedId: string;
  recommendedId: string;
  onSelect: (modelId: string) => void;
  disabled?: boolean;
  excludeId?: string;
  compact?: boolean;
  label?: string;
};

export function ModelPicker({ models, selectedId, recommendedId, onSelect, disabled = false, excludeId, compact = false, label = "Model for next AI step" }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = models.find((model) => model.id === selectedId);
  const recommended = models.find((model) => model.id === recommendedId);
  const localModels = models.filter((model) => model.location === "local");
  const hostedModels = models.filter((model) => model.location === "hosted");

  function choose(modelId: string) { onSelect(modelId); setOpen(false); }
  const modelOption = (model: ModelOption, recommendedOption = false) => <button type="button" role="option" aria-selected={model.id === selectedId} className={`model-option ${model.id === selectedId ? "selected" : ""}`} disabled={model.id === excludeId} onClick={() => choose(model.id)} key={`${recommendedOption ? "recommended" : "model"}-${model.id}`}>
    <span className="model-avatar">{model.label.slice(0, 1).toUpperCase()}</span>
    <span className="model-option-copy"><span><strong>{model.label}</strong>{recommendedOption ? <em>Recommended</em> : null}</span><small>{model.best_for}</small><span className="model-option-meta">{model.location === "local" ? "Private local runtime" : `${model.provider} hosted API`}</span></span>
    <span className="model-check">{model.id === selectedId ? <Check aria-hidden="true" /> : null}</span>
  </button>;

  return <div className={`model-picker ${compact ? "compact" : ""} ${open ? "open" : ""}`}>
    <button type="button" className="model-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={disabled || !models.length} onClick={() => setOpen((current) => !current)}>
      <span className="model-trigger-icon"><Sparkles aria-hidden="true" /></span><span><small>{label}</small><strong>{selected?.label ?? "Loading models…"}</strong></span><span className="model-location">{selected?.location ?? ""}</span><span className="model-chevron"><ChevronDown aria-hidden="true" /></span>
    </button>
    {open ? <><button type="button" className="model-picker-scrim" aria-label="Close model menu" onClick={() => setOpen(false)} /><section className="model-menu" role="listbox" aria-label="Available AI models">
      <header><div><span className="overline">AI runtime</span><h3>Choose a model</h3></div><button type="button" aria-label="Close model menu" onClick={() => setOpen(false)}>×</button></header>
      {recommended ? <div className="model-group"><span>Recommended for this workspace</span>{modelOption(recommended, true)}</div> : null}
      {localModels.length ? <div className="model-group"><span>Local models</span>{localModels.map((model) => modelOption(model))}</div> : null}
      {hostedModels.length ? <div className="model-group"><span>Hosted models</span>{hostedModels.map((model) => modelOption(model))}</div> : null}
      <footer><span className="runtime-dot" />Only configured and available models are shown.</footer>
    </section></> : null}
  </div>;
}
