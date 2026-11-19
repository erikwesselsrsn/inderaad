/**
 * sp-sessie.mjs — sessiebeheer voor de singleplayer-variant (geen AI-calls).
 *
 * POST /api/sp-sessie
 *   { actie: "start",   dossier_id, fractie_id }
 *   { actie: "inbreng", sessie_id, positie: "voor"|"tegen", inbreng }
 *   { actie: "fase",    sessie_id, fase }
 *
 * Schrijven gebeurt met de service role via RPC's, zodat leerlingen hun
 * eigen caps/budget niet kunnen aanpassen. Lezen doet de frontend zelf (RLS).
 */
import { schoonInvoer } from './lib/sp-shared.mjs';
import { json, verifieerGebruiker, rpc, laadConfig } from './lib/sp-server.mjs';

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
      r = await rpc('sp_speler_actie', {
        p_sessie: body.sessie_id, p_user: userId, p_actie: 'inbreng',
        p_data: { positie: body.positie, inbreng },
      });
    } else if (body.actie === 'fase') {
      r = await rpc('sp_speler_actie', {
        p_sessie: body.sessie_id, p_user: userId, p_actie: 'fase', p_data: { fase: body.fase },
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
