"use client"

import Link from "next/link"
import { Popover } from "radix-ui"
import { IconMenu2, IconPlus } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"

export function MobileNav({
  navItems,
}: {
  navItems: { href: string; label: string }[]
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="sm:hidden"
          aria-label="Open menu"
        >
          <IconMenu2 />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          className="z-50 w-56 rounded-2xl border bg-popover p-2 text-popover-foreground shadow-md outline-none"
        >
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => (
              <Popover.Close key={item.href} asChild>
                <Link
                  href={item.href}
                  className="rounded-xl px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  {item.label}
                </Link>
              </Popover.Close>
            ))}
            <Popover.Close asChild>
              <Link
                href="/issues/new"
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <IconPlus className="size-4" />
                New issue
              </Link>
            </Popover.Close>
          </nav>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
