import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { Readable, Writable } from "node:stream"

import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ActiveSession,
  type ClientContext,
  type ContentBlock,
  type NewSessionResponse,
  type NewSessionRequest,
  type PermissionOption,
  type RequestPermissionOutcome,
  type ResumeSessionResponse,
} from "@agentclientprotocol/sdk"

import type { AgentApi } from "./api.js"
import { logError } from "./log.js"
import { StreamingAssistantMessage, publishMessage } from "./messages.js"
import type { IssueRealtimeChannel } from "./realtime.js"

export type AgentProvider = "claude_code" | "codex"

/** How to launch one ACP agent's child process. */
interface AgentEntry {
  command: string
  args: string[]
  /** True when `command` is the compiled sidecar binary, not a dev/node path. */
  usingSidecar: boolean
  /** Absolute path to the sidecar's own directory, for locating its siblings. */
  sidecarDir: string | null
}

/**
 * In dev/pnpm mode the ACP agent is a plain ESM file under node_modules, run
 * with `node <file>` (`process.execPath` is the node binary). When gentic is
 * compiled with `bun build --compile`, `require.resolve` against
 * node_modules no longer applies (there is no node_modules on the target
 * machine) and `process.execPath` refers to the gentic binary itself, so
 * `node <file>` would just re-invoke gentic with a stray argument. The build
 * script (scripts/build-binary.sh) works around both problems by compiling
 * each ACP agent into its own standalone sidecar binary under
 * `vendor/<name>/<name>`, next to the gentic binary — so this prefers that
 * binary (run directly, no runtime needed) and falls back to the dev-mode
 * `require.resolve` + node-invocation path when no sidecar is present.
 */
function resolveAgentEntry(
  sidecarName: "claude-agent-acp" | "codex-acp",
  packageEntry: string
): AgentEntry {
  const sidecarDir = join(dirname(process.execPath), "vendor", sidecarName)
  const sidecar = join(sidecarDir, sidecarName)
  if (existsSync(sidecar)) {
    return { command: sidecar, args: [], usingSidecar: true, sidecarDir }
  }

  const require = createRequire(import.meta.url)
  return {
    command: process.execPath,
    args: [require.resolve(packageEntry)],
    usingSidecar: false,
    sidecarDir: null,
  }
}

// Appended to the selected agent's instructions so every issue run ends
// with its work committed and proposed for review, without relying on each
// issue's own instructions to say so.
const COMMIT_AND_PR_INSTRUCTIONS = `Before you finish working on this issue, commit your changes with a descriptive commit message and open a pull request against the repository's default branch using the \`gh\` CLI. Title the pull request following the Conventional Commits spec: prefix it with a type such as \`feat:\`, \`fix:\`, \`chore:\`, \`docs:\`, \`refactor:\`, \`test:\`, \`perf:\`, \`build:\`, or \`ci:\` (for example, \`feat: add issue assignment API\`), so it produces a clean squash-merge commit message for CI/CD. Do this even if not explicitly asked. Skip it only if you made no changes to commit.`

export function issueRunInstructions(existingPrUrl?: string | null): string {
  if (existingPrUrl) {
    return `This follow-up run already has an existing pull request: ${existingPrUrl}. This supersedes any prior instruction to open a pull request. The existing pull request branch has already been checked out. Before you finish, commit your changes with a descriptive commit message and push them to that same branch. Do not open a new pull request. Skip committing and pushing only if you made no changes.`
  }

  return COMMIT_AND_PR_INSTRUCTIONS
}

/** One prompt turn: plain text, or text plus attachment content blocks. */
export type PromptTurn = string | ContentBlock[]

