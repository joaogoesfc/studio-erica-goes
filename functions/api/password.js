// /api/password — a Erica troca a senha do painel (precisa estar logada e saber a senha atual).
import { isAdmin, checkPassword, setPassword, issueToken } from '../../lib/auth.js';
import { json } from '../../lib/agenda.js';

const DAY = 86400;

export async function onRequestPost({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: 'unauthorized', message: 'Faça login no painel novamente.' }, 401);
  if (!env.AUTH) return json({ error: 'not_configured', message: 'Troca de senha ainda não configurada.' }, 501);
  let body = {};
  try { body = await request.json(); } catch { /* corpo vazio */ }
  const atual = String(body.current || ''), nova = String(body.next || '');
  if (!(await checkPassword(env, atual))) {
    await new Promise((r) => setTimeout(r, 900));
    return json({ error: 'invalid_password', message: 'A senha atual está incorreta.' }, 403);
  }
  if (nova.length < 8) return json({ error: 'weak', message: 'A senha nova precisa ter pelo menos 8 caracteres.' }, 400);
  if (nova.length > 100) return json({ error: 'too_long', message: 'Senha longa demais.' }, 400);
  if (nova === atual) return json({ error: 'same', message: 'A senha nova precisa ser diferente da atual.' }, 400);
  await setPassword(env, nova);
  // A troca derruba as sessões antigas; devolve uma sessão nova pra quem trocou continuar logada.
  const ttl = body.remember ? 30 * DAY : DAY / 2;
  return json({ ok: true, token: await issueToken(env, ttl), expiresIn: ttl });
}
