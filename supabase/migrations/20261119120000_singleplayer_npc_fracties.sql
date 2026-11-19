-- ════════════════════════════════════════════════════════════════════
-- Raadsspel Singleplayer — NPC-fracties (architectuurvoorstel scenario 2)
--
-- Tabellen:   sp_npc_config, sp_fracties, sp_dossiers, sp_sessies,
--             sp_berichten, sp_tokenlog
-- Functies:   sp_reserveer_call, sp_registreer_call, sp_nieuwe_sessie
--
-- Beveiligingsmodel:
-- - Leerlingen LEZEN via RLS (eigen sessies/berichten; fracties en actieve
--   dossiers zijn read-only voor iedere ingelogde gebruiker).
-- - Alle SCHRIJFACTIES lopen via Netlify-functions met de service-role-key,
--   zodat een leerling zijn eigen budget/caps niet kan resetten.
-- - Tokenlog en config zijn niet leesbaar voor leerlingen.
-- Staat volledig los van de Firebase-multiplayerstate.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Config (modelnamen, prijzen, caps) — overschrijft code-defaults ──
create table if not exists public.sp_npc_config (
  id          text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ── Fractieprofielen ──
create table if not exists public.sp_fracties (
  id        text primary key,
  naam      text not null,
  zetels    int  not null check (zetels > 0),
  positie   text not null check (positie in ('coalitie','oppositie')),
  kleur     text not null default '#888888',
  volgorde  int  not null default 0,
  profiel   jsonb not null default '{}'::jsonb  -- {waarden, aandachtspunten, toon}
);

-- ── Dossiers ──
create table if not exists public.sp_dossiers (
  id      text primary key,
  titel   text not null,
  actief  boolean not null default true,
  inhoud  jsonb not null  -- {titel, pitch, raadsvoorstel, context, feiten[], opties[], fractie_hints{}, reflectievragen[]}
);

-- ── Sessies ──
create table if not exists public.sp_sessies (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  dossier_id       text not null references public.sp_dossiers(id),
  speler_fractie   text not null references public.sp_fracties(id),
  speler_positie   text check (speler_positie in ('voor','tegen')),
  speler_inbreng   text,
  fase             text not null default 'briefing'
                   check (fase in ('briefing','fractieoverleg','commissie','onderhandeling','stemming','afgerond')),
  caps             jsonb not null,                       -- kopie van config.caps bij aanmaak
  calls_gebruikt   int not null default 0,
  kosten_usd       numeric(12,6) not null default 0,
  vragen           jsonb not null default '{}'::jsonb,   -- {fractie_id: aantal}
  standpunten      jsonb not null default '{}'::jsonb,   -- {fractie_id: {houding, voorwaarde, tekst}}
  onderhandeling   jsonb,                                -- {fracties: [...], beurten: n, akkoord: {}}
  uitslag          jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists sp_sessies_user_idx on public.sp_sessies(user_id, created_at desc);

-- ── Berichten (gespreksgeschiedenis) ──
create table if not exists public.sp_berichten (
  id          bigserial primary key,
  sessie_id   uuid not null references public.sp_sessies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  rol         text not null check (rol in ('speler','npc','systeem')),
  fractie_id  text references public.sp_fracties(id),
  soort       text not null,
  tekst       text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists sp_berichten_sessie_idx on public.sp_berichten(sessie_id, id);

-- ── Tokenlog (per AI-call) ──
create table if not exists public.sp_tokenlog (
  id                  bigserial primary key,
  sessie_id           uuid references public.sp_sessies(id) on delete set null,
  user_id             uuid,
  fractie_id          text,
  soort               text not null,
  model               text,
  input_tokens        int not null default 0,
  cache_write_tokens  int not null default 0,
  cache_read_tokens   int not null default 0,
  output_tokens       int not null default 0,
  kosten_usd          numeric(12,6) not null default 0,
  latency_ms          int,
  fallback            boolean not null default false,
  fallback_reden      text,
  vermijd_hits        text[] not null default '{}',
  created_at          timestamptz not null default now()
);
create index if not exists sp_tokenlog_sessie_idx on public.sp_tokenlog(sessie_id);
create index if not exists sp_tokenlog_created_idx on public.sp_tokenlog(created_at);

-- ════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════
alter table public.sp_npc_config enable row level security;
alter table public.sp_fracties   enable row level security;
alter table public.sp_dossiers   enable row level security;
alter table public.sp_sessies    enable row level security;
alter table public.sp_berichten  enable row level security;
alter table public.sp_tokenlog   enable row level security;

drop policy if exists sp_fracties_lezen on public.sp_fracties;
create policy sp_fracties_lezen on public.sp_fracties
  for select to authenticated using (true);

drop policy if exists sp_dossiers_lezen on public.sp_dossiers;
create policy sp_dossiers_lezen on public.sp_dossiers
  for select to authenticated using (actief);

drop policy if exists sp_sessies_eigen on public.sp_sessies;
create policy sp_sessies_eigen on public.sp_sessies
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists sp_berichten_eigen on public.sp_berichten;
create policy sp_berichten_eigen on public.sp_berichten
  for select to authenticated using (user_id = (select auth.uid()));

-- Geen policies op sp_npc_config en sp_tokenlog: alleen service role.
-- Expliciet geen insert/update/delete-policies: schrijven gaat via de functions.
revoke insert, update, delete on public.sp_sessies, public.sp_berichten, public.sp_fracties, public.sp_dossiers from anon, authenticated;
revoke all on public.sp_npc_config, public.sp_tokenlog from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- RPC: nieuwe sessie (met dagcap per gebruiker, atomair)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.sp_nieuwe_sessie(
  p_user uuid, p_dossier text, p_fractie text, p_caps jsonb, p_max_per_dag int
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_aantal int;
  v_id uuid;
begin
  -- serialiseer per gebruiker, zodat parallelle requests de dagcap niet omzeilen
  perform pg_advisory_xact_lock(hashtext('sp_nieuwe_sessie:' || p_user::text));
  select count(*) into v_aantal from sp_sessies
   where user_id = p_user and created_at > now() - interval '24 hours';
  if v_aantal >= p_max_per_dag then
    return jsonb_build_object('ok', false, 'reden', 'dagcap');
  end if;
  if not exists (select 1 from sp_dossiers where id = p_dossier and actief) then
    return jsonb_build_object('ok', false, 'reden', 'onbekend_dossier');
  end if;
  if not exists (select 1 from sp_fracties where id = p_fractie) then
    return jsonb_build_object('ok', false, 'reden', 'onbekende_fractie');
  end if;
  insert into sp_sessies (user_id, dossier_id, speler_fractie, caps)
  values (p_user, p_dossier, p_fractie, p_caps)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'sessie', (select to_jsonb(s) from sp_sessies s where s.id = v_id));
end $$;

-- ════════════════════════════════════════════════════════════════════
-- RPC: reserveer een AI-call (atomair: caps + circuit breaker)
--
-- Retourneert {ok, reden?, budget_ok, sessie}
--   ok=false   → harde weigering (cap bereikt, verkeerde fase, …): geen call
--   budget_ok=false → circuit breaker: wél een antwoord, maar gescript
-- ════════════════════════════════════════════════════════════════════
create or replace function public.sp_reserveer_call(
  p_sessie uuid, p_user uuid, p_soort text, p_fractie text, p_fracties text[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s sp_sessies%rowtype;
  v_budget_ok boolean;
  v_cnt int;
  v_onderh jsonb;
begin
  select * into s from sp_sessies where id = p_sessie and user_id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'reden', 'onbekende_sessie');
  end if;
  if s.uitslag is not null and (s.uitslag ? 'stemmen') then
    return jsonb_build_object('ok', false, 'reden', 'afgerond');
  end if;
  if s.speler_positie is null then
    return jsonb_build_object('ok', false, 'reden', 'geen_inbreng');
  end if;

  v_budget_ok := s.calls_gebruikt < (s.caps->>'max_calls')::int
             and s.kosten_usd   < (s.caps->>'max_kosten_usd')::numeric;

  if p_soort = 'opening' then
    if p_fractie is null or p_fractie = s.speler_fractie then
      return jsonb_build_object('ok', false, 'reden', 'ongeldige_fractie');
    end if;
    -- 'bezig'-markering voorkomt dubbele openingen bij parallelle requests;
    -- na 90 s mag opnieuw (bijv. als de function door een timeout is afgebroken)
    if (s.standpunten -> p_fractie ? 'houding')
       or coalesce((s.standpunten -> p_fractie ->> 'ts')::double precision, 0) > extract(epoch from now()) - 90 then
      return jsonb_build_object('ok', false, 'reden', 'al_geopend');
    end if;
    s.standpunten := s.standpunten || jsonb_build_object(p_fractie,
                       jsonb_build_object('status', 'bezig', 'ts', extract(epoch from now())));

  elsif p_soort = 'vraag' then
    if p_fractie is null or p_fractie = s.speler_fractie then
      return jsonb_build_object('ok', false, 'reden', 'ongeldige_fractie');
    end if;
    if not (s.standpunten -> p_fractie ? 'houding') then
      return jsonb_build_object('ok', false, 'reden', 'nog_geen_standpunt');
    end if;
    v_cnt := coalesce((s.vragen ->> p_fractie)::int, 0);
    if v_cnt >= (s.caps->>'max_vragen_per_fractie')::int then
      return jsonb_build_object('ok', false, 'reden', 'vragencap');
    end if;
    s.vragen := s.vragen || jsonb_build_object(p_fractie, v_cnt + 1);

  elsif p_soort = 'onderhandeling' then
    if s.onderhandeling is null then
      if p_fracties is null or cardinality(p_fracties) < 1
         or cardinality(p_fracties) > (s.caps->>'max_onderhandeling_fracties')::int
         or s.speler_fractie = any(p_fracties) then
        return jsonb_build_object('ok', false, 'reden', 'ongeldige_fracties');
      end if;
      v_onderh := jsonb_build_object('fracties', to_jsonb(p_fracties), 'beurten', 1, 'akkoord', '{}'::jsonb);
    else
      if (s.onderhandeling->>'beurten')::int >= (s.caps->>'max_onderhandeling_beurten')::int then
        return jsonb_build_object('ok', false, 'reden', 'onderhandeling_cap');
      end if;
      v_onderh := jsonb_set(s.onderhandeling, '{beurten}', to_jsonb((s.onderhandeling->>'beurten')::int + 1));
    end if;
    s.onderhandeling := v_onderh;

  elsif p_soort = 'stemverklaringen' then
    if coalesce((s.uitslag ->> 'ts')::double precision, 0) > extract(epoch from now()) - 90 then
      return jsonb_build_object('ok', false, 'reden', 'al_bezig');
    end if;
    s.uitslag := jsonb_build_object('status', 'bezig', 'ts', extract(epoch from now()));

  else
    return jsonb_build_object('ok', false, 'reden', 'onbekende_soort');
  end if;

  update sp_sessies set
    standpunten    = s.standpunten,
    vragen         = s.vragen,
    onderhandeling = s.onderhandeling,
    uitslag        = s.uitslag,
    calls_gebruikt = s.calls_gebruikt + case when v_budget_ok then 1 else 0 end,
    updated_at     = now()
  where id = p_sessie
  returning * into s;

  return jsonb_build_object('ok', true, 'budget_ok', v_budget_ok, 'sessie', to_jsonb(s));
end $$;

-- ════════════════════════════════════════════════════════════════════
-- RPC: registreer de uitkomst van een (AI- of gescripte) call
-- ════════════════════════════════════════════════════════════════════
create or replace function public.sp_registreer_call(
  p_sessie uuid, p_user uuid, p_soort text, p_fractie text,
  p_log jsonb,            -- {model, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, kosten_usd, latency_ms, fallback, fallback_reden, vermijd_hits[]}
  p_berichten jsonb,      -- [{rol, fractie_id, soort, tekst, meta}]
  p_standpunt jsonb,      -- {houding, voorwaarde, tekst} of null
  p_akkoord jsonb,        -- {fractie_id: bool} of null
  p_uitslag jsonb         -- volledige uitslag of null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s sp_sessies%rowtype;
begin
  select * into s from sp_sessies where id = p_sessie and user_id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'reden', 'onbekende_sessie');
  end if;

  insert into sp_tokenlog (sessie_id, user_id, fractie_id, soort, model, input_tokens, cache_write_tokens,
                           cache_read_tokens, output_tokens, kosten_usd, latency_ms, fallback, fallback_reden, vermijd_hits)
  values (p_sessie, p_user, p_fractie, p_soort, p_log->>'model',
          coalesce((p_log->>'input_tokens')::int, 0), coalesce((p_log->>'cache_write_tokens')::int, 0),
          coalesce((p_log->>'cache_read_tokens')::int, 0), coalesce((p_log->>'output_tokens')::int, 0),
          coalesce((p_log->>'kosten_usd')::numeric, 0), (p_log->>'latency_ms')::int,
          coalesce((p_log->>'fallback')::boolean, false), p_log->>'fallback_reden',
          coalesce(array(select jsonb_array_elements_text(coalesce(p_log->'vermijd_hits', '[]'::jsonb))), '{}'));

  insert into sp_berichten (sessie_id, user_id, rol, fractie_id, soort, tekst, meta)
  select p_sessie, p_user, b->>'rol', nullif(b->>'fractie_id', ''), b->>'soort', b->>'tekst', coalesce(b->'meta', '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_berichten, '[]'::jsonb)) b;

  update sp_sessies set
    kosten_usd     = kosten_usd + coalesce((p_log->>'kosten_usd')::numeric, 0),
    standpunten    = case when p_standpunt is not null and p_fractie is not null
                          then standpunten || jsonb_build_object(p_fractie, p_standpunt) else standpunten end,
    onderhandeling = case when p_akkoord is not null and onderhandeling is not null
                          then jsonb_set(onderhandeling, '{akkoord}', coalesce(onderhandeling->'akkoord', '{}'::jsonb) || p_akkoord)
                          else onderhandeling end,
    uitslag        = coalesce(p_uitslag, uitslag),
    fase           = case when p_uitslag is not null then 'afgerond' else fase end,
    updated_at     = now()
  where id = p_sessie;

  return jsonb_build_object('ok', true);
end $$;

-- ════════════════════════════════════════════════════════════════════
-- RPC: speler-acties die geen AI kosten (inbreng, fasewissel)
-- ════════════════════════════════════════════════════════════════════
create or replace function public.sp_speler_actie(
  p_sessie uuid, p_user uuid, p_actie text, p_data jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s sp_sessies%rowtype;
  v_fasen text[] := array['briefing','fractieoverleg','commissie','onderhandeling','stemming'];
  v_nieuw text;
begin
  select * into s from sp_sessies where id = p_sessie and user_id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'reden', 'onbekende_sessie');
  end if;
  if s.fase = 'afgerond' then
    return jsonb_build_object('ok', false, 'reden', 'afgerond');
  end if;

  if p_actie = 'inbreng' then
    if s.speler_positie is not null then
      return jsonb_build_object('ok', false, 'reden', 'inbreng_al_gegeven');
    end if;
    if (p_data->>'positie') not in ('voor','tegen') or coalesce(length(p_data->>'inbreng'), 0) < 1 then
      return jsonb_build_object('ok', false, 'reden', 'ongeldige_inbreng');
    end if;
    update sp_sessies set speler_positie = p_data->>'positie', speler_inbreng = p_data->>'inbreng',
                          fase = 'commissie', updated_at = now()
     where id = p_sessie;
    insert into sp_berichten (sessie_id, user_id, rol, fractie_id, soort, tekst, meta)
    values (p_sessie, p_user, 'speler', s.speler_fractie, 'inbreng', p_data->>'inbreng',
            jsonb_build_object('positie', p_data->>'positie'));

  elsif p_actie = 'fase' then
    v_nieuw := p_data->>'fase';
    if not (v_nieuw = any(v_fasen)) then
      return jsonb_build_object('ok', false, 'reden', 'ongeldige_fase');
    end if;
    -- alleen vooruit (of gelijk) in de fasevolgorde
    if array_position(v_fasen, v_nieuw) < array_position(v_fasen, s.fase) then
      return jsonb_build_object('ok', false, 'reden', 'fase_terug');
    end if;
    if array_position(v_fasen, v_nieuw) >= array_position(v_fasen, 'commissie') and s.speler_positie is null then
      return jsonb_build_object('ok', false, 'reden', 'geen_inbreng');
    end if;
    update sp_sessies set fase = v_nieuw, updated_at = now() where id = p_sessie;
  else
    return jsonb_build_object('ok', false, 'reden', 'onbekende_actie');
  end if;

  return jsonb_build_object('ok', true, 'sessie', (select to_jsonb(x) from sp_sessies x where x.id = p_sessie));
end $$;

-- RPC's alleen voor de service role (Netlify-functions)
revoke all on function public.sp_nieuwe_sessie(uuid, text, text, jsonb, int) from public, anon, authenticated;
revoke all on function public.sp_reserveer_call(uuid, uuid, text, text, text[]) from public, anon, authenticated;
revoke all on function public.sp_registreer_call(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.sp_speler_actie(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.sp_nieuwe_sessie(uuid, text, text, jsonb, int) to service_role;
grant execute on function public.sp_reserveer_call(uuid, uuid, text, text, text[]) to service_role;
grant execute on function public.sp_registreer_call(uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.sp_speler_actie(uuid, uuid, text, jsonb) to service_role;

-- Handige view voor kostenanalyse (alleen service role / dashboard)
create or replace view public.sp_kosten_per_sessie
with (security_invoker = true) as
select sessie_id,
       count(*)                                   as calls,
       count(*) filter (where fallback)           as fallbacks,
       sum(input_tokens)                          as input_tokens,
       sum(cache_read_tokens)                     as cache_read_tokens,
       sum(cache_write_tokens)                    as cache_write_tokens,
       sum(output_tokens)                         as output_tokens,
       sum(kosten_usd)                            as kosten_usd,
       count(*) filter (where cardinality(vermijd_hits) > 0) as calls_met_vermijdhits
from public.sp_tokenlog
group by sessie_id;
revoke all on public.sp_kosten_per_sessie from anon, authenticated;
