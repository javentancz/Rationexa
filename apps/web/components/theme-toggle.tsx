"use client";

import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

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

  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <Button type="button" variant="outline" size="icon" className={compact ? "theme-toggle compact" : "theme-toggle"} aria-label="Choose color theme">
        <CurrentIcon aria-hidden="true" />
      </Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="theme-menu" sideOffset={8} align="end" collisionPadding={12}>
        <DropdownMenu.Label>Appearance</DropdownMenu.Label>
        {options.map(({ value, label, icon: Icon }) => <DropdownMenu.Item key={value} className="theme-menu-item" onSelect={() => setTheme(value)}>
          <Icon aria-hidden="true" /><span>{label}</span>{mounted && theme === value ? <Check aria-hidden="true" /> : null}
        </DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
