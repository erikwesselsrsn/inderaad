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
  timeout_ms: 25000,        // Netlify staat 60 s toe voor synchrone functions; 9 s bleek te krap (playtest 19-11)
  // Plafond per antwoord. Ruim gekozen: het is een bovengrens, je betaalt alleen
  // wat het model echt schrijft. Te krap = afgekapte JSON = gescript antwoord
  // (playtest 19-11: vrijwel alle calls liepen tegen 400/250/500/600 aan).
  max_tokens: { opening: 900, vraag: 1000, onderhandeling: 1200, stemverklaringen: 1500 },
  caps: {
    max_calls: 28,                   // 6 openingen + 12 vragen + 6 onderhandeling + 1 stemming = 25, plus marge
    max_kosten_usd: 0.15,            // ~2x de verwachte $0,06–0,08 per sessie
    max_vragen_per_fractie: 2,
    max_onderhandeling_beurten: 6,   // totaal aantal berichten, te verdelen over fracties naar keuze
    max_onderhandeling_fracties: 2,
  },
  max_sessies_per_dag: 8,            // per gebruiker; begrenst kosten via "nieuwe sessie"-route
  max_tekst: 600,                    // max lengte spelersinvoer (tekens)
};

export const SOORTEN = ['opening', 'vraag', 'onderhandeling', 'stemverklaringen'];

/**
 * Eén gedeelde tool voor álle soorten beurten. Met tool_choice geforceerd
 * levert het model altijd een JSON-object (tool input), zonder tekst eromheen.
 * Bewust één schema voor alle soorten: tools staan vóór de system prompt in
 * de cache-prefix, dus verschillende tools per soort zouden de cache breken.
 */
export const ANTWOORD_TOOL = {
  name: 'antwoord',
  description: 'Geef het antwoord van de fractie(s). Vul alleen de velden in die de opdracht vraagt.',
  input_schema: {
    type: 'object',
    properties: {
      tekst: { type: 'string', description: 'Wat de fractie zegt (opening of antwoord op een vraag). Kort, binnen de gevraagde lengte.' },
      houding: { type: 'string', enum: ['voor', 'tegen', 'twijfel'], description: 'Houding over het raadsvoorstel.' },
      houding_amendement: { type: 'string', enum: ['voor', 'tegen', 'twijfel'], description: 'Houding over het amendement, alleen als er een amendement is.' },
      voorwaarde: { type: ['string', 'null'], description: 'Wat de fractie nodig heeft om (meer) te steunen, in één zin.' },
      reacties: {
        type: 'array',
        description: 'Onderhandeling: per fractie aan tafel één reactie.',
        items: { type: 'object', properties: { fractie: { type: 'string' }, tekst: { type: 'string' } }, required: ['fractie', 'tekst'] },
      },
      akkoord: { type: 'object', description: 'Onderhandeling: per fractie-id true, false of null.', additionalProperties: { type: ['boolean', 'null'] } },
      verklaringen: { type: 'object', description: 'Stemming: per fractie-id een stemverklaring.', additionalProperties: { type: 'string' } },
    },
  },
};

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

/**
 * Reddingspoging voor afgekapte JSON (stop_reason = max_tokens): haal het
 * veld "tekst" eruit tot de laatste volledige zin, plus houding/voorwaarde
 * als die al compleet zijn. Alleen bruikbaar voor opening en vraag.
 */
