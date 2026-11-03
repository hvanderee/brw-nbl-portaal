-- Plant de Edge Function `bezetting` elke 5 minuten in via pg_cron + pg_net.
-- Vervang <PROJECT_REF> door je Supabase project-ref (staat in de project-URL).
-- Draai dit in de SQL Editor NADAT de function is gedeployed.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Eenmalig: zet de service_role-sleutel veilig in Vault (Dashboard > Project Settings > API > service_role key).
-- select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');

-- Bestaande planning opruimen (veilig als die nog niet bestaat):
select cron.unschedule('bezetting-elke-5-min')
where exists (select 1 from cron.job where jobname = 'bezetting-elke-5-min');

select cron.schedule(
  'bezetting-elke-5-min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/bezetting',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Controleren:  select * from cron.job;
-- Loggen:       select * from cron.job_run_details order by start_time desc limit 10;
