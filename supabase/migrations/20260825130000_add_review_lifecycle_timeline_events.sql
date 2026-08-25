-- GEN-419: first-class Issue timeline events for the Automatic Review
-- lifecycle, plus one new recovery primitive. Purely additive
-- (`create or replace function`) — no table changes. Every event insert
-- below lives inside a transition an existing RPC already performs exactly
-- once per state change (the same guarded/locked path `status_changed`,
-- `review_fix_delivered`, and `implementation_ownership_reset` already use),
-- so each is idempotent for free rather than needing new bookkeeping.

-- Same as the original definition (see 20260819130000), with one addition:
-- a `review_superseded` event whenever a live cycle is actually superseded
-- (the "not found" no-op path emits nothing, since nothing changed).
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

  insert into public.issue_events (issue_id, type, payload)
  values (
    v_issue_id,
    'review_superseded',
    jsonb_build_object(
      'review_cycle_id', v_cycle.id,
      'pull_request_id', v_pull_request_id,
      'reason', p_reason
    )
  );

  if p_reason = 'human_review' then
    perform public.set_issue_status_from_review(
      v_issue_id, 'changes-requested', p_now, 'human_review'
    );
  end if;

  return query select v_cycle.id, true;
end;
$$;

-- Same as the original definition (see 20260819130000), with a
-- `review_queued` event added at every point a fresh pending `review_runs`
-- row is created (the `queued`/`continued`/`superseded_and_queued` actions).
-- The `superseded_and_queued` path's `review_superseded` event comes for
-- free from the `supersede_active_review_cycle` call above.
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

    insert into public.issue_events (issue_id, type, payload)
    values (
      v_issue_id,
      'review_queued',
      jsonb_build_object(
        'review_cycle_id', v_new_cycle_id,
        'review_run_id', v_new_run_id,
        'pull_request_id', v_pr.id,
        'head_sha', v_pr.head_sha,
        'attempt_number', 1
      )
    );

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

    insert into public.issue_events (issue_id, type, payload)
    values (
      v_issue_id,
      'review_queued',
      jsonb_build_object(
        'review_cycle_id', v_latest_cycle.id,
        'review_run_id', v_new_run_id,
        'pull_request_id', v_pr.id,
        'head_sha', v_pr.head_sha,
        'attempt_number', v_completed_attempts + 1
      )
    );

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

    insert into public.issue_events (issue_id, type, payload)
    values (
      v_issue_id,
      'review_queued',
      jsonb_build_object(
        'review_cycle_id', v_new_cycle_id,
        'review_run_id', v_new_run_id,
        'pull_request_id', v_pr.id,
        'head_sha', v_pr.head_sha,
        'attempt_number', 1
      )
    );

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

  insert into public.issue_events (issue_id, type, payload)
  values (
    v_issue_id,
    'review_queued',
    jsonb_build_object(
      'review_cycle_id', v_latest_cycle.id,
      'review_run_id', v_new_run_id,
      'pull_request_id', v_pr.id,
      'head_sha', v_pr.head_sha,
      'attempt_number', v_completed_attempts + 1
    )
  );

  return query
    select v_issue_id, v_pr.id, true, v_latest_cycle.id, v_new_run_id, 'continued';
end;
$$;

-- Same as the original definition (see 20260819130000), with a
-- `review_approved` or `review_changes_requested` event added once the
-- verdict (and any resulting cycle-exhaustion) is decided.
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

  if p_verdict = 'approved' then
    insert into public.issue_events (issue_id, type, payload)
    values (
      v_cycle.issue_id,
      'review_approved',
      jsonb_build_object(
        'review_attempt_id', v_attempt_id,
        'review_cycle_id', v_cycle.id,
        'pull_request_id', v_cycle.pull_request_id,
        'attempt_number', v_attempt_number,
        'source', 'automatic'
      )
    );
  else
    insert into public.issue_events (issue_id, type, payload)
    values (
      v_cycle.issue_id,
      'review_changes_requested',
      jsonb_build_object(
        'review_attempt_id', v_attempt_id,
        'review_cycle_id', v_cycle.id,
        'pull_request_id', v_cycle.pull_request_id,
        'attempt_number', v_attempt_number,
        'verdict', p_verdict,
        'findings_count', jsonb_array_length(coalesce(p_findings, '[]'::jsonb))
      )
    );
  end if;

  perform public.set_issue_status_from_review(v_cycle.issue_id, v_next_status, p_now);

  return query
    select v_attempt_id, v_cycle.id, v_cycle.issue_id, v_attempt_number,
      (select state from public.review_cycles where id = v_cycle.id), true;
end;
$$;

