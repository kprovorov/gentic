create or replace function public.claim_next_unblocked_issue(p_user_id text)
returns table (
  id uuid,
  agent_provider text,
  session_id text,
  run_finished_at timestamptz,
  repo text,
  setup_script text
)
language sql
security invoker
set search_path = public
as $$
  with candidate as (
    select
      issues.id,
      issues.run_finished_at
    from public.issues
    join public.projects on projects.id = issues.project_id
    where issues.run_status = 'queued'
      and projects.user_id = p_user_id
      and not exists (
        select 1
        from public.issue_relations
        join public.issues blocker
          on blocker.id = issue_relations.source_issue_id
        where issue_relations.target_issue_id = issues.id
          and issue_relations.type = 'blocks'
          and blocker.status not in ('completed', 'cancelled')
      )
    order by issues.updated_at asc
    limit 1
    for update of issues skip locked
  ),
  claimed as (
    update public.issues
    set
      status = 'in-progress',
      run_status = 'cloning',
      run_started_at = now(),
      run_error = null,
      run_finished_at = null,
      updated_at = now()
    from candidate
    where issues.id = candidate.id
      and issues.run_status = 'queued'
    returning
      issues.id,
      issues.agent_provider,
      issues.session_id,
      candidate.run_finished_at,
      issues.project_id
  )
  select
    claimed.id,
    claimed.agent_provider,
    claimed.session_id,
    claimed.run_finished_at,
    projects.repo,
    projects.setup_script
  from claimed
  join public.projects on projects.id = claimed.project_id;
$$;

revoke all on function public.claim_next_unblocked_issue(text) from public;
grant execute on function public.claim_next_unblocked_issue(text) to service_role;
