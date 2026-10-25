// /api/boot — script carregado no <head> antes do app: entrega a configuração em window.EG_CONFIG.
import { getConfig } from '../../lib/config.js';

export async function onRequestGet({ env }) {
  const cfg = await getConfig(env);
  const js = `window.EG_CONFIG=${JSON.stringify(cfg).replace(/</g, '\\u003c')};`;
  return new Response(js, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
