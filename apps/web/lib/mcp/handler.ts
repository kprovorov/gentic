import {
  addIssueRelationSchema,
  agentProviderSchema,
  createIssueSchema,
  deleteIssueRelationSchema,
  issueModelSchema,
  issuePrioritySchema,
  issueRelationDirectionSchema,
  issueStatusSchema,
  issueTypeSchema,
  updateIssuePrioritySchema,
  updateIssueSchema,
  updateIssueStatusSchema,
} from "@gentic/validators/issues"
import { projectSchema } from "@gentic/validators/projects"
import { createMcpHandler } from "mcp-handler"
import { z } from "zod"

import * as issuesService from "@gentic/services/issues"
import * as projectsService from "@gentic/services/projects"

import { resolveMcpUserId, tool } from "./lib"

const jsonObjectSchema = z.record(z.string(), z.unknown())
const priorityValuesDescription = "Accepted values: low, medium, high, urgent."

const issueObjectOutputSchema = z
  .object({
    priority: issuePrioritySchema.describe(
      `Issue priority. ${priorityValuesDescription}`
    ),
  })
  .passthrough()

const projectOutputSchema = {
  project: jsonObjectSchema.describe(
    "A Gentic project owned by the authenticated account."
  ),
}

const projectsOutputSchema = {
  projects: z
    .array(jsonObjectSchema)
    .describe("Projects owned by the authenticated account."),
}

const issueOutputSchema = {
  issue: issueObjectOutputSchema.describe(
    "A Gentic issue owned by the authenticated account, including priority."
  ),
}

const issuesOutputSchema = {
  issues: z
    .array(issueObjectOutputSchema)
    .describe("Issues owned by the authenticated account, including priority."),
}

const deletedOutputSchema = {
  id: z.string().uuid().describe("The deleted Gentic resource id."),
  deleted: z.literal(true).describe("True when the delete completed."),
}

const projectIdInputSchema = {
  id: z
    .string()
    .uuid()
    .describe("The project id, from list_projects or get_project."),
}

const issueIdInputSchema = {
  id: z
    .string()
    .uuid()
    .describe("The issue id, from list_issues, create_issue, or get_issue."),
}

const addedRelationOutputSchema = {
  issue_id: z.string().uuid().describe("The issue id passed as issue_id."),
  related_issue_id: z
    .string()
    .uuid()
    .describe("The issue id passed as related_issue_id."),
  added: z.literal(true).describe("True when the relation was created."),
}

const relationsOutputSchema = {
  relations: z
    .array(jsonObjectSchema)
    .describe("Blocking relations involving the given issue."),
}

const relationCandidatesOutputSchema = {
  issues: z
    .array(jsonObjectSchema)
    .describe(
      "Other issues owned by the authenticated account that could be related to the given issue."
    ),
}

type McpServer = Parameters<Parameters<typeof createMcpHandler>[0]>[0]

interface McpToolDependencies {
  issuesService: typeof issuesService
  projectsService: typeof projectsService
  tool: typeof tool
}

const defaultMcpToolDependencies: McpToolDependencies = {
  issuesService,
  projectsService,
  tool,
}

