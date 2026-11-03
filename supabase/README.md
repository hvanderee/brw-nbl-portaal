# Pre-Com-bezetting via Supabase (realtime, betrouwbaar gepland)

De Pre-Com-ophaler draaide via een GitHub Action die `bezetting.js` committe. Geplande
GitHub Actions lopen onbetrouwbaar (vaak tientallen minuten vertraagd). Hieronder draait
dezelfde ophaler als **Supabase Edge Function** op een cron, schrijft de bezetting in de
tabel `bezetting`, en het portaal leest die **live** bij het inloggen. `bezetting.js` blijft
als fallback staan tot dit draait.

Er worden **geen namen** opgeslagen of gelogd — alleen aantallen per functie.

## Onderdelen
- `migrations/0001_bezetting.sql` — tabel `bezetting` + RLS (alleen ingelogde gebruikers lezen).
- `functions/bezetting/index.ts` — de Edge Function (port van `precom_bezetting.py`).
- `cron_bezetting.sql` — plant de function elke 5 minuten in.

## Deploy — stap voor stap

Eenmalig de Supabase CLI: `npm i -g supabase` en `supabase login`, daarna in de repo
`supabase link --project-ref <PROJECT_REF>` (project-ref staat in je project-URL).

1. **Tabel aanmaken.** Dashboard → SQL Editor → plak `migrations/0001_bezetting.sql` → Run.
   (Of via CLI: `supabase db push`.)

2. **Secrets zetten** (Pre-Com-login; worden nooit in de browser of repo opgeslagen):
   ```
   supabase secrets set PRECOM_USER="..." PRECOM_PASS="..."
   ```
   Optioneel afwijkend: `PRECOM_GROUP_ID`, `PRECOM_NODE_ID`, `PRECOM_MODULE_ID`, `PRECOM_DAGEN`.
   (`SUPABASE_URL` en `SUPABASE_SERVICE_ROLE_KEY` worden automatisch geïnjecteerd.)

3. **Function deployen:**
   ```
   supabase functions deploy bezetting
   ```

4. **Eén keer testen** (handmatig aanroepen) — vervang ref en anon-key:
   ```
   curl -i -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/bezetting" \
        -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" -d '{}'
   ```
   Verwacht: `{"ok":true,"ondergrens":..,"streef":..,"streef_asp":..}`. Faalt het? Kijk in
   Dashboard → Edge Functions → bezetting → Logs; de foutmelding zegt welke stap klapt
   (meestal login/secrets of NODE/MODULE-id). Dan passen we de function daarop aan.

5. **Cron inplannen.** Dashboard → Database → Extensions: zet **pg_cron** en **pg_net** aan.
   Open `cron_bezetting.sql`, vul je `<PROJECT_REF>` in, zet eenmalig je service_role-key in
   Vault (regel staat erin), en Run het in de SQL Editor.

6. **Portaal.** De portaalcode leest de tabel al (met fallback op `bezetting.js`). Zodra de
   function een rij heeft geschreven, tonen Overzicht en Paraatheid de live cijfers.

7. **Opruimen (optioneel).** Werkt alles? Dan kan de GitHub Action uit: verwijder
   `.github/workflows/bezetting.yml` (of zet 'm op alleen `workflow_dispatch`). `bezetting.js`
   mag dan blijven staan als laatste fallback.

## Hoe het portaal leest
`js/auth.js` → `laadBezetting()` draait `supabase.from('bezetting').select('data').eq('id',1)`
na het inloggen en zet `window.NBL_BEZETTING`. Zelfde JSON-vorm als `bezetting.js`, plus
`sterkte` en `heatmap_streef`.
