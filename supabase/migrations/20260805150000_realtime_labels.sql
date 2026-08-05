-- Realtime: stream label catalog and assignment changes to the browser like
-- messages/issue_events, so definitions, chips, filters, counts, and timeline
-- styling stay coherent across tabs. RLS keeps each subscription scoped to the
-- authenticated account's rows.
alter table public.labels replica identity full;
alter table public.issue_labels replica identity full;

alter publication supabase_realtime add table public.labels;
alter publication supabase_realtime add table public.issue_labels;
