"use client";

import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const options = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const { theme, resolvedTheme, setTheme } = useTheme();
  useEffect(() => setMounted(true), []);
  const CurrentIcon = mounted && resolvedTheme === "dark" ? Moon : Sun;

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="outline" size="icon" className={compact ? "theme-toggle compact" : "theme-toggle"} aria-label="Choose color theme">
        <CurrentIcon aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
      <DropdownMenuContent className="theme-menu" sideOffset={8} align="end" collisionPadding={12}>
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        {options.map(({ value, label, icon: Icon }) => <DropdownMenuItem key={value} className="theme-menu-item" onSelect={() => setTheme(value)}>
          <Icon aria-hidden="true" /><span>{label}</span>{mounted && theme === value ? <Check aria-hidden="true" /> : null}
        </DropdownMenuItem>)}
      </DropdownMenuContent>
  </DropdownMenu>;
}
