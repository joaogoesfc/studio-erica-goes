/* Studio Erica Goes — regras do site vindas da configuração editável (/ajustes).
   Carregado antes do app: window.EG_CONFIG vem de /api/boot; sem ele usa window.EG_DEFAULT. */
(function () {
  var C = window.EG_CONFIG || window.EG_DEFAULT;
  if (!C || !C.categories) { console.error('[eg] configuração ausente'); C = { categories: [], week: [], dates: {}, deposit: { low: 0, high: 0, limit: 0 } }; }
  for (var w = 0; w < 7; w++) C.week[w] = C.week[w] || { slots: [] };
  C.dates = C.dates || {};

  var PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='440' height='540'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#d4aa6c'/><stop offset='1' stop-color='#2a1b1a'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='42%' font-size='110' text-anchor='middle' dominant-baseline='middle'>✨</text></svg>");

  function duracao(m) { var h = Math.floor(m / 60), r = m % 60; return h ? h + 'h' + (r ? (r < 10 ? '0' : '') + r : '') : r + ' min'; }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function min(t) { var p = String(t).split(':'); return +p[0] * 60 + +p[1]; }

  // Lista no formato que o app já usa: time = minutos bloqueados na agenda; display = duração mostrada.
  var services = [];
  C.categories.forEach(function (c) {
    (c.services || []).forEach(function (s) {
      services.push({ name: s.name, price: s.price, time: s.dur + s.gap, display: duracao(s.dur), image: s.image || PLACEHOLDER, category: c.name });
    });
  });
  var categories = C.categories.map(function (c) { return c.name; });

  function slotsFor(d) {
    var o = C.dates[ymd(d)];
    if (o) return o.closed ? [] : (o.slots || []).slice();
    return (C.week[d.getDay()].slots || []).slice();
  }
  function openNow() {
    var n = new Date(), agora = n.getHours() * 60 + n.getMinutes();
    var o = C.dates[ymd(n)], s;
    if (o) {
      if (o.closed || !o.slots || !o.slots.length) return false;
      s = o.slots;
      var dia = C.week[n.getDay()];
      var abre = dia.open ? Math.min(min(dia.open), min(s[0])) : min(s[0]);
      var fecha = dia.close ? Math.max(min(dia.close), min(s[s.length - 1]) + 60) : min(s[s.length - 1]) + 60;
      return agora >= abre && agora < fecha;
    }
    var w = C.week[n.getDay()];
    if (!w.slots || !w.slots.length || !w.open || !w.close) return false;
    return agora >= min(w.open) && agora < min(w.close);
  }

  // "Seg a Sáb", "Seg, Qua e Sex"… e "Segunda a sábado • Domingo fechado"
  var CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  var LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  var ORDEM = [1, 2, 3, 4, 5, 6, 0];
  var abertos = ORDEM.filter(function (d) { return C.week[d].slots && C.week[d].slots.length; });
  var fechados = ORDEM.filter(function (d) { return abertos.indexOf(d) < 0; });
  function lista(dias, nomes, cap) {
    var f = function (s) { return cap ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
    if (!dias.length) return '';
    var seguidos = dias.every(function (d, i) { return i === 0 || ORDEM.indexOf(d) === ORDEM.indexOf(dias[i - 1]) + 1; });
    if (dias.length >= 3 && seguidos) return f(nomes[dias[0]]) + ' a ' + nomes[dias[dias.length - 1]];
    var n = dias.map(function (d, i) { return i === 0 ? f(nomes[d]) : nomes[d]; });
    return n.length === 1 ? n[0] : n.slice(0, -1).join(', ') + ' e ' + n[n.length - 1];
  }
  var dayLabel = abertos.length === 7 ? 'Todos os dias' : (lista(abertos, CURTO, true) || 'Com agendamento');
  var calendarNote = abertos.length === 7 ? 'Todos os dias'
    : !abertos.length ? 'Datas sob consulta'
    : lista(abertos, LONGO, true) + ' • ' + lista(fechados, LONGO, true) + (fechados.length > 1 ? ' fechados' : ' fechado');

  var D = window.EG_DEFAULT || {};
  var texts = Object.assign({}, D.texts || {}, C.texts || {});
  var contact = Object.assign({}, D.contact || {}, C.contact || {});
  if (!texts.story || !texts.story.length) texts.story = (D.texts && D.texts.story) || [];

  // Comprovante do sinal: reduz a foto no celular (até 1600px, JPEG) e guarda no próprio site.
  function enviarComprovante(file) {
    return new Promise(function (ok, falha) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onerror = function () { URL.revokeObjectURL(url); falha(new Error('imagem inválida')); };
      img.onload = function () {
        var esc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * esc); c.height = Math.round(img.naturalHeight * esc);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (blob) {
          if (!blob) return falha(new Error('falha ao preparar a foto'));
          fetch('/api/comprovante', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
            .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || 'falha'); return j; }); })
            .then(function (j) { ok(location.origin + j.url); }, falha);
        }, 'image/jpeg', 0.82);
      };
      img.src = url;
    });
  }

  window.EG = {
    config: C,
    enviarComprovante: enviarComprovante,
    t: texts,
    contact: contact,
    // estilo de cada parágrafo da história: 1º em destaque; frases curtas (ex.: "Assim nasceu…") em negrito
    storyClass: function (p, i) {
      return i === 0 ? 'text-lg text-foreground/90 leading-relaxed font-medium'
        : p.length <= 60 ? 'text-foreground font-semibold leading-relaxed' : 'text-muted-foreground leading-relaxed';
    },
    services: services,
    categories: categories.length ? categories : [''],
    slotsFor: slotsFor,
    isOpenDay: function (d) { return slotsFor(d).length > 0; },
    openNow: openNow,
    deposit: function (preco) { return preco <= C.deposit.limit ? C.deposit.low : C.deposit.high; },
    dayLabel: dayLabel,
    calendarNote: calendarNote,
  };
})();
