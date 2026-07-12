/**
 * Ssurd — POST /api/analyze-teaser
 * Unauthenticated one-shot preview: real score + ONE Before/After fix.
 * Rate limited 1/IP/day + 300/day global via Firestore atomic increments (fail-closed).
 *
 * Cost bound: ~1,300 input + ≤1,200 output tokens ≈ $0.022 worst case per call.
 * Caps: 3,000-char letter, no JD, no news, max_tokens 1200, 1/IP/day, 300/day global
 * → absolute worst-case spend ≈ $6.60/day (~$200/mo hard ceiling).
 */

const FIREBASE_PROJECT_ID = 'ssurd-6400c';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const DAILY_GLOBAL_CAP = 300;

export async function onRequestPost({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid request format.' }), { status: 400, headers });
  }
  const jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle.trim().slice(0, 120) : '';
  const coverLetter = typeof body.coverLetter === 'string' ? body.coverLetter.trim().slice(0, 3000) : '';
  if (jobTitle.length < 2) {
    return new Response(JSON.stringify({ ok: false, error: 'Please enter the target role.' }), { status: 400, headers });
  }
  if (coverLetter.length < 100) {
    return new Response(JSON.stringify({ ok: false, error: 'Please enter at least 100 characters.' }), { status: 400, headers });
  }

  // ── Rate limit: increment-first (reserves the slot atomically), then read. Fail-closed. ──
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || '0.0.0.0';
  const day = new Date().toISOString().slice(0, 10);
  const salt = env.TEASER_IP_SALT || 'ssurd-t1';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${ip}|${day}`));
  const ipDocId = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  const globalDocId = `_global_${day}`;
  const docPath = id => `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/teaser_limits/${id}`;

  let ipCount, globalCount;
  try {
    const accessToken = await getGoogleAccessToken(env.FIREBASE_SERVICE_ACCOUNT);
    const commitRes = await fetch(`${FIRESTORE_BASE.replace('/documents', '')}/documents:commit`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          { transform: { document: docPath(ipDocId), fieldTransforms: [{ fieldPath: 'count', increment: { integerValue: '1' } }] } },
          { transform: { document: docPath(globalDocId), fieldTransforms: [{ fieldPath: 'count', increment: { integerValue: '1' } }] } },
        ],
      }),
    });
    if (!commitRes.ok) throw new Error(`commit ${commitRes.status}`);
    const [ipRes, gRes] = await Promise.all([
      fetch(`${FIRESTORE_BASE}/teaser_limits/${ipDocId}`, { headers: { 'Authorization': `Bearer ${accessToken}` } }),
      fetch(`${FIRESTORE_BASE}/teaser_limits/${globalDocId}`, { headers: { 'Authorization': `Bearer ${accessToken}` } }),
    ]);
    ipCount = parseInt((await ipRes.json()).fields?.count?.integerValue || '1', 10);
    globalCount = parseInt((await gRes.json()).fields?.count?.integerValue || '1', 10);
  } catch (e) {
    // Fail-closed: an unauthenticated endpoint must not become an open Claude proxy
    console.error('Teaser limiter unavailable:', e);
    return new Response(JSON.stringify({ ok: false, error: 'Preview is unavailable right now — sign up free for 3 full analyses every month.' }), { status: 503, headers });
  }

  if (ipCount > 1) {
    return new Response(JSON.stringify({ ok: false, code: 'teaser_limit', error: "You've used today's free preview. Sign up free for 3 full analyses every month." }), { status: 429, headers });
  }
  if (globalCount > DAILY_GLOBAL_CAP) {
    return new Response(JSON.stringify({ ok: false, error: 'Preview is busy today — sign up free for your full report.' }), { status: 503, headers });
  }

  // ── Claude ──
  let claudeRes;
  try {
    claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: buildTeaserPrompt(jobTitle, coverLetter) }],
      }),
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Failed to connect to analysis service.' }), { status: 502, headers });
  }
  if (!claudeRes.ok) {
    console.error(`Teaser Claude API ${claudeRes.status}: ${await claudeRes.text()}`);
    return new Response(JSON.stringify({ ok: false, error: 'Analysis server error. Please try again shortly.' }), { status: 502, headers });
  }
  const claudeData = await claudeRes.json();
  if (claudeData.stop_reason === 'max_tokens') {
    return new Response(JSON.stringify({ ok: false, error: 'Report was cut off. Please try again.' }), { status: 500, headers });
  }
  const rawText = claudeData.content?.[0]?.text || '';
  let report;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON not found');
    report = JSON.parse(match[0]);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Failed to parse analysis result. Please try again.' }), { status: 500, headers });
  }

  return new Response(JSON.stringify({ ok: true, teaser: true, report }), { headers });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

// ── 프롬프트 (analyze.js 페르소나/기준/캘리브레이션과 동일, 스키마만 축소) ──

function buildTeaserPrompt(jobTitle, coverLetter) {
  return `You are a seasoned HR director with 20 years of talent acquisition experience at top-tier companies. You have reviewed over 10,000 cover letters and resumes. Analyze with a strict, honest lens — avoid vague generalities. Every piece of feedback must be directly actionable.

[Target Role]
${jobTitle}

[Cover Letter / Resume]
${coverLetter}

Evaluation criteria:
1. Relevance (0-100): How directly does the applicant's background connect to this specific role's requirements?
2. Specificity (0-100): Are claims backed by concrete data, numbers, outcomes, and named projects — or just vague assertions?
3. Clarity (0-100): Is the writing active voice, well-structured, concise, and free of filler phrases?
4. Authenticity (0-100): Does it feel like a real person with genuine experience, or a generic template?
5. Impact (0-100): Are achievements framed in terms of measurable outcomes and business value?

Scoring calibration (be honest — grade inflation helps no one):
- 90-100: Exceptional. Would make a top recruiter immediately schedule an interview.
- 75-89: Strong. Clear value proposition with minor gaps.
- 55-74: Average. Some good elements but missing specificity or role alignment.
- 35-54: Weak. Generic claims, lacks evidence, needs significant rework.
- 0-34: Poor. Does not demonstrate fit for the role.

Also assess ATS (Applicant Tracking System) compatibility as a single 0-100 score with a verdict.

Return ONLY the JSON object below. Do not include any other text or explanation:

{
  "score": <overall score 0-100 integer>,
  "grade": <"S" | "A" | "B" | "C" | "D">,
  "summary": "<one-sentence honest assessment focusing on the single biggest factor, max 120 characters>",
  "scores": {
    "relevance": <0-100>,
    "specificity": <0-100>,
    "clarity": <0-100>,
    "authenticity": <0-100>,
    "impact": <0-100>
  },
  "improvement": {
    "issue": "<the SINGLE most damaging issue in this letter, max 40 characters>",
    "why": "<why this hurts the application from an HR perspective, max 120 characters>",
    "before": "<exact phrase or sentence copied from the submitted text>",
    "after": "<a concrete, specific rewrite of that phrase>"
  },
  "ats": {
    "score": <ATS compatibility score 0-100 integer>,
    "verdict": <"pass" | "risky" | "fail">
  }
}`;
}

// ── 서비스 계정 OAuth2 토큰 — share.js와 동일 패턴 ────────────────────────

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
  if (!access_token) throw new Error('No access token');
  return access_token;
}

function toB64u(str) {
  return btoa(str).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
