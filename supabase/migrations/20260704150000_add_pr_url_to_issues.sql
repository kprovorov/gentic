-- Link to the pull request the agent opened for this issue's run, if any.
alter table public.issues
  add column pr_url text;
