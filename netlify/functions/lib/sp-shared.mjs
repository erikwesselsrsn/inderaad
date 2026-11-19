/**
 * sp-shared.mjs — pure logica voor de singleplayer-NPC-fracties.
 *
 * Geen netwerk, geen env-afhankelijkheden: alles hier is los te testen
 * (zie tests/sp-shared.test.mjs). De Netlify-functions gebruiken dit voor
 * modelroutering, caps, kostenberekening, prompts, stemregels en fallbacks.
 *
 * Zie architectuur/npc-fracties-architectuurvoorstel.md (scenario 2,
 * "middenweg"): Sonnet 5.5 voor openingsstandpunten, onderhandeling en
 * stemverklaringen; Haiku 5.5 voor routinematige vragen.
 */

// ─────────────────────────────────────────────────────────────
// CONFIG — defaults. Overschrijfbaar via env en via Supabase
// (tabel sp_npc_config, rij id='default'). Modelnamen staan hier
// alleen als default, nooit hardcoded in de call zelf.
// ─────────────────────────────────────────────────────────────
export const DEFAULT_CONFIG = {
  modellen: {
    premium: 'claude-sonnet-5-5', // openingsstandpunt, onderhandeling, stemverklaringen
    routine: 'claude-haiku-5-5',  // vragen aan een fractie
  },
  // Prijzen in USD per miljoen tokens. Bron: architectuurvoorstel (pricing
  // gecontroleerd 19-11-2026). Cache-write = 1,25x (5m) of 2x (1u) input —
  // aanname op basis van de gebruikelijke Anthropic-multipliers; verifiëren.
  prijzen: {
    'claude-sonnet-5-5': { input: 2.0, output: 10.0, cache_read: 0.10, cache_write_5m: 2.5, cache_write_1h: 4.0 },
    'claude-haiku-5-5': { input: 0.10, output: 0.50, cache_read: 0.01, cache_write_5m: 0.125, cache_write_1h: 0.20 },
  },
  cache_ttl: '1h',          // '1h' of '5m'
  timeout_ms: 9000,         // onder de synchrone Netlify-limiet blijven (plan-afhankelijk!)
  max_tokens: { opening: 400, vraag: 250, onderhandeling: 500, stemverklaringen: 600 },
  caps: {
    max_calls: 26,                   // 6 openingen + 12 vragen + 4 onderhandeling + 1 stemming = 23, plus marge
    max_kosten_usd: 0.12,            // ~2x de verwachte $0,05–0,06 per sessie
    max_vragen_per_fractie: 2,
    max_onderhandeling_beurten: 4,
    max_onderhandeling_fracties: 2,
  },
  max_sessies_per_dag: 8,            // per gebruiker; begrenst kosten via "nieuwe sessie"-route
  max_tekst: 600,                    // max lengte spelersinvoer (tekens)
};

export const SOORTEN = ['opening', 'vraag', 'onderhandeling', 'stemverklaringen'];

/** Welk modelniveau per soort beurt (hybride inzet, aanpassing 2). */
export const ROUTERING = {
  opening: 'premium',
  vraag: 'routine',
  onderhandeling: 'premium',
  stemverklaringen: 'premium',
};

export const VERMIJDLIJST = [
  'luister naar de burger',
  'samen sterk',
  'we nemen het mee',
  'wij nemen het mee',
  'we komen erop terug',
  'wij komen erop terug',
  'we komen daarop terug',
];

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/** Diepe merge: latere bronnen winnen; arrays worden vervangen. */
export function mergeConfig(...bronnen) {
  const uit = {};
  for (const b of bronnen) {
    if (!isObj(b)) continue;
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined || v === null || v === '') continue;
      uit[k] = isObj(v) && isObj(uit[k]) ? mergeConfig(uit[k], v) : (isObj(v) ? mergeConfig(v) : v);
    }
  }
  return uit;
}

