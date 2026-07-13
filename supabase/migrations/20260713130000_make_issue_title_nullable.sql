-- Issue titles are now generated in the background after the issue is saved
-- (see apps/web/app/issues/actions.ts), so a freshly created issue briefly
-- has no title. Allow null while keeping the blank-string check for whatever
-- title is eventually set.

alter table public.issues
  drop constraint issues_title_not_blank;

alter table public.issues
  alter column title drop not null;

alter table public.issues
  add constraint issues_title_valid
  check (title is null or length(trim(title)) between 1 and 160);
