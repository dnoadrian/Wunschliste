/*
 * Cloudflare Worker: liefert die Wunschliste (index.html) aus
 * und ist gleichzeitig der Proxy, über den die Seite Shopseiten lädt.
 *
 *   https://<worker>.workers.dev/                 -> Webseite
 *   https://<worker>.workers.dev/proxy?url=https://…  -> Shopseite abrufen
 */

// Andere Seiten, die den Proxy zusätzlich benutzen dürfen (z.B. GitHub Pages)
const ERLAUBT = ['https://dnoadrian.github.io'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/proxy') return env.ASSETS.fetch(request);

    const origin = request.headers.get('Origin');
    const sameSite = request.headers.get('Sec-Fetch-Site') === 'same-origin' || origin === url.origin;
    const cors = {
      'Access-Control-Allow-Origin': ERLAUBT.includes(origin) ? origin : url.origin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!sameSite && !ERLAUBT.includes(origin)) return new Response('nicht erlaubt', { status: 403, headers: cors });

    const target = url.searchParams.get('url');
    if (!target || !/^https?:\/\//i.test(target)) {
      return new Response('?url=https://… fehlt', { status: 400, headers: cors });
    }

    let res;
    try {
      res = await fetch(target, {
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
        },
      });
    } catch (e) {
      return new Response(`shop nicht erreichbar: ${e.message}`, { status: 502, headers: cors });
    }

    const headers = new Headers(cors);
    headers.set('Content-Type', res.headers.get('Content-Type') || 'text/plain');
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  },
};