export function redAfgekapteJson(tekst) {
  if (typeof tekst !== 'string') return null;
  const veld = (naam) => {
    const m = tekst.match(new RegExp('"' + naam + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)("?)'));
    if (!m) return null;
    let v; try { v = JSON.parse('"' + m[1].replace(/\\$/, '') + '"'); } catch { v = m[1]; }
    return { waarde: v, compleet: m[2] === '"' };
  };
  const t = veld('tekst');
  if (!t || !t.waarde) return null;
  let tekstWaarde = t.waarde.trim();
  if (!t.compleet) {
    const einde = Math.max(tekstWaarde.lastIndexOf('. '), tekstWaarde.lastIndexOf('? '), tekstWaarde.lastIndexOf('! '));
    if (/[.?!]$/.test(tekstWaarde)) { /* al netjes */ }
    else if (einde > 40) tekstWaarde = tekstWaarde.slice(0, einde + 1);
    else return null;
  }
  const uit = { tekst: tekstWaarde };
  const h = veld('houding'); if (h?.compleet) uit.houding = h.waarde;
  const ha = veld('houding_amendement'); if (ha?.compleet) uit.houding_amendement = ha.waarde;
  const v = veld('voorwaarde'); if (v?.compleet) uit.voorwaarde = v.waarde;
  return uit;
}

const HOUDINGEN = ['voor', 'tegen', 'twijfel'];
const SCHAAL = ['tegen', 'twijfel', 'voor'];

/** Houding mag per vraag maximaal één stap opschuiven (tegen ↔ twijfel ↔ voor). */
export function beperkStap(oud, nieuw) {
  const o = SCHAAL.indexOf(oud), n = SCHAAL.indexOf(nieuw);
  if (o === -1) return n === -1 ? 'twijfel' : nieuw;
  if (n === -1) return oud;
  if (Math.abs(n - o) <= 1) return nieuw;
  return SCHAAL[o + Math.sign(n - o)];
}
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
      ...(p.coalitie ? [`Positie in de raad: ${p.coalitie}`] : []),
      `Bij dit dossier: ${hint.aandachtspunt || '-'} (startneiging: ${hint.neiging || 'twijfel'})`,
    ].join('\n');
  }).join('\n\n');

  const opties = (d.opties || []).map((o, i) => `${i + 1}. ${o.titel}: ${o.omschrijving}`).join('\n');
  const feiten = (d.feiten || []).map(f => `- ${f}`).join('\n');

  return `Je speelt de fracties in een gesimuleerde gemeenteraad van Rijssen-Holten (Overijssel; de stad Rijssen en het dorp Holten). Dit is een educatief spel voor leerlingen van 15 tot 18 jaar (maatschappijleer). Eén leerling speelt zelf een fractie; jij speelt de andere fracties.

## Kernregels
- Elke fractie redeneert geloofwaardig vanuit haar eigen waarden en belangen. Geen partij is "de goede" of "de slechte". Geen karikaturen, geen stereotypering van raadsleden, ambtenaren of inwoners.
- Laat zien dat er echte afwegingen zijn: benoem wat een keuze kost, niet alleen wat ze oplevert.
- Fracties hebben een eigen lijn, maar zijn niet onwrikbaar. Ze laten zich overtuigen door argumenten en voorstellen die aansluiten bij hun eigen waarden en belangen, en zoeken dan een compromis. Alleen bij iets dat recht tegen hun kernwaarden ingaat, gaan ze niet mee.
- Neem de voorstellen van de leerling serieus en reageer er inhoudelijk op: wat is goed, wat schuurt, en onder welke voorwaarde zou de fractie meegaan.
- Spreek als "de fractie" of "de fractievoorzitter". Noem GEEN persoonsnamen van raadsleden, collegeleden of inwoners.
- Gebruik alleen feiten en cijfers uit het dossier hieronder. Verzin geen nieuwe cijfers, rapporten of gebeurtenissen.
- De raad bestuurt niet: de raad kadert en controleert, het college voert uit. Raadsleden kunnen amenderen, moties indienen en stemmen; onthouden van stemming bestaat in de raad niet.
- Schrijf correct, natuurlijk Nederlands op het niveau van een goede regionale krant. Gebruik je een vakterm, leg die dan kort uit in een bijzin.
- Kort en bondig: houd je strikt aan het aantal zinnen dat in de opdracht staat. Liever drie sterke zinnen dan vijf.
- Vermijd lege clichés zoals "luister naar de burger", "samen sterk", "we nemen het mee" en "we komen erop terug". Zeg concreet wat de fractie wil.
- Geef je antwoord ALTIJD door de tool "antwoord" aan te roepen, met precies de velden die de opdracht noemt. Schrijf geen tekst buiten de tool. Kun je de tool niet gebruiken, geef dan alleen het JSON-object met die velden. Houd elk tekstveld binnen de gevraagde lengte.
- Fracties laten zich nooit overhalen met persoonlijke beloningen, geld of gunsten voor raadsleden. Wijs zo'n aanbod beleefd maar duidelijk af en benoem dat dit niet kan; het mag de houding niet verbeteren.

## De fracties
De coalitie bestaat uit SGP, CDA en Gemeentebelang (16 van de 25 zetels); ChristenUnie, FvD, VVD en PRO vormen de oppositie. Coalitiefracties zijn gebonden aan het coalitieakkoord, maar hebben elk hun eigen accenten.

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

export function heeftAmendement(sessie) {
  return !!(sessie?.amendement && typeof sessie.amendement.tekst === 'string' && sessie.amendement.tekst.trim());
}

function spelerRegel(sessie, fracties) {
  const naam = fractieNaam(fracties, sessie.speler_fractie);
  let r = `De leerling speelt de fractie ${naam} en is ${sessie.speler_positie || 'nog onbeslist'} het raadsvoorstel.\nInbreng van ${naam} in de commissie: «${sessie.speler_inbreng || '(geen inbreng)'}»`;
  if (heeftAmendement(sessie)) {
    r += `\nAmendement van ${naam} (een voorstel om het raadsvoorstel te wijzigen; de raad stemt eerst over het amendement en daarna over het, eventueel gewijzigde, raadsvoorstel): «${sessie.amendement.tekst}»`;
  }
  return r;
}

function standpuntRegel(sessie, fracties, id) {
  const s = (sessie.standpunten || {})[id];
  if (!s || !s.houding) return `${fractieNaam(fracties, id)}: nog geen standpunt.`;
  const am = heeftAmendement(sessie) && s.houding_amendement ? `; over het amendement: ${s.houding_amendement}` : '';
  return `${fractieNaam(fracties, id)} (raadsvoorstel: ${s.houding}${am}${s.voorwaarde ? `; voorwaarde: ${s.voorwaarde}` : ''}): «${s.tekst || ''}»`;
}

const AM_VELD = (sessie) => heeftAmendement(sessie)
  ? ', "houding_amendement": "voor" | "tegen" | "twijfel"'
  : '';

/**
 * Delta-prompt per call. `geschiedenis` is een lijst eerdere berichten
 * (uit sp_berichten) die voor deze call relevant zijn.
 */
export function bouwDelta({ soort, sessie, fracties, fractieId, fractieIds, tekst, geschiedenis = [], uitslag }) {
  const caps = sessie.caps || DEFAULT_CONFIG.caps;
  if (soort === 'opening') {
    return `Fase: commissievergadering.
