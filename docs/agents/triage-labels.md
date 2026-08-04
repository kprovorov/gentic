# Triage Labels

The skills speak in terms of five canonical triage roles. Gentic (see `docs/agents/issue-tracker.md`) has **no native labels/tags field** — only `status`, `type`, `priority`. The roles below map to Gentic's `status` plus a title-prefix convention for the two roles with no direct status equivalent.

| Role in mattpocock/skills | Representation in Gentic                          | Meaning                                             |
| -------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| `needs-triage`              | status `draft`, no title prefix                    | Newly created, maintainer hasn't evaluated it yet   |
| `needs-info`                | status `draft`, title prefixed `[needs-info] `      | Waiting on the reporter for more information        |
| `ready-for-agent`           | status `todo`                                       | Fully specified — promoting to `todo` **starts the background agent immediately**, so only do this when you mean it right now, not as a passive marker |
| `ready-for-human`           | status `draft`, title prefixed `[ready-for-human] ` | Requires human implementation; deliberately kept out of `todo` so Gentic's agent never picks it up |
| `wontfix`                   | status `cancelled`                                  | Will not be actioned (no reason field — put the reason in `prompt` first if it matters) |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding status/prefix from this table via `mcp__gentic__update_issue_status` (and `mcp__gentic__update_issue` for the title prefix).
