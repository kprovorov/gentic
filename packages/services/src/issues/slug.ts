const MAX_SLUG_LENGTH = 60

// Returns null (never throws) so callers can tell "no slug yet" from "has one"
export function slugifyIssueTitle(title: string | null | undefined) {
  if (!title) return null

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  if (slug.length === 0) return null
  if (slug.length <= MAX_SLUG_LENGTH) return slug

  let cut = slug.slice(0, MAX_SLUG_LENGTH)
  if (slug[MAX_SLUG_LENGTH] !== "-") {
    const lastDash = cut.lastIndexOf("-")
    if (lastDash > 0) cut = cut.slice(0, lastDash)
  }

  return cut.replace(/-+$/, "")
}
