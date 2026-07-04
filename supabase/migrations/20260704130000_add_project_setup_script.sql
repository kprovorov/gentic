alter table public.projects
  add column setup_script text,
  add constraint projects_setup_script_length check (length(setup_script) <= 10000);
