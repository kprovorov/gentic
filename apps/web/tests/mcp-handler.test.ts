import assert from "node:assert/strict"
import test from "node:test"

import { z } from "zod"

const { registerGenticMcpTools } = await import("../lib/mcp/handler")

const projectId = "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2"
const issueId = "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"

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

function registerTools(
  issuesService: Record<string, unknown> = {},
  labelsService: Record<string, unknown> = {}
): Map<string, RegisteredTool> {
  const server = new FakeServer()

  registerGenticMcpTools(server as never, {
    issuesService: issuesService as never,
    labelsService: labelsService as never,
    projectsService: {} as never,
    tool: ((
        run: (ctx: unknown, input: unknown) => Promise<Record<string, unknown>>
      ) =>
      (input: Record<string, unknown>) =>
        run({ supabase: "supabase", userId: "user_1" }, input)) as never,
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
          id: projectId,
          name: input.name,
          color: input.color,
          assignment_count: 0,
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
        ? [{ id: issueId, priority: "urgent" }]
        : { id: issueId, priority: "urgent" }
    assert.equal(
      (field.safeParse as (value: unknown) => { success: boolean })(candidate)
        .success,
      true
    )

    const invalid =
      name === "list_issues"
        ? [{ id: issueId, priority: "normal" }]
        : { id: issueId, priority: "normal" }
    assert.equal(
      (field.safeParse as (value: unknown) => { success: boolean })(invalid)
        .success,
      false
    )
  }
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
    (error: unknown) => error instanceof ServiceError && error.code === "not_found"
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
      throw new ServiceError("validation", "Adding these labels would exceed the 20-label limit.")
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
    (error: unknown) => error instanceof ServiceError && error.code === "validation"
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
    (error: unknown) => error instanceof ServiceError && error.code === "not_found"
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
