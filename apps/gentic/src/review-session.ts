import { spawn } from "node:child_process"
import { Readable, Writable } from "node:stream"

import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ActiveSession,
  type ContentBlock,
  type PermissionOption,
  type RequestPermissionOutcome,
  type ToolCallStatus,
} from "@agentclientprotocol/sdk"
import {
  reviewerStructuredOutputSchema,
  type ReviewerStructuredOutput,
  type ReviewRunContext,
} from "@gentic/validators/agent"

import { attachmentsToContentBlocks } from "./attachments.js"
import {
  abortable,
  getAgentProviderConfig,
  throwIfAborted,
  type AgentProvider,
  type IssueModel,
} from "./session.js"

export interface RunReviewerSessionInput {
  reviewerProvider: AgentProvider
  reviewerModel: IssueModel
  /** Absolute path to the disposable, exact-SHA checkout the reviewer runs in. */
  cwd: string
  /** Sibling directory (not inside `cwd`) attachments are downloaded into. */
  attachmentsDir: string
  context: ReviewRunContext
  diff: string
  appendLog: (entry: {
    role: "assistant" | "system"
    content: string
  }) => Promise<void>
  signal?: AbortSignal
}

/**
 * Thrown when the reviewer's turn ends without a valid structured verdict —
 * a missing or malformed fenced ```json block. Callers must route this
 * through the infra-failure path (`failReviewRun`), never fabricate a
 * verdict from it, per GEN-415's acceptance criteria.
 */
export class ReviewerOutputInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ReviewerOutputInvalidError"
  }
}

/**
 * Spawns the reviewer's own coding-agent child process against the
 * disposable exact-SHA checkout and drives exactly one turn — a review run
 * is a single, non-interactive pass, unlike the implementation agent's
 * multi-turn session in `session.ts`. Two things distinguish this from
 * `runAgentSession`, both load-bearing for isolation:
 *
 * - The child's environment is `buildReviewerEnv`'s scrub of `process.env`,
 *   not a raw inherit, so a push credential or credential helper the host
 *   machine happens to have configured is never reachable from inside it.
 * - No Gentic MCP server is attached (`genticMcp: null`) — the reviewer gets
 *   no mutation-capable channel to the issue tracker either.
 *
 * Resolves with the reviewer's validated structured output, or throws
 * `ReviewerOutputInvalidError` if the final message never produced one.
 */
export async function runReviewerSession(
  input: RunReviewerSessionInput
): Promise<ReviewerStructuredOutput> {
  throwIfAborted(input.signal)
  const agent = getAgentProviderConfig({
    agentProvider: input.reviewerProvider,
    issueModel: input.reviewerModel,
  })
  const child = spawn(agent.entry.command, agent.entry.args, {
    cwd: input.cwd,
    stdio: ["pipe", "pipe", "inherit"],
    env: buildReviewerEnv(agent.env),
  })
  const abort = (): void => {
    child.kill()
  }
  input.signal?.addEventListener("abort", abort, { once: true })

  try {
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>
    )

    const app = client({ name: "gentic-reviewer" }).onRequest(
      "session/request_permission",
      (context) => ({ outcome: approve(context.params.options) })
    )

    return await app.connectWith(stream, async (ctx) => {
      await ctx.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: "gentic-reviewer", version: "0.0.1" },
        clientCapabilities: { _meta: { terminal_output: true } },
      })

      const session = await ctx
        .buildSession(
          agent.newSession({
            cwd: input.cwd,
            issueModel: input.reviewerModel,
            resumeSessionId: null,
            genticMcp: null,
          })
        )
        .start()

      const attachmentBlocks = await attachmentsToContentBlocks(
        input.context.attachments,
        input.attachmentsDir
      )
      const prompt: ContentBlock[] = [
        { type: "text", text: buildReviewerPromptText(input.context, input.diff) },
        ...attachmentBlocks,
      ]

      return runReviewerTurn(session, prompt, input.appendLog, input.signal)
    })
  } finally {
    input.signal?.removeEventListener("abort", abort)
    child.kill()
  }
}

