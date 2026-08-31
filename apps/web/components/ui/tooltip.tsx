"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;
const TooltipProvider = TooltipPrimitive.Provider;

function TooltipContent({ className, sideOffset = 6, children, ...props }: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content sideOffset={sideOffset} className={cn("radix-tooltip", className)} {...props}>
      {children}<TooltipPrimitive.Arrow className="radix-tooltip-arrow" />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>;
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