-- Same as the original definition (see 20260819130000), with a
-- `review_failed` event added on every path that actually records a
-- failure (the very first "run not found / not live" no-op emits nothing).
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
    insert into public.issue_events (issue_id, type, payload)
    values (
      v_cycle.issue_id,
      'review_failed',
      jsonb_build_object(
        'review_run_id', p_review_run_id,
        'review_cycle_id', v_cycle.id,
        'pull_request_id', v_cycle.pull_request_id,
        'error', p_error,
        'retried', false
      )
    );

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

    insert into public.issue_events (issue_id, type, payload)
    values (
      v_cycle.issue_id,
      'review_failed',
      jsonb_build_object(
        'review_run_id', p_review_run_id,
        'review_cycle_id', v_cycle.id,
        'pull_request_id', v_cycle.pull_request_id,
        'error', p_error,
        'retried', true
      )
    );

    return query
      select p_review_run_id, v_cycle.id, true, v_next_run_id, true;
    return;
  end if;

  insert into public.issue_events (issue_id, type, payload)
  values (
    v_cycle.issue_id,
    'review_failed',
    jsonb_build_object(
      'review_run_id', p_review_run_id,
      'review_cycle_id', v_cycle.id,
      'pull_request_id', v_cycle.pull_request_id,
      'error', p_error,
      'retried', false
    )
  );

  return query select p_review_run_id, v_cycle.id, false, null::uuid, true;
end;
$$;

-- Same as the original definition (see 20260819130000), with a
-- `review_approved` event (source `human_override`, distinguishing it from
-- an automatic verdict) added alongside the cycle's approval.
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

  insert into issue_events (issue_id, type, payload)
  values (
    p_issue_id,
    'review_approved',
    jsonb_build_object(
      'review_attempt_id', null,
      'review_cycle_id', v_cycle.id,
      'pull_request_id', v_pr.id,
      'attempt_number', null,
      'source', 'human_override'
    )
  );

  perform set_issue_status_from_review(
    p_issue_id, 'approved', p_now, 'continue_with_human_review'
  );

  return query select v_cycle.id, p_issue_id, 'approved'::text;
end;
$$;

-- Same as the original definition (see 20260819140001), with a
-- `review_started` event added the moment a run is actually claimed.
create or replace function public.claim_review_run(
  p_worker_id uuid,
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
  v_worker_ok boolean;
  v_run_id uuid;
begin
  select exists (
    select 1
      from public.workers
     where id = p_worker_id
       and user_id = p_user_id
       and banned_at is null
  ) into v_worker_ok;

  if not v_worker_ok then
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
         claimed_by_worker_id = p_worker_id,
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

-- The one missing recovery primitive: an explicit, human-initiated "retry
-- now" for a cycle stuck after two trailing infra failures (or simply idle
-- between webhook deliveries) — everything else in ADR-0004/ADR-0003 is
-- read off run history, but nothing previously re-armed progression without
-- new code arriving or a human GitHub action. Mirrors `continue_with_human_
-- review`'s ownership-check shape exactly.
create or replace function public.retry_review_run(
  p_user_id text,
  p_review_cycle_id uuid,
  p_now timestamptz default now()
)
returns table (
  review_run_id uuid,
  review_cycle_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle review_cycles%rowtype;
  v_has_live_run boolean;
  v_completed_attempts integer;
  v_new_run_id uuid;
begin
  select rc.*
    into v_cycle
    from review_cycles rc
    join issue_pull_requests ipr on ipr.id = rc.pull_request_id
    join issues i on i.id = rc.issue_id
    join projects p on p.id = i.project_id
   where rc.id = p_review_cycle_id
     and p.user_id = p_user_id
   for update of rc;

  if not found then
    raise exception 'Review cycle not found' using errcode = 'P0002';
  end if;

  if v_cycle.state <> 'active' then
    raise exception 'Review cycle is not active' using errcode = '23514';
  end if;

  select exists (
    select 1 from review_runs rr
     where rr.review_cycle_id = v_cycle.id
       and rr.status in ('pending', 'running')
  ) into v_has_live_run;

  if v_has_live_run then
    raise exception 'A review run is already in flight for this cycle'
      using errcode = '23514';
  end if;

  select count(*)
    into v_completed_attempts
    from review_attempts ra
   where ra.review_cycle_id = v_cycle.id;

  if v_completed_attempts >= 3 then
    raise exception 'Review attempt budget is exhausted for this cycle'
      using errcode = '23514';
  end if;

  insert into review_runs (review_cycle_id, status, head_sha)
  values (v_cycle.id, 'pending', v_cycle.head_sha)
  returning id into v_new_run_id;

  perform set_issue_status_from_review(v_cycle.issue_id, 'reviewing', p_now);

  insert into issue_events (issue_id, type, payload)
  values (
    v_cycle.issue_id,
    'review_queued',
    jsonb_build_object(
      'review_cycle_id', v_cycle.id,
      'review_run_id', v_new_run_id,
      'pull_request_id', v_cycle.pull_request_id,
      'head_sha', v_cycle.head_sha,
      'attempt_number', v_completed_attempts + 1
    )
  );

  return query select v_new_run_id, v_cycle.id;
end;
$$;

revoke all on function public.retry_review_run(text, uuid, timestamptz)
  from public;

grant execute on function public.retry_review_run(text, uuid, timestamptz)
  to authenticated, service_role;
