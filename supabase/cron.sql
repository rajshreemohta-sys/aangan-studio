-- Every minute, ask the app to call back any new HubSpot contacts.
-- Run once in the Supabase SQL editor after the first Vercel deploy.
-- Replace <APP_URL> and <CRON_SECRET> with your values. The secret is stored in Vault, not in the job text.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<CRON_SECRET>', 'aangan_cron_secret');

select cron.schedule(
  'aangan-hubspot-callbacks',
  '* * * * *',
  $$
  select net.http_post(
    url := '<APP_URL>/api/hubspot/poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'aangan_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- To stop: select cron.unschedule('aangan-hubspot-callbacks');
