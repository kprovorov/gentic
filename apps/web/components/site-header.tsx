"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type React from "react"

import { SidebarTrigger } from "@gentic/ui/sidebar"

function pageHeading(pathname: string): React.ReactNode {
  if (pathname === "/issues") return "Issues"
  if (pathname === "/settings") return "Projects"
  if (pathname === "/issues/new") return "New issue"
  if (/^\/issues\/[^/]+\/edit$/.test(pathname)) return "Edit issue"

  const issueMatch = /^\/issues\/([^/]+)(?:\/[^/]+)?$/.exec(pathname)
  if (issueMatch) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <Link href="/issues" className="shrink-0 hover:text-foreground">
          Issues
        </Link>
        <span aria-hidden className="shrink-0">
          /
        </span>
        <span className="min-w-0 truncate font-mono text-xs text-foreground">
          {decodeURIComponent(issueMatch[1])}
        </span>
      </span>
    )
  }

  return "Gentic"
}

export function SiteHeader() {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 backdrop-blur transition-[width,height] ease-linear">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <div aria-hidden="true" className="mx-2 h-4 w-px shrink-0 bg-border" />
        <h1 className="min-w-0 text-sm font-medium">{pageHeading(pathname)}</h1>
      </div>
    </header>
  )
}
