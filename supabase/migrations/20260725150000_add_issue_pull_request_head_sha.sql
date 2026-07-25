alter table public.issue_pull_requests
  add column if not exists head_sha text;

create index if not exists issue_pull_requests_head_sha_idx
  on public.issue_pull_requests(head_sha)
  where head_sha is not null;
