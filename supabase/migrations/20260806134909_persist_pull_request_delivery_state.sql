alter table public.issue_pull_requests
  drop constraint if exists issue_pull_requests_state_check;

update public.issue_pull_requests
   set state = 'unknown'
 where state is null;

alter table public.issue_pull_requests
  alter column state set default 'unknown',
  alter column state set not null,
  add column head_sha text,
  add column ci_state text not null default 'unknown',
  add column review_decision text not null default 'unknown',
  add constraint issue_pull_requests_state_check
    check (state in ('unknown', 'draft', 'open', 'merged', 'closed', 'queued')),
  add constraint issue_pull_requests_head_sha_not_blank
    check (head_sha is null or length(trim(head_sha)) > 0),
  add constraint issue_pull_requests_ci_state_check
    check (ci_state in ('unknown', 'pending', 'success', 'failure')),
  add constraint issue_pull_requests_review_decision_check
    check (review_decision in (
      'unknown',
      'review_required',
      'approved',
      'changes_requested'
    ));

-- Authenticated users only need to observe delivery state. Signed webhook
-- handlers use the service role for every mutation.
revoke update (state) on public.issue_pull_requests from authenticated;

drop policy if exists "Users can update pull request state for their own issues"
  on public.issue_pull_requests;

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
    ) then
      v_next_status := 'approved';
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

create or replace function public.apply_pull_request_delivery_state(
  p_pr_url text,
  p_state text default null,
  p_head_sha text default null,
  p_ci_state text default null,
  p_review_decision text default null,
  p_expected_head_sha text default null
)
returns table (
  associated_issue_id uuid,
  pull_request_updated boolean,
  issue_status_changed boolean,
  issue_status text
)
language plpgsql
set search_path = ''
as $$
declare
  v_pull_request public.issue_pull_requests%rowtype;
  v_updated boolean := false;
  v_aggregate record;
begin
  select *
    into v_pull_request
    from public.issue_pull_requests
   where url = p_pr_url
   for update;

  if not found then
    return;
  end if;

  -- A delayed CI delivery for an old commit must not overwrite the current
  -- head's state after synchronize/force-push.
  if p_expected_head_sha is not null
     and v_pull_request.head_sha is distinct from p_expected_head_sha then
    return query
      select
        v_pull_request.issue_id,
        false,
        false,
        (select status from public.issues where id = v_pull_request.issue_id);
    return;
  end if;

  update public.issue_pull_requests
     set state = coalesce(p_state, state),
         head_sha = coalesce(p_head_sha, head_sha),
         ci_state = case
           when p_head_sha is not null
             and head_sha is distinct from p_head_sha
             and p_ci_state is null
             then 'unknown'
           else coalesce(p_ci_state, ci_state)
         end,
         review_decision = case
           when p_head_sha is not null
             and head_sha is distinct from p_head_sha
             and p_review_decision is null
             then 'unknown'
           else coalesce(p_review_decision, review_decision)
         end
   where id = v_pull_request.id
     and (
       state is distinct from coalesce(p_state, state)
       or head_sha is distinct from coalesce(p_head_sha, head_sha)
       or ci_state is distinct from case
         when p_head_sha is not null
           and head_sha is distinct from p_head_sha
           and p_ci_state is null
           then 'unknown'
         else coalesce(p_ci_state, ci_state)
       end
       or review_decision is distinct from case
         when p_head_sha is not null
           and head_sha is distinct from p_head_sha
           and p_review_decision is null
           then 'unknown'
         else coalesce(p_review_decision, review_decision)
       end
     );

  v_updated := found;

  select * into v_aggregate
    from public.recompute_issue_status_from_pull_requests(
      v_pull_request.issue_id
    );

  return query
    select
      v_pull_request.issue_id,
      v_updated,
      v_aggregate.status_changed,
      v_aggregate.next_status;
end;
$$;

-- Replace GEN-325's association transaction so initial webhook state and the
-- current head are durable before the non-fatal GitHub hydration begins.
drop function public.associate_pull_request_from_webhook(
  uuid,
  text,
  text,
  boolean
);

create function public.associate_pull_request_from_webhook(
  p_issue_id uuid,
  p_pr_url text,
  p_pr_state text,
  p_ready_for_review boolean,
  p_head_sha text default null
)
returns table (
  association_created boolean,
  associated_issue_id uuid,
  issue_status_changed boolean
)
language plpgsql
set search_path = ''
as $$
declare
  v_associated_issue_id uuid;
  v_association_created boolean := false;
  v_delivery record;
begin
  if length(trim(p_pr_url)) = 0 then
    raise exception 'Pull request URL must not be blank';
  end if;

  if p_pr_state not in ('draft', 'open', 'merged', 'closed', 'queued', 'unknown') then
    raise exception 'Invalid pull request state: %', p_pr_state;
  end if;

  select issue_id
    into v_associated_issue_id
    from public.issue_pull_requests
   where url = p_pr_url;

  if v_associated_issue_id is null then
    insert into public.issue_pull_requests (issue_id, url, state, head_sha)
    values (p_issue_id, p_pr_url, p_pr_state, p_head_sha)
    on conflict (url) do nothing
    returning issue_id into v_associated_issue_id;

    v_association_created := found;

    if v_associated_issue_id is null then
      select issue_id
        into v_associated_issue_id
        from public.issue_pull_requests
       where url = p_pr_url;
    end if;
  end if;

  if v_associated_issue_id is null then
    raise exception 'Could not resolve pull request association';
  end if;

  select * into v_delivery
    from public.apply_pull_request_delivery_state(
      p_pr_url,
      p_pr_state,
      p_head_sha,
      null,
      null,
      null
    );

  if v_association_created then
    insert into public.issue_events (issue_id, type, payload)
    values (
      v_associated_issue_id,
      'pr_associated',
      jsonb_build_object('pr_url', p_pr_url)
    );
  end if;

  return query
    select
      v_association_created,
      v_associated_issue_id,
      coalesce(v_delivery.issue_status_changed, false);
end;
$$;

revoke all on function public.recompute_issue_status_from_pull_requests(uuid)
  from public, anon, authenticated;
revoke all on function public.apply_pull_request_delivery_state(
  text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.associate_pull_request_from_webhook(
  uuid, text, text, boolean, text
) from public, anon, authenticated;

grant execute on function public.recompute_issue_status_from_pull_requests(uuid)
  to service_role;
grant execute on function public.apply_pull_request_delivery_state(
  text, text, text, text, text, text
) to service_role;
grant execute on function public.associate_pull_request_from_webhook(
  uuid, text, text, boolean, text
) to service_role;
