// Agenda falsa em memória — só para testar localmente (CALENDAR_MOCK=1 no .dev.vars).
// Mesma interface do googleCalendar(); some ao reiniciar o servidor local.

const events = new Map();
let seq = 0;

const startMs = (e) => Date.parse(e.start.dateTime || `${e.start.date}T00:00:00-03:00`);
const endMs = (e) => Date.parse(e.end.dateTime || `${e.end.date}T00:00:00-03:00`);

export function mockCalendar() {
  return {
    async list(timeMin, timeMax) {
      const a = Date.parse(timeMin), b = Date.parse(timeMax);
      return [...events.values()].filter((e) => startMs(e) < b && endMs(e) > a).sort((x, y) => startMs(x) - startMs(y));
    },
    async findByEgId(egId) {
      return [...events.values()].find((e) => e.extendedProperties?.private?.eg_id === egId) || null;
    },
    async get(id) { return events.get(id) || null; },
    async insert(event) {
      const id = `mock${++seq}`;
      const saved = { ...structuredClone(event), id, status: 'confirmed' };
      events.set(id, saved);
      return saved;
    },
    async patch(id, patch) {
      const cur = events.get(id);
      if (!cur) throw new Error('não encontrado');
      const merged = { ...cur, ...structuredClone(patch) };
      if (patch.extendedProperties) merged.extendedProperties = { private: { ...cur.extendedProperties?.private, ...patch.extendedProperties.private } };
      events.set(id, merged);
      return merged;
    },
    async remove(id) { events.delete(id); return null; },
  };
}
