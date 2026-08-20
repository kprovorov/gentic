-- Additional structured fields the automatic reviewer (GEN-415) requires on
-- every finding it reports: `title` continues to carry the one-line defect
-- description (already required, non-blank); these three columns carry the
-- evidence backing the defect, its impact, and the requested change. Left
-- nullable and unconstrained at the table level — this table is shared with
-- any future non-reviewer caller, so "these three are mandatory" is enforced
-- by the reviewer's own Zod schema (`packages/validators/src/agent.ts`), not
-- a DB CHECK, mirroring ADR-0004's "additive condition, not a rewrite"
-- precedent for keeping shared tables caller-agnostic.

alter table public.review_findings
  add column evidence text,
  add column impact text,
  add column requested_change text;

-- `complete_review_attempt` (GEN-413) is the only writer of review_findings;
-- extend its finding-insert loop to also persist the three new columns from
-- the same jsonb finding object the caller already sends. Same signature, so
-- this is a body-only `create or replace`, not a new function.
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
