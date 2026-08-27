"use client";

import { AlertDialog, Collapsible, Tooltip } from "radix-ui";
import { ChevronDown } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

export function Hint({
  label,
  children,
  side = "right",
  disabled = false,
}: {
  label: string;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
}) {
  if (disabled) return children;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="radix-tooltip" side={side} sideOffset={10} collisionPadding={16}>
          {label}<Tooltip.Arrow className="radix-tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busyLabel,
  busy = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="modal-backdrop radix-overlay" />
        <AlertDialog.Content className="confirm-modal radix-dialog">
          <AlertDialog.Title>{title}</AlertDialog.Title>
          <AlertDialog.Description>{description}</AlertDialog.Description>
          <div className="modal-actions">
            <AlertDialog.Cancel asChild><button className="text-button" disabled={busy}>Cancel</button></AlertDialog.Cancel>
            <button className="primary danger" disabled={busy} onClick={onConfirm}>{busy ? busyLabel : confirmLabel}</button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function Disclosure({
  title,
  eyebrow,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  eyebrow?: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root className="detail-disclosure" defaultOpen={defaultOpen}>
      <Collapsible.Trigger className="detail-disclosure-trigger">
        <span>{eyebrow ? <small>{eyebrow}</small> : null}<strong>{title}</strong>{summary ? <em>{summary}</em> : null}</span>
        <ChevronDown aria-hidden="true" />
      </Collapsible.Trigger>
      <Collapsible.Content className="detail-disclosure-content">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
