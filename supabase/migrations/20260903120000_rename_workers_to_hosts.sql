-- GEN-435: the "connected worker" concept is now called a "host".
--
-- Renames every schema object that spells "worker" so the database matches the
-- single term the product uses everywhere else. Renames preserve data, grants,
-- RLS policy bodies and publication membership, so this is a pure metadata
-- change -- but PL/pgSQL function bodies are stored as opaque text and are
-- *not* rewritten by a rename, so every function that reads a renamed table or
-- column is redefined below.
--
-- Functions whose name or parameter names change cannot go through
-- `create or replace` (Postgres refuses to rename an input parameter), so they
-- are dropped and recreated -- which also drops their grants, re-issued here.
-- Functions whose signature is unchanged keep their grants and dependent
-- triggers via `create or replace`.

-- pg_cron upserts by case-sensitive job name, so scheduling the new name
-- without unscheduling the old one would leave the old job running against a
-- function this migration drops -- an error every 30 seconds, forever. Drop by
-- id so this no-ops when the job is absent (a fresh local instance) rather
-- than raising the way `cron.unschedule('name')` does.
--
-- `cron.job` carries an RLS policy of `username = current_user` on pg_cron
-- >= 1.4, so this only sees jobs owned by the role running the migration. That
-- is the same role that scheduled it in 20260729212607 (`postgres`, both under
-- `supabase start` and `supabase db push`), so it matches. If migrations ever
-- start running as a different role, this silently no-ops and the old job
-- survives -- there is no way to tell "absent" from "invisible" in SQL, so
-- check `cron.job` by hand if the owning role ever changes.
select cron.unschedule(jobid)
  from cron.job
 where jobname = 'reconcile-offline-worker-runs';

-- Depends on a function that is dropped below; recreated after it.
drop trigger if exists ensure_issue_active_worker_owner on public.issues;

drop function if exists public.ensure_issue_active_worker_owner();
drop function if exists public.requeue_worker_active_issues(uuid, timestamptz);
drop function if exists
  public.requeue_worker_active_review_runs(uuid, timestamptz);
drop function if exists public.rename_worker(text, uuid, text, timestamptz);
drop function if exists public.ban_worker(text, uuid, timestamptz);
drop function if exists public.unban_worker(text, uuid, timestamptz);
drop function if exists public.delete_worker(text, uuid, timestamptz);
drop function if exists public.reconcile_offline_worker_runs(timestamptz);
drop function if exists public.claim_review_run(uuid, text, timestamptz);
drop function if exists public.record_worker_enrollment_exchange_failure(
  text,
  timestamptz,
  integer,
  integer
);
drop function if exists public.consume_worker_enrollment_code(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  jsonb,
  timestamptz,
  timestamptz
);

alter table public.workers rename to hosts;
alter table public.worker_enrollment_codes rename to host_enrollment_codes;
alter table public.worker_enrollment_exchange_failures
  rename to host_enrollment_exchange_failures;
alter table public.worker_skill_installs rename to host_skill_installs;

alter table public.issues rename column active_worker_id to active_host_id;
alter table public.review_runs
  rename column claimed_by_worker_id to claimed_by_host_id;
alter table public.issue_implementation_owners
  rename column worker_id to host_id;
alter table public.host_skill_installs rename column worker_id to host_id;

alter index public.workers_user_id_idx rename to hosts_user_id_idx;
alter index public.workers_available_idx rename to hosts_available_idx;
alter index public.workers_credential_hash_unique
  rename to hosts_credential_hash_unique;
alter index public.worker_enrollment_codes_user_id_idx
  rename to host_enrollment_codes_user_id_idx;
alter index public.worker_enrollment_codes_active_idx
  rename to host_enrollment_codes_active_idx;
alter index public.worker_skill_installs_one_active_per_worker_idx
  rename to host_skill_installs_one_active_per_host_idx;
alter index public.worker_skill_installs_claimable_idx
  rename to host_skill_installs_claimable_idx;
alter index public.worker_skill_installs_user_created_idx
  rename to host_skill_installs_user_created_idx;
alter index public.issues_active_worker_id_idx
  rename to issues_active_host_id_idx;
alter index public.issues_worker_selection_priority_idx
  rename to issues_host_selection_priority_idx;
alter index public.review_runs_claimed_by_worker_id_idx
  rename to review_runs_claimed_by_host_id_idx;
alter index public.issue_implementation_owners_worker_id_idx
  rename to issue_implementation_owners_host_id_idx;

alter table public.hosts rename constraint workers_pkey to hosts_pkey;
alter table public.hosts
  rename constraint workers_user_id_not_blank
  to hosts_user_id_not_blank;
alter table public.hosts
  rename constraint workers_display_name_not_blank
  to hosts_display_name_not_blank;
