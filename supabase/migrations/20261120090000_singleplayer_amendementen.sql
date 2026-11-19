-- ════════════════════════════════════════════════════════════════════
-- Raadsspel Singleplayer v3 — amendementen
--
-- De speler kan een amendement indienen (bij de inbreng of later, tot de
-- stemming). De raad stemt eerst over het amendement en daarna over het
-- (eventueel gewijzigde) raadsvoorstel, zoals in een echte raadsvergadering.
-- ════════════════════════════════════════════════════════════════════

alter table public.sp_sessies add column if not exists amendement jsonb;  -- {tekst, uitslag?}

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
                          amendement = case when coalesce(length(trim(p_data->>'amendement')), 0) > 0
                                            then jsonb_build_object('tekst', trim(p_data->>'amendement')) else null end,
                          fase = 'commissie', updated_at = now()
     where id = p_sessie;
    insert into sp_berichten (sessie_id, user_id, rol, fractie_id, soort, tekst, meta)
    values (p_sessie, p_user, 'speler', s.speler_fractie, 'inbreng', p_data->>'inbreng',
            jsonb_build_object('positie', p_data->>'positie'));
    if coalesce(length(trim(p_data->>'amendement')), 0) > 0 then
      insert into sp_berichten (sessie_id, user_id, rol, fractie_id, soort, tekst, meta)
      values (p_sessie, p_user, 'speler', s.speler_fractie, 'amendement', trim(p_data->>'amendement'), '{}'::jsonb);
    end if;

  elsif p_actie = 'amendement' then
    -- indienen, aanpassen of intrekken (lege tekst), tot de stemming erover
    if s.speler_positie is null then
      return jsonb_build_object('ok', false, 'reden', 'geen_inbreng');
    end if;
    if s.amendement ? 'uitslag' then
      return jsonb_build_object('ok', false, 'reden', 'amendement_al_gestemd');
    end if;
    update sp_sessies set
      amendement = case when coalesce(length(trim(p_data->>'tekst')), 0) > 0
                        then jsonb_build_object('tekst', trim(p_data->>'tekst')) else null end,
      updated_at = now()
     where id = p_sessie;
    insert into sp_berichten (sessie_id, user_id, rol, fractie_id, soort, tekst, meta)
    values (p_sessie, p_user, 'speler', s.speler_fractie, 'amendement',
            coalesce(nullif(trim(p_data->>'tekst'), ''), '(amendement ingetrokken)'), '{}'::jsonb);

  elsif p_actie = 'amendement_uitslag' then
    -- alleen aangeroepen door de function, die de uitslag regelgebaseerd berekent
    if not (s.amendement ? 'tekst') then
      return jsonb_build_object('ok', false, 'reden', 'geen_amendement');
    end if;
    if s.amendement ? 'uitslag' then
      return jsonb_build_object('ok', true, 'sessie', to_jsonb(s));
    end if;
    update sp_sessies set amendement = amendement || jsonb_build_object('uitslag', p_data->'uitslag'),
                          fase = 'stemming', updated_at = now()
     where id = p_sessie;

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
    -- Elk bericht richt zich op 1–2 fracties naar keuze; het totaal aantal
    -- berichten is begrensd. Fracties liggen niet vast na het eerste bericht.
    if p_fracties is null or cardinality(p_fracties) < 1
       or cardinality(p_fracties) > (s.caps->>'max_onderhandeling_fracties')::int
       or s.speler_fractie = any(p_fracties) then
      return jsonb_build_object('ok', false, 'reden', 'ongeldige_fracties');
    end if;
    if coalesce((s.onderhandeling->>'beurten')::int, 0) >= (s.caps->>'max_onderhandeling_beurten')::int then
      return jsonb_build_object('ok', false, 'reden', 'onderhandeling_cap');
    end if;
    v_onderh := jsonb_build_object(
      'fracties', (select coalesce(jsonb_agg(distinct f), '[]'::jsonb)
                     from (select jsonb_array_elements_text(coalesce(s.onderhandeling->'fracties', '[]'::jsonb)) f
                           union select unnest(p_fracties)) x),
      'beurten', coalesce((s.onderhandeling->>'beurten')::int, 0) + 1,
      'akkoord', coalesce(s.onderhandeling->'akkoord', '{}'::jsonb));
    s.onderhandeling := v_onderh;

  elsif p_soort = 'stemverklaringen' then
    if (s.amendement ? 'tekst') and not (s.amendement ? 'uitslag') then
      return jsonb_build_object('ok', false, 'reden', 'eerst_amendement');
    end if;
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

revoke all on function public.sp_speler_actie(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.sp_reserveer_call(uuid, uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.sp_speler_actie(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.sp_reserveer_call(uuid, uuid, text, text, text[]) to service_role;
