// node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG, mergeConfig, configUitEnv, modelVoor, berekenKosten, parseJsonUitTekst,
  berekenStemming, vermijdHits, schoonInvoer, normaliseerAntwoord, fallbackAntwoord, bouwDelta, bouwStatischePrompt,
  redAfgekapteJson, beperkStap, berekenAmendementStemming,
} from '../netlify/functions/lib/sp-shared.mjs';

const FRACTIES = [
  { id: 'sgp', naam: 'SGP', zetels: 8, positie: 'coalitie', profiel: {} },
  { id: 'cda', naam: 'CDA', zetels: 4, positie: 'coalitie', profiel: {} },
  { id: 'gb', naam: 'Gemeentebelang', zetels: 4, positie: 'coalitie', profiel: {} },
  { id: 'cu', naam: 'ChristenUnie', zetels: 3, positie: 'oppositie', profiel: {} },
  { id: 'fvd', naam: 'FvD', zetels: 3, positie: 'oppositie', profiel: {} },
  { id: 'vvd', naam: 'VVD', zetels: 2, positie: 'oppositie', profiel: {} },
  { id: 'pro', naam: 'PRO', zetels: 1, positie: 'oppositie', profiel: {} },
];

test('hybride routering: Sonnet voor opening/onderhandeling/stem, Haiku voor vragen', () => {
  assert.equal(modelVoor('opening', DEFAULT_CONFIG), 'claude-sonnet-5-5');
  assert.equal(modelVoor('onderhandeling', DEFAULT_CONFIG), 'claude-sonnet-5-5');
  assert.equal(modelVoor('stemverklaringen', DEFAULT_CONFIG), 'claude-sonnet-5-5');
  assert.equal(modelVoor('vraag', DEFAULT_CONFIG), 'claude-haiku-5-5');
});

test('modelnaam configureerbaar: env < Supabase', () => {
  const c = mergeConfig(DEFAULT_CONFIG, configUitEnv({ NPC_MODEL_ROUTINE: 'env-model' }), { modellen: { premium: 'db-model' } });
  assert.equal(modelVoor('vraag', c), 'env-model');
  assert.equal(modelVoor('opening', c), 'db-model');
  assert.equal(c.caps.max_vragen_per_fractie, 2, 'overige defaults blijven staan');
});

test('kosten: cache-write 1h, cache-read en output correct', () => {
  // 2000 cache-write (1h) + 300 input + 150 output op Sonnet 5.5
  const k = berekenKosten({ input_tokens: 300, cache_creation_input_tokens: 2000, output_tokens: 150 }, 'claude-sonnet-5-5', DEFAULT_CONFIG);
  assert.equal(k, +(300 * 2 / 1e6 + 2000 * 4 / 1e6 + 150 * 10 / 1e6).toFixed(6));
  const hit = berekenKosten({ input_tokens: 300, cache_read_input_tokens: 2000, output_tokens: 150 }, 'claude-sonnet-5-5', DEFAULT_CONFIG);
  assert.ok(hit < k / 3, 'cache-hit is veel goedkoper');
  assert.equal(berekenKosten({}, 'onbekend-model', DEFAULT_CONFIG), null);
});

test('sessiekosten scenario 2 vallen binnen de bandbreedte uit het voorstel', () => {
  // 6 openingen (1e schrijft cache), 12 vragen (1e schrijft cache), 4 onderhandeling, 1 stemming
  const S = 'claude-sonnet-5-5', H = 'claude-haiku-5-5', STAT = 2200;
  let totaal = 0;
  const sonnet = [...Array(13)].map((_, i) => ({ input_tokens: 450, output_tokens: 220, [i === 0 ? 'cache_creation_input_tokens' : 'cache_read_input_tokens']: STAT }));
  const haiku = [...Array(12)].map((_, i) => ({ input_tokens: 500, output_tokens: 120, [i === 0 ? 'cache_creation_input_tokens' : 'cache_read_input_tokens']: STAT }));
  sonnet.forEach(u => { totaal += berekenKosten(u, S, DEFAULT_CONFIG); });
  haiku.forEach(u => { totaal += berekenKosten(u, H, DEFAULT_CONFIG); });
  assert.ok(totaal > 0.03 && totaal < 0.08, `sessiekosten ${totaal.toFixed(4)} buiten verwachting`);
  assert.ok(totaal < DEFAULT_CONFIG.caps.max_kosten_usd);
});

