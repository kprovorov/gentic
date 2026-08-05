BEGIN;
SELECT plan(4);

-- Cross-tab label coherence depends on Postgres change-data-capture: the
-- browser subscribes to `labels`/`issue_labels`, but no events stream unless
-- both tables belong to the supabase_realtime publication with full replica
-- identity (so DELETEs and pre-image columns reach RLS filtering).

SELECT is(
  (SELECT count(*)::int
     FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'labels'),
  1,
  'labels is published to supabase_realtime'
);

SELECT is(
  (SELECT count(*)::int
     FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'issue_labels'),
  1,
  'issue_labels is published to supabase_realtime'
);

SELECT is(
  (SELECT relreplident FROM pg_class WHERE oid = 'public.labels'::regclass),
  'f'::"char",
  'labels uses full replica identity for realtime deletes'
);

SELECT is(
  (SELECT relreplident FROM pg_class WHERE oid = 'public.issue_labels'::regclass),
  'f'::"char",
  'issue_labels uses full replica identity for realtime deletes'
);

SELECT * FROM finish();
ROLLBACK;
