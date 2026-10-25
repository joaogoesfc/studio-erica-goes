// Configuração editável pela Erica (página /ajustes): serviços, abas, horários, datas especiais e sinal.
// Guardada no KV (binding AUTH, chave "config"). Sem nada salvo, vale lib/default-config.json.
import DEFAULT from './default-config.json';
import { HttpError } from './agenda.js';

const KEY = 'config';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IMG_RE = /^(assets\/img\/erica\/[\w-]+\.webp|\/api\/img\/[\w-]{8,40})$/;

export async function getConfig(env) {
  if (env.AUTH) {
    const saved = await env.AUTH.get(KEY, 'json');
    if (saved && saved.v === 1) return saved;
  }
  return DEFAULT;
}

const text = (v, max, campo) => {
  const t = String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) throw new HttpError(400, 'invalid', `Preencha ${campo}.`);
  if (t.length > max) throw new HttpError(400, 'invalid', `${campo} pode ter no máximo ${max} caracteres.`);
  return t;
};
const int = (v, min, max, campo) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, 'invalid', `${campo} precisa estar entre ${min} e ${max}.`);
  return n;
};
const slots = (list, onde) => {
  if (!Array.isArray(list) || list.length > 24) throw new HttpError(400, 'invalid', `Horários inválidos em ${onde}.`);
  const out = [...new Set(list.map(String))].sort();
  for (const t of out) if (!TIME_RE.test(t)) throw new HttpError(400, 'invalid', `Horário "${t}" inválido em ${onde}.`);
  return out;
};

export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'invalid', 'Configuração inválida.');
  if (!Array.isArray(raw.categories) || !raw.categories.length) throw new HttpError(400, 'invalid', 'Crie pelo menos uma aba.');
  if (raw.categories.length > 15) throw new HttpError(400, 'invalid', 'No máximo 15 abas.');
  const nomesAba = new Set(), nomesServ = new Set();
  let total = 0;
  const categories = raw.categories.map((c, i) => {
    const name = text(c.name, 50, `o nome da aba ${i + 1}`);
    if (nomesAba.has(name)) throw new HttpError(400, 'invalid', `Existem duas abas chamadas "${name}".`);
    nomesAba.add(name);
    const services = (Array.isArray(c.services) ? c.services : []).map((s) => {
      const sn = text(s.name, 80, `o nome de um serviço da aba "${name}"`);
      if (nomesServ.has(sn)) throw new HttpError(400, 'invalid', `O serviço "${sn}" aparece duas vezes. Use nomes diferentes (ex.: "${sn} (Manutenção)").`);
      nomesServ.add(sn);
      const image = String(s.image || '');
      if (image && !IMG_RE.test(image)) throw new HttpError(400, 'invalid', `Foto inválida em "${sn}".`);
      return {
        name: sn,
        price: int(s.price, 0, 10000, `O preço de "${sn}"`),
        dur: int(s.dur, 5, 600, `A duração de "${sn}" (minutos)`),
        gap: int(s.gap, 0, 240, `O intervalo depois de "${sn}" (minutos)`),
        image,
      };
    });
    total += services.length;
    return { name, services };
  });
  if (total > 150) throw new HttpError(400, 'invalid', 'No máximo 150 serviços.');

  if (!Array.isArray(raw.week) || raw.week.length !== 7) throw new HttpError(400, 'invalid', 'Horários da semana inválidos.');
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const week = raw.week.map((d, i) => {
    const s = slots(d?.slots || [], DIAS[i]);
    const open = d?.open && TIME_RE.test(d.open) ? d.open : null;
    const close = d?.close && TIME_RE.test(d.close) ? d.close : null;
    if (s.length && (!open || !close || close <= open)) throw new HttpError(400, 'invalid', `Informe o horário de funcionamento de ${DIAS[i]} (abre antes de fechar).`);
    return s.length ? { slots: s, open, close } : { slots: [], open: null, close: null };
  });

  const dates = {};
  for (const [k, d] of Object.entries(raw.dates || {}).slice(0, 120)) {
    if (!DATE_RE.test(k) || Number.isNaN(Date.parse(`${k}T00:00:00Z`))) throw new HttpError(400, 'invalid', `Data especial inválida: ${k}.`);
    dates[k] = d?.closed ? { closed: true } : { slots: slots(d?.slots || [], k.split('-').reverse().join('/')) };
    if (!dates[k].closed && !dates[k].slots.length) dates[k] = { closed: true };
  }

  const dep = raw.deposit || {};
  const deposit = {
    low: int(dep.low, 0, 1000, 'O sinal menor'),
    high: int(dep.high, 0, 1000, 'O sinal maior'),
    limit: int(dep.limit, 0, 10000, 'O preço-limite do sinal menor'),
  };
  return { v: 1, categories, week, dates, deposit, updatedAt: new Date().toISOString() };
}

export async function saveConfig(env, raw) {
  if (!env.AUTH) throw new HttpError(501, 'not_configured', 'Armazenamento não configurado.');
  const cfg = validateConfig(raw);
  await env.AUTH.put(KEY, JSON.stringify(cfg));
  // apaga fotos enviadas que nenhum serviço usa mais
  const usadas = new Set(cfg.categories.flatMap((c) => c.services.map((s) => s.image)));
  const lista = await env.AUTH.list({ prefix: 'img:' });
  await Promise.all(lista.keys.filter((k) => !usadas.has(`/api/img/${k.name.slice(4)}`)).map((k) => env.AUTH.delete(k.name)));
  return cfg;
}