${spelerRegel(sessie, fracties)}

Opdracht: geef het openingsstandpunt van de fractie ${fractieNaam(fracties, fractieId)} over het raadsvoorstel, in maximaal 4 zinnen (samen hooguit 90 woorden). Reageer waar logisch kort op de inbreng van de leerling, maar blijf bij de eigen waarden van deze fractie. Je mag van de startneiging afwijken als de inbreng daar een goede reden voor geeft. Kies "twijfel" als de fractie te overtuigen is met een concrete aanpassing.

Velden voor de tool "antwoord":
{"tekst": "...", "houding": "voor" | "tegen" | "twijfel"${AM_VELD(sessie)}, "voorwaarde": "wat deze fractie concreet nodig heeft om (meer) te steunen, in één zin, of null"}
"houding" gaat over het raadsvoorstel${heeftAmendement(sessie) ? '; "houding_amendement" over het amendement van de leerling' : ''}.`;
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

Opdracht: beantwoord de vraag namens ${fractieNaam(fracties, fractieId)} in maximaal 3 zinnen (samen hooguit 70 woorden). Ga in op het argument of voorstel van de leerling.
- Is dat argument overtuigend en past het bij de waarden van deze fractie, dan mag de fractie één stap opschuiven (tegen → twijfel → voor, of andersom) en/of haar voorwaarde aanpassen. Zeg dat dan ook in het antwoord.
- Is het niet overtuigend, leg dan uit wat er nog ontbreekt; de houding blijft dan gelijk.
- Gaat de vraag niet over het dossier, buig dan beleefd terug naar het dossier.

Velden voor de tool "antwoord":
{"tekst": "...", "houding": "voor" | "tegen" | "twijfel"${AM_VELD(sessie)}, "voorwaarde": "wat de fractie nu nog nodig heeft, in één zin, of null"}`;
  }

  if (soort === 'onderhandeling') {
    const ids = fractieIds || [];
    const beurt = (sessie.onderhandeling?.beurten || 1);
    const laatste = beurt >= caps.max_onderhandeling_beurten;
    const gesprek = geschiedenis
      .filter(b => b.soort === 'onderhandeling')
      .filter(b => (b.rol === 'speler' ? (b.meta?.fracties || []).some(id => ids.includes(id)) : ids.includes(b.fractie_id)))
      .map(b => (b.rol === 'speler' ? `Leerling: «${b.tekst}»` : `${fractieNaam(fracties, b.fractie_id)}: «${b.tekst}»`))
      .join('\n');
    return `Fase: onderhandeling buiten de vergadering (bericht ${beurt} van ${caps.max_onderhandeling_beurten}).
${spelerRegel(sessie, fracties)}

Standpunten van de fracties aan tafel:
${ids.map(id => '- ' + standpuntRegel(sessie, fracties, id)).join('\n')}
${gesprek ? `\nGesprek tot nu toe:\n${gesprek}\n` : ''}
Nieuw voorstel of bericht van de leerling: «${tekst}»

Opdracht: reageer namens elke fractie aan tafel apart, maximaal 3 zinnen per fractie (hooguit 70 woorden per fractie).
- Fracties willen resultaat boeken en zijn bereid tot een compromis. Een fractie gaat akkoord ("true") als het voorstel van de leerling haar voorwaarde (grotendeels) invult of op een andere manier goed aansluit bij haar waarden en belangen.
- Komt het voorstel deels tegemoet, doe dan een concreet tegenvoorstel: "als u ook ..., dan gaan wij mee" en gebruik ${laatste ? 'false' : 'null'}.
- Een fractie gaat niet akkoord met iets dat recht tegen haar kernwaarden ingaat, of met beloftes zonder inhoud.
- ${heeftAmendement(sessie) ? '"true" betekent: deze fractie steunt het amendement van de leerling en stemt ervoor.' : `"true" betekent: deze fractie stemt mee met de leerling (${sessie.speler_positie || 'zijn positie'} het raadsvoorstel).`} ${laatste ? 'Dit is het laatste bericht van de leerling: geef per fractie een definitief true of false.' : ''}

Velden voor de tool "antwoord":
{"reacties": [{"fractie": "<id>", "tekst": "..."}], "akkoord": {${ids.map(id => `"${id}": true | false${laatste ? '' : ' | null'}`).join(', ')}}}`;
  }

  if (soort === 'stemverklaringen') {
    const am = uitslag.amendement;
    const redenTekst = (r) => r === 'akkoord' ? ' (na een akkoord met de leerling)' : r === 'geen_akkoord' ? ' (onderhandeling leverde geen akkoord op)' : '';
    const regels = Object.entries(uitslag.stemmen)
      .filter(([id]) => id !== sessie.speler_fractie)
      .map(([id, stem]) => `- ${standpuntRegel(sessie, fracties, id)}${am ? ` → amendement: ${am.stemmen[id].stem.toUpperCase()}` : ''} → raadsvoorstel: ${stem.stem.toUpperCase()}${redenTekst(stem.reden)}`)
      .join('\n');
    const amRegel = am
      ? `Stemming over het amendement: ${am.voor} voor, ${am.tegen} tegen; het amendement is ${am.aangenomen ? 'aangenomen' : 'verworpen'}.\nDaarna stemming over het ${am.aangenomen ? 'gewijzigde ' : ''}raadsvoorstel: `
      : 'Uitslag: ';
    return `Fase: stemming in de raad. De stemmen liggen vast; verander ze niet.
${spelerRegel(sessie, fracties)}

${regels}

${amRegel}${uitslag.voor} stemmen voor, ${uitslag.tegen} tegen. Het raadsvoorstel is ${uitslag.aangenomen ? 'aangenomen' : 'verworpen'}.

Opdracht: geef per fractie hierboven één stemverklaring van maximaal 2 zinnen (hooguit 45 woorden) die past bij haar standpunt en het verloop${am ? ', en die waar dat logisch is beide stemmingen kort verklaart' : ''}.

Velden voor de tool "antwoord":
{"verklaringen": {"<fractie-id>": "..."}}`;
  }

  throw new Error('Onbekende soort: ' + soort);
}

