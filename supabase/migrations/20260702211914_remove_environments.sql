drop trigger if exists projects_environment_owned_by_user on public.projects;

drop function if exists public.projects_environment_owned_by_user();

drop index if exists public.projects_environment_id_idx;

alter table if exists public.projects
  drop column if exists environment_id;

drop table if exists public.environments;
