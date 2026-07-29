alter table public.messages
  add column github_comment_id bigint;

create unique index messages_issue_id_github_comment_id_idx
  on public.messages(issue_id, github_comment_id)
  where github_comment_id is not null;
