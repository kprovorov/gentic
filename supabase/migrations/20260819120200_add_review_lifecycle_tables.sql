-- Automatic Code Review lifecycle: cycles, runs, attempts, and findings.
--
-- The durable graph is:
--   review_cycles   one per (pull request, head SHA); terminal when approved,
--                   exhausted (three attempts), or superseded (new head SHA or a
--                   human review taking over).
--   review_runs     one per infrastructure execution try. Runs may fail for
--                   infra reasons without consuming the attempt budget.
--   review_attempts one per *completed* automatic review a run produced. Capped
--                   at three per cycle. Carries the GitHub review publication id.
--   review_findings structured findings for an attempt, each pinned to the exact
--                   head SHA that was reviewed.

create table public.review_cycles (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  pull_request_id uuid not null
    references public.issue_pull_requests(id) on delete cascade,
  head_sha text not null,
  state text not null default 'active',
  superseded_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_cycles_head_sha_not_blank check (length(trim(head_sha)) > 0),
  constraint review_cycles_state_valid check (
    state in ('active', 'approved', 'exhausted', 'superseded')
  ),
  -- A supersession always records why; every other state never does. Human
  -- review is one such reason, alongside a newer head SHA replacing the cycle.
  constraint review_cycles_superseded_reason_valid check (
    (state = 'superseded') = (superseded_reason is not null)
    and (
      superseded_reason is null
      or superseded_reason in ('new_head_sha', 'human_review')
    )
  )
);

-- At most one active cycle per pull request / head SHA.
create unique index review_cycles_active_unique
  on public.review_cycles(pull_request_id, head_sha)
  where state = 'active';

create index review_cycles_issue_id_idx
  on public.review_cycles(issue_id);
create index review_cycles_pull_request_id_idx
  on public.review_cycles(pull_request_id);

create table public.review_runs (
  id uuid primary key default gen_random_uuid(),
  review_cycle_id uuid not null
    references public.review_cycles(id) on delete cascade,
  status text not null default 'pending',
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint review_runs_status_valid check (
    status in ('pending', 'running', 'completed', 'failed', 'cancelled')
  )
);

create index review_runs_review_cycle_id_idx
  on public.review_runs(review_cycle_id);

-- Only runs that hold the pull request live (pending/running) are "active".
create index review_runs_active_idx
  on public.review_runs(review_cycle_id)
  where status in ('pending', 'running');

create table public.review_attempts (
  id uuid primary key default gen_random_uuid(),
  review_cycle_id uuid not null
    references public.review_cycles(id) on delete cascade,
  review_run_id uuid not null
    references public.review_runs(id) on delete cascade,
  attempt_number smallint not null,
  verdict text not null,
  summary text,
  github_review_id bigint,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  -- Three completed attempts per cycle, enforced purely by constraints: the
  -- range bounds each number and the unique index forbids reusing one.
  constraint review_attempts_attempt_number_range check (
    attempt_number between 1 and 3
  ),
  constraint review_attempts_verdict_valid check (
    verdict in ('approved', 'changes_requested', 'commented')
  ),
  constraint review_attempts_cycle_number_unique
    unique (review_cycle_id, attempt_number),
  constraint review_attempts_run_unique unique (review_run_id),
  constraint review_attempts_github_review_id_unique unique (github_review_id)
);

create index review_attempts_review_cycle_id_idx
  on public.review_attempts(review_cycle_id);

create table public.review_findings (
  id uuid primary key default gen_random_uuid(),
  review_attempt_id uuid not null
    references public.review_attempts(id) on delete cascade,
  head_sha text not null,
  severity text not null default 'info',
  file_path text,
  line integer,
  title text not null,
  body text,
  github_comment_id bigint,
  created_at timestamptz not null default now(),
  constraint review_findings_head_sha_not_blank check (length(trim(head_sha)) > 0),
  constraint review_findings_title_not_blank check (length(trim(title)) > 0),
  constraint review_findings_severity_valid check (
    severity in ('info', 'warning', 'error', 'blocker')
  ),
  constraint review_findings_line_positive check (line is null or line > 0),
  constraint review_findings_github_comment_id_unique unique (github_comment_id)
);

create index review_findings_review_attempt_id_idx
  on public.review_findings(review_attempt_id);

-- A cycle must belong to the same Issue as its pull request; this rejects
-- cross-Issue associations.
create or replace function public.ensure_review_cycle_pull_request_matches_issue()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pull_request_issue_id uuid;
begin
  select issue_id
    into v_pull_request_issue_id
    from public.issue_pull_requests
   where id = new.pull_request_id;

  if v_pull_request_issue_id is null
     or v_pull_request_issue_id is distinct from new.issue_id then
    raise exception 'Review cycle pull request must belong to the same issue'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger ensure_review_cycle_pull_request_matches_issue
  before insert or update of issue_id, pull_request_id
  on public.review_cycles
  for each row
  execute function public.ensure_review_cycle_pull_request_matches_issue();

