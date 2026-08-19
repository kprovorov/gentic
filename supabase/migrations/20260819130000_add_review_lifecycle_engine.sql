-- The Automatic Review lifecycle engine (GEN-413, see ADR-0004). Everything
-- here is trusted, service-role-only orchestration: it turns PR/CI/reviewer/
-- human-review events into deterministic review_cycles/runs/attempts
-- transitions. It never calls GitHub and never dispatches a reviewer agent —
-- those are out of scope, left to future work that calls into this engine's
-- completion/failure entry points.

-- Each run remembers the head SHA it reviewed, so infra-failure retry
-- budgets (below) reset when new code arrives instead of inheriting
-- failures from a superseded head SHA.
alter table public.review_runs
  add column head_sha text;

update public.review_runs rr
   set head_sha = rc.head_sha
  from public.review_cycles rc
 where rc.id = rr.review_cycle_id
   and rr.head_sha is null;

alter table public.review_runs
  alter column head_sha set not null,
  add constraint review_runs_head_sha_not_blank
    check (length(trim(head_sha)) > 0);

-- Defense in depth alongside the engine's own row-locking: the DB itself
-- never allows two live runs on one cycle. Replaces the plain (non-unique)
-- index from the original review-lifecycle-tables migration, which served
-- the same lookup but did not enforce this.
drop index if exists public.review_runs_active_idx;

create unique index review_runs_active_unique
  on public.review_runs(review_cycle_id)
  where status in ('pending', 'running');

