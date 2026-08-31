"use client";

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogAction = AlertDialogPrimitive.Action;
const AlertDialogCancel = AlertDialogPrimitive.Cancel;
const AlertDialogDescription = AlertDialogPrimitive.Description;
const AlertDialogTitle = AlertDialogPrimitive.Title;

function AlertDialogContent({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return <AlertDialogPrimitive.Portal>
    <AlertDialogPrimitive.Overlay className="modal-backdrop radix-overlay" />
    <AlertDialogPrimitive.Content className={cn("confirm-modal radix-dialog", className)} {...props} />
  </AlertDialogPrimitive.Portal>;
}

export { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle };
