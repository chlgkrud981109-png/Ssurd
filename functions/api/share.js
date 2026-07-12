/**
 * Ssurd — POST /api/share
 * Creates a sanitized public share doc (shares/{shareId}) for an analysis.
 * Stores scores/grade/role only — NEVER the cover letter, JD, or feedback text.
 */

const FIREBASE_PROJECT_ID = 'ssurd-6400c';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export async function onRequestPost({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ ok: false, error: 'Authentication required.' }), { status: 401, headers });
  }
  const idToken = authHeader.slice(7);
  let payload;
  try {
    payload = await verifyFirebaseToken(idToken, FIREBASE_PROJECT_ID);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Authentication failed.' }), { status: 401, headers });
  }
  const uid = payload.sub;

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid request format.' }), { status: 400, headers });
  }
  const { analysisId } = body;
  if (!analysisId || typeof analysisId !== 'string') {
    return new Response(JSON.stringify({ ok: false, error: 'Missing analysisId.' }), { status: 400, headers });
  }

  // Owner read of the analysis doc (Firestore rules enforce ownership via the user's own token)
  const docRes = await fetch(`${FIRESTORE_BASE}/analyses/${encodeURIComponent(analysisId)}`, {
    headers: { 'Authorization': `Bearer ${idToken}` },
  });
  if (!docRes.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'Analysis not found.' }), { status: 404, headers });
  }
  const analysisDoc = await docRes.json();
  const f = analysisDoc.fields || {};
  if (f.uid?.stringValue !== uid) {
    return new Response(JSON.stringify({ ok: false, error: 'Not your analysis.' }), { status: 403, headers });
  }

  // Idempotent: reuse an existing shareId
  const existing = f.shareId?.stringValue;
  if (existing) {
    return new Response(JSON.stringify({ ok: true, shareId: existing }), { headers });
  }

  // Extract only shareable scalars from the report
  const report = f.report?.mapValue?.fields || {};
  const scores = report.scores?.mapValue?.fields || {};
  const ats = report.ats?.mapValue?.fields || {};
  const jdMatch = report.jdMatch?.mapValue?.fields || {};
  const previous = f.previous?.mapValue?.fields || {};
  const asInt = v => v?.integerValue != null ? parseInt(v.integerValue, 10) : (v?.doubleValue != null ? Math.round(v.doubleValue) : null);

  const score = asInt(report.score) ?? 0;
  const prevScore = asInt(previous.score);
  const shareFields = {
    score: { integerValue: String(score) },
    grade: { stringValue: report.grade?.stringValue || '-' },
    jobTitle: { stringValue: f.jobTitle?.stringValue || '' },
    relevance: { integerValue: String(asInt(scores.relevance) ?? 0) },
    specificity: { integerValue: String(asInt(scores.specificity) ?? 0) },
    clarity: { integerValue: String(asInt(scores.clarity) ?? 0) },
    authenticity: { integerValue: String(asInt(scores.authenticity) ?? 0) },
    impact: { integerValue: String(asInt(scores.impact) ?? 0) },
    atsScore: asInt(ats.score) != null ? { integerValue: String(asInt(ats.score)) } : { nullValue: null },
    atsVerdict: ats.verdict?.stringValue ? { stringValue: ats.verdict.stringValue } : { nullValue: null },
    jdMatchScore: asInt(jdMatch.matchScore) != null ? { integerValue: String(asInt(jdMatch.matchScore)) } : { nullValue: null },
    delta: prevScore != null ? { integerValue: String(score - prevScore) } : { nullValue: null },
    version: { integerValue: String(asInt(f.version) ?? 1) },
    createdAt: { stringValue: new Date().toISOString() },
    uid: { stringValue: uid },
  };

  const shareId = genShareId();

  // Server-only write via service account (client writes to shares/ are blocked by rules)
  let accessToken;
  try {
    accessToken = await getGoogleAccessToken(env.FIREBASE_SERVICE_ACCOUNT);
  } catch (e) {
    console.error('Service account token failed:', e);
    return new Response(JSON.stringify({ ok: false, error: 'Share service unavailable.' }), { status: 500, headers });
  }
  const writeRes = await fetch(`${FIRESTORE_BASE}/shares/${shareId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: shareFields }),
  });
  if (!writeRes.ok) {
    console.error('Share write failed:', await writeRes.text());
    return new Response(JSON.stringify({ ok: false, error: 'Failed to create share link.' }), { status: 500, headers });
  }

  // Record the shareId on the analysis (user-owned write)
  await fetch(`${FIRESTORE_BASE}/analyses/${encodeURIComponent(analysisId)}?updateMask.fieldPaths=shareId`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { shareId: { stringValue: shareId } } }),
  }).catch(e => console.error('shareId patch failed:', e));

  return new Response(JSON.stringify({ ok: true, shareId }), { headers });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function genShareId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(11));
  let id = '';
  for (const b of bytes) id += chars[b % 62];
  return id;
}

// ── Firebase ID 토큰 검증 (WebCrypto) — analyze.js와 동일 패턴 ─────────────

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
}

function b64urlToBuffer(str) {
  const bin = b64urlDecode(str);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function verifyFirebaseToken(token, projectId) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const header = JSON.parse(b64urlDecode(parts[0]));
  const payload = JSON.parse(b64urlDecode(parts[1]));

  const now = Math.floor(Date.now() / 1000);
  if (!payload.sub) throw new Error('Missing subject');
  if (payload.exp < now) throw new Error('Token expired');
  if (payload.aud !== projectId) throw new Error('Invalid audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Invalid issuer');

  const jwksRes = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const { keys } = await jwksRes.json();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Signing key not found');

  const key = await crypto.subtle.importKey(
    'jwk', jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  );

  const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlToBuffer(parts[2]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, signingInput);
  if (!valid) throw new Error('Invalid signature');

  return payload;
}

// ── 서비스 계정 OAuth2 토큰 — lemon-webhook.js와 동일 패턴 ────────────────

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
