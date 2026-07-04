import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { Readable, Writable } from "node:stream"

import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ActiveSession,
  type ContentBlock,
  type PermissionOption,
  type RequestPermissionOutcome,
} from "@agentclientprotocol/sdk"

import {
  StreamingAssistantMessage,
  insertMessage,
} from "./messages"
import type { AgentApi } from "./api"

const require = createRequire(import.meta.url)

// The claude-agent-acp binary is an ACP *agent* that we spawn and drive over
// stdio as the ACP *client*. Resolve its entry so it can run from any cwd.
const AGENT_ENTRY = require.resolve(
  "@agentclientprotocol/claude-agent-acp/dist/index.js"
)

// Appended to Claude Code's default system prompt so every issue run ends
// with its work committed and proposed for review, without relying on each
// issue's own instructions to say so.
const COMMIT_AND_PR_INSTRUCTIONS = `Before you finish working on this issue, commit your changes with a descriptive commit message and open a pull request against the repository's default branch using the \`gh\` CLI. Do this even if not explicitly asked. Skip it only if you made no changes to commit.`

export interface RunSessionInput {
  api: AgentApi
  issueId: string
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
  nextPrompt: () => Promise<string | null>
}

/**
 * Spawns Claude Code over ACP against the cloned repo and drives one prompt
 * turn per message from `nextPrompt`, streaming assistant output into the
 * issue transcript. Resolves once `nextPrompt` returns `null`.
 */
export async function runAgentSession(input: RunSessionInput): Promise<void> {
  const child = spawn(process.execPath, [AGENT_ENTRY], {
    cwd: input.cwd,
    stdio: ["pipe", "pipe", "inherit"],
    env: process.env,
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

      const sessionBuilder = ctx.buildSession({
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
              ...(input.resumeSessionId
                ? { resume: input.resumeSessionId }
                : {}),
            },
          },
        },
      })
      const session = await sessionBuilder.start()
      await input.onSessionId(session.sessionId)

      for (;;) {
        const prompt = await input.nextPrompt()
        if (prompt === null) {
          break
        }
        await runTurn(session, input.api, input.issueId, prompt)
      }
    })
  } finally {
    child.kill()
  }
}

/** Sends one prompt and streams updates into the transcript until it stops. */
async function runTurn(
  session: ActiveSession,
  api: AgentApi,
  issueId: string,
  prompt: string
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
