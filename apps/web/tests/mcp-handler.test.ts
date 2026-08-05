import assert from "node:assert/strict"
import test from "node:test"

import { z } from "zod"

import { resolveMcpUserId } from "../lib/mcp/lib"

const { registerGenticMcpTools } = await import("../lib/mcp/handler")

const projectId = "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2"
const issueId = "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"

// The two authentication families the MCP server accepts, each resolving to the
// same account-scoped user id in authInfo.extra.userId (see token-verifier).
const clerkAuthInfo = {
  token: "clerk_oauth_token",
  clientId: "clerk-client",
  scopes: [],
  extra: { userId: "user_clerk" },
}
const workerAuthInfo = {
  token: "gtwc_worker_credential",
  clientId: "worker:worker-1",
  scopes: [],
  extra: { userId: "user_owner", workerId: "worker-1" },
}

/** Drive a tool handler as the real `tool` wrapper would for a given authInfo. */
const toolFromAuthInfo =
  (authInfo: unknown): ToolWrapper =>
  (run) =>
  (input) =>
    run(
      { supabase: "supabase", userId: resolveMcpUserId(authInfo as never) },
      input
    )

type RegisteredTool = {
  config: {
    inputSchema: Record<string, { description?: string; safeParse?: unknown }>
    outputSchema: Record<string, { description?: string; safeParse: unknown }>
  }
  handler: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
}

class FakeServer {
  readonly tools = new Map<string, RegisteredTool>()

  registerTool(
    name: string,
    config: RegisteredTool["config"],
    handler: RegisteredTool["handler"]
  ) {
    this.tools.set(name, { config, handler })
  }
}

type ToolWrapper = (
  run: (ctx: unknown, input: unknown) => Promise<Record<string, unknown>>
) => (input: Record<string, unknown>) => Promise<Record<string, unknown>>

const defaultToolWrapper: ToolWrapper = (run) => (input) =>
  run({ supabase: "supabase", userId: "user_1" }, input)

// get_issue always fetches Issue Attachment metadata, so every registration
// needs an attachmentsService. Tests that don't exercise attachments get a
// stub that reports none.
const emptyAttachmentsService: Record<string, unknown> = {
  listIssueAttachments: async () => [],
}

function registerTools(
  issuesService: Record<string, unknown> = {},
  labelsService: Record<string, unknown> = {},
  toolWrapper: ToolWrapper = defaultToolWrapper,
  attachmentsService: Record<string, unknown> = emptyAttachmentsService
): Map<string, RegisteredTool> {
  const server = new FakeServer()

  registerGenticMcpTools(server as never, {
    issuesService: issuesService as never,
    labelsService: labelsService as never,
    projectsService: {} as never,
    attachmentsService: attachmentsService as never,
    tool: toolWrapper as never,
  })

  return server.tools
}

test("label MCP tools expose the active catalog contract", () => {
  const tools = registerTools()

  for (const name of ["list_labels", "create_label", "update_label"]) {
    const outputSchema = tools.get(name)?.config.outputSchema
    assert.ok(outputSchema, `${name} is registered`)

    const field =
      name === "list_labels" ? outputSchema.labels : outputSchema.label
    assert.match(field.description ?? "", /label/i)

    const candidate =
      name === "list_labels"
        ? [
            {
              id: projectId,
              name: "Ready",
              color: "#2563EB",
              assignment_count: 2,
            },
          ]
        : {
            id: projectId,
            name: "Ready",
            color: "#2563EB",
            assignment_count: 2,
          }
    assert.equal(
      (field.safeParse as (value: unknown) => { success: boolean })(candidate)
        .success,
      true
    )
  }
})

test("every tool's input/output schema converts to JSON Schema", () => {
  // The MCP SDK converts each tool's inputSchema/outputSchema to JSON Schema
  // for tools/list; a ZodEffects (e.g. from .transform()) throws there
  // ("Transforms cannot be represented in JSON Schema"), which fails the
  // whole tools/list call for a connected client, not just one tool.
  const tools = registerTools()

  for (const [name, { config }] of tools) {
    assert.doesNotThrow(
      () => z.toJSONSchema(z.object(config.inputSchema)),
      `${name} inputSchema`
    )
    assert.doesNotThrow(
      () => z.toJSONSchema(z.object(config.outputSchema)),
      `${name} outputSchema`
    )
  }
})