test('JSON-parser: met fence, met tekst eromheen, met accolade in string', () => {
  assert.deepEqual(parseJsonUitTekst('```json\n{"tekst":"a"}\n```'), { tekst: 'a' });
  assert.deepEqual(parseJsonUitTekst('Hier: {"tekst":"x {y}"} klaar'), { tekst: 'x {y}' });
  assert.equal(parseJsonUitTekst('geen json'), null);
  assert.equal(parseJsonUitTekst('{"kapot": '), null);
});

test('stemming: standpunten, akkoord en twijfel-regel', () => {
  const standpunten = { sgp: { houding: 'voor' }, gb: { houding: 'twijfel' }, cu: { houding: 'twijfel' }, fvd: { houding: 'tegen' }, vvd: { houding: 'voor' }, pro: { houding: 'tegen' } };
  const u = berekenStemming({ fracties: FRACTIES, standpunten, akkoord: { pro: true }, spelerFractie: 'cda', spelerStem: 'voor' });
  assert.equal(u.stemmen.cda.stem, 'voor');
  assert.equal(u.stemmen.pro.stem, 'voor', 'akkoord → stemt met speler');
  assert.equal(u.stemmen.gb.stem, 'voor', 'twijfel coalitie → voor');
  assert.equal(u.stemmen.cu.stem, 'tegen', 'twijfel oppositie → tegen');
  assert.equal(u.voor + u.tegen, 25);
  assert.equal(u.voor, 8 + 4 + 4 + 2 + 1);
  assert.equal(u.aangenomen, true);
});

test('stemming: speler stemt tegen, akkoord-fracties volgen, startneiging als vangnet', () => {
  const u = berekenStemming({
    fracties: FRACTIES, standpunten: {}, akkoord: { sgp: true, gb: false },
    spelerFractie: 'pro', spelerStem: 'tegen',
    hints: { sgp: { neiging: 'voor' }, cda: { neiging: 'voor' }, gb: { neiging: 'twijfel' }, cu: { neiging: 'twijfel' }, fvd: { neiging: 'tegen' }, vvd: { neiging: 'voor' } },
  });
  assert.equal(u.stemmen.sgp.stem, 'tegen');
  assert.equal(u.stemmen.gb.reden, 'geen_akkoord');
  assert.equal(u.voor, 4 + 4 + 2); // cda, gb, vvd
  assert.equal(u.aangenomen, false);
});

test('vermijdlijst en invoerschoonmaak', () => {
  assert.deepEqual(vermijdHits('Wij zeggen: Samen Sterk! En we nemen het mee.'), ['samen sterk', 'we nemen het mee']);
  assert.equal(schoonInvoer('  a\u0000b  ', 600), 'ab');
  assert.equal(schoonInvoer('x'.repeat(700), 600).length, 600);
  assert.equal(schoonInvoer(42), '');
});

test('normaliseren: onbruikbare output valt terug op gescript antwoord', () => {
  const fb = { tekst: 'fallback', houding: 'voor', voorwaarde: null };
  assert.equal(normaliseerAntwoord('opening', null, fb)._parseFout, true);
  const ok = normaliseerAntwoord('opening', { tekst: 'Wij twijfelen.', houding: 'TWIJFEL', voorwaarde: '' }, fb);
  assert.deepEqual(ok, { tekst: 'Wij twijfelen.', houding: 'twijfel', voorwaarde: null });
  const onderh = normaliseerAntwoord('onderhandeling',
    { reacties: [{ fractie: 'gb', tekst: 'Prima' }, { fractie: 'xx', tekst: 'nee' }], akkoord: { gb: true } },
    { reacties: [], akkoord: {} }, { fractieIds: ['gb', 'cu'], laatsteBeurt: true });
  assert.deepEqual(onderh.reacties, [{ fractie: 'gb', tekst: 'Prima' }]);
  assert.deepEqual(onderh.akkoord, { gb: true, cu: false }, 'laatste beurt: geen open eind');
});

