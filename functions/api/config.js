// /api/config — GET público (o que o site mostra) | PUT só no painel (salvar ajustes).
import { isAdmin } from '../../lib/auth.js';
import { json, HttpError } from '../../lib/agenda.js';
import { getConfig, saveConfig } from '../../lib/config.js';

export async function onRequestGet({ env }) {
  return json(await getConfig(env));
}

export async function onRequestPut({ request, env }) {
  try {
    if (!(await isAdmin(request, env))) throw new HttpError(401, 'unauthorized', 'Faça login no painel novamente.');
    const body = await request.text();
    if (body.length > 200000) throw new HttpError(413, 'too_large', 'Configuração grande demais.');
    let raw;
    try { raw = JSON.parse(body); } catch { throw new HttpError(400, 'invalid_json', 'JSON inválido.'); }
    return json({ ok: true, config: await saveConfig(env, raw) });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.error, message: err.message }, err.status);
    console.error('[api/config]', err);
    return json({ error: 'server_error', message: 'Não foi possível salvar agora.' }, 500);
  }
}
