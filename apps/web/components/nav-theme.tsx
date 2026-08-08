"use client"

import * as React from "react"
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react"

import { useTheme } from "@gentic/ui/theme-provider"
import { ToggleGroup, ToggleGroupItem } from "@gentic/ui/toggle-group"

const options = [
  { value: "light", label: "Light", icon: IconSun },
  { value: "dark", label: "Dark", icon: IconMoon },
  { value: "system", label: "System", icon: IconDeviceDesktop },
]

const emptySubscribe = () => () => {}

export function NavTheme() {
  const { theme, setTheme } = useTheme()

  // theme is unknown during SSR, so wait until hydration to reflect selection
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      value={mounted ? theme : undefined}
      onValueChange={(value) => value && setTheme(value)}
      className="w-full"
      aria-label="Appearance"
    >
      {options.map(({ value, label, icon: Icon }) => (
        <ToggleGroupItem
          key={value}
          value={value}
          aria-label={label}
          className="flex-1"
        >
          <Icon />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
