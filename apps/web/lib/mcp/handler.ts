import {
  agentProviderSchema,
  createIssueSchema,
  issueStatusSchema,
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

const projectOutputSchema = {
  project: jsonObjectSchema.describe("A Gentic project owned by the authenticated account."),
}

const projectsOutputSchema = {
  projects: z
    .array(jsonObjectSchema)
    .describe("Projects owned by the authenticated account."),
}

const issueOutputSchema = {
  issue: jsonObjectSchema.describe("A Gentic issue owned by the authenticated account."),
}

const issuesOutputSchema = {
  issues: z
    .array(jsonObjectSchema)
    .describe("Issues owned by the authenticated account."),
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

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "whoami",
      {
        description:
          "Returns the Gentic account id for the account that authorized this MCP connection.",
        inputSchema: {},
        outputSchema: {
          userId: z.string().describe("The Gentic account id for this MCP connection."),
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
      tool(async ({ supabase, userId }) => {
        const projects = await projectsService.listProjects(supabase, userId)
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
      tool(async ({ supabase, userId }, { id }: { id: string }) => {
        const project = await projectsService.getProject(supabase, userId, id)
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
            .describe("GitHub repository in owner/name format, for example vercel/next.js."),
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
      tool(
        async (
          { supabase, userId },
          input: { name: string; repo: string; setup_script?: string | null }
        ) => {
          const project = await projectsService.createProject(
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
      tool(
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
          const project = await projectsService.updateProject(
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
      tool(async ({ supabase, userId }, { id }: { id: string }) => {
        await projectsService.deleteProject(supabase, userId, id)
        return { id, deleted: true as const }
      })
    )

    server.registerTool(
      "list_issues",
      {
        title: "List Issues",
        description:
          "List Gentic issues owned by the authenticated account. Optionally filter by a project id from list_projects. Returned issue ids can be used with get_issue, update_issue, update_issue_status, or delete_issue.",
        inputSchema: {
          project_id: z
            .string()
            .uuid()
            .optional()
            .describe("Optional project id from list_projects to list only that project's issues."),
        },
        outputSchema: issuesOutputSchema,
      },
      tool(
        async (
          { supabase, userId },
          { project_id }: { project_id?: string }
        ) => {
          const issues = await issuesService.listIssues(supabase, userId, {
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
          "Get full details for one Gentic issue owned by the authenticated account. Use the issue id from list_issues or create_issue.",
        inputSchema: issueIdInputSchema,
        outputSchema: issueOutputSchema,
      },
      tool(async ({ supabase, userId }, { id }: { id: string }) => {
        const issue = await issuesService.getIssue(supabase, userId, id)
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
            .describe("Optional detailed instructions for the background coding agent."),
          status: issueStatusSchema
            .optional()
            .default("draft")
            .describe("Initial issue status. Defaults to draft."),
          agent_provider: agentProviderSchema
            .optional()
            .default("claude_code")
            .describe("Coding agent to run for this issue. Defaults to Claude Code."),
        },
        outputSchema: issueOutputSchema,
      },
      tool(
        async (
          { supabase, userId },
          input: {
            project_id: string
            title: string
            prompt?: string
            status?: z.infer<typeof issueStatusSchema>
            agent_provider?: z.infer<typeof agentProviderSchema>
          }
        ) => {
          const issue = await issuesService.createIssue(
            supabase,
            userId,
            createIssueSchema.parse({
              ...input,
              status: input.status ?? "draft",
              agent_provider: input.agent_provider ?? "claude_code",
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
          "Update the title and prompt for an issue owned by the authenticated account. Use the issue id from list_issues, create_issue, or get_issue.",
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
            .describe("Updated optional detailed instructions for the background coding agent."),
          agent_provider: agentProviderSchema.describe(
            "Coding agent to run for this issue."
          ),
        },
        outputSchema: issueOutputSchema,
      },
      tool(
        async (
          { supabase, userId },
          input: {
            id: string
            title: string
            prompt?: string
            agent_provider: z.infer<typeof agentProviderSchema>
          }
        ) => {
          const { id, ...values } = input
          const issue = await issuesService.updateIssue(
            supabase,
            userId,
            id,
            updateIssueSchema.parse({ id, ...values })
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
      tool(async ({ supabase, userId }, { id }: { id: string }) => {
        await issuesService.deleteIssue(supabase, userId, id)
        return { id, deleted: true as const }
      })
    )

    server.registerTool(
      "update_issue_status",
      {
        title: "Update Issue Status",
        description:
          "Update the workflow status for an issue owned by the authenticated account. Use the issue id from list_issues, create_issue, or get_issue. Important transition: moving an issue from draft to todo queues a background coding-agent run, sets run_status to queued, and creates the kickoff user message from the issue title and prompt. Other status changes only update the workflow status.",
        inputSchema: {
          id: issueIdInputSchema.id,
          status: issueStatusSchema.describe(
            "New issue workflow status. Use todo from draft only when you want to start the background agent run."
          ),
        },
        outputSchema: issueOutputSchema,
      },
      tool(
        async (
          { supabase, userId },
          input: { id: string; status: z.infer<typeof issueStatusSchema> }
        ) => {
          const { id, status } = input
          const values = updateIssueStatusSchema.parse({ id, status })
          const issue = await issuesService.updateIssueStatus(
            supabase,
            userId,
            values.id,
            values.status
          )
          return { issue }
        }
      )
    )
  },
  {},
  { basePath: "", disableSse: true }
)

export { mcpHandler }
