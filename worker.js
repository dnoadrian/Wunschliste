/*
 * Cloudflare Worker für Wishly: liefert die Seite (index.html) aus
 * und ist gleichzeitig der Proxy, über den die Seite Shopseiten lädt.
 *
 *   https://<worker>.workers.dev/                 -> Webseite
 *   https://<worker>.workers.dev/proxy?url=https://…  -> Shopseite abrufen
 *   https://<worker>.workers.dev/api/…                -> Benutzerkonten + gespeicherte Wunschlisten
 *   https://<worker>.workers.dev/api/admin/…          -> Admin-Panel: Benutzer anzeigen und löschen
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

// Wishly kann auch unter einem Unterordner laufen, z.B. https://dnoadrian.at/wishly/
const BASE = '/wishly';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === BASE || url.pathname.startsWith(`${BASE}/`)) {
      // /wishly -> /wishly/ (sonst stimmen die relativen Pfade der Seite nicht)
      if (url.pathname === BASE) return Response.redirect(`${url.origin}${BASE}/${url.search}`, 301);
      url.pathname = url.pathname.slice(BASE.length);
    } else if (url.pathname.startsWith(BASE)) {
      return fetch(request); // z.B. /wishlyxyz gehört nicht zu Wishly -> an die eigentliche Webseite
    }
    if (url.pathname.startsWith('/api/')) return api(request, env, url);
    if (url.pathname !== '/proxy') return env.ASSETS.fetch(new Request(url, request));

    // nur für die eigene Seite (sonst wäre es ein offener Proxy für jeden)
    const origin = request.headers.get('Origin');
    const sameSite = request.headers.get('Sec-Fetch-Site') === 'same-origin' || origin === url.origin;
    const cors = { 'Access-Control-Allow-Origin': url.origin };
    if (!sameSite) return new Response('nicht erlaubt', { status: 403, headers: cors });

    const target = url.searchParams.get('url');
    if (!target || !/^https?:\/\//i.test(target)) {
      return new Response('?url=https://… fehlt', { status: 400, headers: cors });
    }

    let res;
    try {
      res = await fetch(target, { redirect: 'follow', headers: HEADERS, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      return new Response(`shop nicht erreichbar: ${e.message}`, { status: 502, headers: cors });
    }

    const headers = new Headers(cors);
    headers.set('Content-Type', res.headers.get('Content-Type') || 'text/plain');
    headers.set('Cache-Control', 'no-store');
    return new Response(res.body, { status: res.status, headers });
  },
};

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
  if (url.pathname.startsWith('/api/admin/')) return admin(request, env, url);

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

  const route = url.pathname.slice(5);
  if (!['register', 'login', 'data', 'logout'].includes(route)) return json({ error: 'unbekannt' }, 404);
  const res = await account(env, user).fetch(`https://account/${route}`, {
    method: request.method,
    headers: { 'Content-Type': 'application/json', 'X-Token': token },
    body: request.method === 'GET' ? undefined : JSON.stringify({ ...body, user }),
  });
  // Benutzer für das Admin-Panel vermerken (Name + zuletzt aktiv)
  if (res.ok && (route === 'login' || route === 'register' || (route === 'data' && request.method === 'GET'))) {
    await registry(env).fetch('https://registry/touch', { method: 'POST', body: JSON.stringify({ name: user }) });
  }
  return new Response(res.body, { status: res.status, headers: res.headers });
}

const account = (env, name) => env.ACCOUNTS.get(env.ACCOUNTS.idFromName(name.toLowerCase()));
const registry = (env) => env.REGISTRY.get(env.REGISTRY.idFromName('registry'));

/* ------------------------------------------------------------ Admin */

// Admin-Zugang. Passwort ändern: in Cloudflare beim Worker ein Secret ADMIN_PASSWORD anlegen.
const ADMIN_USER = 'adrian';
const ADMIN_PASSWORD = '1234';

