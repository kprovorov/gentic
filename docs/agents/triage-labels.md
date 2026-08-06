# Triage Labels

The skills speak in terms of five canonical triage roles. Gentic now has a
**native, account-scoped Label** system (see `docs/agents/issue-tracker.md` and
`docs/web/labels.mdx`), so these roles map to real Labels created on demand —
no more title-prefix or status-substitution workarounds.

Labels are **passive metadata**: assigning one never changes an issue's
`status`, `priority`, or workflow, and never starts an agent. That is exactly
what makes them safe to use for triage.

| Role in mattpocock/skills | Native Gentic Label | Meaning |
| -------------------------- | ------------------- | ------- |
| `needs-triage`   | `needs-triage`   | Newly created, maintainer hasn't evaluated it yet |
| `needs-info`     | `needs-info`     | Waiting on the reporter for more information |
| `ready-for-agent`| `ready-for-agent`| Fully specified and cleared for the background agent. **Passive** — see the warning below |
| `ready-for-human`| `ready-for-human`| Requires human implementation; keep it out of `todo` so the agent never picks it up |
| `wontfix`        | `wontfix`        | Will not be actioned |

## Applying a triage Label

Use the `mcp__gentic__*` Label tools. Labels are account-scoped, so one catalog
covers every project.

1. **Find or create the Label.** Call `mcp__gentic__list_labels` (optionally with
   `search`) to get the Label's stable `id`. If it doesn't exist yet, call
   `mcp__gentic__create_label` with just the `name` (a color is auto-assigned);
   creating a name that matches an archived Label restores it. Label names are
   unique per account, case-insensitively, so reuse the exact names above.
2. **Assign it.** Call `mcp__gentic__add_issue_labels` with `issue_ids` (issue
   **UUIDs** from `list_issues`/`get_issue`, not Issue Codes like `GEN-123`) and
   `label_ids` (the Label UUIDs). It accepts multiple issues and multiple Labels,
   is idempotent, and applies atomically. Remove with
   `mcp__gentic__remove_issue_labels`.

To find issues already carrying a role, filter with `mcp__gentic__list_issues`
using `label_ids` (match-all), or `unlabeled: true` to find issues that still
need triage.

<!-- keep this warning prominent; it is the whole point of the passive model -->
> **`ready-for-agent` does not start an agent.** Applying the Label is a passive
> marker only. To actually launch the background coding agent you must still move
> the issue's status from `draft` to `todo` via `mcp__gentic__update_issue_status`
> — that status transition remains the *only* thing that starts a run, and you
> should only do it when you mean "start now." Explicit workflow actions, not
> Labels, are responsible for execution. Likewise, `wontfix` is a Label, not a
> status: cancel the issue with `update_issue_status` (`cancelled`) if you also
> want it out of the active workflow.

## No automatic migration

Adopting native Labels is forward-looking only. Existing issues that used the old
conventions — `[needs-info]` / `[ready-for-human]` title prefixes, or the
`cancelled` status standing in for `wontfix` — are **not** rewritten
automatically. Leave user-authored titles and statuses as they are; apply native
Labels to new work and to old issues only when you deliberately re-triage them.