/** Env-overrides (alleen wat gezet is). */
export function configUitEnv(env = {}) {
  const c = { modellen: {} };
  if (env.NPC_MODEL_PREMIUM) c.modellen.premium = env.NPC_MODEL_PREMIUM;
  if (env.NPC_MODEL_ROUTINE) c.modellen.routine = env.NPC_MODEL_ROUTINE;
  if (env.NPC_CACHE_TTL) c.cache_ttl = env.NPC_CACHE_TTL;
  if (env.NPC_TIMEOUT_MS && Number(env.NPC_TIMEOUT_MS) > 0) c.timeout_ms = Number(env.NPC_TIMEOUT_MS);
  return c;
}

export function modelVoor(soort, config) {
  const niveau = ROUTERING[soort];
  if (!niveau) throw new Error('Onbekende soort: ' + soort);
  return config.modellen[niveau];
}

// ─────────────────────────────────────────────────────────────
// KOSTEN
// ─────────────────────────────────────────────────────────────
/**
 * Kosten van één call op basis van de usage uit de Anthropic-response.
 * input_tokens is bij Anthropic exclusief cache-read/-write tokens.
 */
export function berekenKosten(usage = {}, model, config, ttl = config.cache_ttl) {
  const p = config.prijzen[model];
  if (!p) return null; // onbekend model: niet gokken, wel loggen
  const M = 1_000_000;
  const cc = usage.cache_creation || {};
  let write1h = cc.ephemeral_1h_input_tokens;
  let write5m = cc.ephemeral_5m_input_tokens;
  if (write1h === undefined && write5m === undefined) {
    const w = usage.cache_creation_input_tokens || 0;
    write1h = ttl === '1h' ? w : 0;
    write5m = ttl === '1h' ? 0 : w;
  }
  const kosten =
    (usage.input_tokens || 0) * p.input / M +
    (usage.output_tokens || 0) * p.output / M +
    (usage.cache_read_input_tokens || 0) * p.cache_read / M +
    (write1h || 0) * p.cache_write_1h / M +
    (write5m || 0) * p.cache_write_5m / M;
  return Math.round(kosten * 1e6) / 1e6;
}

