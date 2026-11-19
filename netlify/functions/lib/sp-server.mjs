/**
 * sp-server.mjs — server-side helpers voor de singleplayer-functions:
 * Supabase-auth, PostgREST/RPC-calls met de service role, config laden,
 * en de Anthropic-call zelf. Geen SDK-afhankelijkheden (alleen fetch).
 */
import { DEFAULT_CONFIG, mergeConfig, configUitEnv, ANTWOORD_TOOL } from './sp-shared.mjs';

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function env(naam) {
  // Netlify.env bestaat in de Functions-runtime; process.env lokaal/in tests
  try { if (globalThis.Netlify?.env?.get) { const v = globalThis.Netlify.env.get(naam); if (v !== undefined) return v; } } catch {}
  return process.env[naam];
}

function supabaseBasis() {
  const url = env('SUPABASE_URL');
  const service = env('SUPABASE_SERVICE_ROLE_KEY');
  const anon = env('SUPABASE_ANON_KEY');
  if (!url || !service || !anon) throw new Error('Supabase-configuratie ontbreekt (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)');
  return { url: url.replace(/\/$/, ''), service, anon };
}

/** Controleer de Supabase-JWT van de speler; geeft user-id of null. */
export async function verifieerGebruiker(req) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.length < 20) return null;
  const { url, anon } = supabaseBasis();
  const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: auth } });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id || null;
}

async function serviceFetch(pad, opties = {}) {
  const { url, service } = supabaseBasis();
  const res = await fetch(`${url}/rest/v1/${pad}`, {
    ...opties,
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      'Content-Type': 'application/json',
      ...(opties.headers || {}),
    },
  });
  if (!res.ok) {
    const tekst = await res.text().catch(() => '');
    throw new Error(`Supabase ${pad} → ${res.status} ${tekst.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

export function rpc(naam, args) {
  return serviceFetch(`rpc/${naam}`, { method: 'POST', body: JSON.stringify(args) });
}

export function select(pad) {
  return serviceFetch(pad, { method: 'GET' });
}

// ── Statische data in-memory cachen (warm containers) ──
const cache = new Map();
async function gecachet(sleutel, ttlMs, laad) {
  const hit = cache.get(sleutel);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await laad();
  cache.set(sleutel, { t: Date.now(), v });
  return v;
}
export function _leegCache() { cache.clear(); }

/** Config: code-defaults < env < Supabase (sp_npc_config, id='default'). */
export async function laadConfig() {
  return gecachet('config', 60_000, async () => {
    let db = {};
    try {
      const rijen = await select('sp_npc_config?id=eq.default&select=data');
      db = rijen?.[0]?.data || {};
    } catch (e) {
      console.warn('[sp] config uit Supabase niet geladen, gebruik defaults:', e.message);
    }
    return mergeConfig(DEFAULT_CONFIG, configUitEnv(process.env), db);
  });
}

export async function laadFracties() {
  return gecachet('fracties', 300_000, () => select('sp_fracties?select=*&order=volgorde.asc'));
}

export async function laadDossier(id) {
  return gecachet('dossier:' + id, 300_000, async () => {
    const rijen = await select(`sp_dossiers?id=eq.${encodeURIComponent(id)}&select=*`);
    return rijen?.[0] || null;
  });
}

/** Anthropic Messages API. Gooit bij fout/timeout; de aanroeper valt dan terug. */
export async function roepClaudeAan({ model, systeem, delta, maxTokens, config }) {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY ontbreekt');
  const cacheControl = config.cache_ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
  const headers = {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  const beta = env('ANTHROPIC_BETA');
  if (beta) headers['anthropic-beta'] = beta;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.timeout_ms);
  const t0 = Date.now();
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        tools: [ANTWOORD_TOOL],
        tool_choice: { type: 'tool', name: ANTWOORD_TOOL.name },
        system: [{ type: 'text', text: systeem, cache_control: cacheControl }],
        messages: [{ role: 'user', content: delta }],
      }),
    });
    if (!res.ok) {
      const tekst = await res.text().catch(() => '');
      throw new Error(`Anthropic ${res.status}: ${tekst.slice(0, 300)}`);
    }
    const data = await res.json();
    const tekst = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const tool = (data.content || []).find(b => b.type === 'tool_use' && b.name === ANTWOORD_TOOL.name);
    const invoer = tool && tool.input && typeof tool.input === 'object' && Object.keys(tool.input).length ? tool.input : null;
    return { tekst, invoer, usage: data.usage || {}, latency: Date.now() - t0, stop: data.stop_reason };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`timeout na ${config.timeout_ms} ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
