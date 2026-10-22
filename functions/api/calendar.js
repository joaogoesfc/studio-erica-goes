// /api/calendar — ponte entre o site e o Google Agenda da Erica.
//   GET              público: só horários ocupados | admin: agendamentos completos + bloqueios
//   POST booking     público (cliente agendando) ou admin (agendamento manual)
//   POST block       admin
//   PUT  booking     admin (remarcar / marcar como concluído)
//   DELETE ?id=      admin (cancelar agendamento ou apagar bloqueio)

import { isAdmin } from '../../lib/auth.js';
import {
  calendarFor, json, HttpError, listForPublic, listForAdmin, createBooking, updateBooking, createBlock, removeById,
} from '../../lib/agenda.js';

async function handle(fn) {
  try {
    return json(await fn());
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.error, message: err.message }, err.status);
    console.error('[api/calendar]', err);
    return json({ error: 'server_error', message: 'Não foi possível acessar a agenda agora.' }, 500);
  }
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 10000) throw new HttpError(413, 'too_large', 'Requisição grande demais.');
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'invalid_json', 'JSON inválido.'); }
}

async function requireAdmin(request, env) {
  if (!(await isAdmin(request, env))) throw new HttpError(401, 'unauthorized', 'Faça login no painel novamente.');
}

export const onRequestGet = ({ request, env }) =>
  handle(async () => {
    const cal = calendarFor(env);
    return (await isAdmin(request, env)) ? listForAdmin(cal) : listForPublic(cal);
  });

export const onRequestPost = ({ request, env }) =>
  handle(async () => {
    const body = await readJson(request);
    const admin = await isAdmin(request, env);
    const cal = calendarFor(env);
    if (body.type === 'booking') return createBooking(cal, body, { admin });
    if (body.type === 'block') { await requireAdmin(request, env); return createBlock(cal, body); }
    throw new HttpError(400, 'invalid_type', 'Tipo inválido.');
  });

export const onRequestPut = ({ request, env }) =>
  handle(async () => {
    await requireAdmin(request, env);
    const body = await readJson(request);
    if (body.type !== 'booking') throw new HttpError(400, 'invalid_type', 'Tipo inválido.');
    return updateBooking(calendarFor(env), body);
  });

export const onRequestDelete = ({ request, env }) =>
  handle(async () => {
    await requireAdmin(request, env);
    return removeById(calendarFor(env), new URL(request.url).searchParams.get('id'));
  });
