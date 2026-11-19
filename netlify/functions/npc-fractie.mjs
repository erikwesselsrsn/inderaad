/**
 * npc-fractie.mjs — één NPC-beurt in de singleplayer-variant.
 *
 * POST /api/npc-fractie
 *   { sessie_id, soort: "opening",          fractie_id }
 *   { sessie_id, soort: "vraag",            fractie_id, tekst }
 *   { sessie_id, soort: "onderhandeling",   fracties: [id, id?] (alleen 1e beurt), tekst }
 *   { sessie_id, soort: "stemverklaringen", speler_stem: "voor" | "tegen" }
 *
 * Eén function-call = maximaal één Claude-call (Netlify-timeout). Openings-
 * standpunten van meerdere fracties vraagt de frontend parallel op.
 *
 * Volgorde: auth → atomaire reservering in Supabase (caps + circuit breaker)
 * → Claude (of gescript antwoord) → registratie (tokenlog, berichten, state).
 */
import {
  SOORTEN, modelVoor, berekenKosten, schoonInvoer, vermijdHits, parseJsonUitTekst,
  bouwStatischePrompt, bouwDelta, berekenStemming, fallbackAntwoord, normaliseerAntwoord, tekstenVan,
} from './lib/sp-shared.mjs';
import {
  json, verifieerGebruiker, rpc, select, laadConfig, laadFracties, laadDossier, roepClaudeAan,
} from './lib/sp-server.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HARDE_WEIGERING = {
  onbekende_sessie: 404, afgerond: 409, geen_inbreng: 409, ongeldige_fractie: 400, ongeldige_fracties: 400,
  al_geopend: 409, nog_geen_standpunt: 409, vragencap: 429, onderhandeling_cap: 429, al_bezig: 409, onbekende_soort: 400,
};

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let userId;
  try { userId = await verifieerGebruiker(req); } catch (e) { return json(500, { error: 'Configuratiefout' }); }
  if (!userId) return json(401, { error: 'Niet ingelogd' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Ongeldig verzoek' }); }
  const { sessie_id, soort } = body || {};
  if (!UUID.test(sessie_id || '') || !SOORTEN.includes(soort)) return json(400, { error: 'Ongeldige sessie of soort' });

  let config, fracties;
  try { [config, fracties] = await Promise.all([laadConfig(), laadFracties()]); }
  catch (e) { console.error('[npc-fractie] laden mislukt', e); return json(502, { error: 'Database niet bereikbaar' }); }

  const fractieIds = fracties.map(f => f.id);
  const fractieId = typeof body.fractie_id === 'string' && fractieIds.includes(body.fractie_id) ? body.fractie_id : null;
  const gevraagdeFracties = Array.isArray(body.fracties) ? body.fracties.filter(id => fractieIds.includes(id)) : null;
  const tekst = schoonInvoer(body.tekst, config.max_tekst);
  if ((soort === 'opening' || soort === 'vraag') && !fractieId) return json(400, { error: 'Onbekende fractie' });
  if ((soort === 'vraag' || soort === 'onderhandeling') && !tekst) return json(400, { error: 'Lege tekst' });

  // ── 1. Atomaire reservering (caps + circuit breaker) ──
  let res;
  try {
    res = await rpc('sp_reserveer_call', {
      p_sessie: sessie_id, p_user: userId, p_soort: soort, p_fractie: fractieId, p_fracties: gevraagdeFracties,
    });
  } catch (e) { console.error('[npc-fractie] reservering mislukt', e); return json(502, { error: 'Database niet bereikbaar' }); }
  if (!res?.ok) return json(HARDE_WEIGERING[res?.reden] || 400, { error: res?.reden || 'geweigerd', reden: res?.reden });

  const sessie = res.sessie;
  const dossier = await laadDossier(sessie.dossier_id);
  if (!dossier) return json(500, { error: 'Dossier ontbreekt' });
  const hints = dossier.inhoud?.fractie_hints || {};

  const onderhFracties = soort === 'onderhandeling' ? (sessie.onderhandeling?.fracties || []) : [];
  const laatsteBeurt = soort === 'onderhandeling' && (sessie.onderhandeling?.beurten || 0) >= sessie.caps.max_onderhandeling_beurten;

  let uitslag = null;
  if (soort === 'stemverklaringen') {
    const spelerStem = body.speler_stem === 'voor' || body.speler_stem === 'tegen' ? body.speler_stem : sessie.speler_positie;
    uitslag = berekenStemming({
      fracties, standpunten: sessie.standpunten, akkoord: sessie.onderhandeling?.akkoord || {},
      spelerFractie: sessie.speler_fractie, spelerStem, hints,
    });
    uitslag.speler_stem = spelerStem;
  }

  // ── 2. Relevante geschiedenis (klein houden = goedkope delta) ──
  let geschiedenis = [];
  try {
    if (soort === 'vraag') {
      geschiedenis = await select(`sp_berichten?sessie_id=eq.${sessie_id}&soort=eq.vraag&fractie_id=eq.${fractieId}&select=rol,fractie_id,soort,tekst&order=id.asc`);
    } else if (soort === 'onderhandeling') {
      geschiedenis = await select(`sp_berichten?sessie_id=eq.${sessie_id}&soort=eq.onderhandeling&select=rol,fractie_id,soort,tekst&order=id.asc&limit=24`);
    }
  } catch (e) { console.warn('[npc-fractie] geschiedenis niet geladen', e.message); }

  const ctx = { soort, sessie, fracties, fractieId, fractieIds: onderhFracties, tekst, geschiedenis, uitslag, dossier };
  const fallback = fallbackAntwoord(ctx);

  // ── 3. Claude of gescript antwoord ──
  const model = modelVoor(soort, config);
  let antwoord = fallback, usage = {}, latency = null, fallbackReden = null;
  if (!res.budget_ok) {
    fallbackReden = 'budget';
  } else {
    try {
      const r = await roepClaudeAan({
        model,
        systeem: bouwStatischePrompt(dossier, fracties),
        delta: bouwDelta(ctx),
        maxTokens: config.max_tokens[soort],
        config,
      });
      usage = r.usage; latency = r.latency;
      antwoord = normaliseerAntwoord(soort, parseJsonUitTekst(r.tekst), fallback, { fractieIds: onderhFracties, laatsteBeurt });
      if (antwoord._parseFout) fallbackReden = 'parse';
    } catch (e) {
      console.error('[npc-fractie] Claude-fout', e.message);
      fallbackReden = 'fout: ' + e.message.slice(0, 120);
      antwoord = fallback;
    }
  }
  const isFallback = fallbackReden !== null;
  antwoord = { ...antwoord };
  delete antwoord._parseFout;

  const kosten = berekenKosten(usage, model, config) ?? 0;
  const hits = [...new Set(tekstenVan(soort, antwoord).flatMap(vermijdHits))];
  if (hits.length) console.warn('[npc-fractie] vermijdlijst geraakt', { sessie_id, soort, hits });

  // ── 4. Registreren ──
  const berichten = [];
  if (soort === 'vraag') berichten.push({ rol: 'speler', fractie_id: fractieId, soort, tekst, meta: {} });
  if (soort === 'onderhandeling') berichten.push({ rol: 'speler', fractie_id: null, soort, tekst, meta: { beurt: sessie.onderhandeling?.beurten } });
  if (soort === 'opening') berichten.push({ rol: 'npc', fractie_id: fractieId, soort, tekst: antwoord.tekst, meta: { houding: antwoord.houding, voorwaarde: antwoord.voorwaarde, fallback: isFallback } });
  if (soort === 'vraag') berichten.push({ rol: 'npc', fractie_id: fractieId, soort, tekst: antwoord.tekst, meta: { fallback: isFallback } });
  if (soort === 'onderhandeling') for (const r of antwoord.reacties) berichten.push({ rol: 'npc', fractie_id: r.fractie, soort, tekst: r.tekst, meta: { akkoord: antwoord.akkoord[r.fractie] ?? null, fallback: isFallback } });
  if (soort === 'stemverklaringen') for (const [id, v] of Object.entries(antwoord.verklaringen)) berichten.push({ rol: 'npc', fractie_id: id, soort, tekst: v, meta: { stem: uitslag.stemmen[id]?.stem, fallback: isFallback } });

  const volledigeUitslag = uitslag ? { ...uitslag, verklaringen: antwoord.verklaringen } : null;
  try {
    await rpc('sp_registreer_call', {
      p_sessie: sessie_id, p_user: userId, p_soort: soort, p_fractie: soort === 'opening' ? fractieId : null,
      p_log: {
        model: res.budget_ok ? model : null,
        input_tokens: usage.input_tokens || 0,
        cache_write_tokens: usage.cache_creation_input_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        kosten_usd: kosten, latency_ms: latency, fallback: isFallback, fallback_reden: fallbackReden, vermijd_hits: hits,
      },
      p_berichten: berichten,
      p_standpunt: soort === 'opening' ? { houding: antwoord.houding, voorwaarde: antwoord.voorwaarde, tekst: antwoord.tekst } : null,
      p_akkoord: soort === 'onderhandeling' ? antwoord.akkoord : null,
      p_uitslag: volledigeUitslag,
    });
  } catch (e) {
    console.error('[npc-fractie] registratie mislukt', e.message);
  }

  return json(200, {
    soort,
    fallback: isFallback,
    antwoord,
    uitslag: volledigeUitslag,
    status: {
      vragen_over: soort === 'vraag'
        ? sessie.caps.max_vragen_per_fractie - (sessie.vragen?.[fractieId] || 0) : undefined,
      onderhandeling_beurten_over: soort === 'onderhandeling'
        ? sessie.caps.max_onderhandeling_beurten - (sessie.onderhandeling?.beurten || 0) : undefined,
    },
  });
};

export const config = { path: '/api/npc-fractie' };
