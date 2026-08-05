BEGIN;
SELECT plan(12);

-- Restoration is the create-or-restore path's second half: a normal confirmed
-- create whose trimmed, case-insensitive name matches an archived label revives
-- that label in place instead of inserting a duplicate. The service performs it
-- as a single UPDATE flipping the row back to active and clearing archived_at,
-- relying on the same constraints and the active-limit trigger this migration
-- added — so exercise that exact statement here at the database level.

INSERT INTO public.projects (id, user_id, name, repo, key)
VALUES ('10000000-0000-4000-8000-000000000701', 'user_alpha', 'Alpha', 'gentic/alpha-restore', 'ARE');

INSERT INTO public.issues (id, project_id, title, body, status, number)
VALUES
  ('20000000-0000-4000-8000-000000000701', '10000000-0000-4000-8000-000000000701', 'Issue one', 'Body', 'todo', 1),
  ('20000000-0000-4000-8000-000000000702', '10000000-0000-4000-8000-000000000701', 'Issue two', 'Body', 'completed', 2);

-- An active label with two assignments, archived through the RPC (which strips
-- the assignments and records one removal event per affected issue), then
-- restored the way the service does it.
INSERT INTO public.labels (id, user_id, name, color)
VALUES ('30000000-0000-4000-8000-000000000701', 'user_alpha', 'Reusable', '#2563EB');
INSERT INTO public.issue_labels (issue_id, label_id)
VALUES
  ('20000000-0000-4000-8000-000000000701', '30000000-0000-4000-8000-000000000701'),
  ('20000000-0000-4000-8000-000000000702', '30000000-0000-4000-8000-000000000701');

SELECT * FROM public.archive_label('user_alpha', '30000000-0000-4000-8000-000000000701', '2026-08-05T11:00:00Z');

UPDATE public.labels
   SET state = 'active',
       archived_at = null,
       updated_at = '2026-08-05T11:05:00Z'
 WHERE id = '30000000-0000-4000-8000-000000000701'
   AND user_id = 'user_alpha'
   AND state = 'archived';

SELECT is(
  (SELECT state FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000701'),
  'active',
  'restoring flips the archived label back to active'
);
SELECT is(
  (SELECT archived_at FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000701'),
  null::timestamptz,
  'restoring clears archived_at'
);
SELECT is(
  (SELECT name FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000701'),
  'Reusable',
  'restoring preserves the stable id''s display name and casing'
);
SELECT is(
  (SELECT color FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000701'),
  '#2563EB',
  'restoring preserves the prior color'
);
SELECT is(
  (SELECT count(*)::integer FROM public.issue_labels WHERE label_id = '30000000-0000-4000-8000-000000000701'),
  0,
  'restoring does not resurrect the label''s former issue assignments'
);
SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_events
     WHERE type = 'labels_changed'
       AND payload -> 'removed' @> jsonb_build_array(jsonb_build_object('id', '30000000-0000-4000-8000-000000000701'))
  ),
  2,
  'restoring leaves the archive removal events (text and timestamps) intact'
);

-- Uniqueness still holds once revived: the active row keeps reserving the
-- case-insensitive name, so a second active label of the same name is rejected.
SELECT throws_ok(
  $$ INSERT INTO public.labels (user_id, name, color) VALUES ('user_alpha', 'reusable', '#1D4ED8') $$,
  '23505',
  null,
  'a restored active label still blocks a case-insensitive duplicate name'
);

-- Flipping state to active without clearing archived_at is rejected, which is
-- exactly why the restore statement nulls archived_at.
INSERT INTO public.labels (id, user_id, name, color, state, archived_at)
VALUES ('30000000-0000-4000-8000-000000000702', 'user_alpha', 'Constrained', '#0F766E', 'archived', '2026-08-05T11:00:00Z');

SELECT throws_ok(
  $$ UPDATE public.labels SET state = 'active' WHERE id = '30000000-0000-4000-8000-000000000702' $$,
  '23514',
  null,
  'restoring must clear archived_at to satisfy the state/archived_at consistency check'
);

-- Active-limit accounting: an account with 100 active labels plus one archived
-- cannot restore, and the failed restore leaves the label archived (atomic).
INSERT INTO public.labels (user_id, name, color)
SELECT 'limit_user_restore', 'Cap ' || value, '#2563EB'
  FROM generate_series(1, 100) AS value;
INSERT INTO public.labels (id, user_id, name, color, state, archived_at)
VALUES ('30000000-0000-4000-8000-000000000703', 'limit_user_restore', 'Archived cap', '#0891B2', 'archived', '2026-08-05T11:00:00Z');

SELECT throws_ok(
  $$ UPDATE public.labels SET state = 'active', archived_at = null WHERE id = '30000000-0000-4000-8000-000000000703' $$,
  '23514',
  null,
  'restoring is rejected when the active catalog is already full'
);
SELECT is(
  (SELECT state FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000703'),
  'archived',
  'a limit-blocked restore leaves the label archived (atomic failure)'
);

-- Rollback: a restore does not survive if the enclosing transaction rolls back.
INSERT INTO public.labels (id, user_id, name, color, state, archived_at)
VALUES ('30000000-0000-4000-8000-000000000704', 'user_alpha', 'Rollback me', '#EA580C', 'archived', '2026-08-05T11:00:00Z');

SAVEPOINT before_restore;
UPDATE public.labels
   SET state = 'active', archived_at = null
 WHERE id = '30000000-0000-4000-8000-000000000704';
ROLLBACK TO SAVEPOINT before_restore;

SELECT is(
  (SELECT state FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000704'),
  'archived',
  'rollback undoes a restore, leaving the label archived'
);
SELECT is(
  (SELECT archived_at FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000704'),
  '2026-08-05T11:00:00Z'::timestamptz,
  'rollback restores the original archived_at'
);

SELECT * FROM finish();
ROLLBACK;
