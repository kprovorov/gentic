"use client"

import { usePathname } from "next/navigation"

import { Separator } from "@gentic/ui/separator"
import { SidebarTrigger } from "@gentic/ui/sidebar"

function pageTitle(pathname: string) {
  if (pathname === "/home") return "Home"
  if (pathname === "/issues") return "Issues"
  if (pathname === "/settings") return "Projects"
  if (pathname === "/issues/new") return "New issue"
  if (/^\/issues\/[^/]+\/edit$/.test(pathname)) return "Edit issue"
  if (/^\/issues\/[^/]+$/.test(pathname)) return "Issue"
  return "Gentic"
}

export function SiteHeader() {
  const pathname = usePathname()

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-2 self-center data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">{pageTitle(pathname)}</h1>
      </div>
    </header>
  )
}