export interface RunSessionInput {
  api: AgentApi
  issueId: string
  channel: IssueRealtimeChannel
  agentProvider: AgentProvider
  /** Absolute path to the cloned repo the agent works in. */
  cwd: string
  /**
   * ACP session id from a previous run on this issue. When set, the session
   * resumes with its prior conversation context instead of starting fresh.
   */
  resumeSessionId?: string | null
  /** Existing pull request for the issue, if a previous run already opened one. */
  existingPrUrl?: string | null
  /** Called once with the ACP session id after the session starts. */
  onSessionId: (sessionId: string) => Promise<void>
  /**
   * Supplies the next user prompt for the session. Resolve with `null` when
   * there is no more work, which ends the session.
   */
  nextPrompt: () => Promise<PromptTurn | null>
}

/**
 * Spawns the selected coding agent over ACP against the cloned repo and drives
 * one prompt turn per message from `nextPrompt`, streaming assistant output
 * into the issue transcript. Resolves once `nextPrompt` returns `null`.
 */
export async function runAgentSession(input: RunSessionInput): Promise<void> {
  const agent = getAgentProviderConfig(input.agentProvider)
  const child = spawn(agent.entry.command, agent.entry.args, {
    cwd: input.cwd,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, ...agent.env },
  })

  try {
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!) as unknown as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>
    )

    const app = client({ name: "gentic" }).onRequest(
      "session/request_permission",
      (context) => ({ outcome: approve(context.params.options) })
    )

    await app.connectWith(stream, async (ctx) => {
      await ctx.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: "gentic", version: "0.0.1" },
      })

      const session =
        agent.provider === "codex" && input.resumeSessionId
          ? await resumeSession(ctx, input.resumeSessionId, input.cwd)
          : await ctx.buildSession(agent.newSession(input)).start()
      await input.onSessionId(session.sessionId)

      let shouldPrependInstructions = agent.provider === "codex"
      for (;;) {
        let prompt = await input.nextPrompt()
        if (prompt === null) {
          break
        }
        if (shouldPrependInstructions) {
          prompt = prependInstructions(prompt, input.existingPrUrl)
          shouldPrependInstructions = false
        }
        await runTurn(session, input.api, input.issueId, input.channel, prompt)
      }
    })
  } finally {
    child.kill()
  }
}

interface AgentProviderConfig {
  provider: AgentProvider
  entry: AgentEntry
  env: NodeJS.ProcessEnv
  newSession: (input: RunSessionInput) => NewSessionRequest
}

function getAgentProviderConfig(provider: AgentProvider): AgentProviderConfig {
  if (provider === "codex") {
    const entry = resolveAgentEntry(
      "codex-acp",
      "@agentclientprotocol/codex-acp/dist/index.js"
    )
    return {
      provider,
      entry,
      env: {
        INITIAL_AGENT_MODE: process.env.INITIAL_AGENT_MODE ?? "agent-full-access",
        // codex-acp resolves its bundled @openai/codex fallback via
        // require.resolve when CODEX_PATH is unset, which — like our own
        // CLAUDE_AGENT_ENTRY resolution — breaks under bun-compile (no
        // node_modules on the target machine). The readme already documents
        // the Codex CLI as an external prerequisite installed on PATH, so
        // when running the compiled sidecar, point at that instead of
        // letting codex-acp fall through to its broken bundled resolution.
        ...(entry.usingSidecar
          ? { CODEX_PATH: process.env.CODEX_PATH ?? "codex" }
          : {}),
      },
      newSession: (input) => ({
        cwd: input.cwd,
        mcpServers: [],
      }),
    }
  }

  const entry = resolveAgentEntry(
    "claude-agent-acp",
    "@agentclientprotocol/claude-agent-acp/dist/index.js"
  )
  return {
    provider,
    entry,
    env: {
      // claude-agent-acp locates the native `claude` CLI (a per-platform
      // optionalDependency of @anthropic-ai/claude-agent-sdk) via
      // import.meta.resolve, which only works against a real node_modules —
      // absent from the compiled binary. build-binary.sh vendors that native
      // binary next to the sidecar; point straight at it so the SDK's own
      // (broken, in this mode) resolution never runs.
      ...(entry.usingSidecar && entry.sidecarDir
        ? {
            CLAUDE_CODE_EXECUTABLE:
              process.env.CLAUDE_CODE_EXECUTABLE ??
              join(entry.sidecarDir, "claude"),
          }
        : {}),
    },
    newSession: (input) => ({
      cwd: input.cwd,
      mcpServers: [],
      _meta: {
        claudeCode: {
          options: {
            systemPrompt: {
              type: "preset",
              preset: "claude_code",
              append: issueRunInstructions(input.existingPrUrl),
            },
            ...(input.resumeSessionId ? { resume: input.resumeSessionId } : {}),
          },
        },
      },
    }),
  }
}

