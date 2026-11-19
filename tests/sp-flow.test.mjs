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
  if (delta.includes('openingsstandpunt')) uit = { tekst: 'Wij zien voordelen, maar willen zekerheid over het verkeer.', houding: 'twijfel', voorwaarde: 'verkeersmaatregelen vooraf' };
  else if (delta.includes('vragenronde')) uit = { tekst: 'Dat hangt af van het verkeersonderzoek.' };
  else if (delta.includes('onderhandeling')) {
    const ids = [...delta.matchAll(/"([a-z]+)": true \| false/g)].map(m => m[1]);
    uit = { reacties: ids.map(id => ({ fractie: id, tekst: 'Als dat in het amendement komt, steunen wij het.' })), akkoord: Object.fromEntries(ids.map(id => [id, true])) };
  } else if (delta.includes('stemverklaring')) uit = { verklaringen: { sgp: 'Wij stemmen in vanwege de gezinswoningen.' } };
  const tekst = claudeGedrag === 'rommel' ? 'Sorry, geen JSON.' : '```json\n' + JSON.stringify(uit) + '\n```';
  return Response.json({
    content: [{ type: 'text', text: tekst }], stop_reason: 'end_turn',
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

  const start = await call(sessie, { actie: 'start', dossier_id: 'veldkamp-woningbouw', fractie_id: 'cda' });
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
  });

  await t.test('onderhandeling: max 2 fracties, 4 beurten, akkoord telt mee', async () => {
    assert.equal((await call(npc, { sessie_id: sid, soort: 'onderhandeling', fracties: ['gb', 'cu', 'pro'], tekst: 'Deal?' })).status, 400);
    for (let i = 1; i <= 4; i++) {
      const r = await call(npc, { sessie_id: sid, soort: 'onderhandeling', fracties: ['gb', 'pro'], tekst: `Voorstel ${i}: verkeersmaatregelen vooraf.` });
      assert.equal(r.status, 200, `beurt ${i}`);
      assert.equal(r.body.status.onderhandeling_beurten_over, 4 - i);
    }
    assert.equal((await call(npc, { sessie_id: sid, soort: 'onderhandeling', tekst: 'Nog één?' })).status, 429);
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
    assert.equal(k.calls, 6 + 3 + 4 + 1);
    assert.equal(k.fallbacks, 1);
    assert.ok(Number(k.kosten_usd) > 0 && Number(k.kosten_usd) < 0.12, 'kosten ' + k.kosten_usd);
    const s = sql(`select row_to_json(s) from sp_sessies s where id = '${sid}'`);
    assert.equal(s.fase, 'afgerond');
    assert.equal(s.calls_gebruikt, 14);
  });

  await t.test('circuit breaker: na max_calls gescript, geen Claude-call meer', async () => {
    const s2 = (await call(sessie, { actie: 'start', dossier_id: 'veldkamp-woningbouw', fractie_id: 'pro' })).body.sessie.id;
    await call(sessie, { sessie_id: s2, actie: 'inbreng', positie: 'tegen', inbreng: 'Meer sociale huur.' });
    sql(`update sp_sessies set caps = caps || '{"max_calls": 1}' where id = '${s2}'; select 'null'`);
    claudeLog.length = 0;
    await call(npc, { sessie_id: s2, soort: 'opening', fractie_id: 'sgp' });
    const tweede = await call(npc, { sessie_id: s2, soort: 'opening', fractie_id: 'cda' });
    assert.equal(claudeLog.length, 1);
    assert.equal(tweede.body.fallback, true);
    assert.equal(tweede.body.antwoord.houding, 'voor', 'startneiging uit dossier');
  });

  await t.test('modeloutput zonder JSON → gescript, gelogd als fallback', async () => {
    const s3 = (await call(sessie, { actie: 'start', dossier_id: 'veldkamp-woningbouw', fractie_id: 'vvd' })).body.sessie.id;
    await call(sessie, { sessie_id: s3, actie: 'inbreng', positie: 'voor', inbreng: 'Snel bouwen.' });
    claudeGedrag = 'rommel';
    const r = await call(npc, { sessie_id: s3, soort: 'opening', fractie_id: 'fvd' });
    claudeGedrag = 'ok';
    assert.equal(r.body.fallback, true);
    assert.equal(sql(`select to_json(fallback_reden) from sp_tokenlog where sessie_id = '${s3}'`), 'parse');
  });
});
