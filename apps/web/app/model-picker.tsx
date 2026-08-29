"use client";

import { Check, ChevronDown, Sparkles } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";

export type ModelOption = { id: string; provider: string; model: string; label: string; location: "local" | "hosted"; best_for: string; available: boolean; availability_reason?: string };

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
  const localModels = models.filter((model) => model.location === "local" && model.id !== recommended?.id);
  const hostedModels = models.filter((model) => model.location === "hosted" && model.id !== recommended?.id);
  const hasOllama = models.some((model) => model.provider === "ollama");
  const hasDeterministic = models.some((model) => model.provider === "deterministic");

  function runtimeLabel(model: ModelOption) {
    if (model.provider === "deterministic") return "Built-in rules · no API key";
    if (model.provider === "ollama") return "Private Ollama runtime";
    return `${model.provider} hosted API`;
  }

  function choose(modelId: string) { onSelect(modelId); setOpen(false); }
  const modelOption = (model: ModelOption, recommendedOption = false) => <button type="button" role="option" aria-selected={model.id === selectedId} className={`model-option ${model.id === selectedId ? "selected" : ""} ${model.available === false ? "unavailable" : ""}`} disabled={model.id === excludeId || model.available === false} onClick={() => choose(model.id)} key={`${recommendedOption ? "recommended" : "model"}-${model.id}`}>
    <span className="model-avatar">{model.label.slice(0, 1).toUpperCase()}</span>
    <span className="model-option-copy"><span><strong>{model.label}</strong>{recommendedOption ? <em>Recommended</em> : null}{model.available === false ? <em className="unavailable-badge">Unavailable</em> : null}</span><small>{model.availability_reason ?? model.best_for}</small><span className="model-option-meta">{runtimeLabel(model)}</span></span>
    <span className="model-check">{model.id === selectedId ? <Check aria-hidden="true" /> : null}</span>
  </button>;

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <div className={`model-picker ${compact ? "compact" : ""} ${open ? "open" : ""}`}>
      <Popover.Trigger asChild>
        <button type="button" className="model-trigger" aria-label={`${label}: ${selected?.label ?? "Loading models"}`} disabled={disabled || !models.length}>
          <span className="model-trigger-icon"><Sparkles aria-hidden="true" /></span><span><small>{label}</small><strong>{selected?.label ?? "Loading models…"}</strong></span><span className="model-location">{selected?.provider === "deterministic" ? "Built-in" : selected?.location ?? ""}</span><span className="model-chevron"><ChevronDown aria-hidden="true" /></span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="model-menu" role="listbox" aria-label="Available AI models" side={compact ? "top" : "bottom"} align="end" sideOffset={8} collisionPadding={16} avoidCollisions>
          <header><div><span className="overline">AI runtime</span><h3>Choose a model</h3></div><Popover.Close aria-label="Close model menu">×</Popover.Close></header>
          {recommended ? <div className="model-group"><span>Recommended for this workspace</span>{modelOption(recommended, true)}</div> : null}
          {localModels.length ? <div className="model-group"><span>Other local models</span>{localModels.map((model) => modelOption(model))}</div> : null}
          {hostedModels.length ? <div className="model-group"><span>Other hosted models</span>{hostedModels.map((model) => modelOption(model))}</div> : null}
          <footer><span className="runtime-dot" />{hasDeterministic ? "Built-in rules require no model or API key. " : ""}{hasOllama ? "Ollama models run only on a connected local runtime. " : ""}Hosted models appear after BYOK is configured.</footer>
        </Popover.Content>
      </Popover.Portal>
    </div>
  </Popover.Root>;
}
