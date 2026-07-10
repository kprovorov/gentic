alter table public.messages
  add column github_review_id bigint;

create unique index messages_issue_id_github_review_id_idx
  on public.messages(issue_id, github_review_id)
  where github_review_id is not null;

alter table public.projects
  add column auto_respond_to_reviews boolean not null default true;
