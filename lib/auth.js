// Login do painel /admin: senha conferida no servidor (ADMIN_PASSWORD, segredo do Cloudflare)
// e sessão como token assinado com HMAC. A chave do HMAC deriva da própria senha, então trocar
// a senha derruba todas as sessões abertas.

const enc = new TextEncoder();
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

async function hmacKey(env) {
  if (!env.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD não configurado');
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`eg-admin:${env.ADMIN_PASSWORD}:${env.GOOGLE_SERVICE_ACCOUNT_JSON || ''}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// Comparação de senha em tempo constante (compara os HMACs, não as strings).
export async function checkPassword(env, candidate) {
  const key = await hmacKey(env);
  const [a, b] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(`pw:${candidate || ''}`)),
    crypto.subtle.sign('HMAC', key, enc.encode(`pw:${env.ADMIN_PASSWORD}`)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function issueToken(env, ttlSeconds) {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function isAdmin(request, env) {
  const m = /^Bearer\s+([\w-]+)\.([\w-]+)$/.exec(request.headers.get('Authorization') || '');
  if (!m) return false;
  try {
    const sig = Uint8Array.from(b64urlDecode(m[2]), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), sig, enc.encode(m[1]));
    if (!ok) return false;
    const { exp } = JSON.parse(b64urlDecode(m[1]));
    return typeof exp === 'number' && exp > Date.now() / 1000;
  } catch {
    return false;
  }
}
