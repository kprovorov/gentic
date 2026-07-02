alter table public.tasks rename to issues;

alter index public.tasks_pkey rename to issues_pkey;
alter index public.tasks_project_id_idx rename to issues_project_id_idx;

alter table public.issues rename constraint tasks_title_not_blank to issues_title_not_blank;
alter table public.issues rename constraint tasks_status_valid to issues_status_valid;
alter table public.issues rename constraint tasks_project_id_fkey to issues_project_id_fkey;

alter policy "Users can read tasks for their own projects"
  on public.issues rename to "Users can read issues for their own projects";
alter policy "Users can create tasks for their own projects"
  on public.issues rename to "Users can create issues for their own projects";
alter policy "Users can update tasks for their own projects"
  on public.issues rename to "Users can update issues for their own projects";
alter policy "Users can delete tasks for their own projects"
  on public.issues rename to "Users can delete issues for their own projects";