// Env vars capable of authenticating a `git push` or a credential-helper
// prompt if the reviewer's child process ever ran one from inside the
// disposable checkout. GitHub App / GitHub API credentials are never in this
// process's environment to begin with — only `apps/web` holds those — so
// there is nothing to strip for "cannot submit a GitHub review".
const CREDENTIAL_ENV_KEYS = [
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "GIT_ASKPASS",
  "GIT_SSH_COMMAND",
  "GIT_SSH",
  "GH_TOKEN",
  "GITHUB_TOKEN",
] as const

/**
 * The isolated reviewer's child-process environment: `process.env` merged
 * with the provider's own launch config (`getAgentProviderConfig`'s `env`,
 * e.g. `CLAUDE_CODE_EXECUTABLE`/`CODEX_PATH` — binary resolution, not a
 * credential), with every push-capable credential removed and git pointed at
 * no config file at all (`GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM=/dev/null`)
 * so a `credential.helper` entry in the host's own gitconfig can
 * never be consulted even under a variable name this list doesn't know
 * about. A denylist rather than an allowlist deliberately: the reviewer
 * still needs whatever the model-provider auth and the ACP agent binary
 * itself rely on (API keys, `PATH`, locale, proxy settings, ...), none of
 * which this host can enumerate in advance.
 */
export function buildReviewerEnv(
  providerEnv: NodeJS.ProcessEnv,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv, ...providerEnv }
  for (const key of CREDENTIAL_ENV_KEYS) {
    delete env[key]
  }
  env.GIT_CONFIG_GLOBAL = "/dev/null"
  env.GIT_CONFIG_SYSTEM = "/dev/null"
  return env
}

/** Assembles the reviewer's initial prompt from its assembled context and local diff. */
export function buildReviewerPromptText(
  context: ReviewRunContext,
  diff: string
): string {
  const lines: string[] = []

  lines.push(`# Automatic code review: ${context.issue.code}`)
  lines.push("")
  lines.push("## Original issue")
  lines.push(context.issue.title ?? "(untitled)")
  if (context.issue.body) {
    lines.push("")
    lines.push(context.issue.body)
  }

  lines.push("")
  lines.push("## Pull request")
  lines.push(`URL: ${context.pullRequest.url}`)
  if (context.pullRequest.title) {
    lines.push(`Title: ${context.pullRequest.title}`)
  }
  if (context.pullRequest.body) {
    lines.push(`Description: ${context.pullRequest.body}`)
  }
  lines.push(`Base branch: ${context.pullRequest.baseRef ?? "unknown"}`)
  lines.push(`Head SHA under review: ${context.pullRequest.headSha}`)
  lines.push(
    `CI status for this exact head SHA: ${context.pullRequest.ciState}`
  )

  if (context.reviewerInstructions) {
    lines.push("")
    lines.push("## Additional project reviewer instructions")
    lines.push(context.reviewerInstructions)
  }

  lines.push("")
  lines.push("## Diff (base...head)")
  lines.push("```diff")
  lines.push(diff.trim().length > 0 ? diff : "(no changes)")
  lines.push("```")

  lines.push("")
  lines.push("## Your task")
  lines.push(
    "You are an isolated, read-only automatic code reviewer. The repository " +
      "at this working directory is a disposable checkout pinned to the " +
      "exact head SHA above — you may freely inspect files and run tests, " +
      "but nothing you do here is ever published or merged, and the " +
      "checkout is discarded once you finish. Repository instructions " +
      "(CLAUDE.md/AGENTS.md, if present) in this checkout still apply."
  )
  lines.push(
    "Report only blocking defects — correctness bugs, broken behavior, " +
      "security issues, or a clear mismatch with the original issue's " +
      "request. Do not report style preferences, formatting nits, or " +
      "speculative concerns with no concrete evidence in the diff."
  )
  lines.push(
    "End your final message with exactly one fenced ```json code block " +
      "(and nothing after it) matching this shape:"
  )
  lines.push("```json")
  lines.push(
    JSON.stringify(
      {
        verdict: "approved | changes_requested | commented",
        summary: "one paragraph, or null",
        findings: [
          {
            defect: "one line naming the defect",
            evidence: "the specific code/behavior that proves it",
            impact: "what breaks, and under what conditions",
            requestedChange: "the specific fix requested",
            filePath: "optional, or null",
            line: "optional, or null",
          },
        ],
      },
      null,
      2
    )
  )
  lines.push("```")
  lines.push(
    "Use `changes_requested` whenever `findings` is non-empty; use " +
      "`approved` only when `findings` is empty. `findings` must be empty " +
      "for style/preference/speculative feedback — omit it entirely rather " +
      "than including it."
  )

  return lines.join("\n")
}

