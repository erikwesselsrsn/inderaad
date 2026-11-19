# Tests

`npm test` draait alle tests. `sp-shared.test.mjs` heeft niets nodig.

`sp-flow.test.mjs` test de Netlify-functions end-to-end tegen een **echte
Postgres** met de migraties (Supabase-REST en Anthropic worden gesimuleerd).
Hij wordt overgeslagen tenzij `SP_TEST_PSQL` gezet is:

```bash
# lege database met een minimale Supabase-stub (auth-schema + rollen)
psql -d raadsspel_test <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
SQL
psql -d raadsspel_test -f supabase/migrations/20261119120000_singleplayer_npc_fracties.sql
psql -d raadsspel_test -f supabase/migrations/20261119120100_singleplayer_seed.sql

SP_TEST_PSQL="psql -q -d raadsspel_test" npm test
```
