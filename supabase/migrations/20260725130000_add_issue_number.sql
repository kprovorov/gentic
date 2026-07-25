alter table public.issues add column number integer;

do $$
declare
  proj record;
  iss record;
  n integer;
begin
  for proj in select id from public.projects loop
    n := 1;

    for iss in
      select id
      from public.issues
      where project_id = proj.id
      order by created_at asc
    loop
      update public.issues set number = n where id = iss.id;
      n := n + 1;
    end loop;

    update public.projects set next_issue_number = n where id = proj.id;
  end loop;
end $$;

alter table public.issues alter column number set not null;

alter table public.issues
  add constraint issues_project_id_number_unique unique (project_id, number);
