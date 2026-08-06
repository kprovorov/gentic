create or replace function public.associate_pull_request_from_webhook(
  p_issue_id uuid,
  p_pr_url text,
  p_pr_state text,
  p_ready_for_review boolean
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
  v_active_run_id uuid;
  v_previous_status text;
  v_issue_status_changed boolean := false;
begin
  if length(trim(p_pr_url)) = 0 then
    raise exception 'Pull request URL must not be blank';
  end if;

  if p_pr_state not in (
    'draft',
    'open',
    'merged',
    'closed',
    'queued',
    'unknown'
  ) then
    raise exception 'Invalid pull request state: %', p_pr_state;
  end if;

  -- Resolve an existing URL first. This is the sticky-association rule: a
  -- force-push or branch rename can never move a previously associated PR to
  -- another issue.
  select issue_id
    into v_associated_issue_id
    from public.issue_pull_requests
   where url = p_pr_url;

  if v_associated_issue_id is null then
    insert into public.issue_pull_requests (issue_id, url, state)
    values (
      p_issue_id,
      p_pr_url,
      case when p_pr_state = 'unknown' then null else p_pr_state end
    )
    on conflict (url) do nothing
    returning issue_id into v_associated_issue_id;

    v_association_created := found;

    -- A concurrent delivery may have won the unique-URL insert while this
    -- call waited. Read its sticky target in a new statement snapshot.
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

  if p_pr_state <> 'unknown' then
    update public.issue_pull_requests
       set state = p_pr_state
     where url = p_pr_url
       and state is distinct from p_pr_state;
  end if;

  if v_association_created then
    insert into public.issue_events (issue_id, type, payload)
    values (
      v_associated_issue_id,
      'pr_associated',
      jsonb_build_object('pr_url', p_pr_url)
    );
  end if;

  -- Lock the issue before checking the active run and status so a webhook
  -- cannot overwrite a live worker transition between the check and update.
  select active_run_id, status
    into v_active_run_id, v_previous_status
    from public.issues
   where id = v_associated_issue_id
   for update;

  if p_ready_for_review
     and v_active_run_id is null
     and v_previous_status is distinct from 'ready-for-review' then
    update public.issues
       set status = 'ready-for-review',
           updated_at = now()
     where id = v_associated_issue_id;

    insert into public.issue_events (issue_id, type, payload)
    values (
      v_associated_issue_id,
      'status_changed',
      jsonb_build_object(
        'from', v_previous_status,
        'to', 'ready-for-review'
      )
    );

    v_issue_status_changed := true;
  end if;

  return query
  select
    v_association_created,
    v_associated_issue_id,
    v_issue_status_changed;
end;
$$;

revoke all on function public.associate_pull_request_from_webhook(
  uuid,
  text,
  text,
  boolean
) from public, anon, authenticated;

grant execute on function public.associate_pull_request_from_webhook(
  uuid,
  text,
  text,
  boolean
) to service_role;
