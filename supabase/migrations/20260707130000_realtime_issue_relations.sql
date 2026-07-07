-- Realtime: stream blocking-relation changes to the browser like messages.
alter table public.issue_relations replica identity full;

alter publication supabase_realtime add table public.issue_relations;