export function registerGenticMcpTools(
  server: McpServer,
  deps: McpToolDependencies = defaultMcpToolDependencies
) {
  server.registerTool(
    "whoami",
    {
      description:
        "Returns the Gentic account id for the account that authorized this MCP connection.",
      inputSchema: {},
      outputSchema: {
        userId: z
          .string()
          .describe("The Gentic account id for this MCP connection."),
      },
    },
    async (_input, { authInfo }) => {
      const userId = resolveMcpUserId(authInfo)

      return {
        content: [{ type: "text", text: JSON.stringify({ userId }) }],
        structuredContent: { userId },
      }
    }
  )

  server.registerTool(
    "list_projects",
    {
      title: "List Projects",
      description:
        "List Gentic projects owned by the authenticated account. Use a returned project id as project_id when creating or filtering issues.",
      inputSchema: {},
      outputSchema: projectsOutputSchema,
    },
    deps.tool(async ({ supabase, userId }) => {
      const projects = await deps.projectsService.listProjects(supabase, userId)
      return { projects }
    })
  )

  server.registerTool(
    "get_project",
    {
      title: "Get Project",
      description:
        "Get one Gentic project owned by the authenticated account. Use the project id from list_projects.",
      inputSchema: projectIdInputSchema,
      outputSchema: projectOutputSchema,
    },
    deps.tool(async ({ supabase, userId }, { id }: { id: string }) => {
      const project = await deps.projectsService.getProject(
        supabase,
        userId,
        id
      )
      return { project }
    })
  )

  server.registerTool(
    "create_project",
    {
      title: "Create Project",
      description:
        "Create a Gentic project for the authenticated account. The repo must be a GitHub repository in owner/name format.",
      inputSchema: {
        name: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .describe("Human-readable project name shown in Gentic."),
        repo: z
          .string()
          .trim()
          .describe(
            "GitHub repository in owner/name format, for example vercel/next.js."
          ),
        setup_script: z
          .string()
          .trim()
          .max(10000)
          .nullable()
          .optional()
          .describe(
            "Optional shell setup script run by the background agent after cloning this project."
          ),
      },
      outputSchema: projectOutputSchema,
    },
    deps.tool(
      async (
        { supabase, userId },
        input: { name: string; repo: string; setup_script?: string | null }
      ) => {
        const project = await deps.projectsService.createProject(
          supabase,
          userId,
          projectSchema.parse({
            ...input,
            setup_script: input.setup_script ?? null,
          })
        )
        return { project }
      }
    )
  )

  server.registerTool(
    "update_project",
    {
      title: "Update Project",
      description:
        "Update a Gentic project owned by the authenticated account. Use the project id from list_projects or get_project.",
      inputSchema: {
        id: projectIdInputSchema.id,
        name: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .describe("Updated human-readable project name shown in Gentic."),
        repo: z
          .string()
          .trim()
          .describe("Updated GitHub repository in owner/name format."),
        setup_script: z
          .string()
          .trim()
          .max(10000)
          .nullable()
          .describe(
            "Updated optional shell setup script run by the background agent after cloning this project."
          ),
      },
      outputSchema: projectOutputSchema,
    },
    deps.tool(
      async (
        { supabase, userId },
        input: {
          id: string
          name: string
          repo: string
          setup_script: string | null
        }
      ) => {
        const { id, ...values } = input
        const project = await deps.projectsService.updateProject(
          supabase,
          userId,
          id,
          projectSchema.parse(values)
        )
        return { project }
      }
    )
  )

  server.registerTool(
    "delete_project",
    {
      title: "Delete Project",
      description:
        "Delete a Gentic project owned by the authenticated account. Deleting a project also deletes its issues through the database cascade.",
      inputSchema: projectIdInputSchema,
      outputSchema: deletedOutputSchema,
    },
    deps.tool(async ({ supabase, userId }, { id }: { id: string }) => {
      await deps.projectsService.deleteProject(supabase, userId, id)
      return { id, deleted: true as const }
    })
  )

  server.registerTool(
    "list_issues",
    {
      title: "List Issues",
      description:
        "List Gentic issues owned by the authenticated account, including priority. Optionally filter by a project id from list_projects. Returned issue ids can be used with get_issue, update_issue, update_issue_priority, update_issue_status, or delete_issue.",
      inputSchema: {
        project_id: z
          .string()
          .uuid()
          .optional()
          .describe(
            "Optional project id from list_projects to list only that project's issues."
          ),
      },
      outputSchema: issuesOutputSchema,
    },
    deps.tool(
      async ({ supabase, userId }, { project_id }: { project_id?: string }) => {
        const issues = await deps.issuesService.listIssues(supabase, userId, {
          projectId: project_id,
        })
        return { issues }
      }
    )
  )

  server.registerTool(
    "get_issue",
    {
      title: "Get Issue",
      description:
        "Get full details for one Gentic issue owned by the authenticated account, including priority. Use the issue id from list_issues or create_issue.",
      inputSchema: issueIdInputSchema,
      outputSchema: issueOutputSchema,
    },
    deps.tool(async ({ supabase, userId }, { id }: { id: string }) => {
      const issue = await deps.issuesService.getIssue(supabase, userId, id)
      return { issue }
    })
  )

  server.registerTool(
    "create_issue",
    {
      title: "Create Issue",
      description:
        "Create a Gentic issue in a project owned by the authenticated account. Create draft issues first unless you intentionally want the issue to enter another workflow state.",
      inputSchema: {
        project_id: z
          .string()
          .uuid()
          .describe("The target project id, from list_projects."),
        title: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .describe("Short issue title shown in Gentic."),
        prompt: z
          .string()
          .trim()
          .optional()
          .describe(
            "Optional detailed instructions for the background coding agent."
          ),
        status: issueStatusSchema
          .optional()
          .default("draft")
          .describe("Initial issue status. Defaults to draft."),
        priority: issuePrioritySchema
          .optional()
          .default("medium")
          .describe(
            `Issue priority. Defaults to medium. ${priorityValuesDescription}`
          ),
        agent_provider: agentProviderSchema
          .optional()
          .default("claude_code")
          .describe(
            "Coding agent to run for this issue. Defaults to Claude Code."
          ),
        type: issueTypeSchema
          .optional()
          .default("feature")
          .describe(
            "Issue type: feature, bug, feedback, or idea. Defaults to feature."
          ),
      },
      outputSchema: issueOutputSchema,
    },
    deps.tool(
      async (
        { supabase, userId },
        input: {
          project_id: string
          title: string
          prompt?: string
          status?: z.infer<typeof issueStatusSchema>
          priority?: z.infer<typeof issuePrioritySchema>
          agent_provider?: z.infer<typeof agentProviderSchema>
          type?: z.infer<typeof issueTypeSchema>
        }
      ) => {
        const issue = await deps.issuesService.createIssue(
          supabase,
          userId,
          createIssueSchema.parse({
            ...input,
            status: input.status ?? "draft",
            priority: input.priority ?? "medium",
            agent_provider: input.agent_provider ?? "claude_code",
            type: input.type ?? "feature",
          })
        )
        return { issue }
      }
    )
  )

  server.registerTool(
    "update_issue",
    {
      title: "Update Issue",
      description:
        "Update the title, prompt, agent provider, type, and priority for an issue owned by the authenticated account. Use the issue id from list_issues, create_issue, or get_issue.",
      inputSchema: {
        id: issueIdInputSchema.id,
        title: z
          .string()
          .trim()
          .min(1)
          .max(160)
          .describe("Updated short issue title shown in Gentic."),
        prompt: z
          .string()
          .trim()
          .optional()
          .describe(
            "Updated optional detailed instructions for the background coding agent."
          ),
        agent_provider: agentProviderSchema.describe(
          "Coding agent to run for this issue."
        ),
        issue_model: issueModelSchema
          .optional()
          .default(null)
          .describe(
            "Coding-agent model to run for this issue. Defaults to null."
          ),
        priority: issuePrioritySchema.describe(
          `Issue priority. ${priorityValuesDescription}`
        ),
        type: issueTypeSchema.describe(
          "Issue type: feature, bug, feedback, or idea."
        ),
      },
      outputSchema: issueOutputSchema,
    },
    deps.tool(
      async (
        { supabase, userId },
        input: {
          id: string
          title: string
          prompt?: string
          agent_provider: z.infer<typeof agentProviderSchema>
          issue_model?: z.infer<typeof issueModelSchema>
          priority: z.infer<typeof issuePrioritySchema>
          type: z.infer<typeof issueTypeSchema>
        }
      ) => {
        const { id, ...values } = input
        const issue = await deps.issuesService.updateIssue(
          supabase,
          userId,
          id,
          updateIssueSchema.parse({
            id,
            ...values,
            issue_model: values.issue_model ?? null,
          })
        )
        return { issue }
      }
    )
  )

  server.registerTool(
    "delete_issue",
    {
      title: "Delete Issue",
      description:
        "Delete an issue owned by the authenticated account. Use the issue id from list_issues, create_issue, or get_issue.",
      inputSchema: issueIdInputSchema,
      outputSchema: deletedOutputSchema,
    },
    deps.tool(async ({ supabase, userId }, { id }: { id: string }) => {
      await deps.issuesService.deleteIssue(supabase, userId, id)
      return { id, deleted: true as const }
    })
  )

  server.registerTool(
    "update_issue_status",
    {
      title: "Update Issue Status",
      description:
        "Update the workflow status for an issue owned by the authenticated account. Use the issue id from list_issues, create_issue, or get_issue. Important transition: moving an issue from draft to todo starts a background coding-agent run and creates the kickoff user message from the issue prompt. Other status changes only update the workflow status.",
      inputSchema: {
        id: issueIdInputSchema.id,
        status: issueStatusSchema.describe(
          "New issue workflow status. Use todo from draft only when you want to start the background agent run."
        ),
      },
      outputSchema: issueOutputSchema,
    },
    deps.tool(
      async (
        { supabase, userId },
        input: { id: string; status: z.infer<typeof issueStatusSchema> }
      ) => {
        const { id, status } = input
        const values = updateIssueStatusSchema.parse({ id, status })
        const issue = await deps.issuesService.updateIssueStatus(
          supabase,
          userId,
          values.id,
          values.status
        )
        return { issue }
      }
    )
  )

  server.registerTool(
    "update_issue_priority",
    {
      title: "Update Issue Priority",
      description:
        "Update the priority for an issue owned by the authenticated account and record priority_changed history when it changes. Use the issue id from list_issues, create_issue, or get_issue.",
      inputSchema: {
        id: issueIdInputSchema.id,
        priority: issuePrioritySchema.describe(
          `New issue priority. ${priorityValuesDescription}`
        ),
      },
      outputSchema: issueOutputSchema,
    },
    deps.tool(
      async (
        { supabase, userId },
        input: { id: string; priority: z.infer<typeof issuePrioritySchema> }
      ) => {
        const values = updateIssuePrioritySchema.parse(input)
        const issue = await deps.issuesService.updateIssuePriority(
          supabase,
          userId,
          values.id,
          values.priority
        )
        return { issue }
      }
    )
  )

  server.registerTool(
    "list_issue_relations",
    {
      title: "List Issue Relations",
      description:
        "List blocking relations for an issue owned by the authenticated account, both issues it blocks and issues that block it. Use the issue id from list_issues, create_issue, or get_issue.",
      inputSchema: issueIdInputSchema,
      outputSchema: relationsOutputSchema,
    },
    deps.tool(async ({ supabase, userId }, { id }: { id: string }) => {
      const relations = await deps.issuesService.listIssueRelations(
        supabase,
        userId,
        id
      )
      return { relations }
    })
  )

  server.registerTool(
    "list_issue_relation_candidates",
    {
      title: "List Issue Relation Candidates",
      description:
        "List other issues owned by the authenticated account that could be related to the given issue with add_issue_relation. Use the issue id from list_issues, create_issue, or get_issue.",
      inputSchema: issueIdInputSchema,
      outputSchema: relationCandidatesOutputSchema,
    },
    deps.tool(async ({ supabase, userId }, { id }: { id: string }) => {
      const issues = await deps.issuesService.listIssueRelationCandidates(
        supabase,
        userId,
        id
      )
      return { issues }
    })
  )

  server.registerTool(
    "add_issue_relation",
    {
      title: "Add Issue Relation",
      description:
        "Create a blocking relation between two issues owned by the authenticated account. direction 'blocking' means issue_id blocks related_issue_id; 'blocked_by' means issue_id is blocked by related_issue_id.",
      inputSchema: {
        issue_id: z
          .string()
          .uuid()
          .describe(
            "The issue id, from list_issues, create_issue, or get_issue."
          ),
        related_issue_id: z
          .string()
          .uuid()
          .describe(
            "The other issue id to relate to issue_id, from list_issues or list_issue_relation_candidates."
          ),
        direction: issueRelationDirectionSchema.describe(
          "'blocking' if issue_id blocks related_issue_id, or 'blocked_by' if issue_id is blocked by related_issue_id."
        ),
      },
      outputSchema: addedRelationOutputSchema,
    },
    deps.tool(
      async (
        { supabase, userId },
        input: {
          issue_id: string
          related_issue_id: string
          direction: z.infer<typeof issueRelationDirectionSchema>
        }
      ) => {
        const values = addIssueRelationSchema.parse(input)
        await deps.issuesService.addIssueRelation(
          supabase,
          userId,
          values.issue_id,
          values.related_issue_id,
          values.direction
        )
        return {
          issue_id: values.issue_id,
          related_issue_id: values.related_issue_id,
          added: true as const,
        }
      }
    )
  )

  server.registerTool(
    "delete_issue_relation",
    {
      title: "Delete Issue Relation",
      description:
        "Delete a blocking relation between two issues owned by the authenticated account. Use the relation id and issue id from list_issue_relations.",
      inputSchema: {
        id: z
          .string()
          .uuid()
          .describe("The relation id, from list_issue_relations."),
        issue_id: z
          .string()
          .uuid()
          .describe(
            "The issue id used to look up the relation, from list_issue_relations."
          ),
      },
      outputSchema: deletedOutputSchema,
    },
    deps.tool(
      async ({ supabase, userId }, input: { id: string; issue_id: string }) => {
        const values = deleteIssueRelationSchema.parse(input)
        await deps.issuesService.deleteIssueRelation(
          supabase,
          userId,
          values.id,
          values.issue_id
        )
        return { id: values.id, deleted: true as const }
      }
    )
  )
}

export function createGenticMcpHandler() {
  return createMcpHandler(
    (server) => {
      registerGenticMcpTools(server)
    },
    {},
    { basePath: "", disableSse: true }
  )
}
