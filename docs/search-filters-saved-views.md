# Search, filters, and saved views

## Summary

Add a richer issue discovery surface to the Gentic home page so users can
quickly find agent work by text, project, status, type, agent, blocker state,
pull request state, and run state. Let users save commonly used filter sets as
named views.

This feature keeps the existing home page as the primary issue list, but moves
querying from "load every issue and group client-side" to server-backed query
parameters that can scale with larger workspaces.

## Goals

- Help users answer "what needs attention now?" without scanning every issue.
- Support focused views for common workflows such as blocked work, failed runs,
  review-ready pull requests, and one project's active queue.
- Persist saved views per user so the home page can become a personal command
  center.
- Keep URLs shareable/bookmarkable for the current filter state.
- Preserve realtime refresh behavior for issue, relation, message, and
  attachment changes.

## Non-goals

- Full-text search across repository contents, pull request diffs, or
  attachments.
- Cross-user/team shared saved views. This can be added after workspace/team
  ownership exists.
- Kanban drag-and-drop. Filtered list views should work first.
- Advanced query language. Filters should remain structured controls.

## User stories

- As a user, I can search issue titles and prompts so I can find a task by a
  phrase I remember.
- As a user, I can filter by project, status, type, agent, blocker state, and
  run state so I can focus on one operating mode.
- As a user, I can quickly open "Needs attention" to see issues waiting for
  input, failing tests, failed deploys, failed runs, or change requests.
- As a user, I can save my current filters as "Review queue" and return to them
  later.
- As a user, I can make one saved view my default home view.
- As a user, I can copy a filtered URL and get the same state after reload.

## Filter model

The first version should support these filters:

| Filter | Values | Notes |
| --- | --- | --- |
| Search | free text | Match `issues.title` and `issues.prompt`. Trim whitespace. |
| Project | one or more project ids | Use project name/repo in picker labels. |
| Status | one or more issue statuses | Reuse existing status enum. |
| Type | one or more issue types | Feature, bug, feedback, idea. |
| Agent | one or more agent providers | Claude Code, Codex. |
| Blocked | `blocked`, `unblocked` | Blocked means an unfinished blocker relation exists. |
| Run state | one or more run statuses plus `not-started` | `not-started` maps to `run_status is null`. |
| PR state | `none`, `open`, `merged`, `closed` | Initial implementation can derive `none` from `pr_url is null`, `merged` from issue status. `open` and `closed` improve after richer GitHub sync exists. |
| Updated | relative ranges | `24h`, `7d`, `30d`, or custom date range. |

Default sort should remain attention-first, then newest updated issue. Provide
sort options for created date, updated date, status, project, and title.

## Saved views

A saved view is a named, user-owned filter/sort configuration.

Recommended default system views:

- **All issues**: no filters.
- **Needs attention**: statuses `waiting-for-input`, `tests-failed`,
  `changes-requested`, `deploy-failed`, plus run status `failed`.
- **Active queue**: statuses `todo`, `in-progress`, `testing`, `validating`,
  `deploying`.
- **Ready for review**: status `ready-for-review`.
- **Blocked**: blocked filter `blocked`.
- **Drafts**: status `draft`.

System views do not need database rows. User-created views should be persisted
and ordered independently.

Saved view actions:

- Save current filters as a new view.
- Rename a saved view.
- Update a saved view from the current filters.
- Duplicate a saved view.
- Delete a saved view.
- Set a saved view as default.
- Reset to system "All issues".

## UX specification

### Home layout

Keep the current header and issue table, then add a compact filter bar above the
summary cards/table:

- Search input with placeholder `Search issues`.
- Project multi-select.
- Status multi-select.
- Type multi-select.
- More filters popover for agent, blocked, run state, PR state, and updated
  range.
- Sort select.
- Save view button.
- Clear filters button, visible only when filters differ from the active saved
  view or default.

Saved views should appear as horizontal tabs or a select on narrow screens.
System views appear first, followed by user views.

### Issue list behavior

- Empty unfiltered state remains the current "No issues yet" call to action.
- Empty filtered state should say `No issues match these filters` and offer
  `Clear filters`.
- Active filter count should be visible near "More filters".
- Grouping by status can remain, but groups should only include matching
  issues.
- The blocked badge remains driven by issue relations.
- Summary cards should reflect the filtered result set and include total,
  active, and blocked counts.

