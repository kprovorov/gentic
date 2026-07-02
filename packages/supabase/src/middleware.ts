import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Refreshes the user's session on every request and keeps auth cookies in sync
 * between the browser and the server. Call this from the root `middleware.ts`.
 *
 * IMPORTANT: always return the `supabaseResponse` object as-is. If you need to
 * build your own response, copy over the cookies first, or you'll silently log
 * users out. See the redirect example below.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANT: Do not run code between createServerClient and getClaims().
  // A simple mistake here can make it very hard to debug random logouts.

  // getClaims() validates the JWT and refreshes the session when needed.
  const { data } = await supabase.auth.getClaims()

  const user = data?.claims

  // Gate protected routes behind login. Copy the refreshed cookies onto the
  // redirect response so the session isn't dropped.
  const protectedRoutes = ["/home"]
  const isProtected = protectedRoutes.some((route) =>
    request.nextUrl.pathname.startsWith(route),
  )

  if (!user && isProtected) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    const redirectResponse = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirectResponse.cookies.set(cookie)
    })
    return redirectResponse
  }

  // IMPORTANT: return supabaseResponse unchanged to preserve refreshed cookies.
  return supabaseResponse
}
