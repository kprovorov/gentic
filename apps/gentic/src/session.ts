import { spawn } from "node:child_process"
import { createRequire } from "node:module"
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

import {
  StreamingAssistantMessage,
  insertMessage,
} from "./messages.js"
import type { AgentApi } from "./api.js"

const require = createRequire(import.meta.url)

const CLAUDE_AGENT_ENTRY = require.resolve(
  "@agentclientprotocol/claude-agent-acp/dist/index.js"
)
const CODEX_AGENT_ENTRY = require.resolve(
  "@agentclientprotocol/codex-acp/dist/index.js"
)

export type AgentProvider = "claude_code" | "codex"

// Appended to the selected agent's instructions so every issue run ends
// with its work committed and proposed for review, without relying on each
// issue's own instructions to say so.
const COMMIT_AND_PR_INSTRUCTIONS = `Before you finish working on this issue, commit your changes with a descriptive commit message and open a pull request against the repository's default branch using the \`gh\` CLI. Do this even if not explicitly asked. Skip it only if you made no changes to commit.`

/** One prompt turn: plain text, or text plus attachment content blocks. */
export type PromptTurn = string | ContentBlock[]

export interface RunSessionInput {
  api: AgentApi
  issueId: string
  agentProvider: AgentProvider
  /** Absolute path to the cloned repo the agent works in. */
  cwd: string
  /**
   * ACP session id from a previous run on this issue. When set, the session
   * resumes with its prior conversation context instead of starting fresh.
   */
  resumeSessionId?: string | null
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
  const child = spawn(process.execPath, [agent.entry], {
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
          prompt = prependInstructions(prompt)
          shouldPrependInstructions = false
        }
        await runTurn(session, input.api, input.issueId, prompt)
      }
    })
  } finally {
    child.kill()
  }
}

interface AgentProviderConfig {
  provider: AgentProvider
  entry: string
  env: NodeJS.ProcessEnv
  newSession: (input: RunSessionInput) => NewSessionRequest
}

function getAgentProviderConfig(provider: AgentProvider): AgentProviderConfig {
  if (provider === "codex") {
    return {
      provider,
      entry: CODEX_AGENT_ENTRY,
      env: {
        DEFAULT_AUTH_REQUEST:
          process.env.DEFAULT_AUTH_REQUEST ?? JSON.stringify({ methodId: "api-key" }),
        INITIAL_AGENT_MODE: process.env.INITIAL_AGENT_MODE ?? "agent-full-access",
        NO_BROWSER: process.env.NO_BROWSER ?? "1",
      },
      newSession: (input) => ({
        cwd: input.cwd,
        mcpServers: [],
      }),
    }
  }

  return {
    provider,
    entry: CLAUDE_AGENT_ENTRY,
    env: {},
    newSession: (input) => ({
      cwd: input.cwd,
      mcpServers: [],
      _meta: {
        claudeCode: {
          options: {
            systemPrompt: {
              type: "preset",
              preset: "claude_code",
              append: COMMIT_AND_PR_INSTRUCTIONS,
            },
            ...(input.resumeSessionId ? { resume: input.resumeSessionId } : {}),
          },
        },
      },
    }),
  }
}

function prependInstructions(prompt: PromptTurn): PromptTurn {
  const instructions = `System instructions for this issue run:\n${COMMIT_AND_PR_INSTRUCTIONS}\n\nUser request:\n`

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
async function runTurn(
  session: ActiveSession,
  api: AgentApi,
  issueId: string,
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
      current = new StreamingAssistantMessage(api, issueId, kind)
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
      await insertMessage(api, issueId, {
        role: "assistant",
        kind: "tool",
        content: update.title,
      })
    }
  }

  await finalizeCurrent()
  // Surface any prompt-turn error (the loop above already saw the stop).
  await promptDone
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
