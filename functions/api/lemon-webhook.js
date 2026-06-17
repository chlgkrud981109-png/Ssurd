const FIREBASE_PROJECT_ID = 'ssurd-6400c';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export async function onRequestPost({ request, env }) {
  const headers = { 'Content-Type': 'application/json' };

  const rawBody = await request.text();
  const signature = request.headers.get('X-Signature');

  if (!signature || !env.LEMON_WEBHOOK_SECRET) {
    return new Response(JSON.stringify({ error: 'Missing signature' }), { status: 400, headers });
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.LEMON_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const sigBuffer = hexToBuffer(signature);
  const valid = await crypto.subtle.verify('HMAC', key, sigBuffer, new TextEncoder().encode(rawBody));

  if (!valid) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const eventName = payload.meta?.event_name;
  const uid = payload.meta?.custom_data?.uid;
  const attrs = payload.data?.attributes;

  if (!uid || !attrs) {
    return new Response(JSON.stringify({ ok: true, skipped: 'no uid' }), { headers });
  }

  if (eventName === 'subscription_created' || eventName === 'subscription_updated') {
    const status = attrs.status;
    const newPlan = (status === 'active' || status === 'trialing') ? 'starter' : 'free';

    try {
      const accessToken = await getGoogleAccessToken(env.FIREBASE_SERVICE_ACCOUNT);
      await fetch(
        `${FIRESTORE_BASE}/users/${uid}?updateMask.fieldPaths=plan`,
        {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { plan: { stringValue: newPlan } } }),
        }
      );
    } catch (e) {
      console.error('Firestore update failed:', e);
      return new Response(JSON.stringify({ error: 'DB update failed' }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ ok: true }), { headers });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Signature',
    },
  });
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes.buffer;
}

async function getGoogleAccessToken(serviceAccountJson) {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = toB64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimB64 = toB64u(JSON.stringify(claim));
  const signingInput = `${headerB64}.${claimB64}`;

  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '');
  const keyBuffer = Uint8Array.from(atob(pem), c => c.charCodeAt(0)).buffer;

  const key = await crypto.subtle.importKey(
    'pkcs8', keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const { access_token } = await tokenRes.json();
  return access_token;
}

function toB64u(str) {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
