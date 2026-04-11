// ── Ssurd Claude API Proxy ──
// Cloudflare Worker: 브라우저에서 직접 Anthropic API 키 노출 없이 호출

export default {
    async fetch(request, env) {

        // CORS preflight 처리
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: corsHeaders(request),
            });
        }

        // POST 요청만 허용
        if (request.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), {
                status: 405,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // 경로 확인: /analyze 만 허용
        const url = new URL(request.url);
        if (url.pathname !== '/analyze') {
            return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        try {
            const body = await request.json();
            const { jobTitle, coverLetter } = body;

            // 입력값 검증
            if (!jobTitle || !coverLetter) {
                return new Response(JSON.stringify({ error: '직무명과 자소서 내용이 필요합니다.' }), {
                    status: 400,
                    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
                });
            }
            if (coverLetter.length < 100) {
                return new Response(JSON.stringify({ error: '자소서를 100자 이상 입력해주세요.' }), {
                    status: 400,
                    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
                });
            }
            if (coverLetter.length > 3000) {
                return new Response(JSON.stringify({ error: '자소서는 3,000자 이내로 입력해주세요.' }), {
                    status: 400,
                    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
                });
            }

            const prompt = `당신은 10년 경력의 대기업 채용 담당자입니다.
아래 자기소개서를 읽고 반드시 JSON 형식만 반환하세요. 다른 텍스트는 절대 포함하지 마세요.

[지원 직무]: ${jobTitle}
[자기소개서]:
${coverLetter}

반환 형식:
{
  "score": 0~100 사이 숫자,
  "grade": "A" 또는 "B" 또는 "C" 또는 "D",
  "summary": "전체 평가 한 줄 요약 (30자 이내)",
  "strengths": ["강점1", "강점2", "강점3"],
  "improvements": [
    {"issue": "문제점", "suggestion": "구체적 개선 예시 문장"}
  ],
  "keywords": {
    "matched": ["매칭된 직무 키워드1", "키워드2"],
    "missing": ["누락된 권장 키워드1", "키워드2"]
  },
  "scores": {
    "relevance": 직무연관성 0~100,
    "specificity": 구체성 0~100,
    "clarity": 문장명확성 0~100,
    "authenticity": 진정성 0~100
  }
}`;

            // Anthropic API 호출 (키는 Worker 환경변수에서만 접근)
            const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': env.ANTHROPIC_API_KEY,   // 환경변수에서 주입
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-5',
                    max_tokens: 1024,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });

            if (!anthropicRes.ok) {
                const err = await anthropicRes.text();
                console.error('Anthropic API error:', err);
                return new Response(JSON.stringify({ error: '분석 엔진 오류가 발생했습니다.' }), {
                    status: 502,
                    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
                });
            }

            const data = await anthropicRes.json();
            const raw = data.content[0].text;
            const report = JSON.parse(raw.replace(/```json|```/g, '').trim());

            return new Response(JSON.stringify({ report }), {
                status: 200,
                headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
            });

        } catch (e) {
            console.error('Worker error:', e);
            return new Response(JSON.stringify({ error: '서버 오류가 발생했습니다.' }), {
                status: 500,
                headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
            });
        }
    },
};

// CORS 헤더: Cloudflare Pages 도메인만 허용
function corsHeaders(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = [
        'https://ssurd.pages.dev',        // Cloudflare Pages
        'http://127.0.0.1:5500',          // VS Code Live Server
        'http://localhost:5500',
        'http://localhost:3000',
    ];
    const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
    return {
        'Access-Control-Allow-Origin': allowOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}