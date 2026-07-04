alter table public.projects
  add column if not exists setup_script text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_setup_script_length'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_setup_script_length check (length(setup_script) <= 10000);
  end if;
end $$;
