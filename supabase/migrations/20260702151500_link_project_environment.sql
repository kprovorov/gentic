alter table public.projects
  add column environment_id uuid references public.environments(id) on delete set null;

create index projects_environment_id_idx on public.projects(environment_id);

-- Keep the linked environment scoped to the project owner: a project may only
-- reference an environment that belongs to the same user.
create or replace function public.projects_environment_owned_by_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if new.environment_id is not null then
    if not exists (
      select 1
      from public.environments
      where environments.id = new.environment_id
        and environments.user_id = new.user_id
    ) then
      raise exception 'Environment must belong to the same user as the project';
    end if;
  end if;

  return new;
end;
$$;

create trigger projects_environment_owned_by_user
  before insert or update of environment_id on public.projects
  for each row
  execute function public.projects_environment_owned_by_user();