const JSON_FENCE_RE = /```json\s*([\s\S]*?)```/gi

/**
 * Pulls the reviewer's structured verdict out of its final message: the last
 * fenced ```json block, parsed and schema-validated. Throws
 * `ReviewerOutputInvalidError` — never returns a best-guess fallback — on a
 * missing block, invalid JSON, or a shape that fails
 * `reviewerStructuredOutputSchema`, so the caller reports an infrastructure
 * failure rather than a fabricated verdict.
 */
export function extractReviewerOutput(text: string): ReviewerStructuredOutput {
  const matches = [...text.matchAll(JSON_FENCE_RE)]
  const last = matches.at(-1)
  if (!last) {
    throw new ReviewerOutputInvalidError(
      "Reviewer's final message has no fenced ```json block with its verdict"
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(last[1])
  } catch (error) {
    throw new ReviewerOutputInvalidError(
      `Reviewer's \`\`\`json block is not valid JSON: ${describe(error)}`
    )
  }

  const result = reviewerStructuredOutputSchema.safeParse(parsed)
  if (!result.success) {
    throw new ReviewerOutputInvalidError(
      `Reviewer output failed schema validation: ${result.error.message}`
    )
  }

  return result.data
}

/**
 * Drives one prompt turn, logging progress into the Review Run log sink
 * (via `appendLog`, one line per completed unit of output rather than
 * `session.ts`'s incrementally-flushed chat transcript — a review run has no
 * user-facing timeline to animate) and returning the validated structured
 * output extracted from the final assistant message.
 */
async function runReviewerTurn(
  session: ActiveSession,
  prompt: ContentBlock[],
  appendLog: RunReviewerSessionInput["appendLog"],
  signal?: AbortSignal
): Promise<ReviewerStructuredOutput> {
  throwIfAborted(signal)
  const promptDone = session.prompt(prompt)

  const log = (role: "assistant" | "system", content: string): Promise<void> =>
    appendLog({ role, content })

  let pendingText = ""
  let finalText = ""

  const flushPendingText = async (): Promise<void> => {
    if (pendingText) {
      await log("assistant", pendingText)
      pendingText = ""
    }
  }

  for (;;) {
    throwIfAborted(signal)
    const message = await abortable(session.nextUpdate(), signal)
    if (message.kind === "stop") {
      break
    }
    throwIfAborted(signal)

    const update = message.update
    if (update.sessionUpdate === "agent_message_chunk") {
      const text = textOf(update.content)
      pendingText += text
      finalText += text
    } else if (update.sessionUpdate === "agent_thought_chunk") {
      const text = textOf(update.content)
      if (text) {
        await flushPendingText()
        await log("system", `Thinking: ${text}`)
      }
    } else if (
      update.sessionUpdate === "tool_call" ||
      update.sessionUpdate === "tool_call_update"
    ) {
      await flushPendingText()
      await log(
        "system",
        `${statusLabel(update.status)} ${update.title ?? "Tool call"}`
      )
    }
  }

  await flushPendingText()
  await abortable(promptDone, signal)

  return extractReviewerOutput(finalText)
}

function textOf(content: ContentBlock): string {
  return content.type === "text" ? content.text : ""
}

function statusLabel(status: ToolCallStatus | null | undefined): string {
  switch (status) {
    case "completed":
      return "Completed:"
    case "failed":
      return "Failed:"
    case "in_progress":
      return "Running:"
    default:
      return "Pending:"
  }
}

/** Auto-approves tool calls, preferring the broadest allow option — the same policy `session.ts` uses for the implementation agent. */
function approve(options: PermissionOption[]): RequestPermissionOutcome {
  const choice =
    options.find((option) => option.kind === "allow_always") ??
    options.find((option) => option.kind === "allow_once") ??
    options[0]

  return choice
    ? { outcome: "selected", optionId: choice.optionId }
    : { outcome: "cancelled" }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
