/*
 * Cloudflare Worker: liefert die Wunschliste (index.html) aus
 * und ist gleichzeitig der Proxy, über den die Seite Shopseiten lädt.
 *
 *   https://<worker>.workers.dev/                 -> Webseite
 *   https://<worker>.workers.dev/proxy?url=https://…  -> Shopseite abrufen
 *   https://<worker>.workers.dev/debug?url=https://…  -> Diagnose: was liefert der Shop?
 *   https://<worker>.workers.dev/api/…                -> Benutzerkonten + gespeicherte Wunschlisten
 */

import { DurableObject } from 'cloudflare:workers';

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
    if (url.pathname.startsWith('/api/')) return api(request, env, url);
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
      '--- preis-stellen (code)',
      ...[...html.matchAll(/\\?"(?:price|amount|salePrice|finalPrice)\\?"\s*:\s*\\?"?[\d.,]+/gi)]
        .slice(0, 20)
        .map((m) => html.slice(Math.max(0, m.index - 120), m.index + 60).replace(/\s+/g, ' ')),
      '',
      '--- preis-stellen (text)',
      ...[...html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').matchAll(/.{0,60}(?:€|EUR|\$)\s?\d[\d.,]*|.{0,60}\d[\d.,]*\s?(?:€|EUR)/g)]
        .slice(0, 20)
        .map((m) => m[0].trim()),
      '',
      `next.js datenstrom: ${(html.match(/self\.__next_f\.push/g) || []).length} teile`,
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

/* ------------------------------------------------------------ Konten */

// Jeder Benutzer hat einen eigenen Speicher (Durable Object "Account"), Name = Benutzername klein geschrieben
const USERNAME = /^[\p{L}\p{N}_.-]{2,32}$/u;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

async function api(request, env, url) {
  // nur von der eigenen Seite aus (Schutz vor fremden Webseiten)
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'nicht erlaubt' }, 403);
  if (url.pathname === '/api/ping') return json({ ok: true });

  let body = {};
  if (request.method === 'POST' || request.method === 'PUT') {
    try {
      body = await request.json();
    } catch {
      return json({ error: 'ungültige anfrage' }, 400);
    }
  }

  let user = '';
  let token = '';
  if (url.pathname === '/api/register' || url.pathname === '/api/login') {
    user = String(body.user || '').trim();
  } else {
    const auth = request.headers.get('Authorization') || '';
    const m = auth.match(/^Bearer ([^:]+):([A-Za-z0-9_-]+)$/);
    if (!m) return json({ error: 'nicht angemeldet' }, 401);
    user = decodeURIComponent(m[1]);
    token = m[2];
  }
  if (!USERNAME.test(user)) return json({ error: 'benutzername: 2–32 zeichen, buchstaben/zahlen/._-' }, 400);

  const stub = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(user.toLowerCase()));
  const route = url.pathname.slice(5); // register | login | data | logout
  const res = await stub.fetch(`https://account/${route}`, {
    method: request.method,
    headers: { 'Content-Type': 'application/json', 'X-Token': token },
    body: request.method === 'GET' ? undefined : JSON.stringify({ ...body, user }),
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
}

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

async function hashPassword(pass, saltB64, iterations = 100000) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return b64url(bits);
}

function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class Account extends DurableObject {
  async fetch(request) {
    const route = new URL(request.url).pathname.slice(1);
    const st = this.ctx.storage;
    const body = request.method === 'GET' ? {} : await request.json();

    if (route === 'register') {
      if (await st.get('auth')) return json({ error: 'benutzer gibt es schon – bitte anmelden' }, 409);
      if (String(body.pass || '').length < 6) return json({ error: 'passwort: mindestens 6 zeichen' }, 400);
      const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      await st.put('auth', { name: body.user, salt, hash: await hashPassword(body.pass, salt), created: Date.now() });
      return this.newSession(body.user, true);
    }

    if (route === 'login') {
      const auth = await st.get('auth');
      if (!auth) return json({ error: 'benutzer nicht gefunden – bitte registrieren' }, 404);
      // Schutz vor Passwort-Raten: nach 10 Fehlversuchen 15 Minuten Pause
      const fails = (await st.get('fails')) || { n: 0, until: 0 };
      if (fails.until > Date.now()) return json({ error: 'zu viele versuche – bitte in 15 minuten wieder' }, 429);
      if (!sameString(await hashPassword(String(body.pass || ''), auth.salt), auth.hash)) {
        fails.n += 1;
        if (fails.n >= 10) Object.assign(fails, { n: 0, until: Date.now() + 15 * 60e3 });
        await st.put('fails', fails);
        return json({ error: 'falsches passwort' }, 401);
      }
      await st.delete('fails');
      return this.newSession(auth.name, !(await st.get('data')));
    }

    // ab hier: angemeldet
    const token = request.headers.get('X-Token');
    const tokens = (await st.get('tokens')) || [];
    if (!token || !tokens.some((t) => sameString(t, token))) return json({ error: 'nicht angemeldet' }, 401);

    if (route === 'logout') {
      await st.put('tokens', tokens.filter((t) => !sameString(t, token)));
      return json({ ok: true });
    }
    if (route === 'data' && request.method === 'GET') {
      const auth = await st.get('auth');
      return json({ name: auth.name, data: (await st.get('data')) || null });
    }
    if (route === 'data' && request.method === 'PUT') {
      const data = body.data;
      if (!data || !Array.isArray(data.lists) || typeof data.items !== 'object') return json({ error: 'ungültige daten' }, 400);
      if (JSON.stringify(data).length > 1.8e6) return json({ error: 'wunschliste zu groß' }, 413);
      await st.put('data', { lists: data.lists, active: data.active, items: data.items, saved: Date.now() });
      return json({ ok: true });
    }
    return json({ error: 'unbekannt' }, 404);
  }

  async newSession(name, empty) {
    const token = randomToken();
    const tokens = [...((await this.ctx.storage.get('tokens')) || []), token].slice(-20); // max. 20 geräte
    await this.ctx.storage.put('tokens', tokens);
    return json({ user: name, token, empty });
  }
}
