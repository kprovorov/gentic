import { Waitlist } from "@clerk/nextjs"
import { Button } from "@gentic/ui/button"
import { Card, CardContent } from "@gentic/ui/card"
import { Skeleton } from "@gentic/ui/skeleton"
import Link from "next/link"
import { Logo } from "@/components/logo"

export default function WaitlistPage() {
  return (
    <div className="min-h-svh bg-muted/40">
      <header className="site-header">
        <Link href="/" className="brand" aria-label="Gentic home">
          <Logo className="brand-logo" />
          <span>Gentic</span>
        </Link>
        <Button asChild variant="ghost">
          <Link href="/">Back to home</Link>
        </Button>
      </header>
      <main className="mx-auto flex w-full max-w-md flex-col items-center gap-8 px-5 pt-10 pb-20 sm:pt-16">
        <div className="text-center">
          <p className="text-4xl leading-tight font-medium tracking-tight text-balance">
            Your next idea starts here.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Get early access to Gentic. We’ll email you when you’re invited in.
          </p>
        </div>
        <Waitlist
          fallback={
            <Card
              className="w-full"
              role="status"
              aria-label="Loading waitlist"
            >
              <CardContent className="space-y-5">
                <span className="sr-only">Loading waitlist…</span>
                <Skeleton className="mx-auto h-7 w-40" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full rounded-4xl" />
              </CardContent>
            </Card>
          }
        />
      </main>
    </div>
  )
}