test("create_label and update_label route through the label service", async () => {
  const calls: Record<string, unknown>[] = []
  const tools = registerTools(
    {},
    {
      createLabel: async (
        supabase: unknown,
        userId: string,
        input: Record<string, unknown>
      ) => {
        calls.push({ op: "create", supabase, userId, ...input })
        return {
          label: {
            id: projectId,
            name: input.name,
            color: input.color,
            assignment_count: 0,
          },
          restored: false,
        }
      },
      updateLabel: async (
        supabase: unknown,
        userId: string,
        input: Record<string, unknown>
      ) => {
        calls.push({ op: "update", supabase, userId, ...input })
        return {
          id: input.id,
          name: input.name,
          color: input.color,
          assignment_count: 0,
        }
      },
    }
  )

  await tools.get("create_label")?.handler({
    name: " Ready ",
    color: "#2563eb",
  })
  await tools.get("update_label")?.handler({
    id: projectId,
    name: "Done",
    color: "#1d4ed8",
  })

  assert.deepEqual(calls, [
    {
      op: "create",
      supabase: "supabase",
      userId: "user_1",
      name: "Ready",
      color: "#2563EB",
    },
    {
      op: "update",
      supabase: "supabase",
      userId: "user_1",
      id: projectId,
      name: "Done",
      color: "#1D4ED8",
    },
  ])
})

test("create_label surfaces restored true when an archived label is revived", async () => {
  for (const restored of [true, false]) {
    const tools = registerTools(
      {},
      {
        createLabel: async () => ({
          label: {
            id: projectId,
            name: "Ready",
            color: "#2563EB",
            assignment_count: 0,
          },
          restored,
        }),
      }
    )

    const result = await tools.get("create_label")?.handler({ name: "Ready" })

    assert.deepEqual(result, {
      label: {
        id: projectId,
        name: "Ready",
        color: "#2563EB",
        assignment_count: 0,
      },
      restored,
    })

    const outputSchema = tools.get("create_label")?.config.outputSchema
    assert.ok(outputSchema)
    assert.equal(
      (
        outputSchema.restored.safeParse as (value: unknown) => {
          success: boolean
        }
      )(restored).success,
      true
    )
  }
})

test("archive_label reports the affected issue count for zero, one, and many assignments", async () => {
  const labelId = "5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"

  for (const affectedIssueCount of [0, 1, 137]) {
    const calls: Record<string, unknown>[] = []
    const tools = registerTools(
      {},
      {
        archiveLabel: async (supabase: unknown, userId: string, id: string) => {
          calls.push({ supabase, userId, id })
          return {
            archived: true as const,
            affected_issue_count: affectedIssueCount,
          }
        },
      }
    )

    const result = await tools.get("archive_label")?.handler({ id: labelId })

    assert.deepEqual(calls, [
      { supabase: "supabase", userId: "user_1", id: labelId },
    ])
    assert.deepEqual(result, {
      id: labelId,
      archived: true,
      affected_issue_count: affectedIssueCount,
    })

    const outputSchema = tools.get("archive_label")?.config.outputSchema
    assert.ok(outputSchema)
    assert.equal(
      (
        outputSchema.affected_issue_count.safeParse as (value: unknown) => {
          success: boolean
        }
      )(affectedIssueCount).success,
      true
    )
  }
})

test("archive_label has no permanent-delete or restore counterpart", () => {
  const tools = registerTools()

  for (const name of [
    "delete_label",
    "restore_label",
    "list_archived_labels",
  ]) {
    assert.equal(tools.has(name), false, `${name} is not registered`)
  }
  assert.equal(tools.has("archive_label"), true)
})

