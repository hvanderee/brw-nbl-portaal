-- Veiligheidspaspoort-id per lid, voor een harde koppeling tussen een ingelogd lid
-- en zijn uitrukken (ingezette_users) uit Veiligheidspaspoort.
alter table public.leden add column if not exists vp_id text;
