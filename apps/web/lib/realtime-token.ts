import { importJWK, SignJWT } from "jose"

// Comfortably inside a run; the worker refreshes before this via
// realtime.setAuth (see apps/gentic/src/realtime.ts).
const TOKEN_TTL_SECONDS = 60 * 60

export interface RealtimeToken {
  url: string
  apiKey: string
  token: string
  expiresAt: string
}

/**
 * Mints a short-lived Supabase JWT for the given Clerk user, signed with the
 * project's asymmetric JWT signing key (see docs/realtime-transport.md
 * "JWT signing key setup"). Its claims mirror what Supabase sees from a
 * Clerk-issued session token, so the same `realtime.messages` RLS policies
 * authorize both browser and worker connections to a private issue channel.
 */
export async function mintRealtimeToken(userId: string): Promise<RealtimeToken> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const privateKeyJwk = process.env.SUPABASE_JWT_PRIVATE_KEY

  if (!url || !apiKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not configured"
    )
  }
  if (!privateKeyJwk) {
    throw new Error("SUPABASE_JWT_PRIVATE_KEY is not configured")
  }

  const jwk = JSON.parse(privateKeyJwk) as JsonWebKey & { kid: string }
  const privateKey = await importJWK(jwk, "ES256")

  const now = Math.floor(Date.now() / 1000)
  const exp = now + TOKEN_TTL_SECONDS

  const token = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey)

  return {
    url,
    apiKey,
    token,
    expiresAt: new Date(exp * 1000).toISOString(),
  }
}
