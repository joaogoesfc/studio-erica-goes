// Login do painel /admin.
// - Senha inicial: segredo ADMIN_PASSWORD (configurado no Cloudflare).
// - Depois que a Erica troca pelo painel, a senha nova fica no KV (binding AUTH) como
//   HMAC(pepper, salt:senha). O pepper vem da chave do Google (segredo), então quem lesse só o KV
//   não conseguiria testar senhas. Hash rápido de propósito: o plano grátis do Workers tem 10 ms de CPU.
// - Sessão = token assinado com HMAC; a chave do token deriva da senha vigente, então trocar a
//   senha derruba todas as sessões abertas.

const enc = new TextEncoder();
const KV_KEY = 'admin_password';
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
const sha256 = (text) => crypto.subtle.digest('SHA-256', enc.encode(text));
const hmacKeyFrom = (raw) => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

function sameBytes(a, b) {
  const x = new Uint8Array(a), y = new Uint8Array(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function pepper(env) {
  const raw = await sha256(`eg-pepper:${env.GOOGLE_SERVICE_ACCOUNT_JSON || ''}`);
  return { key: await hmacKeyFrom(raw), id: b64url(raw).slice(0, 10) };
}

async function storedRecord(env, pep) {
  if (!env.AUTH) return null;
  const rec = await env.AUTH.get(KV_KEY, 'json');
  // Se a chave do Google mudar, o hash salvo deixa de valer e volta a senha inicial (ADMIN_PASSWORD).
  return rec && rec.pepperId === pep.id ? rec : null;
}

const hashWith = async (pep, salt, password) => b64url(await crypto.subtle.sign('HMAC', pep.key, enc.encode(`${salt}:${password}`)));

async function current(env) {
  const pep = await pepper(env);
  const rec = await storedRecord(env, pep);
  if (!rec && !env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD não configurado');
  return { pep, rec };
}

export async function checkPassword(env, candidate) {
  const { pep, rec } = await current(env);
  if (rec) return sameBytes(enc.encode(await hashWith(pep, rec.salt, candidate || '')), enc.encode(rec.hash));
  const [a, b] = await Promise.all([hashWith(pep, 'boot', candidate || ''), hashWith(pep, 'boot', env.ADMIN_PASSWORD)]);
  return sameBytes(enc.encode(a), enc.encode(b));
}

export async function setPassword(env, newPassword) {
  if (!env.AUTH) throw new Error('KV AUTH não configurado');
  const pep = await pepper(env);
  const salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const rec = { v: 1, pepperId: pep.id, salt, hash: await hashWith(pep, salt, newPassword), changedAt: new Date().toISOString() };
  await env.AUTH.put(KV_KEY, JSON.stringify(rec));
}

async function sessionKey(env) {
  const { pep, rec } = await current(env);
  const basis = rec ? `kv:${rec.hash}` : `boot:${await hashWith(pep, 'boot', env.ADMIN_PASSWORD)}`;
  return hmacKeyFrom(await sha256(`eg-session:${pep.id}:${basis}`));
}

export async function issueToken(env, ttlSeconds) {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = await crypto.subtle.sign('HMAC', await sessionKey(env), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function isAdmin(request, env) {
  const m = /^Bearer\s+([\w-]+)\.([\w-]+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) return false;
  try {
    const sig = Uint8Array.from(b64urlDecode(m[2]), (c) => c.charCodeAt(0));
    if (!(await crypto.subtle.verify('HMAC', await sessionKey(env), sig, enc.encode(m[1])))) return false;
    const { exp } = JSON.parse(b64urlDecode(m[1]));
    return typeof exp === 'number' && exp > Date.now() / 1000;
  } catch {
    return false;
  }
}