// ─────────────────────────────────────────────────────────────
// TEKST-HULPJES
// ─────────────────────────────────────────────────────────────
export function schoonInvoer(tekst, max = DEFAULT_CONFIG.max_tekst) {
  if (typeof tekst !== 'string') return '';
  return tekst.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function vermijdHits(tekst) {
  const t = (tekst || '').toLowerCase();
  return VERMIJDLIJST.filter(z => t.includes(z));
}

/** Haal het eerste JSON-object uit modeltekst (met of zonder ```-blok). */
export function parseJsonUitTekst(tekst) {
  if (typeof tekst !== 'string') return null;
  const zonderFence = tekst.replace(/```(?:json)?/gi, '');
  const start = zonderFence.indexOf('{');
  if (start === -1) return null;
  let diepte = 0, inString = false, escape = false;
  for (let i = start; i < zonderFence.length; i++) {
    const ch = zonderFence[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') diepte++;
    else if (ch === '}') {
      diepte--;
      if (diepte === 0) {
        try { return JSON.parse(zonderFence.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

const HOUDINGEN = ['voor', 'tegen', 'twijfel'];
export function normaliseerHouding(h, fallback = 'twijfel') {
  const v = typeof h === 'string' ? h.toLowerCase().trim() : '';
  return HOUDINGEN.includes(v) ? v : fallback;
}

// ─────────────────────────────────────────────────────────────
// PROMPTS — statisch deel (gecachet) + kleine delta per call
// ─────────────────────────────────────────────────────────────
/**
 * Statische system prompt: identiek voor iedere sessie met hetzelfde dossier,
 * dus ook cache-hits tussen leerlingen van dezelfde klas die tegelijk spelen.
 * Bevat bewust GEEN sessie-specifieke inhoud (dat staat in de delta).
 */
export function bouwStatischePrompt(dossier, fracties) {
  const d = dossier.inhoud || dossier;
  const fractieBlok = fracties.map(f => {
    const p = f.profiel || {};
    const hint = (d.fractie_hints || {})[f.id] || {};
    return [
      `### ${f.naam} (id: ${f.id}) — ${f.zetels} zetels, ${f.positie}`,
      `Waarden: ${p.waarden || '-'}`,
      `Waar deze fractie op let: ${p.aandachtspunten || '-'}`,
      `Toon: ${p.toon || '-'}`,
      `Bij dit dossier: ${hint.aandachtspunt || '-'} (startneiging: ${hint.neiging || 'twijfel'})`,
    ].join('\n');
  }).join('\n\n');

  const opties = (d.opties || []).map((o, i) => `${i + 1}. ${o.titel}: ${o.omschrijving}`).join('\n');
  const feiten = (d.feiten || []).map(f => `- ${f}`).join('\n');

  return `Je speelt de fracties in een gesimuleerde gemeenteraad van Rijssen-Holten (Overijssel; de stad Rijssen en het dorp Holten). Dit is een educatief spel voor leerlingen van 15 tot 18 jaar (maatschappijleer). Eén leerling speelt zelf een fractie; jij speelt de andere fracties.

## Kernregels
- Elke fractie redeneert geloofwaardig vanuit haar eigen waarden en belangen. Geen partij is "de goede" of "de slechte". Geen karikaturen, geen stereotypering van raadsleden, ambtenaren of inwoners.
- Laat zien dat er echte afwegingen zijn: benoem wat een keuze kost, niet alleen wat ze oplevert.
- Spreek als "de fractie" of "de fractievoorzitter". Noem GEEN persoonsnamen van raadsleden, collegeleden of inwoners.
- Gebruik alleen feiten en cijfers uit het dossier hieronder. Verzin geen nieuwe cijfers, rapporten of gebeurtenissen.
- De raad bestuurt niet: de raad kadert en controleert, het college voert uit. Raadsleden kunnen amenderen, moties indienen en stemmen; onthouden van stemming bestaat in de raad niet.
- Schrijf correct, natuurlijk Nederlands op het niveau van een goede regionale krant. Gebruik je een vakterm, leg die dan kort uit in een bijzin.
- Kort en bondig: houd je aan het aantal zinnen dat in de opdracht staat.
- Vermijd lege clichés zoals "luister naar de burger", "samen sterk", "we nemen het mee" en "we komen erop terug". Zeg concreet wat de fractie wil.
- Antwoord ALTIJD uitsluitend met één JSON-object in het formaat dat de opdracht vraagt. Geen tekst ervoor of erna.

## De fracties
${fractieBlok}

## Dossier: ${d.titel || dossier.titel}
${d.raadsvoorstel ? `Raadsvoorstel: ${d.raadsvoorstel}\n` : ''}
${d.context || ''}

Feiten:
${feiten}

Mogelijke richtingen in het debat:
${opties}`;
}

function fractieNaam(fracties, id) {
  return (fracties.find(f => f.id === id) || {}).naam || id;
}

function spelerRegel(sessie, fracties) {
  const naam = fractieNaam(fracties, sessie.speler_fractie);
  return `De leerling speelt de fractie ${naam} en is ${sessie.speler_positie || 'nog onbeslist'} het raadsvoorstel.\nInbreng van ${naam} in de commissie: «${sessie.speler_inbreng || '(geen inbreng)'}»`;
}

function standpuntRegel(sessie, fracties, id) {
  const s = (sessie.standpunten || {})[id];
  if (!s || !s.houding) return `${fractieNaam(fracties, id)}: nog geen standpunt.`;
  return `${fractieNaam(fracties, id)} (${s.houding}${s.voorwaarde ? `; voorwaarde: ${s.voorwaarde}` : ''}): «${s.tekst || ''}»`;
}