// ─────────────────────────────────────────────────────────────
// STEMMING — regelgebaseerd, géén AI (scenario 2)
// ─────────────────────────────────────────────────────────────
/**
 * Stemregels (ontwerpkeuze, ter beoordeling door game-design).
 *
 * ZONDER amendement:
 * 1. Speler stemt zelf (spelerStem).
 * 2. Fractie met een akkoord uit de onderhandeling stemt zoals de speler.
 * 3. Anders: houding "voor" → voor, "tegen" → tegen.
 * 4. "twijfel" zonder akkoord: coalitiefracties steunen het collegevoorstel,
 *    oppositiefracties stemmen tegen (er bestaat geen onthouding in de raad).
 *
 * MET amendement (eerst amendement, dan het eventueel gewijzigde voorstel):
 * - Amendement: speler voor; akkoord → voor; anders houding_amendement;
 *   "twijfel" → voor als de fractie in hetzelfde blok zit als de speler
 *   (coalitie/oppositie), anders tegen.
 * - Raadsvoorstel: houding over het voorstel. Is het amendement aangenomen
 *   en stemde de fractie daarvoor, dan wordt "twijfel" → voor (haar wens zit
 *   er nu in). Overige "twijfel": regel 4. Een akkoord ging over het
 *   amendement en bepaalt hier niet direct de stem.
 * Fracties zonder (geldig) standpunt vallen terug op de startneiging.
 */