### URL state

Filters and sort should serialize to query parameters:

```text
/home?q=review&project=uuid1,uuid2&status=ready-for-review,changes-requested&blocked=blocked&sort=updated_desc
```

When a saved view is selected, include `view=<view_id_or_system_slug>`. If the
user edits filters from a saved view, keep the same URL filters but mark the view
as modified in UI.

## Data model

Add a `saved_issue_views` table:

```sql
create table public.saved_issue_views (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  sort text not null default 'attention_desc',
  is_default boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_issue_views_name_not_blank
    check (length(trim(name)) between 1 and 80),
  constraint saved_issue_views_filters_object
    check (jsonb_typeof(filters) = 'object'),
  constraint saved_issue_views_sort_valid
    check (sort in (
      'attention_desc',
      'created_desc',
      'created_asc',
      'updated_desc',
      'updated_asc',
      'title_asc',
      'title_desc'
    ))
);
```

Indexes:

- `(user_id, position)`
- partial unique index on `(user_id)` where `is_default`

RLS:

- Authenticated users can select/insert/update/delete only rows where
  `user_id = auth.jwt()->>'sub'`.

The `filters` JSON should be validated in application code with Zod before
insert/update.

## API and service shape

Add shared validator schemas in `packages/validators/src/issues.ts`:

- `issueSearchFiltersSchema`
- `issueSortSchema`
- `savedIssueViewSchema`
- `createSavedIssueViewSchema`
- `updateSavedIssueViewSchema`

Add service methods in `packages/services/src/issues.ts` or a new
`saved-issue-views.ts` module:

- `listIssues(supabase, userId, filters, sort, pagination)`
- `listSavedIssueViews(supabase, userId)`
- `createSavedIssueView(supabase, userId, input)`
- `updateSavedIssueView(supabase, userId, id, input)`
- `deleteSavedIssueView(supabase, userId, id)`
- `setDefaultSavedIssueView(supabase, userId, id | null)`

Update web queries:

- `getHomeData(searchParams)` returns filtered issues, blocked ids, saved views,
  active view metadata, and result counts.
- Home page should parse `searchParams`, validate them with the shared schema,
  and pass the normalized filter state to `HomeView`.

## Query behavior

Text search can start with simple `ilike` matching:

```sql
title ilike '%' || query || '%' or prompt ilike '%' || query || '%'
```

If this becomes slow, add a generated `tsvector` column or expression index for
`title` and `prompt` and switch to Postgres full-text search.

Blocked filtering should use the existing `issue_relations` table. An issue is
blocked when it is the target of at least one `blocks` relation whose source
issue status is not `completed` or `cancelled`.

Pagination should be added with this feature even if the first UI still renders
one page. Recommended default limit: 50.

## Realtime behavior

Keep the existing `RealtimeRefresh` mechanism, but invalidate the query key that
includes normalized filters and active view id. Saved view mutations should
invalidate both the current home query and the saved-view list.

## Implementation slices

1. **Server-backed filters**
   Add validator schemas, service query filters, URL parsing, and Home UI filter
   controls. No saved views yet.

2. **Saved view persistence**
   Add Supabase migration, service methods, server actions, and saved view UI.

3. **Default and system views**
   Add system view definitions, default view handling, and modified-view state.

4. **Pagination and polish**
   Add result count, next/previous or infinite loading, keyboard-friendly
   filter interactions, and empty filtered state.

## Acceptance criteria

- `/home` still works with no query parameters.
- Filtering by search, project, status, type, agent, blocked state, and run
  state returns only matching user-owned issues.
- Filter state survives refresh through URL query parameters.
- Clearing filters returns the list to the default view.
- Users can create, rename, update, duplicate, delete, and set default saved
  views.
- Saved views are only visible to the creating user.
- Realtime updates refresh the currently filtered list.
- Invalid query parameters are ignored or normalized rather than crashing the
  page.
- Existing issue detail, new issue, edit issue, and settings flows continue to
  work unchanged.

## Open questions

- Should saved views eventually be shared at a workspace level once team support
  exists?
- Should PR state wait for richer GitHub PR metadata instead of deriving from
  `pr_url` and issue status?
- Should "Needs attention" include blocked issues, or should blocked work stay
  separate?
- Should saved views support notification subscriptions later?
