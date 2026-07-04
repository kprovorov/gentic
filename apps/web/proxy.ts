import { NextResponse } from "next/server"
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"

// /api/mcp and /.well-known/oauth-* are authenticated via an OAuth bearer
// token (see @clerk/mcp-tools), not a Clerk session cookie, so they must
// never match isProtectedRoute below or MCP clients would get redirected
// to /login instead of a 401 challenge.
const isProtectedRoute = createRouteMatcher(["/home(.*)"])

export const proxy = clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    const { userId } = await auth()

    if (!userId) {
      const url = request.nextUrl.clone()
      url.pathname = "/login"
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
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