function telStemmen(stemmen, fracties) {
  let voor = 0, tegen = 0;
  for (const f of fracties) { if (stemmen[f.id].stem === 'voor') voor += f.zetels; else tegen += f.zetels; }
  return { stemmen, voor, tegen, aangenomen: voor > (voor + tegen) / 2 };
}

export function berekenAmendementStemming({ fracties, standpunten = {}, akkoord = {}, spelerFractie }) {
  const blokSpeler = (fracties.find(f => f.id === spelerFractie) || {}).positie;
  const stemmen = {};
  for (const f of fracties) {
    let stem, reden;
    if (f.id === spelerFractie) { stem = 'voor'; reden = 'speler'; }
    else if (akkoord[f.id] === true) { stem = 'voor'; reden = 'akkoord'; }
    else {
      const h = normaliseerHouding(standpunten[f.id]?.houding_amendement, 'twijfel');
      if (h === 'twijfel') { stem = f.positie === blokSpeler ? 'voor' : 'tegen'; reden = akkoord[f.id] === false ? 'geen_akkoord' : 'twijfel'; }
      else { stem = h; reden = akkoord[f.id] === false ? 'geen_akkoord' : 'standpunt'; }
    }
    stemmen[f.id] = { stem, reden, zetels: f.zetels };
  }
  return telStemmen(stemmen, fracties);
}

