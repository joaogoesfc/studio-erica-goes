// /api/login — confere a senha do painel no servidor e devolve um token de sessão.
import { checkPassword, issueToken } from '../../lib/auth.js';
import { json } from '../../lib/agenda.js';

const DAY = 86400;

export async function onRequestPost({ request, env }) {
  let body = {};
  try { body = await request.json(); } catch { /* corpo vazio */ }
  if (!(await checkPassword(env, String(body.password || '')))) {
    await new Promise((r) => setTimeout(r, 900)); // freia tentativa de adivinhar senha
    return json({ error: 'invalid_password', message: 'Senha incorreta' }, 401);
  }
  const ttl = body.remember ? 30 * DAY : DAY / 2;
  return json({ token: await issueToken(env, ttl), expiresIn: ttl });
}
