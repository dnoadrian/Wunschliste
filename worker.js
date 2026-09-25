/*
 * Eigener Proxy für die Wunschliste (Cloudflare Worker, kostenlos)
 *
 * 1. https://dash.cloudflare.com → Konto anlegen / einloggen
 * 2. "Workers & Pages" → "Create" → "Create Worker" → Name z.B. wunschliste-proxy → "Deploy"
 * 3. "Edit code" → alles löschen → diesen Code einfügen → "Deploy"
 * 4. Die Adresse (https://wunschliste-proxy.DEINNAME.workers.dev) in index.html
 *    bei  const EIGENER_PROXY = '...';  eintragen
 */

// Nur deine Seite darf den Proxy benutzen
const ERLAUBT = ['https://dnoadrian.github.io', 'null']; // 'null' = lokal geöffnete index.html

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ERLAUBT.includes(origin) ? origin : ERLAUBT[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (origin && !ERLAUBT.includes(origin)) return new Response('nicht erlaubt', { status: 403, headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    if (!target || !/^https?:\/\//i.test(target)) {
      return new Response('?url=https://… fehlt', { status: 400, headers: cors });
    }

    const res = await fetch(target, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      },
    });

    const headers = new Headers(cors);
    headers.set('Content-Type', res.headers.get('Content-Type') || 'text/plain');
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  },
};