export function berekenStemming({ fracties, standpunten = {}, akkoord = {}, spelerFractie, spelerStem, hints = {}, amendement = null }) {
  const stemmen = {};
  for (const f of fracties) {
    let stem, reden;
    if (f.id === spelerFractie) {
      stem = spelerStem === 'voor' ? 'voor' : 'tegen';
      reden = 'speler';
    } else if (!amendement && akkoord[f.id] === true) {
      stem = spelerStem === 'voor' ? 'voor' : 'tegen';
      reden = 'akkoord';
    } else {
      const houding = normaliseerHouding(standpunten[f.id]?.houding, normaliseerHouding(hints[f.id]?.neiging));
      if (houding === 'twijfel') {
        if (amendement?.aangenomen && amendement.stemmen?.[f.id]?.stem === 'voor') { stem = 'voor'; reden = 'amendement'; }
        else { stem = f.positie === 'coalitie' ? 'voor' : 'tegen'; reden = !amendement && akkoord[f.id] === false ? 'geen_akkoord' : 'twijfel'; }
      } else {
        stem = houding;
        reden = !amendement && akkoord[f.id] === false ? 'geen_akkoord' : 'standpunt';
      }
    }
    stemmen[f.id] = { stem, reden, zetels: f.zetels };
  }
  const uit = telStemmen(stemmen, fracties);
  if (amendement) uit.amendement = amendement;
  return uit;
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
      ...(heeftAmendement(sessie) ? { houding_amendement: 'twijfel' } : {}),
      voorwaarde: h.voorwaarde || null,
    };
  }
  if (soort === 'vraag') {
    const s = (sessie.standpunten || {})[fractieId];
    return {
      tekst: `De fractie van ${naam(fractieId)} verwijst naar het eerder ingenomen standpunt${s?.tekst ? `: «${s.tekst}»` : '.'}`,
      houding: s?.houding || null, voorwaarde: s?.voorwaarde ?? null, houding_was: s?.houding || null,
      ...(s?.houding_amendement ? { houding_amendement: s.houding_amendement } : {}),
    };
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
export function normaliseerAntwoord(soort, parsed, fallback, { fractieIds = [], laatsteBeurt = false, huidig = null, metAmendement = false } = {}) {
  if (!parsed || typeof parsed !== 'object') return { ...fallback, _parseFout: true };
  if (soort === 'opening') {
    const tekst = typeof parsed.tekst === 'string' && parsed.tekst.trim() ? parsed.tekst.trim() : null;
    if (!tekst) return { ...fallback, _parseFout: true };
    const uit = {
      tekst,
      houding: normaliseerHouding(parsed.houding, fallback.houding),
      voorwaarde: typeof parsed.voorwaarde === 'string' && parsed.voorwaarde.trim() ? parsed.voorwaarde.trim() : null,
    };
    if (metAmendement) uit.houding_amendement = normaliseerHouding(parsed.houding_amendement, 'twijfel');
    return uit;
  }
  if (soort === 'vraag') {
    const tekst = typeof parsed.tekst === 'string' && parsed.tekst.trim() ? parsed.tekst.trim() : null;
    if (!tekst) return { ...fallback, _parseFout: true };
    const oud = huidig?.houding;
    const houding = beperkStap(oud, normaliseerHouding(parsed.houding, oud || 'twijfel'));
    const voorwaarde = parsed.voorwaarde === null ? null
      : (typeof parsed.voorwaarde === 'string' && parsed.voorwaarde.trim() ? parsed.voorwaarde.trim() : (huidig?.voorwaarde ?? null));
    const uit = { tekst, houding, voorwaarde, houding_was: oud || null };
    if (metAmendement) {
      const oudAm = huidig?.houding_amendement || 'twijfel';
      uit.houding_amendement = beperkStap(oudAm, normaliseerHouding(parsed.houding_amendement, oudAm));
      uit.houding_amendement_was = oudAm;
    }
    return uit;
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
