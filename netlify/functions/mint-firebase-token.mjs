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

async function verifySupabaseJWT(token, secret) {
  // Minimale verificatie: check signature + expiry
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Ongeldig token formaat');

  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token verlopen');

  // Verify HMAC-SHA256 signature
  const keyData = new TextEncoder().encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const signingInput = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const signature = Uint8Array.from(
    atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
    c => c.charCodeAt(0)
  );
  const valid = await crypto.subtle.verify('HMAC', cryptoKey, signature, signingInput);
  if (!valid) throw new Error('Ongeldige handtekening');

  return payload;
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

  const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
  const FIREBASE_SERVICE_ACCOUNT_RAW = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!SUPABASE_JWT_SECRET || !FIREBASE_SERVICE_ACCOUNT_RAW) {
    return new Response(JSON.stringify({ error: 'Server config ontbreekt' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // 1. Verifieer Supabase JWT
    const payload = await verifySupabaseJWT(supabaseToken, SUPABASE_JWT_SECRET);
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
