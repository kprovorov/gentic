import Link from "next/link"
import { Show, UserButton } from "@clerk/nextjs"
import { IconPlus } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"

import { MobileNav } from "./mobile-nav"

const navItems = [
  { href: "/home", label: "Issues" },
  { href: "/settings", label: "Projects" },
]

function Logo() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
      className="size-6 shrink-0 rounded-md"
    >
      <rect width="64" height="64" rx="14" fill="#9aff00" />
      <path
        d="M33 11c-13 0-23 9.5-23 21.5S20 54 33 54c7.4 0 13.7-3 17.7-7.8V30.5H32.3v9.4h7.8v2.5c-1.9 1.4-4.4 2.2-7.1 2.2-7.1 0-12.5-5.2-12.5-12.1S25.9 20.4 33 20.4c4.2 0 7.8 1.8 10.1 4.7l7.7-6.3C46.6 13.9 40.4 11 33 11Z"
        fill="#244d16"
      />
    </svg>
  )
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 md:px-8">
        <div className="flex items-center gap-6">
          <Show when="signed-in">
            <MobileNav navItems={navItems} />
          </Show>
          <Link href="/" className="flex items-center gap-2">
            <Logo />
            <span className="font-heading text-base font-semibold tracking-tight">
              Gentic
            </span>
          </Link>
          <Show when="signed-in">
            <nav className="hidden items-center gap-1 sm:flex">
              {navItems.map((item) => (
                <Button key={item.href} asChild variant="ghost" size="sm">
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              ))}
            </nav>
          </Show>
        </div>

        <div className="flex items-center gap-2">
          <Show when="signed-in">
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
              <Link href="/issues/new">
                <IconPlus />
                New issue
              </Link>
            </Button>
            <UserButton />
          </Show>
          <Show when="signed-out">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/register">Sign up</Link>
            </Button>
          </Show>
        </div>
      </div>
    </header>
  )
}
