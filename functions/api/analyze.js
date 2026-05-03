/**
 * Ssurd — Cloudflare Pages Functions
 * 파일 위치: functions/api/analyze.js
 * 자동으로 /api/analyze 엔드포인트가 됩니다.
 *
 * 배포 후 Cloudflare Pages 대시보드 → Settings → Environment Variables에서
 * ANTHROPIC_API_KEY 를 추가하세요. 코드에 키를 절대 넣지 마세요.
 */

export async function onRequestPost({ request, env }) {
  // CORS
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

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

  return new Response(JSON.stringify({ ok: true, report }), { headers });
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