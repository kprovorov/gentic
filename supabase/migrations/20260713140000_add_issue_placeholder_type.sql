-- Issue types are now classified in the background after the issue is saved
-- (see apps/web/app/issues/actions.ts), so a freshly created issue needs a
-- placeholder type until then. Add "issue" as that placeholder and make it
-- the column default.

alter table public.issues
  drop constraint issues_type_valid;

alter table public.issues
  add constraint issues_type_valid check (
    type in ('issue', 'feature', 'bug', 'feedback', 'idea')
  );

alter table public.issues
  alter column type set default 'issue';