alter table public.hosts
  rename constraint workers_credential_hash_not_blank
  to hosts_credential_hash_not_blank;
alter table public.hosts
  rename constraint workers_setup_state_valid
  to hosts_setup_state_valid;
alter table public.hosts
  rename constraint workers_gentic_version_length
  to hosts_gentic_version_length;
alter table public.hosts rename constraint workers_os_length to hosts_os_length;
alter table public.hosts
  rename constraint workers_arch_length
  to hosts_arch_length;
alter table public.hosts
  rename constraint workers_configured_capacity_range
  to hosts_configured_capacity_range;
alter table public.hosts
  rename constraint workers_provider_capabilities_object
  to hosts_provider_capabilities_object;
alter table public.hosts
  rename constraint workers_user_normalized_name_unique
  to hosts_user_normalized_name_unique;
alter table public.hosts
  rename constraint workers_credential_expires_after_created
  to hosts_credential_expires_after_created;
alter table public.hosts
  rename constraint workers_id_user_id_unique
  to hosts_id_user_id_unique;
alter table public.host_enrollment_codes
  rename constraint worker_enrollment_codes_pkey
  to host_enrollment_codes_pkey;
alter table public.host_enrollment_codes
  rename constraint worker_enrollment_codes_hash_not_blank
  to host_enrollment_codes_hash_not_blank;
alter table public.host_enrollment_codes
  rename constraint worker_enrollment_codes_user_id_not_blank
  to host_enrollment_codes_user_id_not_blank;
alter table public.host_enrollment_codes
  rename constraint worker_enrollment_codes_expires_after_created
  to host_enrollment_codes_expires_after_created;
alter table public.host_enrollment_codes
  rename constraint worker_enrollment_codes_consumed_after_created
  to host_enrollment_codes_consumed_after_created;
alter table public.host_enrollment_codes
  rename constraint worker_enrollment_codes_one_active_per_user
  to host_enrollment_codes_one_active_per_user;
alter table public.host_enrollment_exchange_failures
  rename constraint worker_enrollment_exchange_failures_pkey
  to host_enrollment_exchange_failures_pkey;
alter table public.host_enrollment_exchange_failures
  rename constraint worker_exchange_failures_key_not_blank
  to host_exchange_failures_key_not_blank;
alter table public.host_enrollment_exchange_failures
  rename constraint worker_exchange_failures_count_nonnegative
  to host_exchange_failures_count_nonnegative;
alter table public.host_skill_installs
  rename constraint worker_skill_installs_pkey
  to host_skill_installs_pkey;
alter table public.host_skill_installs
  rename constraint worker_skill_installs_user_id_not_blank
  to host_skill_installs_user_id_not_blank;
alter table public.host_skill_installs
  rename constraint worker_skill_installs_source_valid
  to host_skill_installs_source_valid;
alter table public.host_skill_installs
  rename constraint worker_skill_installs_skill_valid
  to host_skill_installs_skill_valid;
alter table public.host_skill_installs
  rename constraint worker_skill_installs_url_length
  to host_skill_installs_url_length;
alter table public.host_skill_installs
  rename constraint worker_skill_installs_status_valid
  to host_skill_installs_status_valid;
alter table public.host_skill_installs
  rename constraint worker_skill_installs_expires_after_created
  to host_skill_installs_expires_after_created;
alter table public.host_skill_installs
  rename constraint worker_skill_installs_error_summary_length
  to host_skill_installs_error_summary_length;
alter table public.host_skill_installs
  rename constraint worker_skill_installs_output_length
  to host_skill_installs_output_length;
alter table public.host_skill_installs
  rename constraint worker_skill_installs_worker_owner
  to host_skill_installs_host_owner;
alter table public.issues
  rename constraint issues_active_worker_requires_active_run
  to issues_active_host_requires_active_run;
alter table public.issues
  rename constraint issues_active_worker_id_fkey
  to issues_active_host_id_fkey;
alter table public.review_runs
  rename constraint review_runs_claimed_by_worker_id_fkey
  to review_runs_claimed_by_host_id_fkey;
alter table public.issue_implementation_owners
  rename constraint issue_implementation_owners_worker_id_fkey
  to issue_implementation_owners_host_id_fkey;

alter policy "Users can read their own workers"
  on public.hosts
  rename to "Users can read their own hosts";
alter policy "Users can create their own workers"
  on public.hosts
  rename to "Users can create their own hosts";
alter policy "Users can update their own workers"
  on public.hosts
  rename to "Users can update their own hosts";
alter policy "Users can delete their own workers"
  on public.hosts
  rename to "Users can delete their own hosts";

-- Recreated with the renamed identifiers. Dropped above, so grants follow.

create function public.ensure_issue_active_host_owner()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_owner text;
  v_host_owner text;