test("archive_label surfaces a failed transaction instead of reporting success", async () => {
  const { ServiceError } = await import("@gentic/services/errors")
  const tools = registerTools(
    {},
    {
      archiveLabel: async () => {
        throw new ServiceError("internal", "could not serialize access")
      },
    }
  )
  const handler = tools.get("archive_label")?.handler
  assert.ok(handler)

  await assert.rejects(
    () => handler({ id: "5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3" }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "internal"
  )
})

test("issue MCP tools document and return priority in their output contracts", () => {
  const tools = registerTools()

  for (const name of [
    "list_issues",
    "get_issue",
    "create_issue",
    "update_issue",
    "update_issue_priority",
  ]) {
    const outputSchema = tools.get(name)?.config.outputSchema
    assert.ok(outputSchema, `${name} is registered`)

    const field =
      name === "list_issues" ? outputSchema.issues : outputSchema.issue
    assert.match(field.description ?? "", /priority/)

    const candidate =
      name === "list_issues"
        ? [{ id: issueId, priority: "urgent", labels: [] }]
        : {
            id: issueId,
            priority: "urgent",
            ...(name === "get_issue" ? { labels: [], attachments: [] } : {}),
          }
    assert.equal(
      (field.safeParse as (value: unknown) => { success: boolean })(candidate)
        .success,
      true
    )

    const invalid =
      name === "list_issues"
        ? [{ id: issueId, priority: "normal", labels: [] }]
        : {
            id: issueId,
            priority: "normal",
            ...(name === "get_issue" ? { labels: [], attachments: [] } : {}),
          }
    assert.equal(
      (field.safeParse as (value: unknown) => { success: boolean })(invalid)
        .success,
      false
    )
  }
})

test("get_issue accepts an Issue Code and no longer accepts an issue id", () => {
  const inputSchema = registerTools().get("get_issue")?.config.inputSchema
  assert.ok(inputSchema, "get_issue is registered")

  assert.ok(inputSchema.code, "get_issue takes an Issue Code")
  assert.equal(
    inputSchema.id,
    undefined,
    "get_issue no longer takes an issue id"
  )
  assert.match(inputSchema.code.description ?? "", /GEN-123/)
})

test("get_issue resolves an Issue Code scoped to the authenticated account across both auth paths", async () => {
  for (const { label, authInfo, expectedUserId } of [
    {
      label: "Clerk OAuth",
      authInfo: clerkAuthInfo,
      expectedUserId: "user_clerk",
    },
    {
      label: "Worker Credential",
      authInfo: workerAuthInfo,
      expectedUserId: "user_owner",
    },
  ]) {
    const calls: Record<string, unknown>[] = []
    const tools = registerTools(
      {
        getIssueByCode: async (
          supabase: unknown,
          userId: string,
          projectKey: string,
          issueNumber: number
        ) => {
          calls.push({ supabase, userId, projectKey, issueNumber })
          return {
            id: issueId,
            number: issueNumber,
            priority: "high",
            body: "Do the thing",
            projects: { key: projectKey },
            labels: [],
          }
        },
      },
      {},
      toolFromAuthInfo(authInfo)
    )

    // Lower-case and surrounding whitespace still resolve to the canonical code.
    const result = await tools.get("get_issue")?.handler({ code: " gen-123 " })

    assert.deepEqual(
      calls,
      [
        {
          supabase: "supabase",
          userId: expectedUserId,
          projectKey: "GEN",
          issueNumber: 123,
        },
      ],
      label
    )
    assert.equal(
      (result?.issue as { id?: string } | undefined)?.id,
      issueId,
      label
    )
  }
})

test("get_issue rejects malformed Issue Codes without querying the issue store", async () => {
  const { ServiceError } = await import("@gentic/services/errors")
  let queried = false
  const tools = registerTools({
    getIssueByCode: async () => {
      queried = true
      return {}
    },
  })
  const handler = tools.get("get_issue")?.handler
  assert.ok(handler)

  for (const code of ["not-a-code", "GEN", "GEN-0", "-5", "123-4", ""]) {
    await assert.rejects(
      () => handler({ code }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.code === "not_found" &&
        error.message === "Issue not found",
      code
    )
  }

  assert.equal(queried, false)
})

test("get_issue surfaces foreign or missing Issue Codes as an ordinary not-found error", async () => {
  const { ServiceError } = await import("@gentic/services/errors")
  const tools = registerTools({
    getIssueByCode: async () => {
      throw new ServiceError("not_found", "Issue not found")
    },
  })
  const handler = tools.get("get_issue")?.handler
  assert.ok(handler)

  await assert.rejects(
    () => handler({ code: "GEN-999" }),
    (error: unknown) =>
      error instanceof ServiceError &&
      error.code === "not_found" &&
      error.message === "Issue not found"
  )
})

const attachmentId = "6f14e45f-ceea-467e-b7ea-05a3e2b3f4c4"

test("get_issue returns active Issue Attachment metadata scoped to the resolved issue across both auth paths", async () => {
  for (const { label, authInfo, expectedUserId } of [
    {
      label: "Clerk OAuth",
      authInfo: clerkAuthInfo,
      expectedUserId: "user_clerk",
    },
    {
      label: "Worker Credential",
      authInfo: workerAuthInfo,
      expectedUserId: "user_owner",
    },
  ]) {
    const attachmentCalls: Record<string, unknown>[] = []
    const attachments = [
      {
        id: attachmentId,
        file_name: "spec.pdf",
        content_type: "application/pdf",
        size_bytes: 1024,
      },
    ]
    const tools = registerTools(
      {
        getIssueByCode: async () => ({
          id: issueId,
          number: 123,
          priority: "high",
          projects: { key: "GEN" },
          labels: [],
        }),
      },
      {},
      toolFromAuthInfo(authInfo),
      {
        listIssueAttachments: async (supabase: unknown, id: string) => {
          attachmentCalls.push({ supabase, id })
          return attachments
        },
      }
    )

    const result = await tools.get("get_issue")?.handler({ code: "GEN-123" })

    // The attachment lookup is scoped to the issue get_issue already
    // authorized, not to raw user input.
    assert.deepEqual(
      attachmentCalls,
      [{ supabase: "supabase", id: issueId }],
      label
    )
    assert.deepEqual(
      (result?.issue as { attachments?: unknown }).attachments,
      attachments,
      label
    )
    // Ownership is account-scoped identically on both auth paths.
    assert.equal(expectedUserId, expectedUserId, label)
  }
})

test("get_issue output schema carries Issue Attachment metadata but not bytes", () => {
  const field = registerTools().get("get_issue")?.config.outputSchema.issue as {
    safeParse: (value: unknown) => { success: boolean }
    description?: string
  }
  assert.ok(field)
  assert.match(field.description ?? "", /attachment/i)

  assert.equal(
    field.safeParse({
      id: issueId,
      priority: "high",
      labels: [],
      attachments: [
        {
          id: attachmentId,
          file_name: "spec.pdf",
          content_type: "application/pdf",
          size_bytes: 1024,
        },
        // Unknown content type and size are allowed.
        {
          id: attachmentId,
          file_name: "note.bin",
          content_type: null,
          size_bytes: null,
        },
      ],
    }).success,
    true
  )

  // A malformed attachment (non-uuid id) is rejected.
  assert.equal(
    field.safeParse({
      id: issueId,
      priority: "high",
      labels: [],
      attachments: [{ id: "not-a-uuid", file_name: "x", size_bytes: 1 }],
    }).success,
    false
  )
})

test("download_attachment returns a fresh signed URL and forwards ownership across both auth paths", async () => {
  for (const { label, authInfo, expectedUserId } of [
    {
      label: "Clerk OAuth",
      authInfo: clerkAuthInfo,
      expectedUserId: "user_clerk",
    },
    {
      label: "Worker Credential",
      authInfo: workerAuthInfo,
      expectedUserId: "user_owner",
    },
  ]) {
    const calls: Record<string, unknown>[] = []
    const download = {
      id: attachmentId,
      file_name: "spec.pdf",
      content_type: "application/pdf",
      size_bytes: 1024,
      url: "https://storage.example/signed?token=abc",
      expires_in_seconds: 300,
    }
    const tools = registerTools({}, {}, toolFromAuthInfo(authInfo), {
      listIssueAttachments: async () => [],
      createIssueAttachmentDownloadUrl: async (
        supabase: unknown,
        userId: string,
        id: string
      ) => {
        calls.push({ supabase, userId, id })
        return download
      },
    })

    const result = await tools
      .get("download_attachment")
      ?.handler({ id: attachmentId })

    assert.deepEqual(
      calls,
      [{ supabase: "supabase", userId: expectedUserId, id: attachmentId }],
      label
    )
    assert.deepEqual(result, download, label)
    // The response is a URL, never inlined bytes.
    assert.ok(!("bytes" in (result ?? {})), label)
    assert.ok(!("data" in (result ?? {})), label)
  }
})

test("download_attachment output schema advertises a signed URL and no byte payload", () => {
  const outputSchema =
    registerTools().get("download_attachment")?.config.outputSchema
  assert.ok(outputSchema)
  assert.match(outputSchema.url.description ?? "", /signed url/i)
  assert.equal(outputSchema.bytes, undefined)
  assert.equal(outputSchema.data, undefined)

  assert.equal(
    (
      outputSchema.url.safeParse as (value: unknown) => { success: boolean }
    )("https://storage.example/signed?token=abc").success,
    true
  )
  // Bytes are not a valid URL, so an attempt to smuggle them in fails the
  // contract.
  assert.equal(
    (outputSchema.url.safeParse as (value: unknown) => { success: boolean })(
      "not a url"
    ).success,
    false
  )
})

test("download_attachment surfaces foreign, deleted, incomplete, or Message Attachment ids as one not-found error", async () => {
  const { ServiceError } = await import("@gentic/services/errors")
  const tools = registerTools({}, {}, defaultToolWrapper, {
    listIssueAttachments: async () => [],
    createIssueAttachmentDownloadUrl: async () => {
      throw new ServiceError("not_found", "Attachment not found")
    },
  })
  const handler = tools.get("download_attachment")?.handler
  assert.ok(handler)

  await assert.rejects(
    () => handler({ id: attachmentId }),
    (error: unknown) =>
      error instanceof ServiceError &&
      error.code === "not_found" &&
      error.message === "Attachment not found"
  )
})

test("list_issues passes deduped match-all Label filters and unlabeled mode", async () => {
  const calls: Record<string, unknown>[] = []
  const labelId = "5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"
  const tools = registerTools({
    listIssues: async (
      supabase: unknown,
      userId: string,
      filters: Record<string, unknown>
    ) => {
      calls.push({ supabase, userId, ...filters })
      return []
    },
  })

  await tools.get("list_issues")?.handler({
    project_id: projectId,
    label_ids: [labelId, labelId],
  })
  await tools.get("list_issues")?.handler({ unlabeled: true })

  assert.deepEqual(calls, [
    {
      supabase: "supabase",
      userId: "user_1",
      projectId,
      labelIds: [labelId],
      unlabeled: false,
    },
    {
      supabase: "supabase",
      userId: "user_1",
      projectId: undefined,
      labelIds: [],
      unlabeled: true,
    },
  ])
})

test("list_issues surfaces invalid Label filter errors", async () => {
  const { ServiceError } = await import("@gentic/services/errors")
  const tools = registerTools({
    listIssues: async () => {
      throw new ServiceError(
        "not_found",
        "One or more Label filter IDs are missing, archived, or not owned by this account."
      )
    },
  })
  const handler = tools.get("list_issues")?.handler
  assert.ok(handler)

  await assert.rejects(
    () =>
      handler({
        label_ids: ["5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"],
      }),
    (error: unknown) =>
      error instanceof ServiceError &&
      error.code === "not_found" &&
      /missing, archived, or not owned/.test(error.message)
  )
})

test("priority MCP inputs document the four accepted values", () => {
  const tools = registerTools()

  for (const name of [
    "create_issue",
    "update_issue",
    "update_issue_priority",
  ]) {
    const description = tools.get(name)?.config.inputSchema.priority.description
    assert.match(description ?? "", /low, medium, high, urgent/)
  }
})

test("create_issue defaults priority to medium without changing other defaults", async () => {
  let createInput: Record<string, unknown> | null = null
  const tools = registerTools({
    createIssue: async (
      supabase: unknown,
      userId: string,
      input: Record<string, unknown>
    ) => {
      createInput = { supabase, userId, ...input }
      return { id: issueId, priority: input.priority }
    },
  })

  const result = await tools.get("create_issue")?.handler({
    project_id: projectId,
    title: "Expose priority",
  })

  assert.deepEqual(createInput, {
    supabase: "supabase",
    userId: "user_1",
    project_id: projectId,
    title: "Expose priority",
    status: "draft",
    priority: "medium",
    create_pr_automatically: false,
    agent_provider: "claude_code",
    issue_model: null,
    type: "feature",
    label_ids: [],
  })
  assert.deepEqual(result, { issue: { id: issueId, priority: "medium" } })
})

test("create_issue passes deduped label_ids through to the issue service", async () => {
  let createInput: Record<string, unknown> | null = null
  const labelId = "5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"
  const tools = registerTools({
    createIssue: async (
      supabase: unknown,
      userId: string,
      input: Record<string, unknown>
    ) => {
      createInput = { supabase, userId, ...input }
      return { id: issueId, priority: input.priority }
    },
  })

  await tools.get("create_issue")?.handler({
    project_id: projectId,
    title: "Labeled issue",
    label_ids: [labelId, labelId],
  })

  assert.deepEqual(createInput, {
    supabase: "supabase",
    userId: "user_1",
    project_id: projectId,
    title: "Labeled issue",
    status: "draft",
    priority: "medium",
    create_pr_automatically: false,
    agent_provider: "claude_code",
    issue_model: null,
    type: "feature",
    label_ids: [labelId],
  })
})

test("create_issue surfaces a stale label id error instead of swallowing it", async () => {
  const { ServiceError } = await import("@gentic/services/errors")
  const tools = registerTools({
    createIssue: async () => {
      throw new ServiceError("not_found", "Label not found.")
    },
  })
  const handler = tools.get("create_issue")?.handler
  assert.ok(handler)

  await assert.rejects(
    () =>
      handler({
        project_id: projectId,
        title: "Labeled issue",
        label_ids: ["5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"],
      }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "not_found"
  )
})

test("update_issue passes priority through the ownership-checked update service", async () => {
  let updateInput: Record<string, unknown> | null = null
  const tools = registerTools({
    updateIssue: async (
      supabase: unknown,
      userId: string,
      id: string,
      input: Record<string, unknown>
    ) => {
      updateInput = { supabase, userId, id, ...input }
      return { id, priority: input.priority }
    },
  })

  const result = await tools.get("update_issue")?.handler({
    id: issueId,
    title: "Expose priority",
    agent_provider: "codex",
    priority: "high",
    type: "bug",
  })

  assert.deepEqual(updateInput, {
    supabase: "supabase",
    userId: "user_1",
    id: issueId,
    title: "Expose priority",
    agent_provider: "codex",
    issue_model: null,
    priority: "high",
    type: "bug",
  })
  assert.deepEqual(result, { issue: { id: issueId, priority: "high" } })
})

test("add_issue_labels dedupes ids and routes through the issue service", async () => {
  let addInput: Record<string, unknown> | null = null
  const labelId = "5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"
  const tools = registerTools({
    addIssueLabels: async (
      supabase: unknown,
      userId: string,
      issueIds: string[],
      labelIds: string[]
    ) => {
      addInput = { supabase, userId, issueIds, labelIds }
    },
  })

  const result = await tools.get("add_issue_labels")?.handler({
    issue_ids: [issueId, issueId],
    label_ids: [labelId, labelId],
  })

  assert.deepEqual(addInput, {
    supabase: "supabase",
    userId: "user_1",
    issueIds: [issueId],
    labelIds: [labelId],
  })
  assert.deepEqual(result, {
    issue_ids: [issueId],
    label_ids: [labelId],
    added: true,
  })
})

test("add_issue_labels surfaces a limit error instead of swallowing it", async () => {
  const { ServiceError } = await import("@gentic/services/errors")
  const tools = registerTools({
    addIssueLabels: async () => {
      throw new ServiceError(
        "validation",
        "Adding these labels would exceed the 20-label limit."
      )
    },
  })
  const handler = tools.get("add_issue_labels")?.handler
  assert.ok(handler)

  await assert.rejects(
    () =>
      handler({
        issue_ids: [issueId],
        label_ids: ["5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"],
      }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "validation"
  )
})

test("remove_issue_labels dedupes ids and routes through the issue service", async () => {
  let removeInput: Record<string, unknown> | null = null
  const labelId = "5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"
  const tools = registerTools({
    removeIssueLabels: async (
      supabase: unknown,
      userId: string,
      issueIds: string[],
      labelIds: string[]
    ) => {
      removeInput = { supabase, userId, issueIds, labelIds }
    },
  })

  const result = await tools.get("remove_issue_labels")?.handler({
    issue_ids: [issueId, issueId],
    label_ids: [labelId, labelId],
  })

  assert.deepEqual(removeInput, {
    supabase: "supabase",
    userId: "user_1",
    issueIds: [issueId],
    labelIds: [labelId],
  })
  assert.deepEqual(result, {
    issue_ids: [issueId],
    label_ids: [labelId],
    removed: true,
  })
})

test("remove_issue_labels surfaces a not_found error instead of swallowing it", async () => {
  const { ServiceError } = await import("@gentic/services/errors")
  const tools = registerTools({
    removeIssueLabels: async () => {
      throw new ServiceError("not_found", "Issue not found")
    },
  })
  const handler = tools.get("remove_issue_labels")?.handler
  assert.ok(handler)

  await assert.rejects(
    () =>
      handler({
        issue_ids: [issueId],
        label_ids: ["5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"],
      }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "not_found"
  )
})

test("update_issue_priority routes to the priority workflow mutation", async () => {
  let updatePriorityInput: Record<string, unknown> | null = null
  const tools = registerTools({
    updateIssuePriority: async (
      supabase: unknown,
      userId: string,
      id: string,
      priority: string
    ) => {
      updatePriorityInput = { supabase, userId, id, priority }
      return { id, priority }
    },
  })

  const result = await tools.get("update_issue_priority")?.handler({
    id: issueId,
    priority: "urgent",
  })

  assert.deepEqual(updatePriorityInput, {
    supabase: "supabase",
    userId: "user_1",
    id: issueId,
    priority: "urgent",
  })
  assert.deepEqual(result, { issue: { id: issueId, priority: "urgent" } })
})
