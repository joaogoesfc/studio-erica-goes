// /api/img       POST (painel): recebe uma foto já reduzida no navegador e guarda no KV.
// /api/img/<id>  GET  (público): devolve a foto.
import { isAdmin } from '../../../lib/auth.js';
import { json } from '../../../lib/agenda.js';

const TYPES = ['image/webp', 'image/jpeg', 'image/png'];
const MAX = 400 * 1024;

export async function onRequestGet({ params, env }) {
  const id = [].concat(params.id || [])[0] || '';
  if (!/^[\w-]{8,40}$/.test(id) || !env.AUTH) return new Response('Não encontrado', { status: 404 });
  const { value, metadata } = await env.AUTH.getWithMetadata(`img:${id}`, 'arrayBuffer');
  if (!value) return new Response('Não encontrado', { status: 404 });
  return new Response(value, {
    headers: { 'Content-Type': metadata?.type || 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await isAdmin(request, env))) return json({ error: 'unauthorized', message: 'Faça login no painel novamente.' }, 401);
  if (!env.AUTH) return json({ error: 'not_configured', message: 'Armazenamento não configurado.' }, 501);
  const type = (request.headers.get('Content-Type') || '').split(';')[0];
  if (!TYPES.includes(type)) return json({ error: 'invalid', message: 'Envie uma imagem (JPG, PNG ou WebP).' }, 400);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX) return json({ error: 'too_large', message: 'Foto grande demais.' }, 413);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  await env.AUTH.put(`img:${id}`, buf, { metadata: { type } });
  return json({ ok: true, url: `/api/img/${id}` });
}
