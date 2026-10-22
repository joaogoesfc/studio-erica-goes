// Cliente mínimo da API do Google Agenda usando uma conta de serviço (JWT RS256 via WebCrypto).
// Sem dependências: roda no runtime do Cloudflare (Workers / Pages Functions).

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const API = 'https://www.googleapis.com/calendar/v3';

let cachedToken = null; // { value, exp } — reaproveitado enquanto o isolate estiver vivo

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function importPrivateKey(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

function serviceAccount(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não configurado');
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!sa.client_email || !sa.private_key) throw new Error('JSON da conta de serviço inválido');
  return sa;
}

async function accessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value;
  const sa = serviceAccount(env);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({
    iss: sa.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600,
  })}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google OAuth ${res.status}: ${await res.text()}`);
  const data = await res.json();
  cachedToken = { value: data.access_token, exp: now + data.expires_in };
  return cachedToken.value;
}

async function call(env, method, path, { query, body } = {}) {
  const url = new URL(`${API}/calendars/${encodeURIComponent(env.CALENDAR_ID)}${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    for (const item of [].concat(v)) url.searchParams.append(k, item);
  }
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await accessToken(env)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204 || res.status === 410) return null; // 410 = já apagado
  if (!res.ok) throw new Error(`Google Calendar ${method} ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

export function googleCalendar(env) {
  if (!env.CALENDAR_ID) throw new Error('CALENDAR_ID não configurado');
  return {
    async list(timeMin, timeMax) {
      const items = [];
      let pageToken;
      do {
        const page = await call(env, 'GET', '/events', {
          query: { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', ...(pageToken ? { pageToken } : {}) },
        });
        items.push(...(page.items || []));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return items.filter((e) => e.status !== 'cancelled');
    },
    async findByEgId(egId) {
      const page = await call(env, 'GET', '/events', { query: { privateExtendedProperty: `eg_id=${egId}`, maxResults: '5' } });
      return (page.items || []).find((e) => e.status !== 'cancelled') || null;
    },
    get: (eventId) => call(env, 'GET', `/events/${encodeURIComponent(eventId)}`),
    insert: (event) => call(env, 'POST', '/events', { body: event }),
    patch: (eventId, event) => call(env, 'PATCH', `/events/${encodeURIComponent(eventId)}`, { body: event }),
    remove: (eventId) => call(env, 'DELETE', `/events/${encodeURIComponent(eventId)}`),
  };
}