begin
  if new.active_host_id is null then
    return new;
  end if;

  select projects.user_id
    into v_project_owner
    from public.projects
   where projects.id = new.project_id;

  select hosts.user_id
    into v_host_owner
    from public.hosts
   where hosts.id = new.active_host_id;

  if v_host_owner is distinct from v_project_owner then
    raise exception 'Active host must belong to the issue owner'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create function public.requeue_host_active_issues(
  p_host_id uuid,
  p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requeued_count integer := 0;
begin
  with active as (
    select id, active_run_id
      from public.issues
     where active_host_id = p_host_id
       and active_run_id is not null
       and status not in ('completed', 'cancelled', 'run-failed')
     for update
  ),
  requeued as (
    update public.issues
       set status = 'todo',
           active_host_id = null,
           active_run_id = null,
           run_error = null,
           run_started_at = null,
           run_finished_at = null,
           usage_limit_reset_at = null,
           updated_at = p_now
      from active
     where issues.id = active.id
     returning issues.id
  ),
  released_messages as (
    update public.messages
       set consumed_by_run_id = null,
           consumed_at = null,
           updated_at = p_now
      from active
     where messages.issue_id = active.id
       and messages.role = 'user'
       and messages.consumed_by_run_id = active.active_run_id
     returning messages.id
  )
  select count(*)::integer
    into v_requeued_count
    from requeued;

  update public.issues
     set active_host_id = null,
         active_run_id = null,
         updated_at = p_now
   where active_host_id = p_host_id
     and active_run_id is not null
     and status = 'run-failed';

  return v_requeued_count;
end;
$$;

create function public.rename_host(
  p_user_id text,
  p_host_id uuid,
  p_display_name text,
  p_now timestamptz default now()
)
returns public.hosts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text :=
    btrim(regexp_replace(p_display_name, '[[:space:]]+', ' ', 'g'));
  v_host public.hosts%rowtype;
begin
  if length(v_display_name) not between 1 and 80 then
    raise exception 'Host display name must be between 1 and 80 characters'
      using errcode = '22023';
  end if;

  update public.hosts
     set display_name = v_display_name,
         updated_at = p_now
   where id = p_host_id
     and user_id = p_user_id
   returning *
    into v_host;

  if not found then
    return null;
  end if;

  return v_host;
exception
  when unique_violation then
    raise exception 'Host display name is already in use'
      using errcode = '23505';
end;
$$;

create function public.ban_host(
  p_user_id text,
  p_host_id uuid,
  p_now timestamptz default now()
)
returns public.hosts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host public.hosts%rowtype;
  v_ignored integer;
begin
  select *
    into v_host
    from public.hosts
   where id = p_host_id
     and user_id = p_user_id
   for update;

  if not found then
    return null;
  end if;

  if v_host.banned_at is null then
    update public.hosts
       set banned_at = p_now,
           last_seen_at = null,
           updated_at = p_now
     where id = p_host_id
     returning *
      into v_host;
  end if;

  v_ignored := public.requeue_host_active_issues(p_host_id, p_now);
  v_ignored := public.requeue_host_active_review_runs(p_host_id, p_now);

  return v_host;
end;
$$;

create function public.unban_host(
  p_user_id text,
  p_host_id uuid,
  p_now timestamptz default now()
)
returns public.hosts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host public.hosts%rowtype;
begin
  update public.hosts
     set banned_at = null,
         last_seen_at = null,
         updated_at = p_now
   where id = p_host_id
     and user_id = p_user_id
   returning *
    into v_host;

  if not found then
    return null;
  end if;

  return v_host;
end;
$$;

create function public.delete_host(
  p_user_id text,
  p_host_id uuid,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host public.hosts%rowtype;
  v_ignored integer;
begin
  select *
    into v_host
    from public.hosts
   where id = p_host_id
     and user_id = p_user_id
   for update;

  if not found then
    return false;
  end if;

  if v_host.banned_at is null then
    update public.hosts
       set banned_at = p_now,
           last_seen_at = null,
           credential_expires_at = greatest(
             p_now,
             v_host.created_at + interval '1 microsecond'
           ),
           updated_at = p_now
     where id = p_host_id;
  end if;

  v_ignored := public.requeue_host_active_issues(p_host_id, p_now);
  v_ignored := public.requeue_host_active_review_runs(p_host_id, p_now);

  delete from public.hosts
   where id = p_host_id
     and user_id = p_user_id;

  return true;
end;
$$;

create function public.reconcile_offline_host_runs(
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_reconciled_count integer;
begin
  with stale_hosts as materialized (
    select
      hosts.id,
      hosts.last_seen_at,
      hosts.offline_since_at
    from public.hosts
    where hosts.banned_at is null
      and coalesce(hosts.last_seen_at, hosts.offline_since_at)
        <= p_now - interval '5 minutes'
      and exists (
        select 1
        from public.issues
        where issues.active_host_id = hosts.id
          and issues.active_run_id is not null
          and issues.status in (
            'queued',
            'held',
            'in-progress',
            'waiting-for-input'
          )
      )
    for update of hosts skip locked
  ),
  stale_assignments as materialized (
    select
      issues.id as issue_id,
      issues.active_run_id,
      issues.active_host_id,
      stale_hosts.last_seen_at,
      stale_hosts.offline_since_at
    from public.issues
    join stale_hosts
      on stale_hosts.id = issues.active_host_id
    where issues.active_run_id is not null
      and issues.status in (
        'queued',
        'held',
        'in-progress',
        'waiting-for-input'
      )
  ),
  failed as (
    update public.issues
    set
      status = 'run-failed',
      active_run_id = null,
      active_host_id = null,
      run_error = 'Assigned host went offline',
      run_finished_at = p_now,
      usage_limit_reset_at = null,
      updated_at = p_now
    from stale_assignments
    where issues.id = stale_assignments.issue_id
      and issues.active_run_id = stale_assignments.active_run_id
      and issues.active_host_id = stale_assignments.active_host_id
    returning
      issues.id,
      stale_assignments.active_run_id,
      stale_assignments.active_host_id,
      stale_assignments.last_seen_at,
      stale_assignments.offline_since_at
  ),
  recorded as (
    insert into public.issue_events(issue_id, type, payload, created_at)
    select
      failed.id,
      'run_failed',
      jsonb_build_object(
        'reason', jsonb_build_object(
          'code', 'assigned_host_offline',
          'host_id', failed.active_host_id,
          'active_run_id', failed.active_run_id,
          'last_seen_at', failed.last_seen_at,
          'offline_since_at', failed.offline_since_at
        ),
        'failed_at', p_now
      ),
      p_now
    from failed
    returning 1
  )
  select count(*)::integer
    into v_reconciled_count
    from recorded;

  return v_reconciled_count;
end;
$$;

create function public.record_host_enrollment_exchange_failure(
  p_rate_limit_key text,
  p_now timestamptz,
  p_max_failures integer,
  p_window_ms integer
)
returns table (
  failed_count integer,
  locked_until timestamptz
)
language sql
security definer
set search_path = public
as $$
  insert into public.host_enrollment_exchange_failures (
    rate_limit_key,
    failed_count,
    window_started_at,
    locked_until,
    updated_at
  ) values (
    p_rate_limit_key,
    1,
    p_now,
    case
      when p_max_failures <= 1
        then p_now + make_interval(secs => p_window_ms / 1000.0)
      else null
    end,
    p_now
  )
  on conflict (rate_limit_key) do update
    set failed_count = case
          when p_now - host_enrollment_exchange_failures.window_started_at >=
            make_interval(secs => p_window_ms / 1000.0)
            then 1
          else host_enrollment_exchange_failures.failed_count + 1
        end,
        window_started_at = case
          when p_now - host_enrollment_exchange_failures.window_started_at >=
            make_interval(secs => p_window_ms / 1000.0)
            then p_now
          else host_enrollment_exchange_failures.window_started_at
        end,
        locked_until = case
          when (
            case
              when p_now - host_enrollment_exchange_failures.window_started_at >=
                make_interval(secs => p_window_ms / 1000.0)
                then 1
              else host_enrollment_exchange_failures.failed_count + 1
            end
          ) >= p_max_failures
            then p_now + make_interval(secs => p_window_ms / 1000.0)
          else null
        end,
        updated_at = p_now
  returning
    host_enrollment_exchange_failures.failed_count,
    host_enrollment_exchange_failures.locked_until;
$$;

create function public.consume_host_enrollment_code(
  p_code_hash text,
  p_credential_hash text,
  p_display_name text,
  p_gentic_version text,
  p_os text,
  p_arch text,
  p_configured_capacity integer,
  p_provider_capabilities jsonb,
  p_process_started_at timestamptz,
  p_now timestamptz default now()
)
returns public.hosts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code public.host_enrollment_codes%rowtype;
  v_conflict_constraint text;
  v_display_name_limit integer := 80;
  v_base_name text := btrim(regexp_replace(p_display_name, '[[:space:]]+', ' ', 'g'));
  v_candidate_name text;
  v_suffix integer := 1;
  v_host public.hosts%rowtype;
begin
  update public.host_enrollment_codes
     set consumed_at = p_now
   where code_hash = p_code_hash
     and consumed_at is null
     and expires_at > p_now
   returning *
    into v_code;

  if not found then
    return null;
  end if;

  loop
    if v_suffix = 1 then
      v_candidate_name := v_base_name;
    else
      v_candidate_name :=
        left(
          v_base_name,
          greatest(1, v_display_name_limit - 1 - length(v_suffix::text))
        ) || ' ' || v_suffix::text;
    end if;

    begin
      insert into public.hosts (
        user_id,
        display_name,
        credential_hash,
        setup_state,
        gentic_version,
        os,
        arch,
        configured_capacity,
        provider_capabilities,
        process_started_at
      ) values (
        v_code.user_id,
        v_candidate_name,
        p_credential_hash,
        'enrolling',
        p_gentic_version,
        p_os,
        p_arch,
        p_configured_capacity,
        p_provider_capabilities,
        p_process_started_at
      )
      returning *
       into v_host;

      return v_host;
    exception
      when unique_violation then
        get stacked diagnostics v_conflict_constraint = constraint_name;
        if
          v_conflict_constraint is distinct from
            'hosts_user_normalized_name_unique' or
          v_suffix >= 1000
        then
          raise;
        end if;
        v_suffix := v_suffix + 1;
    end;
  end loop;
end;
$$;

create function public.requeue_host_active_review_runs(
  p_host_id uuid,
  p_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run record;
  v_count integer := 0;
begin
  for v_run in
    select id
      from public.review_runs
     where claimed_by_host_id = p_host_id
       and status = 'running'
     for update skip locked
  loop
    perform public.fail_review_run(v_run.id, 'Host banned', p_now);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create function public.claim_review_run(
  p_host_id uuid,
  p_user_id text,
  p_now timestamptz default now()
)
returns table (
  review_run_id uuid,
  review_cycle_id uuid,
  issue_id uuid,
  pull_request_id uuid,
  head_sha text
)
language plpgsql
set search_path = ''
as $$
declare
  v_host_ok boolean;
  v_run_id uuid;
begin
  select exists (
    select 1
      from public.hosts
     where id = p_host_id
       and user_id = p_user_id
       and banned_at is null
  ) into v_host_ok;

  if not v_host_ok then
    return;
  end if;

  select rr.id
    into v_run_id
    from public.review_runs rr
    join public.review_cycles rc
      on rc.id = rr.review_cycle_id
     and rc.state = 'active'
    join public.issue_pull_requests ipr
      on ipr.id = rc.pull_request_id
     and ipr.state in ('open', 'queued')
    join public.issues i on i.id = rc.issue_id
    join public.projects p on p.id = i.project_id
     and p.user_id = p_user_id
   where rr.status = 'pending'
   order by i.priority desc, rr.created_at asc
   for update of rr skip locked
   limit 1;

  if v_run_id is null then
    return;
  end if;

  update public.review_runs
     set status = 'running',
         claimed_by_host_id = p_host_id,
         started_at = p_now,
         updated_at = p_now
   where id = v_run_id;

  insert into public.issue_events (issue_id, type, payload)
  select rc.issue_id,
    'review_started',
    jsonb_build_object(
      'review_run_id', rr.id,
      'review_cycle_id', rr.review_cycle_id,
      'pull_request_id', rc.pull_request_id
    )
    from public.review_runs rr
    join public.review_cycles rc on rc.id = rr.review_cycle_id
   where rr.id = v_run_id;

  return query
    select rr.id, rr.review_cycle_id, rc.issue_id, rc.pull_request_id, rr.head_sha
      from public.review_runs rr
      join public.review_cycles rc on rc.id = rr.review_cycle_id
     where rr.id = v_run_id;
end;
$$;

-- Signature unchanged, so `create or replace` keeps the existing grants and the
-- triggers that depend on these functions; only the renamed identifiers in the
-- bodies change.

create or replace function public.sync_issue_implementation_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current public.issue_implementation_owners%rowtype;
  v_next_generation integer;
begin
  -- Session cleared: the resumable owner is gone. `reset_issue_run` and an
  -- agent-provider change both null out `session_id`, so treat that as the end
  -- of the current ownership and supersede it — the next implementation run
  -- then establishes a fresh generation. A fresh-implementation owner that is
  -- still waiting for its first run carries a null session and must not be torn
  -- down here, so only owners that actually hold a session are superseded.
  if new.session_id is null then
    if tg_op = 'UPDATE' and old.session_id is not null then
      update public.issue_implementation_owners
         set superseded_at = now(),
             updated_at = now()
       where issue_id = new.id
         and superseded_at is null
         and session_id is not null;
    end if;
    return new;
  end if;

  -- With a session present, only a live run (lease held) can own the work.
  if new.active_run_id is null or new.active_host_id is null then
    return new;
  end if;

  -- Nothing ownership-relevant changed.
  if tg_op = 'UPDATE'
     and new.session_id is not distinct from old.session_id
     and new.active_host_id is not distinct from old.active_host_id
     and new.agent_provider is not distinct from old.agent_provider
     and new.issue_model is not distinct from old.issue_model then
    return new;
  end if;

  select *
    into v_current
    from public.issue_implementation_owners
   where issue_id = new.id
     and superseded_at is null
   for update;

  if not found then
    select coalesce(max(generation), 0) + 1
      into v_next_generation
      from public.issue_implementation_owners
     where issue_id = new.id;

    insert into public.issue_implementation_owners (
      issue_id, generation, origin, host_id, session_id,
      agent_provider, issue_model
    ) values (
      new.id, v_next_generation, 'implementation', new.active_host_id,
      new.session_id, new.agent_provider, new.issue_model
    );
    return new;
  end if;

  -- Bind an unbound (fresh-implementation) owner to the first run that brings a
  -- session, and let the owning host refresh its resume handle on reconnect,
  -- restart or a review retry. A *different* host never takes ownership
  -- implicitly — host reassignment must go through start_fresh_implementation.
  if v_current.host_id is null
     or v_current.host_id = new.active_host_id then
    update public.issue_implementation_owners
       set host_id = new.active_host_id,
           session_id = new.session_id,
           agent_provider = new.agent_provider,
           issue_model = new.issue_model,
           updated_at = now()
     where id = v_current.id;
  end if;

  return new;
end;
$$;

create or replace function public.start_fresh_implementation(
  p_user_id text,
  p_issue_id uuid,
  p_now timestamptz default now()
)
returns public.issue_implementation_owners
language plpgsql
security definer
set search_path = public
as $$
declare
  v_issue public.issues%rowtype;
  v_next_generation integer;
  v_owner public.issue_implementation_owners%rowtype;
begin
  select i.*
    into v_issue
    from public.issues i
    join public.projects p on p.id = i.project_id
   where i.id = p_issue_id
     and p.user_id = p_user_id
   for update of i;

  if not found then
    raise exception 'Issue not found' using errcode = 'P0002';
  end if;

  if v_issue.type = 'spec' then
    raise exception 'Spec issues do not run a coding agent'
      using errcode = '22023';
  end if;

  -- Supersede whatever owner is current (bound or still waiting) before the new
  -- generation appears, so the single-current-owner index is never violated and
  -- there is never a window with two current owners.
  update public.issue_implementation_owners
     set superseded_at = p_now,
         updated_at = p_now
   where issue_id = p_issue_id
     and superseded_at is null;

  select coalesce(max(generation), 0) + 1
    into v_next_generation
    from public.issue_implementation_owners
   where issue_id = p_issue_id;

  insert into public.issue_implementation_owners (
    issue_id, generation, origin, host_id, session_id,
    agent_provider, issue_model, established_at
  ) values (
    p_issue_id, v_next_generation, 'fresh_implementation', null, null,
    v_issue.agent_provider, v_issue.issue_model, p_now
  )
  returning * into v_owner;

  -- Clear the resume handle and the run lease and re-queue the issue. This is
  -- what makes the transition race-free: any surviving run is invalidated (its
  -- writes are gated on `active_run_id`/`active_host_id`), and the next run
  -- starts a brand-new session that binds this fresh owner. The trigger above
  -- leaves this owner alone because it has no session yet.
  update public.issues
     set status = 'todo',
         session_id = null,
         active_run_id = null,
         active_host_id = null,
         run_error = null,
         run_started_at = null,
         run_finished_at = null,
         usage_limit_reset_at = null,
         updated_at = p_now
   where id = p_issue_id;

  insert into public.issue_events (issue_id, type, payload)
  values (
    p_issue_id,
    'implementation_ownership_reset',
    jsonb_build_object(
      'generation', v_next_generation,
      'origin', 'fresh_implementation'
    )
  );

  return v_owner;
end;
$$;

create or replace function public.release_issue_run_lease()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.active_run_id is not null
     and new.status not in ('queued', 'in-progress') then
    new.active_run_id := null;
    new.active_host_id := null;
  end if;

  return new;
end;
$$;

create or replace function public.finish_issue_run_if_no_pending(
  p_issue_id uuid,
  p_run_id uuid,
  p_status text,
  p_run_finished_at timestamptz
)
returns table (
  finished boolean,
  status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_aggregate record;
begin
  if p_status not in ('ready-for-review', 'waiting-for-input') then
    raise exception 'Invalid terminal run status'
      using errcode = '22023';
  end if;

  select issues.status
    into v_status
    from public.issues
   where issues.id = p_issue_id
     and issues.active_run_id = p_run_id
   for update;

  if not found then
    return query
      select false, issues.status
        from public.issues
       where issues.id = p_issue_id;
    return;
  end if;

  if exists (
    select 1
      from public.messages
     where messages.issue_id = p_issue_id
       and messages.role = 'user'
       and messages.consumed_by_run_id is null
  ) then
    return query select false, v_status;
    return;
  end if;

  update public.issues
     set status = p_status,
         run_finished_at = p_run_finished_at,
         active_run_id = null,
         active_host_id = null,
         updated_at = now()
   where id = p_issue_id;

  select *
    into v_aggregate
    from public.recompute_issue_status_from_pull_requests(p_issue_id);

  return query
    select true, coalesce(v_aggregate.next_status, p_status);
end;
$$;

create or replace function public.reset_issue_run(
  p_issue_id uuid,
  p_agent_provider text,
  p_issue_model text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_agent_provider not in ('claude_code', 'codex') then
    raise exception 'Invalid agent provider'
      using errcode = '22023';
  end if;

  if p_issue_model is not null and char_length(p_issue_model) not between 1 and 100 then
    raise exception 'Invalid issue model'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.issues where id = p_issue_id
  ) then
    raise exception 'Issue not found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.issues
     where id = p_issue_id
       and type = 'spec'
  ) then
    raise exception 'Spec issues do not run a coding agent'
      using errcode = '22023';
  end if;

  delete from public.messages
  where issue_id = p_issue_id;

  delete from public.issue_pull_requests
  where issue_id = p_issue_id;

  update public.issues
  set
    status = 'todo',
    agent_provider = p_agent_provider,
    issue_model = p_issue_model,
    session_id = null,
    active_run_id = null,
    active_host_id = null,
    run_error = null,
    run_started_at = null,
    run_finished_at = null,
    usage_limit_reset_at = null,
    updated_at = now()
  where id = p_issue_id;

  insert into public.messages(issue_id, role, author_type, content)
  values (
    p_issue_id,
    'user',
    'gentic',
    public.issue_kickoff_message(p_issue_id)
  );
end;
$$;

create or replace function public.deliver_review_fix_request(
  p_review_attempt_id uuid,
  p_content text,
  p_now timestamptz default now()
)
returns table (
  review_attempt_id uuid,
  issue_id uuid,
  outcome text,
  unavailable_reason text
)
language plpgsql
set search_path = ''
as $$
declare
  v_attempt public.review_attempts%rowtype;
  v_issue_id uuid;
  v_cycle public.review_cycles%rowtype;
  v_pr public.issue_pull_requests%rowtype;
  v_issue public.issues%rowtype;
  v_owner public.issue_implementation_owners%rowtype;
  v_owner_found boolean;
  v_host_banned boolean;
  v_message_id uuid;
begin
  select * into v_attempt
    from public.review_attempts
   where id = p_review_attempt_id;

  if not found then
    return query select p_review_attempt_id, null::uuid, 'not_found', null::text;
    return;
  end if;

  if v_attempt.verdict <> 'changes_requested' then
    return query select p_review_attempt_id, null::uuid, 'not_changes_requested', null::text;
    return;
  end if;

  -- Lock the Issue before the cycle, the same order every other
  -- review-lifecycle function uses, so this can never deadlock against
  -- `evaluate_review_eligibility` / `supersede_active_review_cycle` racing
  -- on the same pull request (e.g. a genuine human changes-requested review
  -- landing at the same moment).
  select review_cycles.issue_id into v_issue_id
    from public.review_cycles
   where id = v_attempt.review_cycle_id;

  perform 1 from public.issues where id = v_issue_id for update;

  select * into v_cycle
    from public.review_cycles
   where id = v_attempt.review_cycle_id
   for update;

  select * into v_issue from public.issues where id = v_issue_id;
  select * into v_pr from public.issue_pull_requests where id = v_cycle.pull_request_id;

  if exists (
    select 1 from public.messages
     where messages.issue_id = v_issue_id
       and messages.review_attempt_id = p_review_attempt_id
  ) then
    return query select p_review_attempt_id, v_issue_id, 'already_delivered', null::text;
    return;
  end if;

  -- Not active means either exhausted (third changes-requested attempt —
  -- automatic looping stops and requires human action) or superseded (a new
  -- push, or a genuine human review, already took over this cycle).
  if v_cycle.state <> 'active' then
    return query select p_review_attempt_id, v_issue_id, 'cycle_not_active', null::text;
    return;
  end if;

  -- The pull request moved past the exact commit these findings were
  -- produced against — a push landed between this Review Attempt completing
  -- and delivery. Stale findings are never applied to a newer head.
  if v_pr.head_sha is distinct from v_cycle.head_sha then
    return query select p_review_attempt_id, v_issue_id, 'stale_head', null::text;
    return;
  end if;

  select * into v_owner
    from public.issue_implementation_owners
   where issue_implementation_owners.issue_id = v_issue_id
     and superseded_at is null;
  v_owner_found := found;

  if not v_owner_found then
    return query select p_review_attempt_id, v_issue_id, 'no_owner', null::text;
    return;
  end if;

  -- Mirrors `deriveAvailability` in
  -- `packages/services/src/issues/implementation-owner.ts` — kept in sync
  -- deliberately, since both derive resumability from the same live
  -- host/issue state rather than a stored flag.
  if v_owner.agent_provider <> v_issue.agent_provider
     or coalesce(v_owner.issue_model, '') <> coalesce(v_issue.issue_model, '') then
    return query select p_review_attempt_id, v_issue_id, 'owner_unavailable', 'provider_changed';
    return;
  end if;

  if v_owner.session_id is null then
    return query select p_review_attempt_id, v_issue_id, 'owner_unavailable', 'session_missing';
    return;
  end if;

  if v_owner.host_id is null then
    return query select p_review_attempt_id, v_issue_id, 'owner_unavailable', 'host_deleted';
    return;
  end if;

  select (banned_at is not null) into v_host_banned
    from public.hosts
   where id = v_owner.host_id;

  if coalesce(v_host_banned, false) then
    return query select p_review_attempt_id, v_issue_id, 'owner_unavailable', 'host_banned';
    return;
  end if;

  insert into public.messages (issue_id, role, author_type, content, review_attempt_id)
  values (v_issue_id, 'user', 'gentic', p_content, p_review_attempt_id)
  returning id into v_message_id;

  update public.issues
     set status = 'todo',
         usage_limit_reset_at = null,
         updated_at = p_now
   where id = v_issue_id
     and status = 'changes-requested';

  insert into public.issue_events (issue_id, type, payload)
  values (
    v_issue_id,
    'review_fix_delivered',
    jsonb_build_object(
      'review_attempt_id', p_review_attempt_id,
      'message_id', v_message_id
    )
  );

  return query select p_review_attempt_id, v_issue_id, 'delivered', null::text;
end;
$$;

create or replace function public.reconcile_offline_review_runs(
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_run record;
  v_reconciled_count integer := 0;
begin
  for v_run in
    select rr.id
      from public.review_runs rr
      join public.hosts w on w.id = rr.claimed_by_host_id
     where rr.status = 'running'
       and w.banned_at is null
       and (
         coalesce(w.last_seen_at, w.offline_since_at) <= p_now - interval '5 minutes'
         or coalesce(rr.heartbeat_at, rr.started_at) <= p_now - interval '5 minutes'
       )
     for update of rr skip locked
  loop
    perform public.fail_review_run(v_run.id, 'Assigned host went offline', p_now);
    v_reconciled_count := v_reconciled_count + 1;
  end loop;

  return v_reconciled_count;
end;
$$;

create trigger ensure_issue_active_host_owner
  before insert or update of project_id, active_host_id
  on public.issues
  for each row
  execute function public.ensure_issue_active_host_owner();

revoke execute on function public.requeue_host_active_issues(uuid, timestamptz)
  from public, authenticated;
revoke execute on function public.rename_host(text, uuid, text, timestamptz)
  from public, authenticated;
revoke execute on function public.ban_host(text, uuid, timestamptz)
  from public, authenticated;
revoke execute on function public.unban_host(text, uuid, timestamptz)
  from public, authenticated;
revoke execute on function public.delete_host(text, uuid, timestamptz)
  from public, authenticated;
revoke all on function public.requeue_host_active_review_runs(uuid, timestamptz)
  from public, authenticated;
revoke all on function public.claim_review_run(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.reconcile_offline_host_runs(timestamptz)
  from public;
revoke execute on function public.record_host_enrollment_exchange_failure(
  text,
  timestamptz,
  integer,
  integer
) from public, authenticated;
revoke execute on function public.consume_host_enrollment_code(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  jsonb,
  timestamptz,
  timestamptz
) from public, authenticated;

grant execute on function public.rename_host(text, uuid, text, timestamptz)
  to service_role;
grant execute on function public.ban_host(text, uuid, timestamptz)
  to service_role;
grant execute on function public.unban_host(text, uuid, timestamptz)
  to service_role;
grant execute on function public.delete_host(text, uuid, timestamptz)
  to service_role;
grant execute on function public.requeue_host_active_review_runs(uuid, timestamptz)
  to service_role;
grant execute on function public.claim_review_run(uuid, text, timestamptz)
  to service_role;
grant execute on function public.record_host_enrollment_exchange_failure(
  text,
  timestamptz,
  integer,
  integer
) to service_role;
grant execute on function public.consume_host_enrollment_code(
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  jsonb,
  timestamptz,
  timestamptz
) to service_role;

-- A stable name makes this migration safe to replay: Supabase Cron upserts an
-- existing job with the same case-sensitive name.
select cron.schedule(
  'reconcile-offline-host-runs',
  '30 seconds',
  $job$select public.reconcile_offline_host_runs();$job$
);
