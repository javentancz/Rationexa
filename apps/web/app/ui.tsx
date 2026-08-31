"use client";

import { ChevronDown } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} sideOffset={10} collisionPadding={16}>{label}</TooltipContent>
    </Tooltip>
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
    <AlertDialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
        <AlertDialogContent>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          <div className="modal-actions">
            <AlertDialogCancel className="text-button" disabled={busy}>Cancel</AlertDialogCancel>
            <Button type="button" variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? busyLabel : confirmLabel}</Button>
          </div>
        </AlertDialogContent>
    </AlertDialog>
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
    <Collapsible className="detail-disclosure" defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="detail-disclosure-trigger">
        <span>{eyebrow ? <small>{eyebrow}</small> : null}<strong>{title}</strong>{summary ? <em>{summary}</em> : null}</span>
        <ChevronDown aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent className="detail-disclosure-content">{children}</CollapsibleContent>
    </Collapsible>
  );
}
