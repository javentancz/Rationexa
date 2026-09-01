"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverAnchor = PopoverPrimitive.Anchor;
const PopoverClose = PopoverPrimitive.Close;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({ className, align = "center", sideOffset = 6, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content align={align} sideOffset={sideOffset} className={cn("z-50 outline-none", className)} {...props} />
  </PopoverPrimitive.Portal>;
}

export { Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger };
