/**
 * sp-sessie.mjs — sessiebeheer voor de singleplayer-variant (geen AI-calls).
 *
 * POST /api/sp-sessie
 *   { actie: "start",   dossier_id, fractie_id }
 *   { actie: "inbreng", sessie_id, positie: "voor"|"tegen", inbreng, amendement? }
 *   { actie: "fase",    sessie_id, fase }
 *   { actie: "amendement",      sessie_id, tekst }   (indienen/aanpassen; leeg = intrekken)
 *   { actie: "stem_amendement", sessie_id }          (regelgebaseerde stemming, geen AI)
 *
 * Schrijven gebeurt met de service role via RPC's, zodat leerlingen hun
 * eigen caps/budget niet kunnen aanpassen. Lezen doet de frontend zelf (RLS).
 */
import { schoonInvoer, berekenAmendementStemming, heeftAmendement } from './lib/sp-shared.mjs';
import { json, verifieerGebruiker, rpc, select, laadConfig, laadFracties } from './lib/sp-server.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[a-z0-9-]{1,60}$/;

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let userId;
  try { userId = await verifieerGebruiker(req); } catch { return json(500, { error: 'Configuratiefout' }); }
  if (!userId) return json(401, { error: 'Niet ingelogd' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Ongeldig verzoek' }); }

  try {
    const config = await laadConfig();
    let r;
    if (body?.actie === 'start') {
      if (!ID.test(body.dossier_id || '') || !ID.test(body.fractie_id || '')) return json(400, { error: 'Ongeldig dossier of fractie' });
      r = await rpc('sp_nieuwe_sessie', {
        p_user: userId, p_dossier: body.dossier_id, p_fractie: body.fractie_id,
        p_caps: config.caps, p_max_per_dag: config.max_sessies_per_dag,
      });
      if (!r?.ok) return json(r?.reden === 'dagcap' ? 429 : 400, { error: r?.reden, reden: r?.reden });
      return json(200, { sessie: r.sessie });
    }

    if (!UUID.test(body?.sessie_id || '')) return json(400, { error: 'Ongeldige sessie' });

    if (body.actie === 'inbreng') {
      const inbreng = schoonInvoer(body.inbreng, config.max_tekst);
      const amendement = schoonInvoer(body.amendement, config.max_tekst);
      r = await rpc('sp_speler_actie', {
        p_sessie: body.sessie_id, p_user: userId, p_actie: 'inbreng',
        p_data: { positie: body.positie, inbreng, ...(amendement ? { amendement } : {}) },
      });
    } else if (body.actie === 'fase') {
      r = await rpc('sp_speler_actie', {
        p_sessie: body.sessie_id, p_user: userId, p_actie: 'fase', p_data: { fase: body.fase },
      });
    } else if (body.actie === 'amendement') {
      r = await rpc('sp_speler_actie', {
        p_sessie: body.sessie_id, p_user: userId, p_actie: 'amendement',
        p_data: { tekst: schoonInvoer(body.tekst, config.max_tekst) },
      });
    } else if (body.actie === 'stem_amendement') {
      const [rijen, fracties] = await Promise.all([
        select(`sp_sessies?id=eq.${body.sessie_id}&user_id=eq.${userId}&select=*`),
        laadFracties(),
      ]);
      const sessie = rijen?.[0];
      if (!sessie) return json(404, { error: 'onbekende_sessie', reden: 'onbekende_sessie' });
      if (!heeftAmendement(sessie)) return json(409, { error: 'geen_amendement', reden: 'geen_amendement' });
      if (sessie.amendement.uitslag) return json(200, { sessie });
      const uitslag = berekenAmendementStemming({
        fracties, standpunten: sessie.standpunten, akkoord: sessie.onderhandeling?.akkoord || {},
        spelerFractie: sessie.speler_fractie,
      });
      r = await rpc('sp_speler_actie', {
        p_sessie: body.sessie_id, p_user: userId, p_actie: 'amendement_uitslag', p_data: { uitslag },
      });
    } else {
      return json(400, { error: 'Onbekende actie' });
    }
    if (!r?.ok) return json(r?.reden === 'onbekende_sessie' ? 404 : 409, { error: r?.reden, reden: r?.reden });
    return json(200, { sessie: r.sessie });
  } catch (e) {
    console.error('[sp-sessie]', e.message);
    return json(502, { error: 'Database niet bereikbaar' });
  }
};

export const config = { path: '/api/sp-sessie' };