/**
 * Delta-prompt per call. `geschiedenis` is een lijst eerdere berichten
 * (uit sp_berichten) die voor deze call relevant zijn.
 */
export function bouwDelta({ soort, sessie, fracties, fractieId, fractieIds, tekst, geschiedenis = [], uitslag }) {
  const caps = sessie.caps || DEFAULT_CONFIG.caps;
  if (soort === 'opening') {
    return `Fase: commissievergadering.
${spelerRegel(sessie, fracties)}

Opdracht: geef het openingsstandpunt van de fractie ${fractieNaam(fracties, fractieId)} over het raadsvoorstel, in maximaal 4 zinnen. Reageer waar logisch kort op de inbreng van de leerling, maar blijf bij de eigen waarden van deze fractie. Je mag van de startneiging afwijken als de inbreng daar een goede reden voor geeft.

Antwoord als JSON:
{"tekst": "...", "houding": "voor" | "tegen" | "twijfel", "voorwaarde": "wat deze fractie concreet nodig heeft om (meer) te steunen, in één zin, of null"}`;
  }

  if (soort === 'vraag') {
    const eerdere = geschiedenis
      .filter(b => b.soort === 'vraag')
      .map(b => (b.rol === 'speler' ? `Vraag: «${b.tekst}»` : `Antwoord: «${b.tekst}»`))
      .join('\n');
    return `Fase: commissievergadering, vragenronde.
${spelerRegel(sessie, fracties)}

Eerder ingenomen standpunt: ${standpuntRegel(sessie, fracties, fractieId)}
${eerdere ? `\nEerdere vragen aan deze fractie:\n${eerdere}\n` : ''}
Nieuwe vraag van de leerling aan ${fractieNaam(fracties, fractieId)}: «${tekst}»

Opdracht: beantwoord de vraag namens ${fractieNaam(fracties, fractieId)} in maximaal 3 zinnen. Blijf consistent met het ingenomen standpunt: nuanceren mag, omdraaien niet. Gaat de vraag niet over het dossier, buig dan beleefd terug naar het dossier.

Antwoord als JSON:
{"tekst": "..."}`;
  }

  if (soort === 'onderhandeling') {
    const ids = fractieIds || [];
    const beurt = (sessie.onderhandeling?.beurten || 1);
    const laatste = beurt >= caps.max_onderhandeling_beurten;
    const gesprek = geschiedenis
      .filter(b => b.soort === 'onderhandeling')
      .map(b => (b.rol === 'speler' ? `Leerling: «${b.tekst}»` : `${fractieNaam(fracties, b.fractie_id)}: «${b.tekst}»`))
      .join('\n');
    return `Fase: onderhandeling buiten de vergadering (beurt ${beurt} van ${caps.max_onderhandeling_beurten}).
${spelerRegel(sessie, fracties)}

Standpunten van de fracties aan tafel:
${ids.map(id => '- ' + standpuntRegel(sessie, fracties, id)).join('\n')}
${gesprek ? `\nGesprek tot nu toe:\n${gesprek}\n` : ''}
Nieuw voorstel of bericht van de leerling: «${tekst}»

Opdracht: reageer namens elke fractie aan tafel apart, maximaal 3 zinnen per fractie. Een fractie gaat alleen akkoord als de leerling concreet tegemoetkomt aan haar voorwaarde of een ander serieus argument geeft; beloftes zonder inhoud zijn niet genoeg. ${laatste ? 'Dit is de laatste beurt: geef per fractie een definitief true of false.' : 'Gebruik null als de fractie nog niet beslist.'}

Antwoord als JSON:
{"reacties": [{"fractie": "<id>", "tekst": "..."}], "akkoord": {${ids.map(id => `"${id}": true | false${laatste ? '' : ' | null'}`).join(', ')}}}`;
  }

  if (soort === 'stemverklaringen') {
    const regels = Object.entries(uitslag.stemmen)
      .filter(([id]) => id !== sessie.speler_fractie)
      .map(([id, stem]) => `- ${standpuntRegel(sessie, fracties, id)} → stemt ${stem.stem.toUpperCase()}${stem.reden === 'akkoord' ? ' (na een akkoord met de leerling)' : stem.reden === 'geen_akkoord' ? ' (onderhandeling leverde geen akkoord op)' : ''}`)
      .join('\n');
    return `Fase: stemming in de raad. De stemmen liggen vast; verander ze niet.
${spelerRegel(sessie, fracties)}

${regels}

Uitslag: ${uitslag.voor} stemmen voor, ${uitslag.tegen} tegen. Het raadsvoorstel is ${uitslag.aangenomen ? 'aangenomen' : 'verworpen'}.

Opdracht: geef per fractie hierboven een stemverklaring van maximaal 2 zinnen die past bij haar standpunt en het verloop.

Antwoord als JSON:
{"verklaringen": {"<fractie-id>": "..."}}`;
  }

  throw new Error('Onbekende soort: ' + soort);
}

