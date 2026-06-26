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
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(name)}+company&hl=en&gl=US&ceid=US:en`;
      const res = await fetch(rssUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return { company: name, news: [] };

      const xml = await res.text();
      const items = [];
      const itemRe = /<item>([\s\S]*?)<\/item>/g;
      let m;
      while ((m = itemRe.exec(xml)) !== null && items.length < 5) {
        const b = m[1];
        const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(b) || /<title>(.*?)<\/title>/.exec(b) || [])[1]?.trim();
        const link  = (/<link>(.*?)<\/link>/.exec(b) || [])[1]?.trim();
        const pub   = (/<pubDate>(.*?)<\/pubDate>/.exec(b) || [])[1]?.trim();
        const srcM  = /<source[^>]*>(.*?)<\/source>/.exec(b);
        const source = srcM ? srcM[1].trim() : '';
        if (title && link) items.push({ title, url: link, source, pubDate: pub || '' });
      }
      return { company: name, news: items };
    } catch {
      return { company: name, news: [] };
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
