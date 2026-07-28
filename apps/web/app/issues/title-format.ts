export const MAX_TITLE_LENGTH = 60

const TRAILING_TITLE_PUNCTUATION = /[\s"'`.,;:!?-]+$/g

export function formatGeneratedIssueTitle(text: string): string {
  const title = text
    .trim()
    .replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/\s+/g, " ")

  if (title.length <= MAX_TITLE_LENGTH) {
    return title.replace(TRAILING_TITLE_PUNCTUATION, "")
  }

  const truncated = title.slice(0, MAX_TITLE_LENGTH)
  const wordBoundaryTitle = truncated
    .replace(/\s+\S*$/, "")
    .replace(TRAILING_TITLE_PUNCTUATION, "")

  return (wordBoundaryTitle || truncated).trim()
}