// ─────────────────────────────────────────────────────────────
// STEMMING — regelgebaseerd, géén AI (scenario 2)
// ─────────────────────────────────────────────────────────────
/**
 * Stemregels (ontwerpkeuze, ter beoordeling door game-design):
 * 1. Speler stemt zelf (spelerStem).
 * 2. Fractie met een akkoord uit de onderhandeling stemt zoals de speler.
 * 3. Anders: houding "voor" → voor, "tegen" → tegen.
 * 4. "twijfel" zonder akkoord: coalitiefracties steunen het collegevoorstel,
 *    oppositiefracties stemmen tegen (er bestaat geen onthouding in de raad).
 * Fracties zonder (geldig) openingsstandpunt vallen terug op de startneiging
 * uit het dossier.
 */
export function berekenStemming({ fracties, standpunten = {}, akkoord = {}, spelerFractie, spelerStem, hints = {} }) {
  const stemmen = {};
  let voor = 0, tegen = 0;
  for (const f of fracties) {
    let stem, reden;
    if (f.id === spelerFractie) {
      stem = spelerStem === 'voor' ? 'voor' : 'tegen';
      reden = 'speler';
    } else if (akkoord[f.id] === true) {
      stem = spelerStem === 'voor' ? 'voor' : 'tegen';
      reden = 'akkoord';
    } else {
      const houding = normaliseerHouding(standpunten[f.id]?.houding, normaliseerHouding(hints[f.id]?.neiging));
      if (houding === 'twijfel') {
        stem = f.positie === 'coalitie' ? 'voor' : 'tegen';
        reden = akkoord[f.id] === false ? 'geen_akkoord' : 'twijfel';
      } else {
        stem = houding;
        reden = akkoord[f.id] === false ? 'geen_akkoord' : 'standpunt';
      }
    }
    stemmen[f.id] = { stem, reden, zetels: f.zetels };
    if (stem === 'voor') voor += f.zetels; else tegen += f.zetels;
  }
  const totaal = voor + tegen;
  return { stemmen, voor, tegen, aangenomen: voor > totaal / 2 };
}

