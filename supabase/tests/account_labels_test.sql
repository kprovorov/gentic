BEGIN;
SELECT plan(26);

SELECT has_table('public', 'labels', 'labels table exists');
SELECT has_table('public', 'issue_labels', 'issue label assignment table exists');
SELECT has_column('public', 'labels', 'id', 'labels have stable ids');
SELECT has_column('public', 'labels', 'name', 'labels have display names');
SELECT has_column('public', 'labels', 'color', 'labels have colors');
SELECT has_column('public', 'labels', 'state', 'labels have lifecycle state');
SELECT has_column('public', 'labels', 'archived_at', 'labels are archive-ready');
SELECT has_column('public', 'labels', 'created_at', 'labels have created timestamps');
SELECT has_column('public', 'labels', 'updated_at', 'labels have updated timestamps');

INSERT INTO public.projects (id, user_id, name, repo, key)
VALUES
  ('10000000-0000-4000-8000-000000000501', 'user_alpha', 'Alpha', 'gentic/alpha-labels', 'ALA'),
  ('10000000-0000-4000-8000-000000000502', 'user_beta', 'Beta', 'gentic/beta-labels', 'BLA');

INSERT INTO public.issues (id, project_id, title, prompt, status, number)
VALUES
  ('20000000-0000-4000-8000-000000000501', '10000000-0000-4000-8000-000000000501', 'Draft issue', 'Prompt', 'draft', 1),
  ('20000000-0000-4000-8000-000000000502', '10000000-0000-4000-8000-000000000501', 'Done issue', 'Prompt', 'completed', 2),
  ('20000000-0000-4000-8000-000000000503', '10000000-0000-4000-8000-000000000502', 'Other issue', 'Prompt', 'draft', 1);

INSERT INTO public.labels (id, user_id, name, color)
VALUES (
  '30000000-0000-4000-8000-000000000501',
  'user_alpha',
  'Needs polish',
  '#2563EB'
);

SELECT is(
  (SELECT name FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000501'),
  'Needs polish',
  'label preserves display casing'
);
SELECT is(
  (SELECT state FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000501'),
  'active',
  'label defaults active'
);
SELECT is(
  (SELECT name_key FROM public.labels WHERE id = '30000000-0000-4000-8000-000000000501'),
  'needs polish',
  'label stores case-insensitive key'
);

SELECT throws_ok(
  $$ INSERT INTO public.labels (user_id, name, color) VALUES ('user_alpha', ' needs trim', '#2563EB') $$,
  '23514',
  null,
  'untrimmed label names are rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.labels (user_id, name, color) VALUES ('user_alpha', '', '#2563EB') $$,
  '23514',
  null,
  'blank label names are rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.labels (user_id, name, color) VALUES ('user_alpha', repeat('a', 51), '#2563EB') $$,
  '23514',
  null,
  'overlong label names are rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.labels (user_id, name, color) VALUES ('user_alpha', E'bad\nname', '#2563EB') $$,
  '23514',
  null,
  'control characters are rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.labels (user_id, name, color) VALUES ('user_alpha', 'Bad color', '#2563eb') $$,
  '23514',
  null,
  'non-canonical colors are rejected'
);
SELECT throws_ok(
  $$ INSERT INTO public.labels (user_id, name, color) VALUES ('user_alpha', 'NEEDS POLISH', '#1D4ED8') $$,
  '23505',
  null,
  'case-insensitive duplicate names are rejected per account'
);

INSERT INTO public.labels (user_id, name, color)
VALUES ('user_beta', 'NEEDS POLISH', '#1D4ED8');

SELECT is(
  (SELECT count(*)::integer FROM public.labels WHERE name_key = 'needs polish'),
  2,
  'different accounts can reuse label names'
);

INSERT INTO public.issue_labels (issue_id, label_id)
VALUES
  ('20000000-0000-4000-8000-000000000501', '30000000-0000-4000-8000-000000000501'),
  ('20000000-0000-4000-8000-000000000502', '30000000-0000-4000-8000-000000000501');

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.issue_labels
     WHERE label_id = '30000000-0000-4000-8000-000000000501'
  ),
  2,
  'assignment counts include every issue status'
);

SELECT throws_ok(
  $$ INSERT INTO public.issue_labels (issue_id, label_id) VALUES ('20000000-0000-4000-8000-000000000503', '30000000-0000-4000-8000-000000000501') $$,
  '23514',
  null,
  'cross-account label assignments are rejected'
);

INSERT INTO public.labels (user_id, name, color)
SELECT 'limit_user', 'Label ' || value, '#2563EB'
  FROM generate_series(1, 100) AS value;

UPDATE public.labels
   SET state = 'archived',
       archived_at = now()
 WHERE user_id = 'limit_user'
   AND name = 'Label 100';

INSERT INTO public.labels (user_id, name, color)
VALUES ('limit_user', 'Replacement', '#1D4ED8');

SELECT is(
  (
    SELECT count(*)::integer
      FROM public.labels
     WHERE user_id = 'limit_user'
       AND state = 'active'
  ),
  100,
  'archived labels are structurally excluded from active limit'
);

SELECT throws_ok(
  $$ INSERT INTO public.labels (user_id, name, color) VALUES ('limit_user', 'Too many', '#0F766E') $$,
  '23514',
  null,
  'more than 100 active labels are rejected'
);

SELECT throws_ok(
  $$ UPDATE public.labels SET state = 'archived' WHERE id = '30000000-0000-4000-8000-000000000501' $$,
  '23514',
  null,
  'archived state requires archived_at'
);

SELECT policies_are(
  'public',
  'labels',
  ARRAY[
    'Users can read their own labels',
    'Users can create their own labels',
    'Users can update their own labels',
    'Users can delete their own labels'
  ],
  'labels have account RLS policies'
);

SELECT policies_are(
  'public',
  'issue_labels',
  ARRAY[
    'Users can read labels on their own issues',
    'Users can create labels on their own issues',
    'Users can delete labels from their own issues'
  ],
  'issue_labels have account RLS policies'
);

ROLLBACK;
