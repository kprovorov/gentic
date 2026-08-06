alter table public.github_integrations
  add constraint github_integrations_installation_id_unique
  unique (installation_id);
