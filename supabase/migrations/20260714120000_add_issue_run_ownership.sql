create table public.issue_runs (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  heartbeat_at timestamptz not null default now(),
  lease_expires_at timestamptz not null default now() + interval '2 minutes',
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint issue_runs_status_valid check (
    status in ('active', 'finished', 'failed', 'held', 'superseded')
  )
);

create index issue_runs_issue_id_idx on public.issue_runs(issue_id);
create index issue_runs_lease_expires_at_idx
  on public.issue_runs(lease_expires_at)
  where status = 'active';

alter table public.issue_runs enable row level security;

grant select on public.issue_runs to authenticated;

create policy "Users can read runs for their own issues"
  on public.issue_runs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = issue_runs.issue_id
        and projects.user_id = (select auth.uid())
    )
  );

alter table public.issues
  add column active_run_id uuid references public.issue_runs(id) on delete set null;

create index issues_active_run_id_idx on public.issues(active_run_id);

alter table public.messages
  add column run_id uuid references public.issue_runs(id) on delete set null;

create index messages_run_id_idx on public.messages(run_id);

create or replace function public.claim_issue_run(
  p_user_id text,
  p_lease_seconds integer default 120
)
returns table (
  id uuid,
  run_id uuid,
  agent_provider text,
  session_id text,
  run_finished_at timestamptz,
  pr_url text,
  repo text,
  setup_script text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue record;
  v_run_id uuid;
  v_now timestamptz := now();
  v_lease interval := make_interval(secs => greatest(p_lease_seconds, 30));
begin
  update public.issue_runs
  set status = 'superseded',
      superseded_at = v_now,
      finished_at = coalesce(finished_at, v_now)
  where status = 'active'
    and lease_expires_at <= v_now;

  update public.issues i
  set status = 'todo',
      active_run_id = null,
      run_started_at = null,
      run_finished_at = null,
      run_error = null,
      updated_at = v_now
  from public.issue_runs r
  where i.active_run_id = r.id
    and r.status = 'superseded'
    and i.status in ('queued', 'in-progress');

  select i.id,
         i.agent_provider,
         i.session_id,
         i.run_finished_at,
         i.pr_url,
         p.repo,
         p.setup_script
    into v_issue
  from public.issues i
  join public.projects p on p.id = i.project_id
  where p.user_id = p_user_id
    and (
      i.status = 'todo'
      or (i.status = 'held' and i.usage_limit_reset_at <= v_now)
    )
    and not exists (
      select 1
      from public.issue_relations rel
      join public.issues source_issue on source_issue.id = rel.source_issue_id
      where rel.target_issue_id = i.id
        and rel.type = 'blocks'
        and source_issue.status not in ('completed', 'cancelled')
    )
    and not exists (
      select 1
      from public.issue_runs active_run
      where active_run.id = i.active_run_id
        and active_run.status = 'active'
        and active_run.lease_expires_at > v_now
    )
  order by i.updated_at asc
  for update of i skip locked
  limit 1;

  if not found then
    return;
  end if;

  insert into public.issue_runs (
    issue_id,
    lease_expires_at,
    heartbeat_at
  )
  values (
    v_issue.id,
    v_now + v_lease,
    v_now
  )
  returning public.issue_runs.id into v_run_id;

  update public.issues
  set status = 'queued',
      active_run_id = v_run_id,
      run_started_at = v_now,
      run_error = null,
      run_finished_at = null,
      usage_limit_reset_at = null,
      updated_at = v_now
  where public.issues.id = v_issue.id;

  return query
  select v_issue.id,
         v_run_id,
         v_issue.agent_provider,
         v_issue.session_id,
         v_issue.run_finished_at,
         v_issue.pr_url,
         v_issue.repo,
         v_issue.setup_script;
end;
$$;

create or replace function public.touch_issue_run(
  p_issue_id uuid,
  p_run_id uuid,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_lease interval := make_interval(secs => greatest(p_lease_seconds, 30));
begin
  update public.issue_runs r
  set heartbeat_at = v_now,
      lease_expires_at = v_now + v_lease
  from public.issues i
  where r.id = p_run_id
    and r.issue_id = p_issue_id
    and i.id = p_issue_id
    and i.active_run_id = r.id
    and r.status = 'active';

  return found;
end;
$$;

create or replace function public.insert_run_message(
  p_issue_id uuid,
  p_run_id uuid,
  p_message_id uuid,
  p_role text,
  p_kind text,
  p_content text,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.touch_issue_run(p_issue_id, p_run_id) then
    raise exception 'run is no longer active' using errcode = 'P0001';
  end if;

  insert into public.messages (
    id,
    issue_id,
    run_id,
    role,
    kind,
    content,
    status
  )
  values (
    coalesce(p_message_id, gen_random_uuid()),
    p_issue_id,
    p_run_id,
    p_role,
    coalesce(p_kind, 'text'),
    p_content,
    coalesce(p_status, 'complete')
  )
  on conflict (id) do nothing
  returning id into v_id;

  return coalesce(v_id, p_message_id);
end;
$$;

create or replace function public.patch_issue_run_state(
  p_issue_id uuid,
  p_run_id uuid,
  p_fields jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_terminal boolean := false;
  v_status text := p_fields ->> 'status';
begin
  if not public.touch_issue_run(p_issue_id, p_run_id) then
    return false;
  end if;

  update public.issues
  set status = coalesce(v_status, status),
      session_id = case
        when p_fields ? 'session_id' then p_fields ->> 'session_id'
        else session_id
      end,
      run_error = case
        when p_fields ? 'run_error' then p_fields ->> 'run_error'
        else run_error
      end,
      run_started_at = case
        when p_fields ? 'run_started_at' then (p_fields ->> 'run_started_at')::timestamptz
        else run_started_at
      end,
      run_finished_at = case
        when p_fields ? 'run_finished_at' then (p_fields ->> 'run_finished_at')::timestamptz
        else run_finished_at
      end,
      usage_limit_reset_at = case
        when p_fields ? 'usage_limit_reset_at' then (p_fields ->> 'usage_limit_reset_at')::timestamptz
        else usage_limit_reset_at
      end,
      pr_url = case
        when p_fields ? 'pr_url' then p_fields ->> 'pr_url'
        else pr_url
      end,
      updated_at = v_now
  where id = p_issue_id
    and active_run_id = p_run_id;

  if not found then
    return false;
  end if;

  v_terminal := v_status in (
    'held',
    'run-failed',
    'ready-for-review',
    'waiting-for-input'
  );

  if v_terminal then
    update public.issue_runs
    set status = case
          when v_status = 'held' then 'held'
          when v_status = 'run-failed' then 'failed'
          else 'finished'
        end,
        finished_at = v_now
    where id = p_run_id
      and issue_id = p_issue_id
      and status = 'active';
  end if;

  return true;
end;
$$;

create or replace function public.reset_issue_agent_run(
  p_issue_id uuid,
  p_user_id text,
  p_agent_provider text,
  p_kickoff_content text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  perform 1
  from public.issues i
  join public.projects p on p.id = i.project_id
  where i.id = p_issue_id
    and p.user_id = p_user_id
  for update of i;

  if not found then
    return false;
  end if;

  update public.issue_runs
  set status = 'superseded',
      superseded_at = v_now,
      finished_at = coalesce(finished_at, v_now)
  where issue_id = p_issue_id
    and status = 'active';

  delete from public.messages where issue_id = p_issue_id;
  delete from public.issue_pull_requests where issue_id = p_issue_id;

  update public.issues
  set status = 'todo',
      agent_provider = p_agent_provider,
      active_run_id = null,
      session_id = null,
      run_error = null,
      run_started_at = null,
      run_finished_at = null,
      usage_limit_reset_at = null,
      pr_url = null,
      updated_at = v_now
  where id = p_issue_id;

  insert into public.messages (issue_id, role, content)
  values (p_issue_id, 'user', p_kickoff_content);

  return true;
end;
$$;

revoke execute on function public.claim_issue_run(text, integer) from public, anon, authenticated;
revoke execute on function public.touch_issue_run(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.insert_run_message(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.patch_issue_run_state(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.reset_issue_agent_run(uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.claim_issue_run(text, integer) to service_role;
grant execute on function public.touch_issue_run(uuid, uuid, integer) to service_role;
grant execute on function public.insert_run_message(uuid, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.patch_issue_run_state(uuid, uuid, jsonb) to service_role;
grant execute on function public.reset_issue_agent_run(uuid, text, text, text) to service_role;
