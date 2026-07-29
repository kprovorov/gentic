import { getIssueCode } from "./shared"
import { slugifyIssueTitle } from "./slug"

const FIRST_PUBLISH_BRANCH_FALLBACK_SLUG = "issue"

/**
 * Branch name for the first pull request Gentic automation or the "Create
 * PR" button requests for an issue: the lowercased issue code plus its title
 * slug, e.g. `fit-45-create-settings-page`. Falls back to `issue` when the
 * title has no usable slug (matching `slugifyIssueTitle`'s own fallback
 * behavior for URLs). Not persisted anywhere — callers derive it fresh each
 * time a publishing request is created. Later agent- or user-requested
 * pull requests are free to name their branch however they like; this
 * naming convention applies only to that first, system-requested one.
 */
export function generateFirstPublishBranchName(input: {
  projectKey: string
  issueNumber: number
  issueTitle?: string | null
}): string {
  const code = getIssueCode(input.projectKey, input.issueNumber).toLowerCase()
  const slug =
    slugifyIssueTitle(input.issueTitle) ?? FIRST_PUBLISH_BRANCH_FALLBACK_SLUG
  return `${code}-${slug}`
}

export interface PublishingRequestInput {
  /** Branch to create or switch to; reused as-is if it already exists. */
  branchName: string
  /** URL of a pull request already open for this issue, if any. */
  existingPrUrl?: string | null
}

/**
 * Formats the visible chat instruction that asks the agent to publish its
 * work, used by both the automatic first-PR flow and the manual "Create PR"
 * button. Deliberately pure and idempotent — the same input always renders
 * the same text, and the instructions themselves describe an idempotent
 * publish (reuse the branch and the pull request if either already exists,
 * never duplicate them, never commit when there is nothing to commit).
 */
export function formatPublishingRequest(input: PublishingRequestInput): string {
  const steps = [
    `1. Create the \`${input.branchName}\` branch if it doesn't exist yet, or switch to it if it does. Reuse it rather than creating a new one.`,
    "2. If there are uncommitted changes, commit them with a descriptive Conventional Commit message (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`, `build:`, or `ci:`). Never create an empty commit; skip this step if there is nothing to commit.",
    "3. Push the branch to the remote.",
    "4. Open a pull request against the repository's default branch, ready for review — never a draft. Use the commit message as the pull request title, and include a Summary section and a Test plan section in the pull request body.",
    input.existingPrUrl
      ? `5. A pull request is already recorded for this issue: ${input.existingPrUrl}. If it is still open, step 4 is already done — return its URL rather than opening a duplicate.`
      : "5. If a pull request is already open for this branch, do not open a duplicate — return its URL instead.",
  ]

  return [
    "The requested work is finished. Publish it now, following these steps exactly:",
    ...steps,
  ].join("\n")
}
