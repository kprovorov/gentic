-- The PR pill's status is resolved live from the GitHub API on every page
-- load (see apps/web/app/queries.ts); nothing was persisted. Any transient
-- fetch failure (rate limit, network blip, missing GitHub App installation)
-- fell straight through to "unknown". This column caches the last
-- successfully resolved state so a failed live fetch can fall back to it
-- instead.
alter table public.issue_pull_requests
  add column if not exists state text,
  add constraint issue_pull_requests_state_check
    check (state is null or state in ('draft', 'open', 'merged', 'closed', 'queued'));

-- Scoped to the state column only: users can refresh the cached status for
-- their own issues' PRs but can't touch url/issue_id via this grant.
grant update (state) on public.issue_pull_requests to authenticated;

drop policy if exists "Users can update pull request state for their own issues"
  on public.issue_pull_requests;

create policy "Users can update pull request state for their own issues"
  on public.issue_pull_requests
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_pull_requests.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );
