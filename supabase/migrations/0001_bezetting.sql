-- Eén rij (id = 1) met de laatste Pre-Com-bezetting als JSON.
-- De Edge Function schrijft hierin met de service_role-sleutel (omzeilt RLS);
-- ingelogde portaalgebruikers mogen alleen lezen.
create table if not exists public.bezetting (
  id         int primary key default 1,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  constraint bezetting_singleton check (id = 1)
);

alter table public.bezetting enable row level security;

-- Alleen ingelogde gebruikers (achter de portaal-login) mogen de bezetting lezen.
drop policy if exists "bezetting_select_authenticated" on public.bezetting;
create policy "bezetting_select_authenticated"
  on public.bezetting for select
  to authenticated
  using (true);

-- Geen insert/update/delete-policy: schrijven kan alleen via de service_role (Edge Function).