test('fallbacks per soort', () => {
  const dossier = { inhoud: { fractie_hints: { sgp: { neiging: 'voor', fallback_standpunt: 'Gescript.' } } } };
  const sessie = { speler_fractie: 'cda', standpunten: { sgp: { tekst: 'Wij steunen dit.' } } };
  assert.equal(fallbackAntwoord({ soort: 'opening', sessie, fracties: FRACTIES, fractieId: 'sgp', dossier }).tekst, 'Gescript.');
  assert.match(fallbackAntwoord({ soort: 'vraag', sessie, fracties: FRACTIES, fractieId: 'sgp', dossier }).tekst, /eerder ingenomen standpunt/);
  const uitslag = berekenStemming({ fracties: FRACTIES, spelerFractie: 'cda', spelerStem: 'voor' });
  const st = fallbackAntwoord({ soort: 'stemverklaringen', sessie, fracties: FRACTIES, dossier, uitslag });
  assert.equal(Object.keys(st.verklaringen).length, 6, 'niet voor de speler zelf');
});

test('prompts: statisch deel bevat geen sessie-inhoud, delta wel', () => {
  const dossier = { titel: 'T', inhoud: { titel: 'T', raadsvoorstel: 'RV', feiten: ['f1'], opties: [{ titel: 'o', omschrijving: 'x' }], fractie_hints: {} } };
  const sessie = { speler_fractie: 'cda', speler_positie: 'voor', speler_inbreng: 'GEHEIME-INBRENG', standpunten: {}, caps: DEFAULT_CONFIG.caps };
  const stat = bouwStatischePrompt(dossier, FRACTIES);
  assert.ok(!stat.includes('GEHEIME-INBRENG'));
  assert.ok(stat.includes('Geen partij is "de goede"'));
  const delta = bouwDelta({ soort: 'opening', sessie, fracties: FRACTIES, fractieId: 'sgp' });
  assert.ok(delta.includes('GEHEIME-INBRENG'));
  assert.ok(delta.length < 1500, 'delta blijft klein');
});

test('afgekapte JSON: tekst redden tot de laatste volledige zin', () => {
  const afgekapt = '{"tekst": "Wij zien voordelen in snel bouwen. Wel maken wij ons zorgen over het verkeer op de toegangsweg. Daarom vragen wij het college om een toezeg';
  const r = redAfgekapteJson(afgekapt);
  assert.equal(r.tekst, 'Wij zien voordelen in snel bouwen. Wel maken wij ons zorgen over het verkeer op de toegangsweg.');
  assert.equal(r.houding, undefined);
  const metHouding = redAfgekapteJson('{"tekst": "Prima voorstel.", "houding": "voor", "voorwaarde": "dat het verk');
  assert.deepEqual(metHouding, { tekst: 'Prima voorstel.', houding: 'voor' });
  assert.equal(redAfgekapteJson('{"tekst": "Wij'), null, 'te weinig over om te redden');
  assert.deepEqual(redAfgekapteJson('{"tekst": "Een \\"aanhaling\\" hier."}'), { tekst: 'Een "aanhaling" hier.' });
});

