-- GEN-430: `complete_review_attempt`'s 'approved' branch moved an Issue
-- straight to `approved` the instant *one* associated pull request's review
-- cycle approved, without checking any other reviewable pull request's
-- cycle state -- unlike `recompute_issue_status_from_pull_requests`, the
-- generic PR-state aggregator, which already treats "every reviewable PR's
-- latest cycle is approved" as the bar. An Issue with two associated pull
-- requests could therefore flip to `approved` while a sibling PR's review
-- was still in flight, contradicting the documented guarantee in
-- docs/web/automatic-review.mdx: "every one of them must independently
-- reach an approved Review Cycle" before the Issue is presented as
-- `Approved`.
--
-- The fix mirrors the aggregator's own condition: an approving verdict only
-- promotes the Issue to `approved` once every other open/queued pull
-- request's latest review cycle is also `approved`. Otherwise this verdict
-- forces no Issue-status transition at all -- the sibling pull request's own
-- eligibility/completion calls (or a future recompute) are what own the
-- Issue's status while its review is still outstanding, so guessing a
-- status here risks clobbering one of the higher-priority states (e.g.
-- `changes-requested` from that sibling) with a lower-priority one.
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
  v_all_reviewable_approved boolean;
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
      evidence, impact, requested_change, github_comment_id
    ) values (
      v_attempt_id,
      v_cycle.head_sha,
      coalesce(v_finding->>'severity', 'info'),
      v_finding->>'file_path',
      nullif(v_finding->>'line', '')::integer,
      v_finding->>'title',
      v_finding->>'body',
      v_finding->>'evidence',
      v_finding->>'impact',
      v_finding->>'requested_change',
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

    -- Same all-reviewable-PRs-approved condition
    -- `recompute_issue_status_from_pull_requests` enforces: this cycle just
    -- became approved, but a sibling pull request may still have its own
    -- cycle in flight (or not yet approved).
    v_all_reviewable_approved := not exists (
      select 1
        from public.issue_pull_requests ipr
       where ipr.issue_id = v_cycle.issue_id
         and ipr.state in ('open', 'queued')
         and coalesce(
           (
             select rc.state = 'approved'
               from public.review_cycles rc
              where rc.pull_request_id = ipr.id
              order by rc.created_at desc
              limit 1
           ),
           false
         ) = false
    );

    -- null (rather than a guessed status) when a sibling pull request's
    -- cycle isn't approved yet, so the perform below is skipped and the
    -- Issue's current status is left untouched.
    v_next_status := case
      when v_all_reviewable_approved then 'approved'
      else null
    end;
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

  if v_next_status is not null then
    perform public.set_issue_status_from_review(v_cycle.issue_id, v_next_status, p_now);
  end if;

  return query
    select v_attempt_id, v_cycle.id, v_cycle.issue_id, v_attempt_number,
      (select state from public.review_cycles where id = v_cycle.id), true;
end;
$$;
