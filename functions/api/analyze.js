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
    return new Response(JSON.stringify({ ok: false, error: '인증이 필요합니다.' }), { status: 401, headers });
  }
  const idToken = authHeader.slice(7);
  let payload;
  try {
    payload = await verifyFirebaseToken(idToken, FIREBASE_PROJECT_ID);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: '인증에 실패했습니다.' }), { status: 401, headers });
  }
  const uid = payload.sub;
  const currentMonth = new Date().toISOString().slice(0, 7); // "2026-05"

  // Firestore REST API로 사용량 확인 (서버 사이드)
  const userDocUrl = `${FIRESTORE_BASE}/users/${uid}`;
  let used = 0, limit = 3, userDocExists = false;
  try {
    const userRes = await fetch(userDocUrl, {
      headers: { 'Authorization': `Bearer ${idToken}` },
    });
    if (userRes.ok) {
      userDocExists = true;
      const userDoc = await userRes.json();
      const fields = userDoc.fields || {};
      const plan = fields.plan?.stringValue || 'free';
      limit = plan === 'starter' ? 10 : 3;
      const storedMonth = fields.monthlyUsageMonth?.stringValue;
      used = storedMonth === currentMonth
        ? parseInt(fields.monthlyUsage?.integerValue || '0', 10)
        : 0;
    }
  } catch {
    // 사용량 확인 실패 시 통과 (fail-open)
  }

  if (used >= limit) {
    return new Response(JSON.stringify({ ok: false, error: '이번 달 분석 횟수를 모두 사용했습니다.' }), { status: 429, headers });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: '요청 형식이 올바르지 않습니다.' }), { status: 400, headers });
  }

  const { jobTitle, coverLetter } = body;

  if (!jobTitle || jobTitle.trim().length < 2) {
    return new Response(JSON.stringify({ ok: false, error: '지원 직무를 입력해주세요.' }), { status: 400, headers });
  }
  if (!coverLetter || coverLetter.trim().length < 100) {
    return new Response(JSON.stringify({ ok: false, error: '자기소개서를 100자 이상 입력해주세요.' }), { status: 400, headers });
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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Claude API 연결에 실패했습니다.' }), { status: 502, headers });
  }

  if (!claudeRes.ok) {
    const errBody = await claudeRes.text();
    console.error(`Claude API ${claudeRes.status}: ${errBody}`);
    return new Response(JSON.stringify({ ok: false, error: `분석 서버 오류 (${claudeRes.status}). 잠시 후 다시 시도해주세요.` }), { status: 502, headers });
  }

  const claudeData = await claudeRes.json();
  const rawText = claudeData.content?.[0]?.text || '';

  let report;
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('JSON not found');
    report = JSON.parse(match[0]);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: '분석 결과 파싱 실패. 다시 시도해주세요.' }), { status: 500, headers });
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
  return `당신은 국내 대기업 채용 담당 15년 경력의 시니어 HR 전문가입니다.
아래 자기소개서를 철저하게 분석하여 지원자가 실질적으로 개선할 수 있는 피드백을 제공하세요.

[지원 직무]
${jobTitle}

[자기소개서 원문]
${coverLetter}

분석 기준:
1. 직무 연관성: 해당 직무에서 요구하는 역량과 경험이 얼마나 잘 연결되는가
2. 구체성: 막연한 표현 대신 수치, 사례, 행동을 구체적으로 서술했는가
3. 문장 명확성: 능동태, 간결한 문체, 논리적 흐름을 갖추고 있는가
4. 진정성: 본인만의 고유한 경험과 관점이 드러나는가
5. 임팩트: 성과와 기여를 설득력 있게 표현했는가

반드시 아래 JSON 형식만 반환하고 다른 텍스트는 절대 포함하지 마세요:

{
  "score": <종합 점수 0-100 정수>,
  "grade": <"S" | "A" | "B" | "C" | "D">,
  "summary": "<전체 평가 한 줄 요약, 40자 이내>",
  "scores": {
    "relevance": <직무연관성 0-100>,
    "specificity": <구체성 0-100>,
    "clarity": <문장명확성 0-100>,
    "authenticity": <진정성 0-100>,
    "impact": <임팩트 0-100>
  },
  "strengths": [
    { "title": "<강점 제목 20자 이내>", "detail": "<구체적 근거 60자 이내>" },
    { "title": "<강점 제목 20자 이내>", "detail": "<구체적 근거 60자 이내>" }
  ],
  "improvements": [
    {
      "issue": "<문제점 제목 20자 이내>",
      "why": "<왜 문제인지 50자 이내>",
      "before": "<원문에서 가져온 개선 전 표현>",
      "after": "<실제 개선된 문장>"
    },
    {
      "issue": "<문제점 제목 20자 이내>",
      "why": "<왜 문제인지 50자 이내>",
      "before": "<원문에서 가져온 개선 전 표현>",
      "after": "<실제 개선된 문장>"
    }
  ],
  "keywords": {
    "matched": ["<발견된 키워드>", "<발견된 키워드>", "<발견된 키워드>"],
    "missing": ["<추가 권장 키워드>", "<추가 권장 키워드>", "<추가 권장 키워드>"]
  },
  "oneLineTip": "<채용 담당자로서 전하는 핵심 한마디 50자 이내>"
}`;
}