test('houding schuift per vraag maximaal één stap', () => {
  assert.equal(beperkStap('tegen', 'voor'), 'twijfel');
  assert.equal(beperkStap('voor', 'tegen'), 'twijfel');
  assert.equal(beperkStap('twijfel', 'voor'), 'voor');
  assert.equal(beperkStap('tegen', 'tegen'), 'tegen');
  const n = normaliseerAntwoord('vraag', { tekst: 'Goed punt, wij gaan mee.', houding: 'voor', voorwaarde: null },
    { tekst: 'fb' }, { huidig: { houding: 'tegen', voorwaarde: 'eerst onderzoek' } });
  assert.deepEqual(n, { tekst: 'Goed punt, wij gaan mee.', houding: 'twijfel', voorwaarde: null, houding_was: 'tegen' });
  const zonderVoorwaarde = normaliseerAntwoord('vraag', { tekst: 'Nee.', houding: 'tegen' },
    { tekst: 'fb' }, { huidig: { houding: 'tegen', voorwaarde: 'eerst onderzoek' } });
  assert.equal(zonderVoorwaarde.voorwaarde, 'eerst onderzoek', 'ontbrekende voorwaarde blijft staan');
});

test('max_tokens ruim genoeg voor de gevraagde lengte', () => {
  // ~90 woorden NL ≈ 160–200 tokens + JSON-overhead; plafond moet daar ruim boven zitten
  assert.ok(DEFAULT_CONFIG.max_tokens.opening >= 600);
  assert.ok(DEFAULT_CONFIG.max_tokens.vraag >= 400);
  assert.ok(DEFAULT_CONFIG.max_tokens.onderhandeling >= 2 * 400);
  assert.ok(DEFAULT_CONFIG.max_tokens.stemverklaringen >= 6 * 150);
});

test('amendementstemming: speler, akkoord, houding en blokregel bij twijfel', () => {
  const standpunten = {
    sgp: { houding: 'voor', houding_amendement: 'tegen' }, cda: { houding: 'voor', houding_amendement: 'twijfel' },
    gb: { houding: 'twijfel', houding_amendement: 'twijfel' }, fvd: { houding: 'tegen', houding_amendement: 'voor' },
    vvd: { houding: 'voor', houding_amendement: 'tegen' }, pro: { houding: 'tegen', houding_amendement: 'twijfel' },
  };
  const am = berekenAmendementStemming({ fracties: FRACTIES, standpunten, akkoord: { gb: true }, spelerFractie: 'cu' });
  assert.equal(am.stemmen.cu.stem, 'voor');
  assert.equal(am.stemmen.gb.stem, 'voor', 'akkoord');
  assert.equal(am.stemmen.cda.stem, 'tegen', 'twijfel, ander blok (coalitie vs oppositie-speler)');
  assert.equal(am.stemmen.pro.stem, 'voor', 'twijfel, zelfde blok als speler');
  assert.equal(am.stemmen.fvd.stem, 'voor');
  assert.equal(am.voor, 3 + 4 + 3 + 1);
  assert.equal(am.aangenomen, false);

  // aangenomen amendement trekt twijfelaars die ervoor stemden over de streep
  const amAan = { ...am, aangenomen: true };
  const eind = berekenStemming({ fracties: FRACTIES, standpunten, akkoord: { gb: true }, spelerFractie: 'cu', spelerStem: 'voor', amendement: amAan });
  assert.equal(eind.stemmen.gb.stem, 'voor'); assert.equal(eind.stemmen.gb.reden, 'amendement');
  assert.equal(eind.stemmen.pro.stem, 'tegen', 'houding tegen blijft tegen');
  assert.equal(eind.stemmen.fvd.stem, 'tegen');
  assert.ok(eind.amendement);
  // met amendement telt een akkoord niet als 'stemt mee' bij het voorstel
  const eind2 = berekenStemming({ fracties: FRACTIES, standpunten: { ...standpunten, gb: { houding: 'tegen' } }, akkoord: { gb: true }, spelerFractie: 'cu', spelerStem: 'voor', amendement: { ...am, aangenomen: false } });
  assert.equal(eind2.stemmen.gb.stem, 'tegen');
});
