create table public.labels (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  name_key text generated always as (lower(name)) stored,
  color text not null,
  state text not null default 'active',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint labels_name_length check (char_length(name) between 1 and 50),
  constraint labels_name_trimmed check (name = btrim(name)),
  constraint labels_name_no_control_characters check (name !~ '[[:cntrl:]]'),
  constraint labels_color_hex check (color ~ '^#[0-9A-F]{6}$'),
  constraint labels_state_valid check (state in ('active', 'archived')),
  constraint labels_archived_at_matches_state check (
    (state = 'active' and archived_at is null)
    or (state = 'archived' and archived_at is not null)
  ),
  constraint labels_user_name_key_unique unique (user_id, name_key)
);

create index labels_user_active_name_idx
  on public.labels(user_id, name_key)
  where state = 'active';

create index labels_user_active_color_idx
  on public.labels(user_id, color)
  where state = 'active';

create or replace function public.enforce_active_label_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state = 'active' and (
    tg_op = 'INSERT'
    or old.state <> 'active'
    or old.user_id <> new.user_id
  ) then
    if (
      select count(*)::integer
        from public.labels
       where user_id = new.user_id
         and state = 'active'
    ) >= 100 then
      raise exception 'active label limit reached'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger labels_active_limit
  before insert or update of user_id, state on public.labels
  for each row
  execute function public.enforce_active_label_limit();

create table public.issue_labels (
  issue_id uuid not null references public.issues(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id, label_id)
);

create index issue_labels_label_id_idx
  on public.issue_labels(label_id);

create or replace function public.enforce_issue_label_account_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  issue_owner text;
  label_owner text;
  label_state text;
begin
  select projects.user_id into issue_owner
    from public.issues
    join public.projects on projects.id = issues.project_id
   where issues.id = new.issue_id;

  select labels.user_id, labels.state into label_owner, label_state
    from public.labels
   where labels.id = new.label_id;

  if issue_owner is null or label_owner is null or issue_owner <> label_owner then
    raise exception 'issue and label must belong to the same account'
      using errcode = '23514';
  end if;

  if label_state <> 'active' then
    raise exception 'cannot assign archived label'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger issue_labels_account_scope
  before insert or update of issue_id, label_id on public.issue_labels
  for each row
  execute function public.enforce_issue_label_account_scope();

alter table public.labels enable row level security;
alter table public.issue_labels enable row level security;

grant select, insert, update, delete on public.labels to authenticated;
grant select, insert, delete on public.issue_labels to authenticated;

create policy "Users can read their own labels"
  on public.labels
  for select
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can create their own labels"
  on public.labels
  for insert
  to authenticated
  with check (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can update their own labels"
  on public.labels
  for update
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id)
  with check (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can delete their own labels"
  on public.labels
  for delete
  to authenticated
  using (((select auth.jwt()) ->> 'sub') = user_id);

create policy "Users can read labels on their own issues"
  on public.issue_labels
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.labels
       where labels.id = issue_labels.label_id
         and labels.user_id = ((select auth.jwt()) ->> 'sub')
    )
    and exists (
      select 1
        from public.issues
        join public.projects on projects.id = issues.project_id
       where issues.id = issue_labels.issue_id
         and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can create labels on their own issues"
  on public.issue_labels
  for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.labels
       where labels.id = issue_labels.label_id
         and labels.user_id = ((select auth.jwt()) ->> 'sub')
         and labels.state = 'active'
    )
    and exists (
      select 1
        from public.issues
        join public.projects on projects.id = issues.project_id
       where issues.id = issue_labels.issue_id
         and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );

create policy "Users can delete labels from their own issues"
  on public.issue_labels
  for delete
  to authenticated
  using (
    exists (
      select 1
        from public.labels
       where labels.id = issue_labels.label_id
         and labels.user_id = ((select auth.jwt()) ->> 'sub')
    )
    and exists (
      select 1
        from public.issues
        join public.projects on projects.id = issues.project_id
       where issues.id = issue_labels.issue_id
         and projects.user_id = ((select auth.jwt()) ->> 'sub')
    )
  );
