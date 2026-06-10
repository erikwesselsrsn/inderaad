/**
 * mint-firebase-token.mjs
 * Wisselt een geldige Supabase JWT in voor een Firebase custom token.
 * De client gebruikt dit token om firebase.auth().signInWithCustomToken() aan te roepen,
 * zodat Firebase weet wie de gebruiker is en de security rules kunnen controleren.
 *
 * Vereiste env vars (in Netlify dashboard):
 *   FIREBASE_SERVICE_ACCOUNT  — volledige JSON van het Firebase service account (als string)
 *   SUPABASE_JWT_SECRET       — JWT secret uit Supabase: Project Settings → API → JWT Secret
 */

// Firebase Admin JWT minting — zonder volledige SDK (werkt in Netlify edge/Node18)
// We bouwen het custom token handmatig via de RS256 signing spec van Google

async function importPrivateKey(pemKey) {
  const pem = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );
}

function base64url(data) {
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function mintFirebaseToken(serviceAccount, uid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
    claims,
  };

  const signingInput = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload));
  const key = await importPrivateKey(serviceAccount.private_key);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  return signingInput + '.' + base64url(new Uint8Array(sig));
}

function b64urlToBytes(s) {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
function decodeSegment(seg) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(seg)));
}

// Haal de publieke JWKS-sleutels op van Supabase (voor ES256/RS256 tokens)
let _jwksCache = null;
let _jwksCacheTime = 0;
async function fetchJWKS(supabaseUrl) {
  const now = Date.now();
  // Cache 10 minuten (zoals Supabase aanbeveelt)
  if (_jwksCache && (now - _jwksCacheTime) < 600000) return _jwksCache;
  const res = await fetch(supabaseUrl + '/auth/v1/.well-known/jwks.json');
  if (!res.ok) throw new Error('JWKS ophalen mislukt: ' + res.status);
  const jwks = await res.json();
  _jwksCache = jwks;
  _jwksCacheTime = now;
  return jwks;
}

async function verifySupabaseJWT(token, secret, supabaseUrl) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Ongeldig token formaat');

  const header = decodeSegment(parts[0]);
  const payload = decodeSegment(parts[1]);
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token verlopen');

  const signingInput = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const signature = b64urlToBytes(parts[2]);

  if (header.alg === 'ES256') {
    // ── Asymmetrisch (nieuwe Supabase-standaard) ──
    if (!supabaseUrl) throw new Error('SUPABASE_URL nodig voor ES256-verificatie');
    const jwks = await fetchJWKS(supabaseUrl);
    const jwk = jwks.keys.find(k => k.kid === header.kid) || jwks.keys[0];
    if (!jwk) throw new Error('Geen passende JWKS-sleutel gevonden');

    const cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey, signature, signingInput
    );
    if (!valid) throw new Error('Ongeldige handtekening (ES256)');
    return payload;

  } else if (header.alg === 'RS256') {
    // ── RSA-variant ──
    if (!supabaseUrl) throw new Error('SUPABASE_URL nodig voor RS256-verificatie');
    const jwks = await fetchJWKS(supabaseUrl);
    const jwk = jwks.keys.find(k => k.kid === header.kid) || jwks.keys[0];
    if (!jwk) throw new Error('Geen passende JWKS-sleutel gevonden');

    const cryptoKey = await crypto.subtle.importKey(
      'jwk', jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    );
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', cryptoKey, signature, signingInput
    );
    if (!valid) throw new Error('Ongeldige handtekening (RS256)');
    return payload;

  } else {
    // ── HS256 (legacy symmetrisch) ──
    if (!secret) throw new Error('SUPABASE_JWT_SECRET nodig voor HS256-verificatie');
    const cryptoKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const valid = await crypto.subtle.verify('HMAC', cryptoKey, signature, signingInput);
    if (!valid) throw new Error('Ongeldige handtekening (HS256)');
    return payload;
  }
}

export default async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization') || '';
  const supabaseToken = authHeader.replace('Bearer ', '').trim();
  if (!supabaseToken) {
    return new Response(JSON.stringify({ error: 'Geen token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET; // optioneel (alleen voor HS256)
  const SUPABASE_URL = process.env.SUPABASE_URL;               // nodig voor ES256/RS256 (JWKS)
  const FIREBASE_SERVICE_ACCOUNT_RAW = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!FIREBASE_SERVICE_ACCOUNT_RAW) {
    return new Response(JSON.stringify({ error: 'FIREBASE_SERVICE_ACCOUNT ontbreekt' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  if (!SUPABASE_URL && !SUPABASE_JWT_SECRET) {
    return new Response(JSON.stringify({ error: 'SUPABASE_URL of SUPABASE_JWT_SECRET nodig' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // 1. Verifieer Supabase JWT (ES256 via JWKS, of HS256 via secret)
    const payload = await verifySupabaseJWT(supabaseToken, SUPABASE_JWT_SECRET, SUPABASE_URL);
    const uid = 'supa_' + payload.sub.replace(/-/g, '').slice(0, 28); // Firebase uid max 128 chars

    // 2. Parse service account
    const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_RAW);

    // 3. Mint Firebase custom token met gebruiker-claims
    const firebaseToken = await mintFirebaseToken(serviceAccount, uid, {
      supabase_id: payload.sub,
      email: payload.email || '',
    });

    return new Response(JSON.stringify({ firebaseToken, uid }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('[mint-firebase-token]', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
};

export const config = { path: '/api/firebase-token' };
