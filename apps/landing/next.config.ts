import { PHASE_PRODUCTION_BUILD } from "next/constants"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {}

// `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is inlined into the client bundle at build
// time, so a deploy built without it ships a waitlist form permanently stuck on
// "temporarily unavailable" — a silent failure no test, type check or build
// catches, because the fallback branch is itself correct. Warn in the build log,
// where someone asking "why is the waitlist dead?" will look.
//
// Deliberately a warning and not a thrown error: failing the build would trade a
// page whose waitlist is broken for a page that cannot deploy at all, freezing
// the whole marketing site at its last good build over one optional widget.
// Scoped to Vercel's production build so local and CI builds, which have no key
// by design, stay quiet.
export default function config(phase: string): NextConfig {
  if (
    phase === PHASE_PRODUCTION_BUILD &&
    process.env.VERCEL &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ) {
    console.warn(
      "\n⚠️  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not set for this build.\n" +
        "   The waitlist form will render as permanently unavailable.\n" +
        "   Set it on this Vercel project (all environments) to the same Clerk\n" +
        "   application apps/web uses, then redeploy — the key is inlined at\n" +
        "   build time, so setting it without a redeploy changes nothing.\n" +
        "   See apps/landing/README.md.\n"
    )
  }

  return nextConfig
}