-- Shared guard for every Issue status transition the engine drives. Mirrors
-- the protections `recompute_issue_status_from_pull_requests` already
-- applies: a live implementation run or a terminal status is never
-- clobbered by review-lifecycle bookkeeping.
create or replace function public.set_issue_status_from_review(
  p_issue_id uuid,
  p_status text,
  p_now timestamptz default now(),
  p_reason text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_active_run_id uuid;
begin
  select status, active_run_id
    into v_status, v_active_run_id
    from public.issues
   where id = p_issue_id
   for update;

  if not found
     or v_status = p_status
     or v_active_run_id is not null
     or v_status in ('completed', 'cancelled') then
    return;
  end if;

  update public.issues
     set status = p_status,
         updated_at = p_now
   where id = p_issue_id;

  insert into public.issue_events (issue_id, type, payload)
  values (
    p_issue_id,
    'status_changed',
    case
      when p_reason is null then jsonb_build_object('from', v_status, 'to', p_status)
      else jsonb_build_object('from', v_status, 'to', p_status, 'reason', p_reason)
    end
  );
end;
$$;

-- Cancels any live (pending/running) run and marks the pull request's
-- current active cycle superseded. Used directly for a genuine human
-- changes-requested review, and reused by `evaluate_review_eligibility` when
-- a push lands mid-flight and makes the in-progress run's verdict moot.
create or replace function public.supersede_active_review_cycle(
  p_pr_url text,
  p_reason text,
  p_now timestamptz default now()
)
returns table (
  review_cycle_id uuid,
  superseded boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_issue_id uuid;
  v_pull_request_id uuid;
  v_cycle public.review_cycles%rowtype;
begin
  if p_reason not in ('new_head_sha', 'human_review') then
    raise exception 'Invalid supersede reason: %', p_reason
      using errcode = '22023';
  end if;

  select ipr.issue_id, ipr.id
    into v_issue_id, v_pull_request_id
    from public.issue_pull_requests ipr
   where ipr.url = p_pr_url;

  if v_issue_id is null then
    return;
  end if;

  perform 1 from public.issues where id = v_issue_id for update;
  if not found then
    return;
  end if;

  select *
    into v_cycle
    from public.review_cycles
   where pull_request_id = v_pull_request_id
     and state = 'active'
   for update;

  if not found then
    return query select null::uuid, false;
    return;
  end if;

  update public.review_runs
     set status = 'cancelled',
         finished_at = p_now,
         updated_at = p_now
   where review_runs.review_cycle_id = v_cycle.id
     and review_runs.status in ('pending', 'running');

  update public.review_cycles
     set state = 'superseded',
         superseded_reason = p_reason,
         updated_at = p_now
   where id = v_cycle.id;

  if p_reason = 'human_review' then
    perform public.set_issue_status_from_review(
      v_issue_id, 'changes-requested', p_now, 'human_review'
    );
  end if;

  return query select v_cycle.id, true;
end;
$$;

-- The main entry point: re-evaluate whether a pull request should have a
-- live automatic Review Attempt in flight, and if so, queue one. Called for
-- every pull_request event (opened, synchronize, ready_for_review,
-- reopened, converted_to_draft) and every completed/pending CI event.
-- Locks the Issue first (same order every other PR-state function uses),
-- so concurrent or reordered deliveries for the same PR serialize instead
-- of racing.
create or replace function public.evaluate_review_eligibility(
  p_pr_url text,
  p_now timestamptz default now()
)
returns table (
  issue_id uuid,
  pull_request_id uuid,
  eligible boolean,
  review_cycle_id uuid,
  review_run_id uuid,
  action text
)
language plpgsql
set search_path = ''
as $$
declare
  v_issue_id uuid;
  v_pr public.issue_pull_requests%rowtype;
  v_policy public.issue_review_policies%rowtype;
  v_policy_found boolean;
  v_eligible boolean;
  v_latest_cycle public.review_cycles%rowtype;
  v_cycle_found boolean;
  v_has_live_run boolean;
  v_completed_attempts integer;
  v_trailing_failures integer;
  v_new_cycle_id uuid;
  v_new_run_id uuid;
begin
  select ipr.issue_id
    into v_issue_id
    from public.issue_pull_requests ipr
   where ipr.url = p_pr_url;

  if v_issue_id is null then
    return;
  end if;

  perform 1 from public.issues where id = v_issue_id for update;
  if not found then
    return;
  end if;

  select *
    into v_pr
    from public.issue_pull_requests ipr
   where ipr.url = p_pr_url
   for update;

  select *
    into v_policy
    from public.issue_review_policies irp
   where irp.issue_id = v_issue_id;
  v_policy_found := found;

  if not v_policy_found or not v_policy.enabled then
    return query
      select v_issue_id, v_pr.id, false, null::uuid, null::uuid, 'policy_disabled';
    return;
  end if;

  v_eligible := v_pr.state in ('open', 'queued')
    and v_pr.ci_state = 'success'
    and v_pr.head_sha is not null;

  select *
    into v_latest_cycle
    from public.review_cycles rc
   where rc.pull_request_id = v_pr.id
   order by rc.created_at desc
   limit 1
   for update;
  v_cycle_found := found;

  if not v_eligible then
    if v_cycle_found and v_latest_cycle.state = 'active' then
      update public.review_runs
         set status = 'cancelled',
             finished_at = p_now,
             updated_at = p_now
       where review_runs.review_cycle_id = v_latest_cycle.id
         and review_runs.status in ('pending', 'running');

      return query
        select v_issue_id, v_pr.id, false, v_latest_cycle.id, null::uuid, 'paused';
      return;
    end if;

    return query
      select v_issue_id, v_pr.id, false, null::uuid, null::uuid, 'noop';
    return;
  end if;

  -- No cycle yet, or the latest one already concluded.
  if not v_cycle_found or v_latest_cycle.state <> 'active' then
    if v_cycle_found and v_latest_cycle.head_sha = v_pr.head_sha then
      -- Already terminal for this exact commit: a stale success replay or a
      -- repeat delivery must not reopen a concluded cycle.
      return query
        select v_issue_id, v_pr.id, true, v_latest_cycle.id, null::uuid, 'noop';
      return;
    end if;

    insert into public.review_cycles (issue_id, pull_request_id, head_sha)
    values (v_issue_id, v_pr.id, v_pr.head_sha)
    returning id into v_new_cycle_id;

    insert into public.review_runs (review_cycle_id, status, head_sha)
    values (v_new_cycle_id, 'pending', v_pr.head_sha)
    returning id into v_new_run_id;

    perform public.set_issue_status_from_review(v_issue_id, 'reviewing', p_now);

    return query
      select v_issue_id, v_pr.id, true, v_new_cycle_id, v_new_run_id, 'queued';
    return;
  end if;

  -- The latest cycle is active.
  select exists (
    select 1 from public.review_runs rr
     where rr.review_cycle_id = v_latest_cycle.id
       and rr.status in ('pending', 'running')
  ) into v_has_live_run;

  select count(*)
    into v_completed_attempts
    from public.review_attempts ra
   where ra.review_cycle_id = v_latest_cycle.id;

  if v_latest_cycle.head_sha = v_pr.head_sha then
    -- Two trailing infra failures at this exact head SHA means the retry
    -- budget from `fail_review_run` is spent: automatic progression must stay
    -- stopped until new code arrives, even if eligibility gets re-evaluated
    -- again by an unrelated later webhook (e.g. a duplicate CI event).
    select count(*)
      into v_trailing_failures
      from public.review_runs rr
     where rr.review_cycle_id = v_latest_cycle.id
       and rr.head_sha = v_latest_cycle.head_sha
       and rr.status = 'failed';

    if v_has_live_run or v_completed_attempts >= 3 or v_trailing_failures >= 2 then
      return query
        select v_issue_id, v_pr.id, true, v_latest_cycle.id, null::uuid, 'noop';
      return;
    end if;

    insert into public.review_runs (review_cycle_id, status, head_sha)
    values (v_latest_cycle.id, 'pending', v_pr.head_sha)
    returning id into v_new_run_id;

    perform public.set_issue_status_from_review(v_issue_id, 'reviewing', p_now);

    return query
      select v_issue_id, v_pr.id, true, v_latest_cycle.id, v_new_run_id, 'continued';
    return;
  end if;

  -- A new head SHA has landed while the cycle is still active.
  if v_has_live_run or v_completed_attempts >= 3 then
    -- Either the in-flight run's verdict is now moot, or the cycle should
    -- already have exhausted at its third attempt and didn't (safety net).
    -- Either way, this push starts a fresh cycle with a full budget.
    perform public.supersede_active_review_cycle(p_pr_url, 'new_head_sha', p_now);

    insert into public.review_cycles (issue_id, pull_request_id, head_sha)
    values (v_issue_id, v_pr.id, v_pr.head_sha)
    returning id into v_new_cycle_id;

    insert into public.review_runs (review_cycle_id, status, head_sha)
    values (v_new_cycle_id, 'pending', v_pr.head_sha)
    returning id into v_new_run_id;

    perform public.set_issue_status_from_review(v_issue_id, 'reviewing', p_now);

    return query
      select v_issue_id, v_pr.id, true, v_new_cycle_id, v_new_run_id, 'superseded_and_queued';
    return;
  end if;

  -- Idle between attempts: the cycle carries its budget across the fix.
  update public.review_cycles
     set head_sha = v_pr.head_sha,
         updated_at = p_now
   where id = v_latest_cycle.id;

  insert into public.review_runs (review_cycle_id, status, head_sha)
  values (v_latest_cycle.id, 'pending', v_pr.head_sha)
  returning id into v_new_run_id;

  perform public.set_issue_status_from_review(v_issue_id, 'reviewing', p_now);

  return query
    select v_issue_id, v_pr.id, true, v_latest_cycle.id, v_new_run_id, 'continued';
end;
$$;

-- Records a completed reviewer verdict. Only reviewer *completion* consumes
-- an attempt — infra failures go through `fail_review_run` instead. Replaying
-- the same run id is idempotent: a run already `completed` returns its
-- existing attempt rather than creating a second one.
create or replace function public.complete_review_attempt(
  p_review_run_id uuid,
  p_verdict text,
  p_summary text default null,
  p_github_review_id bigint default null,
  p_findings jsonb default '[]'::jsonb,
  p_now timestamptz default now()
)
returns table (
  review_attempt_id uuid,
  review_cycle_id uuid,
  issue_id uuid,
  attempt_number smallint,
  cycle_state text,
  accepted boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_run public.review_runs%rowtype;
  v_cycle public.review_cycles%rowtype;
  v_attempt_number smallint;
  v_attempt_id uuid;
  v_finding jsonb;
  v_next_status text;
begin
  if p_verdict not in ('approved', 'changes_requested', 'commented') then
    raise exception 'Invalid review verdict: %', p_verdict
      using errcode = '22023';
  end if;

  select *
    into v_run
    from public.review_runs
   where id = p_review_run_id
   for update;

  if not found then
    return;
  end if;

  if v_run.status = 'completed' then
    return query
      select ra.id, ra.review_cycle_id, rc.issue_id, ra.attempt_number,
        rc.state, true
        from public.review_attempts ra
        join public.review_cycles rc on rc.id = ra.review_cycle_id
       where ra.review_run_id = p_review_run_id;
    return;
  end if;

  if v_run.status not in ('pending', 'running') then
    -- Cancelled or failed: this run's verdict is stale (e.g. superseded
    -- mid-flight by a newer push) and must not be published.
    return query
      select null::uuid, v_run.review_cycle_id, null::uuid, null::smallint,
        null::text, false;
    return;
  end if;

  select *
    into v_cycle
    from public.review_cycles
   where id = v_run.review_cycle_id
   for update;

  if v_cycle.state <> 'active' then
    update public.review_runs
       set status = 'cancelled',
           finished_at = p_now,
           updated_at = p_now
     where id = p_review_run_id;

    return query
      select null::uuid, v_cycle.id, v_cycle.issue_id, null::smallint,
        v_cycle.state, false;
    return;
  end if;

  select count(*) + 1
    into v_attempt_number
    from public.review_attempts ra
   where ra.review_cycle_id = v_cycle.id;

  if v_attempt_number > 3 then
    update public.review_runs
       set status = 'cancelled',
           finished_at = p_now,
           updated_at = p_now
     where id = p_review_run_id;

    return query
      select null::uuid, v_cycle.id, v_cycle.issue_id, null::smallint,
        v_cycle.state, false;
    return;
  end if;

  insert into public.review_attempts (
    review_cycle_id, review_run_id, attempt_number, verdict, summary,
    github_review_id, published_at
  ) values (
    v_cycle.id, p_review_run_id, v_attempt_number, p_verdict, p_summary,
    p_github_review_id,
    case when p_github_review_id is not null then p_now else null end
  )
  returning id into v_attempt_id;

  for v_finding in select * from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb))
  loop
    insert into public.review_findings (
      review_attempt_id, head_sha, severity, file_path, line, title, body,
      github_comment_id
    ) values (
      v_attempt_id,
      v_cycle.head_sha,
      coalesce(v_finding->>'severity', 'info'),
      v_finding->>'file_path',
      nullif(v_finding->>'line', '')::integer,
      v_finding->>'title',
      v_finding->>'body',
      nullif(v_finding->>'github_comment_id', '')::bigint
    );
  end loop;

  update public.review_runs
     set status = 'completed',
         finished_at = p_now,
         updated_at = p_now
   where id = p_review_run_id;

  if p_verdict = 'approved' then
    update public.review_cycles
       set state = 'approved',
           updated_at = p_now
     where id = v_cycle.id;
    v_next_status := 'approved';
  elsif p_verdict = 'changes_requested' then
    if v_attempt_number >= 3 then
      update public.review_cycles
         set state = 'exhausted',
             updated_at = p_now
       where id = v_cycle.id;
    end if;
    v_next_status := 'changes-requested';
  else
    -- 'commented': non-blocking feedback. Still consumes an attempt and can
    -- still exhaust the cycle, but nothing is required of the Issue, so it
    -- is left ready for review rather than forced to changes-requested.
    if v_attempt_number >= 3 then
      update public.review_cycles
         set state = 'exhausted',
             updated_at = p_now
       where id = v_cycle.id;
    end if;
    v_next_status := 'ready-for-review';
  end if;

  perform public.set_issue_status_from_review(v_cycle.issue_id, v_next_status, p_now);

  return query
    select v_attempt_id, v_cycle.id, v_cycle.issue_id, v_attempt_number,
      (select state from public.review_cycles where id = v_cycle.id), true;
