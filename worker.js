/*
 * Cloudflare Worker: liefert die Wunschliste (index.html) aus
 * und ist gleichzeitig der Proxy, über den die Seite Shopseiten lädt.
 *
 *   https://<worker>.workers.dev/                 -> Webseite
 *   https://<worker>.workers.dev/proxy?url=https://…  -> Shopseite abrufen
 *   https://<worker>.workers.dev/debug?url=https://…  -> Diagnose: was liefert der Shop?
 */

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
  // Shops (v.a. Shopify) sollen Preise für Österreich in Euro liefern, nicht in ihrer Heimatwährung
  'Cookie': 'localization=AT; cart_currency=EUR',
};

// Andere Seiten, die den Proxy zusätzlich benutzen dürfen (z.B. GitHub Pages)
const ERLAUBT = ['https://dnoadrian.github.io'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/debug') return debug(url.searchParams.get('url'));
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
      res = await fetch(target, { redirect: 'follow', headers: HEADERS });
    } catch (e) {
      return new Response(`shop nicht erreichbar: ${e.message}`, { status: 502, headers: cors });
    }

    const headers = new Headers(cors);
    headers.set('Content-Type', res.headers.get('Content-Type') || 'text/plain');
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  },
};

// Kurzer Bericht, was der Worker vom Shop bekommt (zum Fehlersuchen im Browser öffnen)
async function debug(target) {
  if (!target || !/^https?:\/\//i.test(target)) return new Response('?url=https://… fehlt', { status: 400 });
  const out = [`url: ${target}`];
  try {
    const res = await fetch(target, { redirect: 'follow', headers: HEADERS });
    const html = await res.text();
    const grab = (re) => [...html.matchAll(re)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 300));
    out.push(
      `status: ${res.status}`,
      `final-url: ${res.url}`,
      `content-type: ${res.headers.get('content-type')}`,
      `server: ${res.headers.get('server') || '-'}`,
      `länge: ${html.length} zeichen`,
      '',
      '--- title / h1',
      ...grab(/<title[^>]*>[\s\S]*?<\/title>/gi),
      ...grab(/<h1[^>]*>[\s\S]*?<\/h1>/gi).slice(0, 3),
      '',
      '--- meta',
      ...grab(/<meta[^>]+(?:property|name|itemprop)=["'](?:og:|product:|twitter:|price|name|image)[^>]*>/gi).slice(0, 25),
      '',
      '--- json-ld',
      ...grab(/<script[^>]+ld\+json[^>]*>[\s\S]*?<\/script>/gi).slice(0, 5),
      '',
      '--- itemprop',
      ...grab(/<[^>]+itemprop=["'][^"']+["'][^>]*>/gi).slice(0, 15),
      '',
      '--- scripts',
      ...grab(/<script[^>]*src=["'][^"']+["'][^>]*>/gi).slice(0, 15),
      ...grab(/<script[^>]*type=["'][^"']*json[^"']*["'][^>]*>/gi).slice(0, 10),
      '',
      '--- anfang der seite',
      html.slice(0, 1500),
    );
  } catch (e) {
    out.push(`fehler: ${e.message}`);
  }
  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
