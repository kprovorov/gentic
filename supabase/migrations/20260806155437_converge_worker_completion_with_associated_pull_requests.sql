-- A webhook delivery and a worker completion both serialize on the Issue row.
-- Completion releases the lease and recomputes from the delivery state in one
-- transaction, so either event order converges on the same aggregate status.
drop function public.finish_issue_run_if_no_pending(
  uuid,
  uuid,
  text,
  timestamptz,
  text
);

create function public.finish_issue_run_if_no_pending(
  p_issue_id uuid,
  p_run_id uuid,
  p_status text,
  p_run_finished_at timestamptz,
  p_pr_url text default null
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
         pr_url = coalesce(p_pr_url, pr_url),
         active_run_id = null,
         active_worker_id = null,
         updated_at = now()
   where id = p_issue_id;

  select *
    into v_aggregate
    from public.recompute_issue_status_from_pull_requests(p_issue_id);

  return query
    select true, coalesce(v_aggregate.next_status, p_status);
end;
$$;

revoke all on function public.finish_issue_run_if_no_pending(
  uuid,
  uuid,
  text,
  timestamptz,
  text
) from public, anon, authenticated;

grant execute on function public.finish_issue_run_if_no_pending(
  uuid,
  uuid,
  text,
  timestamptz,
  text
) to service_role;

-- Lock the target Issue before a new association becomes visible. This uses
-- the same parent lock as completion and publishing eligibility, preventing
-- those paths from making decisions against a partially associated PR.
create or replace function public.associate_pull_request_from_webhook(
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

  if p_ready_for_review and p_pr_state = 'draft' then
    raise exception 'A draft pull request cannot be ready for review';
  end if;

  select issue_id
    into v_associated_issue_id
    from public.issue_pull_requests
   where url = p_pr_url;

  perform 1
    from public.issues
   where id = coalesce(v_associated_issue_id, p_issue_id)
   for update;

  if not found then
    raise exception 'Issue not found: %', coalesce(v_associated_issue_id, p_issue_id);
  end if;

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

-- Publishing uses the same Issue lock and treats any webhook-owned
-- association as proof that the first PR already exists. A duplicate retry
-- for a request that won earlier still returns that request idempotently.
create or replace function public.request_automatic_pr_publish(
  p_issue_id uuid,
  p_run_id uuid,
  p_content text
)
returns table(
  request_id uuid,
  message_id uuid,
  status text,
  created boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_message_id uuid;
  v_status text;
begin
  perform 1
    from public.issues
   where issues.id = p_issue_id
     and issues.active_run_id = p_run_id
   for update;

  if not found then
    raise exception 'Automatic pull request must target the issue active run'
      using errcode = '23514';
  end if;

  insert into public.issue_automatic_pr_requests(issue_id, run_id, status)
  select p_issue_id, p_run_id, 'pending'
   where exists (
    select 1
      from public.issues
     where issues.id = p_issue_id
       and issues.active_run_id = p_run_id
       and issues.create_pr_automatically
       and issues.pr_url is null
       and issues.has_unpublished_agent_changes
  )
    and not exists (
      select 1
        from public.issue_pull_requests
       where issue_pull_requests.issue_id = p_issue_id
    )
  on conflict (issue_id, run_id) do nothing
  returning id into v_request_id;

  if v_request_id is not null then
    insert into public.messages(
      issue_id,
      role,
      kind,
      content,
      author_type,
      generated_action
    )
    values (p_issue_id, 'user', 'text', p_content, 'gentic', 'create_pr')
    returning id into v_message_id;

    update public.issue_automatic_pr_requests
       set requested_by_message_id = v_message_id
     where id = v_request_id
    returning issue_automatic_pr_requests.status into v_status;

    return query select v_request_id, v_message_id, v_status, true;
    return;
  end if;

  select issue_automatic_pr_requests.id,
         issue_automatic_pr_requests.requested_by_message_id,
         issue_automatic_pr_requests.status
    into v_request_id, v_message_id, v_status
    from public.issue_automatic_pr_requests
   where issue_automatic_pr_requests.issue_id = p_issue_id
     and issue_automatic_pr_requests.run_id = p_run_id;

  if found then
    return query select v_request_id, v_message_id, v_status, false;
    return;
  end if;

  raise exception 'Issue is not eligible for an automatic pull request'
    using errcode = '23514';
end;
$$;
