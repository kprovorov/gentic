-- Serialize every delivery for an Issue before locking or mutating an
-- individual PR. Locking the PR first allows two deliveries for different
-- PRs to update concurrently and then recompute through statement snapshots
-- that predate the other delivery's commit. The last waiter can consequently
-- persist an aggregate that does not describe the final per-PR rows.
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
  v_issue_id uuid;
  v_pull_request public.issue_pull_requests%rowtype;
  v_updated boolean := false;
  v_aggregate record;
begin
  -- Association is sticky, so this unlocked lookup is only used to discover
  -- the parent lock. Re-read and lock the PR after acquiring the Issue lock.
  select issue_id
    into v_issue_id
    from public.issue_pull_requests
   where url = p_pr_url;

  if not found then
    return;
  end if;

  perform 1
    from public.issues
   where id = v_issue_id
   for update;

  if not found then
    return;
  end if;

  select *
    into v_pull_request
    from public.issue_pull_requests
   where url = p_pr_url
     and issue_id = v_issue_id
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
