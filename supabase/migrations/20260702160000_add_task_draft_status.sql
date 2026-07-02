alter table public.tasks
  drop constraint tasks_status_valid;

alter table public.tasks
  add constraint tasks_status_valid
  check (status in ('draft', 'todo', 'in-progress', 'done'));
