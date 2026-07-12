/**
 * Ssurd — GET /share/{id}
 * Server-rendered public score card with OG/Twitter meta so links unfurl on X.
 * Reads the sanitized shares/{id} doc (public-read Firestore rule, no token).
 */

const FIREBASE_PROJECT_ID = 'ssurd-6400c';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export async function onRequestGet({ params, request }) {
  const id = params.id;
  if (!id || !/^[A-Za-z0-9]{6,24}$/.test(id)) {
    return Response.redirect(new URL('/', request.url).toString(), 302);
  }

  const res = await fetch(`${FIRESTORE_BASE}/shares/${id}`);
  if (!res.ok) {
    return Response.redirect(new URL('/', request.url).toString(), 302);
  }
  const docData = await res.json();
  const f = docData.fields || {};
  const asInt = v => v?.integerValue != null ? parseInt(v.integerValue, 10) : null;
  const asStr = v => v?.stringValue || null;

  const score = asInt(f.score) ?? 0;
  const grade = asStr(f.grade) || '-';
  const jobTitle = asStr(f.jobTitle) || 'Cover letter';
  const atsScore = asInt(f.atsScore);
  const atsVerdict = asStr(f.atsVerdict);
  const jdMatchScore = asInt(f.jdMatchScore);
  const delta = asInt(f.delta);
  const version = asInt(f.version) ?? 1;
  const dims = {
    Relevance: asInt(f.relevance) ?? 0,
    Specificity: asInt(f.specificity) ?? 0,
    Clarity: asInt(f.clarity) ?? 0,
    Authenticity: asInt(f.authenticity) ?? 0,
    Impact: asInt(f.impact) ?? 0,
  };

  const origin = new URL(request.url).origin;
  const shareUrl = `${origin}/share/${id}`;
  // Static dark brand palette (marketing unfurl page — no theme toggle here)
  const scoreColor = score >= 80 ? '#2fd98a' : score >= 60 ? '#6ba1ff' : score >= 40 ? '#fbbf24' : '#ff5c67';
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const ogTitle = `${score}/100 (Grade ${grade}) — ${jobTitle} cover letter, scored by AI`;
  const ogDesc = `${atsScore != null ? `ATS ${atsScore}/100 · ` : ''}Relevance ${dims.Relevance} · Impact ${dims.Impact}${delta != null && delta > 0 ? ` · +${delta} pts improved` : ''}. Get your free ATS + HR analysis on Ssurd.`;

  const barRow = (label, v) => {
    const c = v >= 75 ? '#2fd98a' : v >= 55 ? '#6ba1ff' : v >= 35 ? '#fbbf24' : '#ff5c67';
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <span style="font-size:13px;color:#a1a1aa;width:88px;flex-shrink:0;font-weight:500">${label}</span>
      <div style="flex:1;height:5px;background:#232327;border-radius:3px;overflow:hidden"><div style="height:100%;width:${v}%;background:${c};border-radius:3px"></div></div>
      <span style="font-family:'DM Mono',monospace;font-size:12px;font-weight:500;width:26px;text-align:right;color:#f4f4f5">${v}</span>
    </div>`;
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(ogTitle)}</title>
<meta name="description" content="${esc(ogDesc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Ssurd">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(ogDesc)}">
<meta property="og:url" content="${esc(shareUrl)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(ogDesc)}">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%233182f6'/%3E%3Ctext x='16' y='22' text-anchor='middle' fill='white' font-size='20' font-weight='700' font-family='system-ui'%3ES%3C/text%3E%3C/svg%3E">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-EFMM3RPZKR"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-EFMM3RPZKR');gtag('event','share_page_view',{share_id:'${id}'});</script>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;600;700;800;900&family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0b0b0c;font-family:'Inter','Noto Sans KR',-apple-system,sans-serif;color:#f4f4f5;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
</style>
</head>
<body>
<a href="${origin}" style="font-size:17px;font-weight:600;color:#f4f4f5;text-decoration:none;margin-bottom:24px;letter-spacing:-.02em">Ss<span style="color:#6ba1ff">.</span>urd</a>
<div style="background:#151517;border:1px solid #3a3a3f;border-radius:20px;padding:36px 32px;max-width:420px;width:100%">
  <div style="font-size:13px;color:#71717a;font-weight:500;margin-bottom:6px">Cover letter score${version > 1 ? ` · v${version}` : ''}</div>
  <div style="font-size:16px;font-weight:600;margin-bottom:20px">${esc(jobTitle)}</div>
  <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px">
    <span style="font-size:72px;font-weight:700;line-height:1;letter-spacing:-.04em;color:${scoreColor}">${score}</span>
    <span style="font-size:16px;color:#52525b;font-weight:600">/100</span>
    <span style="font-size:12px;font-weight:600;padding:4px 12px;border-radius:100px;background:rgba(107,161,255,.15);color:#6ba1ff">Grade ${esc(grade)}</span>
  </div>
  ${delta != null && delta !== 0 ? `<div style="margin-bottom:16px"><span style="font-family:'DM Mono',monospace;font-size:12px;font-weight:500;padding:3px 10px;border-radius:100px;background:${delta>0?'rgba(47,217,138,.15)':'rgba(255,92,103,.15)'};color:${delta>0?'#2fd98a':'#ff5c67'}">${delta>0?'▲ +':'▼ '}${delta} pts vs previous version</span></div>` : '<div style="margin-bottom:16px"></div>'}
  <div style="border-top:1px solid #232326;padding-top:18px;margin-bottom:6px">
    ${Object.entries(dims).map(([k,v]) => barRow(k,v)).join('')}
  </div>
  ${atsScore != null ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
    <span style="font-size:11px;font-weight:600;padding:4px 12px;border-radius:100px;background:${atsVerdict==='pass'?'rgba(47,217,138,.15)':atsVerdict==='fail'?'rgba(255,92,103,.15)':'rgba(251,191,36,.15)'};color:${atsVerdict==='pass'?'#2fd98a':atsVerdict==='fail'?'#ff5c67':'#fbbf24'}">ATS ${atsScore}/100</span>
    ${jdMatchScore != null ? `<span style="font-size:11px;font-weight:600;padding:4px 12px;border-radius:100px;background:rgba(107,161,255,.15);color:#6ba1ff">JD match ${jdMatchScore}%</span>` : ''}
  </div>` : ''}
</div>
<a href="${origin}/write.html" style="display:inline-flex;align-items:center;gap:8px;background:#f4f4f5;color:#0b0b0c;font-size:14px;font-weight:600;padding:14px 28px;border-radius:100px;border:none;text-decoration:none;margin-top:24px" onclick="gtag('event','share_cta_click',{share_id:'${id}'})">Score your own cover letter free →</a>
<div style="font-size:12px;color:#52525b;margin-top:12px">Free ATS check + HR-grade feedback in 30 seconds</div>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