async function admin(request, env, url) {
  const route = url.pathname.slice('/api/admin/'.length);
  let body = {};
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch {
      return json({ error: 'ungültige anfrage' }, 400);
    }
  }
  const reg = registry(env);
  const call = (path, data) => reg.fetch(`https://registry/${path}`, { method: 'POST', body: JSON.stringify(data || {}) });

  if (route === 'login') {
    const ok =
      sameString(String(body.user || '').trim().toLowerCase(), ADMIN_USER) &&
      sameString(String(body.password || ''), env.ADMIN_PASSWORD || ADMIN_PASSWORD);
    const res = await call('admin-login', { ok });
    return new Response(res.body, { status: res.status, headers: res.headers });
  }

  // ab hier: als Admin angemeldet
  const token = (request.headers.get('Authorization') || '').replace(/^Admin /, '');
  const check = await (await call('admin-check', { token })).json();
  if (!check.ok) return json({ error: 'nicht angemeldet' }, 401);

  if (route === 'logout') {
    await call('admin-logout', { token });
    return json({ ok: true });
  }
  if (route === 'users') {
    const names = await (await call('list')).json();
    const users = await Promise.all(
      names.map(async (u) => {
        const stats = await (await account(env, u.name).fetch('https://account/internal/stats')).json();
        return { ...u, ...stats };
      }),
    );
    // Konten, die inzwischen gelöscht/leer sind, aus der Übersicht nehmen
    const gone = users.filter((u) => !u.exists);
    await Promise.all(gone.map((u) => call('remove', { name: u.name })));
    return json({ users: users.filter((u) => u.exists).sort((a, b) => (b.seen || 0) - (a.seen || 0)) });
  }
  if (route === 'delete') {
    const name = String(body.user || '').trim();
    if (!USERNAME.test(name)) return json({ error: 'ungültiger benutzer' }, 400);
    if (name.toLowerCase() === ADMIN_USER) return json({ error: 'das admin-konto kann nicht gelöscht werden' }, 400);
    await account(env, name).fetch('https://account/internal/wipe', { method: 'POST', body: '{}' });
    await call('remove', { name });
    return json({ ok: true });
  }
  return json({ error: 'unbekannt' }, 404);
}

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

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

    // nur vom Worker selbst aufrufbar (api() leitet diese Wege nicht weiter)
    if (route === 'internal/stats') {
      const auth = await st.get('auth');
      if (!auth) return json({ exists: false });
      const data = (await st.get('data')) || { lists: [], items: {} };
      const items = Object.values(data.items || {}).reduce((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
      return json({
        exists: true,
        name: auth.name,
        created: auth.created,
        saved: data.saved || null,
        lists: (data.lists || []).length,
        items,
        devices: ((await st.get('tokens')) || []).length,
      });
    }
    if (route === 'internal/wipe') {
      await st.deleteAll();
      return json({ ok: true });
    }

    // Anmelden nur mit Benutzernamen (ohne Passwort): gibt es den Namen noch nicht, wird er angelegt
    if (route === 'login' || route === 'register') {
      let auth = await st.get('auth');
      if (!auth) {
        auth = { name: body.user, created: Date.now() };
        await st.put('auth', auth);
      }
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

// Verzeichnis aller Benutzer (für das Admin-Panel) und Admin-Sitzungen
export class Registry extends DurableObject {
  async fetch(request) {
    const route = new URL(request.url).pathname.slice(1);
    const st = this.ctx.storage;
    const body = request.method === 'GET' ? {} : await request.json();
    const now = Date.now();

    if (route === 'touch') {
      const key = `u:${body.name.toLowerCase()}`;
      const u = (await st.get(key)) || { first: now };
      await st.put(key, { ...u, name: body.name, seen: now });
      return json({ ok: true });
    }
    if (route === 'remove') {
      await st.delete(`u:${body.name.toLowerCase()}`);
      return json({ ok: true });
    }
    if (route === 'list') return json([...(await st.list({ prefix: 'u:' })).values()]);

    // Admin-Anmeldung: nach 5 Fehlversuchen 15 Minuten gesperrt
    const sessions = ((await st.get('admin-sessions')) || []).filter((s) => s.until > now);
    if (route === 'admin-login') {
      const lock = (await st.get('admin-lock')) || { fails: 0, until: 0 };
      if (lock.until > now) return json({ error: 'zu viele fehlversuche – später nochmal probieren' }, 429);
      if (!body.ok) {
        const fails = lock.fails + 1;
        await st.put('admin-lock', fails >= 5 ? { fails: 0, until: now + 15 * 60e3 } : { fails, until: 0 });
        return json({ error: 'name oder passwort falsch' }, 401);
      }
      await st.put('admin-lock', { fails: 0, until: 0 });
      const token = randomToken();
      await st.put('admin-sessions', [...sessions, { token, until: now + 12 * 3600e3 }].slice(-10));
      return json({ token });
    }
    if (route === 'admin-check') return json({ ok: !!body.token && sessions.some((s) => sameString(s.token, body.token)) });
    if (route === 'admin-logout') {
      await st.put('admin-sessions', sessions.filter((s) => !sameString(s.token, body.token)));
      return json({ ok: true });
    }
    return json({ error: 'unbekannt' }, 404);
  }
}
