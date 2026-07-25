alter table public.projects
  add column next_issue_number integer not null default 1;

create or replace function public.next_issue_number_for_project(p_project_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_next_issue_number integer;
begin
  update public.projects
  set next_issue_number = next_issue_number + 1
  where id = p_project_id
  returning next_issue_number - 1 into v_next_issue_number;

  if not found then
    raise exception 'Project not found'
      using errcode = 'P0002';
  end if;

  return v_next_issue_number;
end;
$$;

revoke all on function public.next_issue_number_for_project(uuid) from public;

grant execute on function public.next_issue_number_for_project(uuid)
  to authenticated;
grant execute on function public.next_issue_number_for_project(uuid)
  to service_role;
