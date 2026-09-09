import { PHASE_PRODUCTION_BUILD } from "next/constants"
import type { NextConfig } from "next"

const nextConfig: NextConfig = {}

// `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is inlined into the client bundle at build
// time, so a deploy built without it ships a waitlist form that is permanently
// stuck on "temporarily unavailable" — a silent failure no test or type check
// catches, because the fallback branch is itself correct. Fail the deploy
// instead. Scoped to Vercel builds: CI (`pnpm build`) and local builds have no
// key and must stay green, and the runtime phases are excluded so a missing key
// can never take the whole marketing site down with a 500.
export default function config(phase: string): NextConfig {
  if (
    phase === PHASE_PRODUCTION_BUILD &&
    process.env.VERCEL &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ) {
    throw new Error(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required to build the landing page: " +
        "without it the waitlist form renders as unavailable. Set it on this " +
        "Vercel project (all environments) to the same Clerk application " +
        "apps/web uses, then redeploy. See apps/landing/README.md."
    )
  }

  return nextConfig
}
