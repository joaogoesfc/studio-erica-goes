// /api/comprovante       POST (público): a cliente envia a foto do comprovante do sinal (já reduzida no celular).
// /api/comprovante/<id>  GET  (link que vai na mensagem de WhatsApp para a Erica).
// Guardado no KV do próprio site e apagado sozinho depois de 60 dias.
import { json } from '../../../lib/agenda.js';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX = 2 * 1024 * 1024;
const TTL = 60 * 86400;

export async function onRequestGet({ params, env }) {
  const id = [].concat(params.id || [])[0] || '';
  if (!/^[a-f0-9]{32}$/.test(id) || !env.AUTH) return new Response('Comprovante não encontrado (pode ter expirado).', { status: 404 });
  const { value, metadata } = await env.AUTH.getWithMetadata(`comp:${id}`, 'arrayBuffer');
  if (!value) return new Response('Comprovante não encontrado (pode ter expirado).', { status: 404 });
  return new Response(value, {
    headers: {
      'Content-Type': metadata?.type || 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.AUTH) return json({ error: 'not_configured', message: 'Envio de comprovante indisponível.' }, 501);
  const type = (request.headers.get('Content-Type') || '').split(';')[0];
  if (!TYPES.includes(type)) return json({ error: 'invalid', message: 'Envie uma foto do comprovante.' }, 400);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX) return json({ error: 'too_large', message: 'Foto grande demais. Tente um print da tela.' }, 413);
  const id = crypto.randomUUID().replace(/-/g, '');
  await env.AUTH.put(`comp:${id}`, buf, { expirationTtl: TTL, metadata: { type, at: new Date().toISOString() } });
  return json({ ok: true, url: `/api/comprovante/${id}` });
}