function prependInstructions(
  prompt: PromptTurn,
  existingPrUrl?: string | null
): PromptTurn {
  const instructions = `System instructions for this issue run:\n${issueRunInstructions(existingPrUrl)}\n\nUser request:\n`

  if (typeof prompt === "string") {
    return `${instructions}${prompt}`
  }

  return [{ type: "text", text: instructions }, ...prompt]
}

async function resumeSession(
  ctx: ClientContext,
  sessionId: string,
  cwd: string
): Promise<ActiveSession> {
  const response = (await ctx.request("session/resume", {
    sessionId,
    cwd,
    mcpServers: [],
  })) as ResumeSessionResponse

  const attachable = ctx as unknown as {
    attachSession(response: NewSessionResponse): ActiveSession
  }

  return attachable.attachSession({
    sessionId,
    ...response,
  } satisfies NewSessionResponse)
}

/** Sends one prompt and streams updates into the transcript until it stops. */
export async function runTurn(
  session: ActiveSession,
  api: AgentApi,
  issueId: string,
  channel: IssueRealtimeChannel,
  prompt: PromptTurn
): Promise<void> {
  const promptDone = session.prompt(prompt)

  let current: StreamingAssistantMessage | null = null
  let currentKind: "text" | "thinking" | null = null

  const streamInto = async (
    kind: "text" | "thinking"
  ): Promise<StreamingAssistantMessage> => {
    if (current && currentKind !== kind) {
      await current.finalize()
      current = null
    }
    if (!current) {
      current = new StreamingAssistantMessage(api, issueId, channel, kind)
      currentKind = kind
    }
    return current
  }

  const finalizeCurrent = async (): Promise<void> => {
    if (current) {
      await current.finalize()
      current = null
      currentKind = null
    }
  }

  try {
    for (;;) {
      const message = await session.nextUpdate()
      if (message.kind === "stop") {
        break
      }

      const update = message.update
      if (update.sessionUpdate === "agent_message_chunk") {
        const text = textOf(update.content)
        if (text) {
          await (await streamInto("text")).append(text)
        }
      } else if (update.sessionUpdate === "agent_thought_chunk") {
        const text = textOf(update.content)
        if (text) {
          await (await streamInto("thinking")).append(text)
        }
      } else if (update.sessionUpdate === "tool_call") {
        // Flush any streaming text first so the transcript keeps its ordering.
        await finalizeCurrent()
        await publishMessage(api, issueId, channel, {
          kind: "tool",
          content: update.title,
        })
      }
    }

    await finalizeCurrent()
    // Surface any prompt-turn error (the loop above already saw the stop).
    await promptDone
  } catch (error) {
    const partial = current as StreamingAssistantMessage | null
    if (partial) {
      await partial.persistPartialError().catch((persistError) => {
        logError("failed to persist errored assistant message:", persistError)
      })
    }
    throw error
  }
}

function textOf(content: ContentBlock): string {
  return content.type === "text" ? content.text : ""
}

/** Auto-approves tool calls, preferring the broadest allow option. */
function approve(options: PermissionOption[]): RequestPermissionOutcome {
  const choice =
    options.find((option) => option.kind === "allow_always") ??
    options.find((option) => option.kind === "allow_once") ??
    options[0]

  return choice
    ? { outcome: "selected", optionId: choice.optionId }
    : { outcome: "cancelled" }
}