end;
$$;

-- Records a reviewer infrastructure failure (never a verdict, never
-- consumes an attempt). Retries once automatically; if the retry also
-- fails at the same head SHA, automatic progression stops and the cycle is
-- left `active` with no live run — a recovery state callers derive from run
-- history rather than a stored flag (see ADR-0004 / ADR-0003).
create or replace function public.fail_review_run(
  p_review_run_id uuid,
  p_error text,
  p_now timestamptz default now()
)
returns table (
  review_run_id uuid,
  review_cycle_id uuid,
  retried boolean,
  next_review_run_id uuid,
  accepted boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_run public.review_runs%rowtype;
  v_cycle public.review_cycles%rowtype;
  v_trailing_failures integer;
  v_next_run_id uuid;
begin
  select *
    into v_run
    from public.review_runs
   where id = p_review_run_id
   for update;

  if not found or v_run.status not in ('pending', 'running') then
    return query
      select p_review_run_id, v_run.review_cycle_id, false, null::uuid, false;
    return;
  end if;

  select *
    into v_cycle
    from public.review_cycles
   where id = v_run.review_cycle_id
   for update;

  update public.review_runs
     set status = 'failed',
         error = p_error,
         finished_at = p_now,
         updated_at = p_now
   where id = p_review_run_id;

  if v_cycle.state <> 'active' then
    return query select p_review_run_id, v_cycle.id, false, null::uuid, true;
    return;
  end if;

  select count(*)
    into v_trailing_failures
    from public.review_runs rr
   where rr.review_cycle_id = v_cycle.id
     and rr.head_sha = v_cycle.head_sha
     and rr.status = 'failed';

  if v_trailing_failures < 2 then
    insert into public.review_runs (review_cycle_id, status, head_sha)
    values (v_cycle.id, 'pending', v_cycle.head_sha)
    returning id into v_next_run_id;

    return query
      select p_review_run_id, v_cycle.id, true, v_next_run_id, true;
    return;
  end if;

  return query select p_review_run_id, v_cycle.id, false, null::uuid, true;
end;
$$;

-- Explicit user override: accept the pull request's human review as
-- sufficient without a further automatic verdict. This is the *only* other
-- way (besides an automatic `approved` verdict) a cycle can reach
-- `state = 'approved'` — a bare human GitHub approval alone never does.
create or replace function public.continue_with_human_review(
  p_user_id text,
  p_issue_id uuid,
  p_now timestamptz default now()
)
returns table (
  review_cycle_id uuid,
  issue_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pr record;
  v_cycle review_cycles%rowtype;
begin
  perform 1
    from issues i
    join projects p on p.id = i.project_id
   where i.id = p_issue_id
     and p.user_id = p_user_id
   for update of i;

  if not found then
    raise exception 'Issue not found' using errcode = 'P0002';
  end if;

  select ipr.id, ipr.head_sha
    into v_pr
    from issue_pull_requests ipr
   where ipr.issue_id = p_issue_id
     and ipr.state in ('open', 'queued')
   order by ipr.created_at desc
   limit 1;

  if not found then
    raise exception 'Issue has no open pull request to approve'
      using errcode = '23514';
  end if;

  select *
    into v_cycle
    from review_cycles
   where pull_request_id = v_pr.id
     and state = 'active'
   for update;

  if not found then
    raise exception 'No active automatic review cycle to continue'
      using errcode = '23514';
  end if;

  if v_cycle.head_sha is distinct from v_pr.head_sha then
    raise exception 'Pull request has new commits since the last review cycle'
      using errcode = '23514';
  end if;

  update review_cycles
     set state = 'approved',
         updated_at = p_now
   where id = v_cycle.id;

  perform set_issue_status_from_review(
    p_issue_id, 'approved', p_now, 'continue_with_human_review'
  );

  return query select v_cycle.id, p_issue_id, 'approved'::text;
end;
$$;

-- Additive gate on the existing PR/Issue status aggregator: when Automatic
-- Review is enabled for the Issue, a plain GitHub review_decision of
-- 'approved' is no longer sufficient on its own — every reviewable PR must
-- also have its latest review cycle in `state = 'approved'` (an automatic
-- verdict or an explicit `continue_with_human_review`). Every other branch
-- is unchanged, so Issues without Automatic Review enabled (the default)
-- keep their exact prior behavior.
create or replace function public.recompute_issue_status_from_pull_requests(
  p_issue_id uuid
)
returns table (
  issue_id uuid,
  previous_status text,
  next_status text,
  status_changed boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_active_run_id uuid;
  v_previous_status text;
  v_next_status text;
  v_reviewable_count integer;
  v_participating_count integer;
  v_unknown_count integer;
  v_merged_count integer;
  v_automatic_review_enabled boolean;
begin
  select active_run_id, status
    into v_active_run_id, v_previous_status
    from public.issues
   where id = p_issue_id
   for update;

  if not found then
    raise exception 'Issue not found: %', p_issue_id;
  end if;

  -- Webhooks may persist PR state during a run, but must not revoke its lease
  -- by moving the Issue out of queued/in-progress. Completed and cancelled are
  -- explicit terminal decisions and are likewise protected.
  if v_active_run_id is not null
     or v_previous_status in ('completed', 'cancelled') then
    return query select p_issue_id, v_previous_status, v_previous_status, false;
    return;
  end if;

  select irp.enabled
    into v_automatic_review_enabled
    from public.issue_review_policies irp
   where irp.issue_id = p_issue_id;

  select
    count(*) filter (where state in ('open', 'queued')),
    count(*) filter (where state in ('open', 'queued', 'merged', 'closed')),
    count(*) filter (where state = 'unknown'),
    count(*) filter (where state = 'merged')
    into
      v_reviewable_count,
      v_participating_count,
      v_unknown_count,
      v_merged_count
    from public.issue_pull_requests as ipr
   where ipr.issue_id = p_issue_id;

  if v_reviewable_count > 0 then
    if exists (
      select 1 from public.issue_pull_requests as ipr
       where ipr.issue_id = p_issue_id
         and ipr.state in ('open', 'queued')
         and ipr.review_decision = 'changes_requested'
    ) then
      v_next_status := 'changes-requested';
    elsif exists (
      select 1 from public.issue_pull_requests as ipr
       where ipr.issue_id = p_issue_id
         and ipr.state in ('open', 'queued')
         and ipr.ci_state = 'failure'
    ) then
      v_next_status := 'tests-failed';
    elsif exists (
      select 1 from public.issue_pull_requests as ipr
       where ipr.issue_id = p_issue_id
         and ipr.state in ('open', 'queued')
         and ipr.ci_state = 'pending'
    ) then
      v_next_status := 'testing';
    elsif not exists (
      select 1 from public.issue_pull_requests as ipr
       where ipr.issue_id = p_issue_id
         and ipr.state in ('open', 'queued')
         and ipr.review_decision <> 'approved'
    )
    and (
      coalesce(v_automatic_review_enabled, false) = false
      or not exists (
        -- The PR's *latest* cycle must be the one that approved, not merely
        -- some cycle in its history — otherwise a post-approval push that
        -- opened a fresh (not yet approved) cycle would be masked by the
        -- earlier approval.
        select 1 from public.issue_pull_requests as ipr
         where ipr.issue_id = p_issue_id
           and ipr.state in ('open', 'queued')
           and coalesce(
             (
               select rc.state = 'approved'
                 from public.review_cycles as rc
                where rc.pull_request_id = ipr.id
                order by rc.created_at desc
                limit 1
             ),
             false
           ) = false
      )
    ) then
      v_next_status := 'approved';
    elsif coalesce(v_automatic_review_enabled, false) and exists (
      select 1
        from public.issue_pull_requests as ipr
        join public.review_cycles as rc
          on rc.pull_request_id = ipr.id and rc.state = 'active'
        join public.review_runs as rr
          on rr.review_cycle_id = rc.id and rr.status in ('pending', 'running')
       where ipr.issue_id = p_issue_id
         and ipr.state in ('open', 'queued')
    ) then
      v_next_status := 'reviewing';
    else
      v_next_status := 'ready-for-review';
    end if;
  elsif v_participating_count > 0
        and v_unknown_count = 0 then
    if v_merged_count > 0 then
      v_next_status := 'merged';
    else
      v_next_status := 'cancelled';
    end if;
  else
    -- Draft and unknown PRs are visible but contribute no workflow state.
    v_next_status := v_previous_status;
  end if;

  if v_next_status is distinct from v_previous_status then
    update public.issues
       set status = v_next_status,
           updated_at = now()
     where id = p_issue_id;

    insert into public.issue_events (issue_id, type, payload)
    values (
      p_issue_id,
      'status_changed',
      jsonb_build_object('from', v_previous_status, 'to', v_next_status)
    );

    return query select p_issue_id, v_previous_status, v_next_status, true;
  else
    return query select p_issue_id, v_previous_status, v_next_status, false;
  end if;
end;
$$;

revoke all on function public.set_issue_status_from_review(uuid, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.supersede_active_review_cycle(text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.evaluate_review_eligibility(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.complete_review_attempt(uuid, text, text, bigint, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.fail_review_run(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.continue_with_human_review(text, uuid, timestamptz)
  from public;

grant execute on function public.set_issue_status_from_review(uuid, text, timestamptz, text)
  to service_role;
grant execute on function public.supersede_active_review_cycle(text, text, timestamptz)
  to service_role;
grant execute on function public.evaluate_review_eligibility(text, timestamptz)
  to service_role;
grant execute on function public.complete_review_attempt(uuid, text, text, bigint, jsonb, timestamptz)
  to service_role;
grant execute on function public.fail_review_run(uuid, text, timestamptz)
  to service_role;
grant execute on function public.continue_with_human_review(text, uuid, timestamptz)
  to authenticated, service_role;
