/**
 * Ssurd — Cloudflare Pages Functions
 * 파일 위치: functions/api/analyze.js
 * 자동으로 /api/analyze 엔드포인트가 됩니다.
 *
 * 배포 후 Cloudflare Pages 대시보드 → Settings → Environment Variables에서
 * ANTHROPIC_API_KEY 를 추가하세요. 코드에 키를 절대 넣지 마세요.
 */

const FIREBASE_PROJECT_ID = 'ssurd-6400c';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export async function onRequestPost({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  // Firebase ID 토큰 검증
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
  const currentMonth = new Date().toISOString().slice(0, 7); // "2026-05"

  // Firestore REST API로 사용량 확인 (서버 사이드)
  const userDocUrl = `${FIRESTORE_BASE}/users/${uid}`;
  let used = 0, limit = 3, userDocExists = false, plan = 'free';
  try {
    const userRes = await fetch(userDocUrl, {
      headers: { 'Authorization': `Bearer ${idToken}` },
    });
    if (userRes.ok) {
      userDocExists = true;
      const userDoc = await userRes.json();
      const fields = userDoc.fields || {};
      plan = fields.plan?.stringValue || 'free';
      limit = plan === 'starter' ? 10 : 3;
      const storedMonth = fields.monthlyUsageMonth?.stringValue;
      used = storedMonth === currentMonth
        ? parseInt(fields.monthlyUsage?.integerValue || '0', 10)
        : 0;
    }
  } catch {
    // 사용량 확인 실패 시 통과 (fail-open)
  }

  if (plan !== 'admin' && used >= limit) {
    return new Response(JSON.stringify({ ok: false, error: "You've used all your free analyses. Paid plan coming soon — check back shortly!" }), { status: 429, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid request format.' }), { status: 400, headers });
  }

  const { jobTitle, coverLetter } = body;

  if (!jobTitle || jobTitle.trim().length < 2) {
    return new Response(JSON.stringify({ ok: false, error: 'Please enter the target role.' }), { status: 400, headers });
  }
  if (!coverLetter || coverLetter.trim().length < 100) {
    return new Response(JSON.stringify({ ok: false, error: 'Please enter at least 100 characters.' }), { status: 400, headers });
  }

  const prompt = buildPrompt(jobTitle.trim(), coverLetter.trim().slice(0, 3000));

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
        max_tokens: 2500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Failed to connect to analysis service.' }), { status: 502, headers });
  }

  if (!claudeRes.ok) {
    const errBody = await claudeRes.text();
    console.error(`Claude API ${claudeRes.status}: ${errBody}`);
    return new Response(JSON.stringify({ ok: false, error: `Analysis server error (${claudeRes.status}). Please try again shortly.` }), { status: 502, headers });
  }

  const claudeData = await claudeRes.json();
  const rawText = claudeData.content?.[0]?.text || '';

  let report;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON not found');
    report = JSON.parse(match[0]);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Failed to parse analysis result. Please try again.' }), { status: 500, headers });
  }

  // Firestore 사용량 업데이트 (서버 사이드)
  try {
    if (userDocExists) {
      await fetch(
        userDocUrl + '?updateMask.fieldPaths=monthlyUsage&updateMask.fieldPaths=monthlyUsageMonth',
        {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              monthlyUsage: { integerValue: String(used + 1) },
              monthlyUsageMonth: { stringValue: currentMonth },
            },
          }),
        }
      );
    } else {
      // 신규 사용자: 문서 생성
      await fetch(userDocUrl, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            email: { stringValue: payload.email || '' },
            plan: { stringValue: 'free' },
            monthlyUsage: { integerValue: '1' },
            monthlyUsageMonth: { stringValue: currentMonth },
          },
        }),
      });
    }
  } catch (e) {
    console.error('Usage update failed:', e);
  }

  return new Response(JSON.stringify({ ok: true, report }), { headers });
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

// ── Firebase ID 토큰 검증 (WebCrypto) ──────────────────────────────────────

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

// ── 프롬프트 ───────────────────────────────────────────────────────────────

function buildPrompt(jobTitle, coverLetter) {
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
  "strengths": [
    { "title": "<strength title, max 40 characters>", "detail": "<cite specific evidence from the submitted text, max 140 characters>" },
    { "title": "<strength title, max 40 characters>", "detail": "<cite specific evidence from the submitted text, max 140 characters>" },
    { "title": "<strength title, max 40 characters>", "detail": "<cite specific evidence from the submitted text, max 140 characters>" }
  ],
  "improvements": [
    {
      "issue": "<issue title, max 40 characters>",
      "why": "<why this hurts the application from an HR perspective, max 120 characters>",
      "before": "<exact phrase or sentence copied from the submitted text>",
      "after": "<a concrete, specific rewrite of that phrase>"
    },
    {
      "issue": "<issue title, max 40 characters>",
      "why": "<why this hurts the application from an HR perspective, max 120 characters>",
      "before": "<exact phrase or sentence copied from the submitted text>",
      "after": "<a concrete, specific rewrite of that phrase>"
    },
    {
      "issue": "<issue title, max 40 characters>",
      "why": "<why this hurts the application from an HR perspective, max 120 characters>",
      "before": "<exact phrase or sentence copied from the submitted text>",
      "after": "<a concrete, specific rewrite of that phrase>"
    }
  ],
  "keywords": {
    "matched": ["<keyword or skill found in the text>", "<keyword>", "<keyword>", "<keyword>"],
    "missing": ["<important keyword for this role that is absent>", "<keyword>", "<keyword>", "<keyword>"]
  },
  "oneLineTip": "<the single highest-leverage change this applicant should make — be direct and specific, max 150 characters>"
}`;
}