-- Draft pull requests cannot hold an active review run.
create or replace function public.ensure_review_run_pull_request_not_draft()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pull_request_state text;
begin
  if new.status in ('pending', 'running') then
    select ipr.state
      into v_pull_request_state
      from public.review_cycles as rc
      join public.issue_pull_requests as ipr on ipr.id = rc.pull_request_id
     where rc.id = new.review_cycle_id;

    if v_pull_request_state = 'draft' then
      raise exception 'Draft pull requests cannot have an active review run'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger ensure_review_run_pull_request_not_draft
  before insert or update of status, review_cycle_id
  on public.review_runs
  for each row
  execute function public.ensure_review_run_pull_request_not_draft();

-- An attempt's cycle must match the cycle of the run that produced it.
create or replace function public.ensure_review_attempt_cycle_matches_run()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_run_cycle_id uuid;
begin
  select review_cycle_id
    into v_run_cycle_id
    from public.review_runs
   where id = new.review_run_id;

  if v_run_cycle_id is null
     or v_run_cycle_id is distinct from new.review_cycle_id then
    raise exception 'Review attempt cycle must match its run cycle'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger ensure_review_attempt_cycle_matches_run
  before insert or update of review_cycle_id, review_run_id
  on public.review_attempts
  for each row
  execute function public.ensure_review_attempt_cycle_matches_run();

-- A finding belongs to one attempt and one exact head SHA: the head SHA of the
-- attempt's cycle.
create or replace function public.ensure_review_finding_head_sha()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cycle_head_sha text;
begin
  select rc.head_sha
    into v_cycle_head_sha
    from public.review_attempts as ra
    join public.review_cycles as rc on rc.id = ra.review_cycle_id
   where ra.id = new.review_attempt_id;

  if v_cycle_head_sha is null
     or v_cycle_head_sha is distinct from new.head_sha then
    raise exception 'Review finding head SHA must match its attempt cycle head SHA'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger ensure_review_finding_head_sha
  before insert or update of review_attempt_id, head_sha
  on public.review_findings
  for each row
  execute function public.ensure_review_finding_head_sha();

alter table public.review_cycles enable row level security;
alter table public.review_runs enable row level security;
alter table public.review_attempts enable row level security;
alter table public.review_findings enable row level security;

grant select on public.review_cycles to authenticated;
grant select on public.review_runs to authenticated;
grant select on public.review_attempts to authenticated;
grant select on public.review_findings to authenticated;

grant select, insert, update, delete on public.review_cycles to service_role;
grant select, insert, update, delete on public.review_runs to service_role;
grant select, insert, update, delete on public.review_attempts to service_role;
grant select, insert, update, delete on public.review_findings to service_role;

create policy "Users can read review cycles for their own issues"
  on public.review_cycles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.issues
      join public.projects on projects.id = issues.project_id
      where issues.id = review_cycles.issue_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can read review runs for their own issues"
  on public.review_runs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.review_cycles
      join public.issues on issues.id = review_cycles.issue_id
      join public.projects on projects.id = issues.project_id
      where review_cycles.id = review_runs.review_cycle_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can read review attempts for their own issues"
  on public.review_attempts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.review_cycles
      join public.issues on issues.id = review_cycles.issue_id
      join public.projects on projects.id = issues.project_id
      where review_cycles.id = review_attempts.review_cycle_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can read review findings for their own issues"
  on public.review_findings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.review_attempts
      join public.review_cycles on review_cycles.id = review_attempts.review_cycle_id
      join public.issues on issues.id = review_cycles.issue_id
      join public.projects on projects.id = issues.project_id
      where review_attempts.id = review_findings.review_attempt_id
        and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

alter table public.review_cycles replica identity full;
alter table public.review_runs replica identity full;
alter table public.review_attempts replica identity full;
alter table public.review_findings replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'review_cycles'
  ) then
    alter publication supabase_realtime add table public.review_cycles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'review_runs'
  ) then
    alter publication supabase_realtime add table public.review_runs;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'review_attempts'
  ) then
    alter publication supabase_realtime add table public.review_attempts;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'review_findings'
  ) then
    alter publication supabase_realtime add table public.review_findings;
  end if;
end $$;

revoke all on function public.ensure_review_cycle_pull_request_matches_issue()
  from public;
revoke all on function public.ensure_review_run_pull_request_not_draft()
  from public;
revoke all on function public.ensure_review_attempt_cycle_matches_run()
  from public;
revoke all on function public.ensure_review_finding_head_sha()
  from public;

grant execute on function public.ensure_review_cycle_pull_request_matches_issue()
  to service_role;
grant execute on function public.ensure_review_run_pull_request_not_draft()
  to service_role;
grant execute on function public.ensure_review_attempt_cycle_matches_run()
  to service_role;
grant execute on function public.ensure_review_finding_head_sha()
  to service_role;
