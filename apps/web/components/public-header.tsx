import Link from "next/link"

import { Button } from "@gentic/ui/button"

import { Logo } from "./logo"

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 md:px-8">
        <Link href="/" className="flex items-center gap-2">
          <Logo />
          <span className="font-heading text-base font-semibold tracking-tight">
            Gentic
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/register">Sign up</Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
