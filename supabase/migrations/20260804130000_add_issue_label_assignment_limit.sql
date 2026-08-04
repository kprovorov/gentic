create or replace function public.enforce_issue_label_assignment_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*)::integer
      from public.issue_labels
     where issue_id = new.issue_id
  ) >= 20 then
    raise exception 'issue label assignment limit reached'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger issue_labels_assignment_limit
  before insert on public.issue_labels
  for each row
  execute function public.enforce_issue_label_assignment_limit();
