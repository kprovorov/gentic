import { Redis } from "@upstash/redis"

let client: Redis | null | undefined

/**
 * Shared Upstash Redis (REST) client, or `null` when the credentials aren't
 * configured — e.g. local dev. Callers must treat Redis as a best-effort cache
 * and degrade gracefully when this returns `null` or a call throws, rather than
 * letting cache availability gate the request.
 */
export function getRedis(): Redis | null {
  if (client === undefined) {
    const url = process.env.UPSTASH_REDIS_REST_URL
    const token = process.env.UPSTASH_REDIS_REST_TOKEN
    // Store/return values as raw strings so simple string caches round-trip
    // deterministically instead of going through JSON (de)serialization.
    client =
      url && token
        ? new Redis({ url, token, automaticDeserialization: false })
        : null
  }
  return client
}