// ─────────────────────────────────────────────────────────────
// FALLBACKS — gescripte antwoorden (circuit breaker / API-fout)
// ─────────────────────────────────────────────────────────────
export function fallbackAntwoord({ soort, sessie, fracties, fractieId, fractieIds, dossier, uitslag }) {
  const hints = (dossier?.inhoud || dossier || {}).fractie_hints || {};
  const naam = id => fractieNaam(fracties, id);
  if (soort === 'opening') {
    const h = hints[fractieId] || {};
    return {
      tekst: h.fallback_standpunt || `De fractie van ${naam(fractieId)} wil eerst de gevolgen van het voorstel goed op een rij hebben voordat zij een definitief oordeel geeft.`,
      houding: normaliseerHouding(h.neiging),
      voorwaarde: h.voorwaarde || null,
    };
  }
  if (soort === 'vraag') {
    const s = (sessie.standpunten || {})[fractieId];
    return { tekst: `De fractie van ${naam(fractieId)} verwijst naar het eerder ingenomen standpunt${s?.tekst ? `: «${s.tekst}»` : '.'}` };
  }
  if (soort === 'onderhandeling') {
    const ids = fractieIds || [];
    return {
      reacties: ids.map(id => ({ fractie: id, tekst: `De fractie van ${naam(id)} houdt vast aan het eerder ingenomen standpunt en doet nu geen nieuwe toezegging.` })),
      akkoord: {},
    };
  }
  if (soort === 'stemverklaringen') {
    const verklaringen = {};
    for (const [id, s] of Object.entries(uitslag.stemmen)) {
      if (id === sessie.speler_fractie) continue;
      verklaringen[id] = `De fractie van ${naam(id)} stemt ${s.stem}, in lijn met het eerder ingenomen standpunt.`;
    }
    return { verklaringen };
  }
  throw new Error('Onbekende soort: ' + soort);
}

/**
 * Normaliseer modeloutput naar de vorm die de rest van de code verwacht.
 * Valt per veld terug op de fallback als het model iets onbruikbaars gaf.
 */
export function normaliseerAntwoord(soort, parsed, fallback, { fractieIds = [], laatsteBeurt = false } = {}) {
  if (!parsed || typeof parsed !== 'object') return { ...fallback, _parseFout: true };
  if (soort === 'opening') {
    const tekst = typeof parsed.tekst === 'string' && parsed.tekst.trim() ? parsed.tekst.trim() : null;
    if (!tekst) return { ...fallback, _parseFout: true };
    return {
      tekst,
      houding: normaliseerHouding(parsed.houding, fallback.houding),
      voorwaarde: typeof parsed.voorwaarde === 'string' && parsed.voorwaarde.trim() ? parsed.voorwaarde.trim() : null,
    };
  }
  if (soort === 'vraag') {
    const tekst = typeof parsed.tekst === 'string' && parsed.tekst.trim() ? parsed.tekst.trim() : null;
    return tekst ? { tekst } : { ...fallback, _parseFout: true };
  }
  if (soort === 'onderhandeling') {
    const reacties = Array.isArray(parsed.reacties)
      ? parsed.reacties.filter(r => r && fractieIds.includes(r.fractie) && typeof r.tekst === 'string' && r.tekst.trim())
        .map(r => ({ fractie: r.fractie, tekst: r.tekst.trim() }))
      : [];
    if (!reacties.length) return { ...fallback, _parseFout: true };
    const akkoord = {};
    for (const id of fractieIds) {
      const v = parsed.akkoord?.[id];
      if (v === true || v === false) akkoord[id] = v;
      else if (laatsteBeurt) akkoord[id] = false; // laatste beurt: geen open eind
    }
    return { reacties, akkoord };
  }
  if (soort === 'stemverklaringen') {
    const verklaringen = { ...fallback.verklaringen };
    let bruikbaar = false;
    if (parsed.verklaringen && typeof parsed.verklaringen === 'object') {
      for (const id of Object.keys(verklaringen)) {
        const v = parsed.verklaringen[id];
        if (typeof v === 'string' && v.trim()) { verklaringen[id] = v.trim(); bruikbaar = true; }
      }
    }
    return bruikbaar ? { verklaringen } : { ...fallback, _parseFout: true };
  }
  return fallback;
}

/** Tekst(en) die gecontroleerd worden op de vermijdlijst. */
export function tekstenVan(soort, antwoord) {
  if (soort === 'onderhandeling') return (antwoord.reacties || []).map(r => r.tekst);
  if (soort === 'stemverklaringen') return Object.values(antwoord.verklaringen || {});
  return [antwoord.tekst];
}
