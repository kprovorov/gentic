import { NextResponse } from "next/server"
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"

const isProtectedRoute = createRouteMatcher([
  "/home(.*)",
  "/issues(.*)",
  "/settings(.*)",
])

export const proxy = clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    const { userId } = await auth()

    if (!userId) {
      const url = request.nextUrl.clone()
      url.pathname = "/"
      return NextResponse.redirect(url)
    }
  }
})

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - image files
     * - api/v1/ (the agent API and host enrollment)
     * - mcp (the remote MCP server)
     * - .well-known/ (OAuth metadata for MCP clients)
     *
     * Those last three are excluded deliberately, not for convenience.
     * `clerkMiddleware` calls `authenticateRequest` with `acceptsToken: "any"`
     * on every path it matches, and these three carry machine credentials
     * rather than a Clerk session: `gtwc_...` host credentials, which
     * `authenticateHostCredential` resolves against Supabase, and `oat_...`
     * OAuth tokens, which `lib/mcp/auth.ts` now verifies itself behind a cache.
     * A host polls the agent API about every three seconds, so leaving Clerk in
     * front of that traffic only bought a lookup with no Clerk identity to find
     * — and on `/mcp` it spent a metered Clerk verification before any route
     * code could cache the result (GEN-444). None of these routes calls
     * `auth()`.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/v1/|mcp$|mcp/|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
