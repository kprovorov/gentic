import { slugifyIssueTitle } from "./issue-slug.js"

const DEFAULT_TITLE_SLUG = "issue"

export interface FirstPullRequestBranchInput {
  issueCode: string
  issueTitle?: string | null
}

export function formatFirstPullRequestBranchName(
  input: FirstPullRequestBranchInput
): string {
  const code = input.issueCode.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-")
  const normalizedCode = code.replace(/^-+|-+$/g, "") || DEFAULT_TITLE_SLUG
  const titleSlug = slugifyIssueTitle(input.issueTitle) ?? DEFAULT_TITLE_SLUG

  return `${normalizedCode}-${titleSlug}`
}

export interface PublishingRequestInput {
  branchName: string
}

export type FirstPullRequestPublishingRequestInput = FirstPullRequestBranchInput

export function formatPublishingRequest(input: PublishingRequestInput): string {
  return [
    "The requested work is finished. Publish it now.",
    "",
    "Follow any explicit visible chat instructions in this conversation as authoritative.",
    "",
    "Publishing requirements:",
    `- Create or switch to the branch \`${input.branchName}\`. If that branch already exists locally or on the remote, reuse it.`,
    "- Commit uncommitted changes with a descriptive Conventional Commit message.",
    "- Avoid empty commits.",
    "- Push the branch to the remote.",
    "- Open a ready-for-review pull request against the repository's default branch using the `gh` CLI.",
    "- Use the commit message as the pull request title.",
    "- Include Summary and Tests sections in the pull request body.",
    "- Before opening a pull request, check whether one already exists for this branch. Return the existing pull request URL instead of creating a duplicate.",
  ].join("\n")
}

export function formatFirstPullRequestPublishingRequest(
  input: FirstPullRequestPublishingRequestInput
): string {
  return formatPublishingRequest({
    branchName: formatFirstPullRequestBranchName(input),
  })
}
