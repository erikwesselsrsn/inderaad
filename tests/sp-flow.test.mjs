/**
 * End-to-end test van de singleplayer-functions tegen een ECHTE Postgres
 * (met de migraties toegepast), met een gesimuleerde Supabase-REST-laag en
 * een gesimuleerde Anthropic API.
 *
 * Draait alleen als SP_TEST_PSQL gezet is, bijv.:
 *   SP_TEST_PSQL="psql -h /tmp -p 5499 -U postgres -d t" node --test tests/
 * De database moet de migraties + een auth.users-stub bevatten (zie
 * tests/README.md).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const PSQL = process.env.SP_TEST_PSQL;
const USER = '33333333-3333-3333-3333-333333333333';

function sql(q) {
  const out = execSync(`${PSQL} -At -v ON_ERROR_STOP=1`, { input: q, encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : null;
}
const lit = v => (v === null || v === undefined ? 'null' : `$sp$${typeof v === 'string' ? v : JSON.stringify(v)}$sp$`);

const claudeLog = [];
let claudeGedrag = 'ok';

function nepClaude(body) {
  const delta = body.messages[0].content;
  claudeLog.push({ model: body.model, cache: body.system[0].cache_control, delta });
  if (claudeGedrag === 'fout') return new Response('overloaded', { status: 529 });
  let uit;
  if (delta.includes('openingsstandpunt')) uit = { tekst: 'Wij zien voordelen, maar willen zekerheid over het verkeer.', houding: 'twijfel', voorwaarde: 'verkeersmaatregelen vooraf', ...(delta.includes('houding_amendement') ? { houding_amendement: 'tegen' } : {}) };
  else if (delta.includes('vragenronde')) uit = { tekst: 'Met die toezegging over het verkeer kunnen wij meegaan.', houding: 'voor', voorwaarde: null };
  else if (delta.includes('onderhandeling')) {
    const ids = [...delta.matchAll(/"([a-z]+)": true \| false/g)].map(m => m[1]);
    uit = { reacties: ids.map(id => ({ fractie: id, tekst: 'Als dat in het amendement komt, steunen wij het.' })), akkoord: Object.fromEntries(ids.map(id => [id, true])) };
  } else if (delta.includes('stemverklaring')) uit = { verklaringen: { sgp: 'Wij stemmen in vanwege de gezinswoningen.' } };
  assert.equal(body.tool_choice?.name, 'antwoord', 'tool geforceerd');
  // afwisselend tool_use (normale route) en JSON in tekst (terugvaloptie)
  const content = claudeGedrag === 'rommel' ? [{ type: 'text', text: 'Sorry, geen JSON.' }]
    : claudeLog.length % 2 ? [{ type: 'tool_use', id: 't1', name: 'antwoord', input: uit }]
    : [{ type: 'text', text: '```json\n' + JSON.stringify(uit) + '\n```' }];
  return Response.json({
    content, stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn',
    usage: { input_tokens: 400, cache_creation_input_tokens: claudeLog.length === 1 ? 2100 : 0, cache_read_input_tokens: claudeLog.length === 1 ? 0 : 2100, output_tokens: 150 },
  });
}

function nepSupabase(url, init) {
  const u = new URL(url);
  if (u.pathname === '/auth/v1/user') {
    return init.headers.Authorization === 'Bearer goed-token-123456789' ? Response.json({ id: USER }) : new Response('{}', { status: 401 });
  }
  const pad = u.pathname.replace('/rest/v1/', '');
  if (pad.startsWith('rpc/')) {
    const naam = pad.slice(4);
    const args = JSON.parse(init.body);
    const params = Object.entries(args).map(([k, v]) => {
      if (Array.isArray(v) && v.every(x => typeof x === 'string')) return `${k} => ${v.length ? `array[${v.map(x => lit(x)).join(',')}]::text[]` : 'null'}`;
      if (v && typeof v === 'object') return `${k} => ${lit(v)}::jsonb`;
      return `${k} => ${lit(v)}`;
    }).join(', ');
    return Response.json(sql(`select public.${naam}(${params})`));
  }
  if (pad === 'sp_npc_config') return Response.json([{ data: {} }]);
  if (pad === 'sp_sessies') return Response.json(sql(`select coalesce(json_agg(x), '[]') from sp_sessies x where id = ${lit(u.searchParams.get('id').slice(3))} and user_id = ${lit(u.searchParams.get('user_id').slice(3))}`));
  if (pad === 'sp_fracties') return Response.json(sql(`select json_agg(f order by volgorde) from sp_fracties f`));
  if (pad === 'sp_dossiers') return Response.json(sql(`select json_agg(d) from sp_dossiers d where id = ${lit(u.searchParams.get('id').slice(3))}`));
  if (pad === 'sp_berichten') {
    const w = [`sessie_id = ${lit(u.searchParams.get('sessie_id').slice(3))}`, `soort = ${lit(u.searchParams.get('soort').slice(3))}`];
    if (u.searchParams.get('fractie_id')) w.push(`fractie_id = ${lit(u.searchParams.get('fractie_id').slice(3))}`);
    return Response.json(sql(`select coalesce(json_agg(b order by id), '[]') from (select * from sp_berichten where ${w.join(' and ')}) b`));
  }
  return new Response('onbekend pad ' + pad, { status: 404 });
}

const req = (body, token = 'goed-token-123456789') => new Request('http://x/api', {
  method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('singleplayer-flow end-to-end', { skip: !PSQL && 'SP_TEST_PSQL niet gezet' }, async (t) => {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://sb.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', ANTHROPIC_API_KEY: 'sk-test',
  });
  sql(`insert into auth.users values ('${USER}') on conflict do nothing; delete from sp_sessies where user_id = '${USER}'; select 'null'`);
  globalThis.fetch = async (url, init = {}) => (String(url).startsWith('https://api.anthropic.com') ? nepClaude(JSON.parse(init.body)) : nepSupabase(String(url), init));

  const sessie = (await import('../netlify/functions/sp-sessie.mjs')).default;
  const npc = (await import('../netlify/functions/npc-fractie.mjs')).default;
  const call = async (fn, body, token) => { const r = await fn(req(body, token)); return { status: r.status, body: await r.json() }; };

  await t.test('zonder geldige login: 401', async () => {
    assert.equal((await call(npc, { sessie_id: USER, soort: 'opening', fractie_id: 'sgp' }, 'fout-token-123456789')).status, 401);
  });

  const start = await call(sessie, { actie: 'start', dossier_id: 'banis-omgevingsplan', fractie_id: 'cda' });
  assert.equal(start.status, 200);
  const sid = start.body.sessie.id;

  await t.test('opening vóór inbreng wordt geweigerd', async () => {
    const r = await call(npc, { sessie_id: sid, soort: 'opening', fractie_id: 'sgp' });
    assert.equal(r.status, 409);
    assert.equal(r.body.reden, 'geen_inbreng');
  });

  assert.equal((await call(sessie, { sessie_id: sid, actie: 'inbreng', positie: 'voor', inbreng: 'Wij willen snel bouwen, met aandacht voor ouderen.' })).status, 200);

  await t.test('openingen: eerste alleen (cache warm), daarna parallel; Sonnet + 1h-cache', async () => {
    const eerste = await call(npc, { sessie_id: sid, soort: 'opening', fractie_id: 'sgp' });
    assert.equal(eerste.status, 200);
    assert.equal(eerste.body.antwoord.houding, 'twijfel');
    const rest = await Promise.all(['gb', 'cu', 'fvd', 'vvd', 'pro'].map(f => call(npc, { sessie_id: sid, soort: 'opening', fractie_id: f })));
    assert.ok(rest.every(r => r.status === 200));
    assert.ok(claudeLog.every(c => c.model === 'claude-sonnet-5-5' && c.cache.ttl === '1h'));
    assert.equal((await call(npc, { sessie_id: sid, soort: 'opening', fractie_id: 'sgp' })).body.reden, 'al_geopend');
  });

  await t.test('vraag kan houding één stap laten opschuiven en wordt opgeslagen', async () => {
    // alle openingen zijn "twijfel" in de nep; zet fvd op "tegen" om de stapbeperking te testen
    sql(`update sp_sessies set standpunten = jsonb_set(standpunten, '{fvd,houding}', '"tegen"') where id = '${sid}'; select 'null'`);
    const r = await call(npc, { sessie_id: sid, soort: 'vraag', fractie_id: 'fvd', tekst: 'Wat als het verkeersonderzoek eerst komt?' });
    assert.equal(r.status, 200);
    assert.equal(r.body.antwoord.houding, 'twijfel', 'tegen → voor wordt beperkt tot één stap');
    assert.equal(r.body.antwoord.houding_was, 'tegen');
    const s = sql(`select standpunten->'fvd' from sp_sessies where id = '${sid}'`);
    assert.equal(s.houding, 'twijfel');
    assert.ok(s.tekst, 'openingstekst blijft bewaard');
    assert.equal(s.voorwaarde, null);
  });

  await t.test('vragen op Haiku, cap van 2 per fractie', async () => {
    claudeLog.length = 0;
    const v1 = await call(npc, { sessie_id: sid, soort: 'vraag', fractie_id: 'gb', tekst: 'Wat moet er gebeuren met de toegangsweg?' });
    const v2 = await call(npc, { sessie_id: sid, soort: 'vraag', fractie_id: 'gb', tekst: 'En als het onderzoek tegenvalt?' });
    const v3 = await call(npc, { sessie_id: sid, soort: 'vraag', fractie_id: 'gb', tekst: 'Nog eentje?' });
    assert.equal(v1.status, 200); assert.equal(v1.body.status.vragen_over, 1);
    assert.equal(v2.body.status.vragen_over, 0);
    assert.equal(v3.status, 429); assert.equal(v3.body.reden, 'vragencap');
    assert.equal(claudeLog.length, 2);
    assert.ok(claudeLog.every(c => c.model === 'claude-haiku-5-5'));
    assert.ok(claudeLog[1].delta.includes('Wat moet er gebeuren met de toegangsweg?'), 'eerdere vraag zit in de delta');
  });

  await t.test('API-fout → gescript antwoord, sessie loopt door', async () => {
    claudeGedrag = 'fout';
    const r = await call(npc, { sessie_id: sid, soort: 'vraag', fractie_id: 'cu', tekst: 'Hoe hard is de 30%?' });
    claudeGedrag = 'ok';
    assert.equal(r.status, 200);
    assert.equal(r.body.fallback, true);
    assert.match(r.body.antwoord.tekst, /eerder ingenomen standpunt/);
    assert.equal(sql(`select to_json(standpunten->'cu'->>'houding') from sp_sessies where id = '${sid}'`), 'twijfel', 'fallback verandert houding niet');
  });

  await t.test('onderhandeling: per bericht 1–2 fracties, wisselen mag, totaal 6 berichten', async () => {
    assert.equal((await call(npc, { sessie_id: sid, soort: 'onderhandeling', fracties: ['gb', 'cu', 'pro'], tekst: 'Deal?' })).status, 400);
    assert.equal((await call(npc, { sessie_id: sid, soort: 'onderhandeling', tekst: 'Zonder fractie' })).status, 400);
    const volgorde = [['sgp'], ['gb'], ['gb', 'pro'], ['fvd'], ['vvd'], ['pro']];
    claudeLog.length = 0;
    for (let i = 0; i < volgorde.length; i++) {
      const r = await call(npc, { sessie_id: sid, soort: 'onderhandeling', fracties: volgorde[i], tekst: `Voorstel ${i + 1}: verkeersmaatregelen vooraf.` });
      assert.equal(r.status, 200, `bericht ${i + 1}`);
      assert.deepEqual(r.body.antwoord.reacties.map(x => x.fractie), volgorde[i]);
      assert.equal(r.body.status.onderhandeling_beurten_over, 6 - (i + 1));
    }
    // delta bij gb+pro bevat het eerdere gesprek met gb, niet dat met sgp
    assert.ok(claudeLog[2].delta.includes('Voorstel 2'));
    assert.ok(!claudeLog[2].delta.includes('Voorstel 1'));
    assert.equal((await call(npc, { sessie_id: sid, soort: 'onderhandeling', fracties: ['cu'], tekst: 'Nog één?' })).status, 429);
    const oh = sql(`select onderhandeling from sp_sessies where id = '${sid}'`);
    assert.deepEqual(oh.fracties.sort(), ['fvd', 'gb', 'pro', 'sgp', 'vvd']);
    assert.equal(oh.akkoord.sgp, true);
  });

  await t.test('stemming: regelgebaseerd + stemverklaringen, daarna afgerond', async () => {
    const r = await call(npc, { sessie_id: sid, soort: 'stemverklaringen', speler_stem: 'voor' });
    assert.equal(r.status, 200);
    const u = r.body.uitslag;
    assert.equal(u.voor + u.tegen, 25);
    assert.equal(u.stemmen.pro.stem, 'voor'); assert.equal(u.stemmen.pro.reden, 'akkoord');
    assert.equal(u.stemmen.cu.stem, 'tegen', 'twijfel in oppositie zonder akkoord');
    assert.equal(Object.keys(u.verklaringen).length, 6);
    assert.equal(u.verklaringen.sgp, 'Wij stemmen in vanwege de gezinswoningen.');
    assert.equal((await call(npc, { sessie_id: sid, soort: 'vraag', fractie_id: 'vvd', tekst: 'Nog iets?' })).body.reden, 'afgerond');
  });

  await t.test('tokenlog en kosten zijn bijgehouden', () => {
    const k = sql(`select row_to_json(k) from sp_kosten_per_sessie k where sessie_id = '${sid}'`);
    assert.equal(k.calls, 6 + 4 + 6 + 1);
    assert.equal(k.fallbacks, 1);
    assert.ok(Number(k.kosten_usd) > 0 && Number(k.kosten_usd) < 0.12, 'kosten ' + k.kosten_usd);
    const s = sql(`select row_to_json(s) from sp_sessies s where id = '${sid}'`);
    assert.equal(s.fase, 'afgerond');
    assert.equal(s.calls_gebruikt, 17);
  });

  await t.test('circuit breaker: na max_calls gescript, geen Claude-call meer', async () => {
    const s2 = (await call(sessie, { actie: 'start', dossier_id: 'banis-omgevingsplan', fractie_id: 'pro' })).body.sessie.id;
    await call(sessie, { sessie_id: s2, actie: 'inbreng', positie: 'tegen', inbreng: 'Meer sociale huur.' });
    sql(`update sp_sessies set caps = caps || '{"max_calls": 1}' where id = '${s2}'; select 'null'`);
    claudeLog.length = 0;
    await call(npc, { sessie_id: s2, soort: 'opening', fractie_id: 'sgp' });
    const tweede = await call(npc, { sessie_id: s2, soort: 'opening', fractie_id: 'cda' });
    assert.equal(claudeLog.length, 1);
    assert.equal(tweede.body.fallback, true);
    assert.equal(tweede.body.antwoord.houding, 'voor', 'startneiging uit dossier');
  });

  await t.test('amendement: eerst stemmen over amendement, dan over het voorstel', async () => {
    const s4 = (await call(sessie, { actie: 'start', dossier_id: 'banis-omgevingsplan', fractie_id: 'cu' })).body.sessie.id;
    const ib = await call(sessie, { sessie_id: s4, actie: 'inbreng', positie: 'voor', inbreng: 'Wij steunen De Banis.', amendement: 'Het aandeel sociale huur gaat naar 35%.' });
    assert.equal(ib.body.sessie.amendement.tekst, 'Het aandeel sociale huur gaat naar 35%.');
    claudeLog.length = 0;
    const op = await call(npc, { sessie_id: s4, soort: 'opening', fractie_id: 'pro' });
    assert.equal(op.body.antwoord.houding_amendement, 'tegen');
    assert.ok(claudeLog[0].delta.includes('Amendement van ChristenUnie'), 'amendement zit in de delta');
    // overige openingen
    await Promise.all(['sgp', 'cda', 'gb', 'fvd', 'vvd'].map(f => call(npc, { sessie_id: s4, soort: 'opening', fractie_id: f })));
    // amendement aanpassen mag tot de stemming
    const aanp = await call(sessie, { sessie_id: s4, actie: 'amendement', tekst: 'Het aandeel sociale huur gaat naar 40%.' });
    assert.equal(aanp.body.sessie.amendement.tekst, 'Het aandeel sociale huur gaat naar 40%.');
    // akkoord met PRO via onderhandeling
    await call(npc, { sessie_id: s4, soort: 'onderhandeling', fracties: ['pro'], tekst: 'Steunt u ons amendement van 40%?' });
    // stemverklaringen vóór amendementstemming: geweigerd
    const te_vroeg = await call(npc, { sessie_id: s4, soort: 'stemverklaringen', speler_stem: 'voor' });
    assert.equal(te_vroeg.status, 409); assert.equal(te_vroeg.body.reden, 'eerst_amendement');
    const am = await call(sessie, { sessie_id: s4, actie: 'stem_amendement' });
    assert.equal(am.status, 200);
    const au = am.body.sessie.amendement.uitslag;
    assert.equal(au.stemmen.cu.stem, 'voor');
    assert.equal(au.stemmen.pro.stem, 'voor', 'akkoord → voor amendement');
    assert.equal(au.stemmen.sgp.stem, 'tegen', 'houding_amendement tegen');
    assert.equal(au.voor, 3 + 1);
    assert.equal(au.aangenomen, false);
    // aanpassen na de stemming kan niet meer
    assert.equal((await call(sessie, { sessie_id: s4, actie: 'amendement', tekst: 'later' })).status, 409);
    const st = await call(npc, { sessie_id: s4, soort: 'stemverklaringen', speler_stem: 'voor' });
    assert.equal(st.status, 200);
    assert.equal(st.body.uitslag.amendement.aangenomen, false);
    assert.equal(st.body.uitslag.voor + st.body.uitslag.tegen, 25);
    assert.ok(claudeLog.at(-1).delta.includes('Stemming over het amendement'));
  });

  await t.test('modeloutput zonder JSON → gescript, gelogd als fallback', async () => {
    const s3 = (await call(sessie, { actie: 'start', dossier_id: 'banis-omgevingsplan', fractie_id: 'vvd' })).body.sessie.id;
    await call(sessie, { sessie_id: s3, actie: 'inbreng', positie: 'voor', inbreng: 'Snel bouwen.' });
    claudeGedrag = 'rommel';
    const r = await call(npc, { sessie_id: s3, soort: 'opening', fractie_id: 'fvd' });
    claudeGedrag = 'ok';
    assert.equal(r.body.fallback, true);
    assert.match(sql(`select to_json(fallback_reden) from sp_tokenlog where sessie_id = '${s3}'`), /^parse: Sorry, geen JSON\./);
  });
});
