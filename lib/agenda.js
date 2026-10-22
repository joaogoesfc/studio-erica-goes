// Regras de agendamento do Studio Erica Goes em cima do Google Agenda.
// Formato da API = o que o app React (herdado do site original) já espera:
//   booking: { id, service, price, date: "dd/MM/yyyy", time: "HH:mm", name, phone, status }
//   block:   { id, date: "dd/MM/yyyy", allDay, start: "HH:mm", end: "HH:mm", reason }

import { googleCalendar } from './google.js';
import { mockCalendar } from './mock.js';

const OFFSET = '-03:00'; // Brasília, sem horário de verão desde 2019
const OFFSET_MS = -3 * 3600 * 1000;
const DAY_MS = 86400000;
const COLOR_BOOKING = '4'; // flamingo (rosa)
const COLOR_DONE = '8'; // grafite

export const calendarFor = (env) => (env.CALENDAR_MOCK === '1' ? mockCalendar() : googleCalendar(env));

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

export class HttpError extends Error {
  constructor(status, error, message) { super(message); this.status = status; this.error = error; }
}

// ---------- datas ----------
const DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function toIso(date, time) {
  const [, d, m, y] = DATE_RE.exec(date) || [];
  if (!d || !TIME_RE.test(time)) throw new HttpError(400, 'invalid_datetime', 'Data ou horário inválido.');
  const iso = `${y}-${m}-${d}T${time}:00${OFFSET}`;
  if (Number.isNaN(Date.parse(iso))) throw new HttpError(400, 'invalid_datetime', 'Data inválida.');
  return iso;
}
const localParts = (ms) => {
  const t = new Date(ms + OFFSET_MS);
  const p = (n) => String(n).padStart(2, '0');
  return { date: `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`, time: `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`, ymd: `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}` };
};
const dayStartMs = (ms) => Math.floor((ms + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS;
const isoPlus = (iso, minutes) => new Date(Date.parse(iso) + minutes * 60000).toISOString();
const ymdToBr = (ymd) => ymd.split('-').reverse().join('/');
const addDaysYmd = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const eventStartMs = (e) => Date.parse(e.start.dateTime || `${e.start.date}T00:00:00${OFFSET}`);
const eventEndMs = (e) => Date.parse(e.end.dateTime || `${e.end.date}T00:00:00${OFFSET}`);
const isBusy = (e) => e.transparency !== 'transparent' && e.status !== 'cancelled';
const priv = (e) => e.extendedProperties?.private || {};

// ---------- evento -> blocos por dia (o app calcula horário livre por dia) ----------
function eventToDayBlocks(e, withReason) {
  const base = { id: priv(e).eg_id || e.id };
  const reason = withReason ? (priv(e).eg_type === 'booking' ? 'Agendamento' : e.summary || 'Ocupado') : undefined;
  const out = [];
  if (e.start.date) { // dia inteiro (end.date é exclusivo)
    for (let ymd = e.start.date; ymd < e.end.date; ymd = addDaysYmd(ymd, 1)) {
      out.push({ ...base, id: `${base.id}:${ymd}`, date: ymdToBr(ymd), allDay: true, reason });
    }
    return out;
  }
  const s = eventStartMs(e), en = eventEndMs(e);
  for (let day = dayStartMs(s); day < en; day += DAY_MS) {
    const a = Math.max(s, day), b = Math.min(en, day + DAY_MS);
    if (b <= a) continue;
    const end = b === day + DAY_MS ? '24:00' : localParts(b).time;
    out.push({ ...base, id: out.length ? `${base.id}:${localParts(a).ymd}` : base.id, date: localParts(a).date, allDay: false, start: localParts(a).time, end, reason });
  }
  return out;
}

function eventToBooking(e) {
  let data = {};
  try { data = JSON.parse(priv(e).eg_data || '{}'); } catch { /* evento editado à mão */ }
  const { date, time } = localParts(eventStartMs(e)); // vale o horário real do evento (Erica pode ter arrastado)
  return { ...data, id: priv(e).eg_id, date, time, status: data.status || 'accepted' };
}

// ---------- leitura ----------
export async function listForPublic(cal) {
  const now = Date.now();
  const events = await cal.list(new Date(now - DAY_MS).toISOString(), new Date(now + 120 * DAY_MS).toISOString());
  // Público só enxerga "ocupado": nenhum nome/telefone de cliente sai daqui.
  const blocks = events.filter(isBusy).flatMap((e) => eventToDayBlocks(e, false).map(({ reason, ...b }) => b));
  return { bookings: [], blocks };
}

export async function listForAdmin(cal) {
  const now = Date.now();
  const events = await cal.list(new Date(now - 365 * DAY_MS).toISOString(), new Date(now + 180 * DAY_MS).toISOString());
  const bookings = [], blocks = [];
  for (const e of events) {
    if (priv(e).eg_type === 'booking') bookings.push(eventToBooking(e));
    else if (isBusy(e)) blocks.push(...eventToDayBlocks(e, true));
  }
  return { bookings, blocks };
}

// ---------- validação ----------
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const ID_RE = /^[\w-]{6,64}$/;

function parseBooking(raw, duration, { allowPast }) {
  if (!raw || typeof raw !== 'object') throw new HttpError(400, 'invalid', 'Agendamento inválido.');
  const b = {
    id: clean(raw.id, 64), service: clean(raw.service, 300), price: Number(raw.price),
    date: clean(raw.date, 10), time: clean(raw.time, 5), name: clean(raw.name, 80),
    phone: clean(raw.phone, 20).replace(/\D/g, ''), status: raw.status === 'completed' ? 'completed' : 'accepted',
  };
  const dur = Math.round(Number(duration));
  if (!ID_RE.test(b.id)) throw new HttpError(400, 'invalid', 'Identificador inválido.');
  if (!b.service || !b.name) throw new HttpError(400, 'invalid', 'Informe nome e serviço.');
  if (b.phone.length < 10 || b.phone.length > 13) throw new HttpError(400, 'invalid', 'WhatsApp inválido.');
  if (!Number.isFinite(b.price) || b.price < 0 || b.price > 10000) throw new HttpError(400, 'invalid', 'Valor inválido.');
  if (!Number.isFinite(dur) || dur < 15 || dur > 720) throw new HttpError(400, 'invalid', 'Duração inválida.');
  const startIso = toIso(b.date, b.time);
  if (!allowPast && Date.parse(startIso) < Date.now() - 5 * 60000) throw new HttpError(400, 'past', 'Esse horário já passou.');
  if (!allowPast && Date.parse(startIso) > Date.now() + 120 * DAY_MS) throw new HttpError(400, 'too_far', 'Agendamentos só até 4 meses à frente.');
  return { b, dur, startIso, endIso: isoPlus(startIso, dur) };
}

function bookingEvent({ b, dur, startIso, endIso }) {
  const phone = b.phone.length <= 11 ? `55${b.phone}` : b.phone;
  const data = JSON.stringify({ service: b.service, price: b.price, name: b.name, phone: b.phone, status: b.status, duration: dur });
  return {
    summary: `${b.status === 'completed' ? '✅ ' : ''}${b.name} · ${b.service}`,
    description: [
      `Cliente: ${b.name}`, `WhatsApp: https://wa.me/${phone}`, `Serviço: ${b.service}`, `Valor: R$ ${b.price},00`,
      '', 'Agendado pelo site. Para cancelar, apague este evento.',
    ].join('\n'),
    start: { dateTime: startIso }, end: { dateTime: endIso },
    colorId: b.status === 'completed' ? COLOR_DONE : COLOR_BOOKING,
    extendedProperties: { private: { eg_type: 'booking', eg_id: b.id, eg_data: data.slice(0, 1024) } },
  };
}

async function assertFree(cal, startIso, endIso, ignoreEventId) {
  const s = Date.parse(startIso), e = Date.parse(endIso);
  const events = await cal.list(new Date(dayStartMs(s)).toISOString(), new Date(dayStartMs(s) + DAY_MS).toISOString());
  const clash = events.some((ev) => isBusy(ev) && ev.id !== ignoreEventId && eventStartMs(ev) < e && eventEndMs(ev) > s);
  if (clash) throw new HttpError(409, 'slot_occupied', 'Este horário acabou de ser preenchido, por favor selecione outro.');
}

// ---------- escrita ----------
export async function createBooking(cal, body, { admin }) {
  const parsed = parseBooking(body.booking, body.duration, { allowPast: admin });
  const existing = await cal.findByEgId(parsed.b.id);
  if (existing) return { ok: true, id: parsed.b.id, duplicate: true }; // clique duplo / reenvio
  if (!admin) await assertFree(cal, parsed.startIso, parsed.endIso);
  await cal.insert(bookingEvent(parsed));
  return { ok: true, id: parsed.b.id };
}

export async function updateBooking(cal, body) {
  const ev = await cal.findByEgId(clean(body.id, 64));
  if (!ev) throw new HttpError(404, 'not_found', 'Agendamento não encontrado.');
  const parsed = parseBooking({ ...body.booking, id: body.id }, body.duration, { allowPast: true });
  const { extendedProperties, ...rest } = bookingEvent(parsed);
  await cal.patch(ev.id, { ...rest, extendedProperties });
  return { ok: true, id: parsed.b.id };
}

export async function createBlock(cal, body) {
  const raw = body.block || {};
  const id = clean(raw.id, 64), reason = clean(raw.reason, 120) || 'Bloqueio de Agenda';
  if (!ID_RE.test(id)) throw new HttpError(400, 'invalid', 'Identificador inválido.');
  const [, d, m, y] = DATE_RE.exec(clean(raw.date, 10)) || [];
  if (!d) throw new HttpError(400, 'invalid_datetime', 'Data inválida.');
  const ymd = `${y}-${m}-${d}`;
  const when = raw.allDay
    ? { start: { date: ymd }, end: { date: addDaysYmd(ymd, 1) } }
    : { start: { dateTime: toIso(raw.date, clean(raw.start, 5)) }, end: { dateTime: toIso(raw.date, clean(raw.end, 5)) } };
  if (!raw.allDay && Date.parse(when.end.dateTime) <= Date.parse(when.start.dateTime)) throw new HttpError(400, 'invalid', 'O fim precisa ser depois do início.');
  if (await cal.findByEgId(id)) return { ok: true, id, duplicate: true };
  await cal.insert({ summary: `🔒 ${reason}`, ...when, colorId: COLOR_DONE, extendedProperties: { private: { eg_type: 'block', eg_id: id } } });
  return { ok: true, id };
}

export async function removeById(cal, rawId) {
  const id = clean(rawId, 200).replace(/:\d{4}-\d{2}-\d{2}$/, ''); // bloco de vários dias chega com ":AAAA-MM-DD"
  if (!id) throw new HttpError(400, 'invalid', 'Informe o id.');
  const ev = (await cal.findByEgId(id)) || (/^[\w-]+$/.test(id) ? await cal.get(id).catch(() => null) : null);
  if (!ev) throw new HttpError(404, 'not_found', 'Não encontrado.');
  await cal.remove(ev.id);
  return { ok: true };
}
