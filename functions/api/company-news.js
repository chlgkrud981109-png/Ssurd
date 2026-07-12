export async function onRequestGet({ request }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const url = new URL(request.url);
  const companiesParam = url.searchParams.get('companies');
  if (!companiesParam) {
    return new Response(JSON.stringify({ ok: false, error: 'No companies specified' }), { status: 400, headers });
  }

  const companies = companiesParam.split(',').slice(0, 3).map(c => c.trim()).filter(Boolean);

  const results = await Promise.all(companies.map(async (name) => {
    try {
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(name)}&hl=en-US&gl=US&ceid=US:en`;
      const res = await fetch(rssUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
        signal: AbortSignal.timeout(8000),
      });

      const contentType = res.headers.get('content-type') || '';
      const xml = await res.text();

      console.log(`[company-news] ${name} → status:${res.status} ct:${contentType} preview:${xml.slice(0,200)}`);

      if (!res.ok || !xml.includes('<item>')) {
        return { company: name, news: [], _debug: { status: res.status, preview: xml.slice(0, 300) } };
      }

      const items = [];
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = itemRe.exec(xml)) !== null && items.length < 5) {
        const b = m[1];

        const titleCdata = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(b);
        const titlePlain = /<title>([^<]+)<\/title>/.exec(b);
        const title = (titleCdata?.[1] || titlePlain?.[1] || '').trim();

        const link = /<link>([^<\s]+)<\/link>/.exec(b)?.[1]?.trim()
          || /<guid[^>]*>([^<]+)<\/guid>/.exec(b)?.[1]?.trim()
          || '';

        const pub = /<pubDate>([^<]+)<\/pubDate>/.exec(b)?.[1]?.trim() || '';

        const srcCdata = /<source[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/source>/.exec(b);
        const srcPlain = /<source[^>]*>([^<]+)<\/source>/.exec(b);
        const source = (srcCdata?.[1] || srcPlain?.[1] || '').trim();

        if (title && link) items.push({ title, url: link, source, pubDate: pub });
      }

      return { company: name, news: items };
    } catch (e) {
      console.error(`[company-news] ${name} error:`, e.message);
      return { company: name, news: [], _debug: { error: e.message } };
    }
  }));

  return new Response(JSON.stringify({ ok: true, data: results }), { headers });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
