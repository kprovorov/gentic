-- Keep automatic publishing's concurrency guarantees while making the
-- association table the only authority for whether an Issue already has a PR.
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
set search_path = public
as $$
declare
  v_request_id uuid;
  v_message_id uuid;
  v_status text;
begin
  insert into public.issue_automatic_pr_requests(issue_id, run_id, status)
  select p_issue_id, p_run_id, 'pending'
  where exists (
    select 1
      from public.issues
     where issues.id = p_issue_id
       and issues.active_run_id = p_run_id
       and issues.create_pr_automatically
       and issues.has_unpublished_agent_changes
       and not exists (
         select 1
           from public.issue_pull_requests
          where issue_pull_requests.issue_id = issues.id
       )
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

  if not exists (
    select 1 from public.issues
     where issues.id = p_issue_id
       and issues.active_run_id = p_run_id
  ) then
    raise exception 'Automatic pull request must target the issue active run'
      using errcode = '23514';
  end if;

  raise exception 'Issue is not eligible for an automatic pull request'
    using errcode = '23514';
end;
$$;
