alter table public.issues
  add column type text not null default 'feature';

alter table public.issues
  add constraint issues_type_valid check (
    type in ('feature', 'bug', 'feedback', 'idea')
  );
