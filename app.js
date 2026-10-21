'use strict';

const APP_VERSION = '1.8'; // subir junto con VERSION en sw.js en cada publicación

// ---------- Configuración ----------
const CFG = {
  TIEMPO_INICIAL: 10000,   // ms para responder la primera pregunta
  TIEMPO_MINIMO: 1200,     // nunca baja de acá (límite físico para leer y tocar)
  // El tiempo límite se ajusta al subir de nivel (cada PREGUNTAS_POR_NIVEL aciertos) según el promedio
  // de respuesta de ese nivel: apunta a MARGEN veces el promedio, pero baja como mucho PASO_MAX y
  // como mínimo PASO_MIN del límite actual. Nunca sube.
  MARGEN: 1.6,             // límite objetivo = promedio de respuesta × MARGEN
  PASO_MAX: 0.15,          // por nivel baja a lo sumo este porcentaje del límite actual
  PASO_MIN: 0.03,          // por nivel baja al menos este porcentaje, aunque vaya justo
  PUNTOS_BASE: 100,        // por responder bien
  BONUS_MAX: 100,          // extra máximo por velocidad (proporcional al tiempo que sobró) a 10 s de límite;
                           // se multiplica por la dificultad (TIEMPO_INICIAL / límite actual)
  PREGUNTAS_POR_NIVEL: 5,
  RANKING_MAX: 10,
};
const LS = { tablas: 'aj.mult.tablas', ranking: 'aj.mult.ranking', nombre: 'aj.nombre', sonido: 'aj.sonido', cid: 'aj.cid', visitas: 'aj.visitas' };
const STATS_URL = 'https://aprendejugando-stats.cavassinif.workers.dev/e'; // '' para apagar la medición
const TABLAS_DEFAULT = [2, 3, 4, 5, 6, 7, 8, 9];

// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);
const rnd = (n) => Math.floor(Math.random() * n);
const elegir = (arr) => arr[rnd(arr.length)];
function mezclar(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin storage: el juego sigue, sin ranking */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ídem */ } },
};
const fmtSeg = (ms) => (ms / 1000).toFixed(1).replace('.', ',');

// ---------- Estadísticas anónimas ----------
// Un id aleatorio por dispositivo (sin cookies, sin datos personales). Eventos: visita, partida, sesion.
// No se mide cuando se juega desde localhost o una IP de la red local.
const stats = (() => {
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
  const activo = !!STATS_URL && !local;
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
  let cid = ls.get(LS.cid);
  let primera = !cid;
  if (!cid) { cid = uuid(); ls.set(LS.cid, cid); }
  const visitas = (parseInt(ls.get(LS.visitas), 10) || 0) + 1;
  ls.set(LS.visitas, String(visitas));
  const PAUSA_NUEVA_SESION = 30 * 60 * 1000;
  let sid = uuid();
  const ses = { visible: 0, visibleDesde: document.hidden ? null : performance.now(), ocultoDesde: null, jugado: 0, partidas: 0, puntosMax: 0 };

  function enviar(tipo, datos) {
    if (!activo) return;
    const cuerpo = JSON.stringify({ cid, sid, eventos: [{ tipo, datos }] });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(STATS_URL, new Blob([cuerpo], { type: 'text/plain' }))) return;
    } catch { /* sigue con fetch */ }
    fetch(STATS_URL, { method: 'POST', body: cuerpo, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  }
  const tiempoVisible = () => ses.visible + (ses.visibleDesde != null ? performance.now() - ses.visibleDesde : 0);
  function visita() {
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    enviar('visita', { primera, visitas, standalone, ancho: screen.width, alto: screen.height, idioma: navigator.language, version: APP_VERSION });
    primera = false;
  }
  function cerrarSesion() {
    enviar('sesion', { duracion: Math.round(tiempoVisible()), jugado: Math.round(ses.jugado), partidas: ses.partidas, puntosMax: ses.puntosMax });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      ses.visible = tiempoVisible(); ses.visibleDesde = null; ses.ocultoDesde = Date.now();
      cerrarSesion();
    } else {
      if (ses.ocultoDesde && Date.now() - ses.ocultoDesde > PAUSA_NUEVA_SESION) {
        sid = uuid();
        Object.assign(ses, { visible: 0, jugado: 0, partidas: 0, puntosMax: 0 });
        visita();
      }
      ses.visibleDesde = performance.now(); ses.ocultoDesde = null;
    }
  });
  window.addEventListener('pagehide', () => { if (!document.hidden) { ses.visible = tiempoVisible(); ses.visibleDesde = null; cerrarSesion(); } });
  visita();
  return {
    partida(datos) {
      ses.partidas += 1; ses.jugado += datos.duracion; ses.puntosMax = Math.max(ses.puntosMax, datos.puntos);
      enviar('partida', datos);
    },
    compartir(datos) { enviar('compartir', datos); },
  };
})();

// ---------- Sonido (Web Audio, sin archivos) ----------
let sonidoOn = ls.get(LS.sonido) !== 'off';
const sonido = (() => {
  let ctx = null;
  // iOS deja el contexto en 'interrupted' (no 'suspended') al abrir el menú de compartir, bloquear la
  // pantalla o cambiar de app, y a veces lo cierra. Se reanuda en cualquier estado que no sea 'running'
  // y se recrea si quedó cerrado. resume() solo funciona dentro de un toque, por eso se llama en cada uno.
  function ensure() {
    if (!sonidoOn) return null;
    try {
      if (ctx && ctx.state === 'closed') ctx = null;
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      return ctx;
    } catch { return null; }
  }
  function desbloquear() {
    const c = ensure(); if (!c) return;
    // Un buffer mudo "destraba" la salida de audio en iOS después de una interrupción.
    const b = c.createBuffer(1, 1, 22050), src = c.createBufferSource();
    src.buffer = b; src.connect(c.destination); src.start(0);
  }
  document.addEventListener('touchend', () => { if (ctx && ctx.state !== 'running') desbloquear(); }, { passive: true });
  document.addEventListener('click', () => { if (ctx && ctx.state !== 'running') desbloquear(); });
  function nota(freq, dur, t0 = 0, tipo = 'square', vol = 0.08) {
    const c = ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = tipo; o.frequency.value = freq;
    const t = c.currentTime + t0;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur);
  }
  return {
    activar() { desbloquear(); },
    ok() { nota(660, 0.12); nota(880, 0.18, 0.1); },
    nivel() { nota(523, 0.1); nota(659, 0.1, 0.1); nota(784, 0.1, 0.2); nota(1046, 0.3, 0.3); },
    mal() { nota(180, 0.4, 0, 'sawtooth', 0.12); },
    tiempo() { nota(440, 0.15); nota(330, 0.15, 0.15); nota(220, 0.45, 0.3); },
    tic() { nota(1000, 0.05, 0, 'sine', 0.05); },
  };
})();
function renderSonido() { $('sonido').textContent = sonidoOn ? '🔊' : '🔇'; }

// ---------- Pantallas ----------
function mostrar(id) {
  document.querySelectorAll('.pantalla').forEach((p) => p.classList.toggle('activa', p.id === id));
  window.scrollTo(0, 0);
}

// ---------- Tablas a practicar ----------
let tablas = cargarTablas();
function cargarTablas() {
  try {
    const v = JSON.parse(ls.get(LS.tablas));
    if (Array.isArray(v)) { const ok = v.filter((n) => Number.isInteger(n) && n >= 2 && n <= 9); if (ok.length) return ok; }
  } catch { /* valor inválido: usar default */ }
  return TABLAS_DEFAULT.slice();
}
function setTablas(nuevas) {
  tablas = [...new Set(nuevas)].sort((a, b) => a - b);
  ls.set(LS.tablas, JSON.stringify(tablas));
  renderChips();
}
function renderChips() {
  const cont = $('chips');
  cont.innerHTML = '';
  for (let t = 2; t <= 9; t++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (tablas.includes(t) ? ' on' : '');
    b.textContent = t;
    b.addEventListener('click', () => setTablas(tablas.includes(t) ? tablas.filter((x) => x !== t) : [...tablas, t]));
    cont.appendChild(b);
  }
  $('jugar').disabled = tablas.length === 0;
  $('practicar').disabled = tablas.length === 0;
}

// ---------- Preguntas ----------
function distractores(a, b, correcto) {
  const cerca = [a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b];           // errores típicos de tabla
  const lejos = [correcto + 1, correcto - 1, correcto + 2, correcto - 2, correcto + 10, correcto - 10,
    (a + 1) * (b + 1), (a - 1) * (b - 1), a + b, correcto * 2];
  const vistos = new Set([correcto]);
  const out = [];
  for (const v of [...mezclar(cerca), ...mezclar(lejos)]) {
    if (v > 0 && !vistos.has(v)) { vistos.add(v); out.push(v); }
    if (out.length === 3) return out;
  }
  let k = 3;
  while (out.length < 3) { const v = correcto + k; if (!vistos.has(v)) { vistos.add(v); out.push(v); } k++; }
  return out;
}

// ---------- Estado del juego ----------
let juego = null;
const nivelDe = (n) => Math.floor(n / CFG.PREGUNTAS_POR_NIVEL) + 1;

// modo: 'reloj' (se pierde al fallar o quedarse sin tiempo, entra al ranking) o 'practica' (al fallar
// muestra la respuesta correcta y sigue; termina cuando el jugador quiere; no entra al ranking).
function iniciar(modo) {
  sonido.activar();
  if (juego) { cancelAnimationFrame(juego.raf); clearTimeout(juego.timer); }
  modo = modo === 'practica' ? 'practica' : 'reloj';
  juego = { modo, inicio: Date.now(), puntos: 0, n: 0, errores: 0, actual: null, limite: CFG.TIEMPO_INICIAL, tiempos: [], total: 0, deadline: 0, raf: 0, timer: 0, bloqueado: false, ultimaClave: null, ultimoTic: null };
  $('puntos').textContent = '0';
  $('aciertos').textContent = '0';
  $('errores').textContent = '0';
  $('nivel').textContent = '1';
  $('hErrores').classList.toggle('oculto', modo !== 'practica');
  $('terminar').classList.toggle('oculto', modo !== 'practica');
  mostrar('juego');
  nuevaPregunta();
}

function nuevaPregunta() {
  if (!juego) return;
  let a, b, clave, intentos = 0;
  do {
    a = elegir(tablas); b = 1 + rnd(10); clave = a + 'x' + b;
  } while (clave === juego.ultimaClave && ++intentos < 20);
  juego.ultimaClave = clave;
  const correcto = a * b;
  juego.actual = { a, b, correcto, opciones: mezclar([correcto, ...distractores(a, b, correcto)]) };
  juego.total = juego.limite;
  juego.deadline = performance.now() + juego.total;
  juego.ultimoTic = null;
  juego.bloqueado = false;

  $('pregunta').textContent = `${a} × ${b}`;
  const cont = $('opciones');
  cont.innerHTML = '';
  juego.actual.opciones.forEach((v, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = v;
    btn.addEventListener('click', () => responder(i));
    cont.appendChild(btn);
  });
  cancelAnimationFrame(juego.raf);
  juego.raf = requestAnimationFrame(tick);
}

function tick(now) {
  if (!juego || juego.bloqueado) return;
  const restante = Math.max(0, juego.deadline - now);
  const frac = restante / juego.total;
  $('barraFill').style.transform = `scaleX(${frac})`;
  $('barraFill').style.background = `hsl(${Math.round(120 * frac)} 80% 45%)`;
  $('segundos').textContent = fmtSeg(restante);
  const seg = Math.ceil(restante / 1000);
  if (seg >= 1 && seg <= 3 && seg !== juego.ultimoTic) { juego.ultimoTic = seg; sonido.tic(); }
  if (restante <= 0) { perder('tiempo'); return; }
  juego.raf = requestAnimationFrame(tick);
}

function responder(idx) {
  if (!juego || juego.bloqueado) return;
  juego.bloqueado = true;
  cancelAnimationFrame(juego.raf);
  const { correcto, opciones } = juego.actual;
  const botones = [...$('opciones').children];
  if (opciones[idx] !== correcto) {
    botones[idx].classList.add('mal');
    botones[opciones.indexOf(correcto)].classList.add('ok');
    perder('error');
    return;
  }
  const restante = Math.max(0, juego.deadline - performance.now());
  juego.tiempos.push(juego.total - restante);
  const dificultad = CFG.TIEMPO_INICIAL / juego.total;
  const bonus = Math.round(CFG.BONUS_MAX * (restante / juego.total) * dificultad);
  const ganados = CFG.PUNTOS_BASE + bonus;
  const nivelAntes = nivelDe(juego.n);
  juego.puntos += ganados;
  juego.n += 1;
  const nivelAhora = nivelDe(juego.n);
  if (nivelAhora > nivelAntes) ajustarLimite();
  botones[idx].classList.add('ok');
  $('puntos').textContent = juego.puntos;
  $('aciertos').textContent = juego.n;
  if (nivelAhora > nivelAntes) {
    $('nivel').textContent = nivelAhora;
    pulsar($('nivel'));
    flotante(`¡Nivel ${nivelAhora}!`);
    sonido.nivel();
  } else {
    flotante(`+${ganados}`);
    sonido.ok();
  }
  juego.timer = setTimeout(nuevaPregunta, 400);
}

// Al subir de nivel: el límite apunta a MARGEN × promedio de respuesta del nivel, con paso acotado y sin subir nunca.
function ajustarLimite() {
  const ultimos = juego.tiempos.slice(-CFG.PREGUNTAS_POR_NIVEL);
  const promedio = ultimos.reduce((a, b) => a + b, 0) / ultimos.length;
  const objetivo = promedio * CFG.MARGEN;
  const maximo = juego.limite * (1 - CFG.PASO_MIN);   // nunca sube, y siempre baja al menos PASO_MIN
  const minimo = juego.limite * (1 - CFG.PASO_MAX);   // y nunca baja más de PASO_MAX por nivel
  juego.limite = Math.max(CFG.TIEMPO_MINIMO, Math.min(maximo, Math.max(minimo, objetivo)));
}

function perder(motivo) {
  juego.bloqueado = true;
  cancelAnimationFrame(juego.raf);
  const { a, b, correcto, opciones } = juego.actual;
  const botones = [...$('opciones').children];
  if (motivo === 'tiempo') {
    $('segundos').textContent = fmtSeg(0);
    $('barraFill').style.transform = 'scaleX(0)';
    botones[opciones.indexOf(correcto)].classList.add('ok');
    sonido.tiempo();
  } else {
    sonido.mal();
  }
  if (navigator.vibrate) navigator.vibrate(200);
  $('juego').classList.add('temblor');
  setTimeout(() => $('juego').classList.remove('temblor'), 500);
  if (juego.modo === 'practica') {
    // En práctica no se pierde: se muestra la respuesta correcta, se afloja un poco el tiempo y sigue.
    juego.errores += 1;
    $('errores').textContent = juego.errores;
    pulsar($('errores'));
    flotante(`${a} × ${b} = ${correcto}`);
    juego.limite = Math.min(CFG.TIEMPO_INICIAL, juego.limite * 1.1);
    juego.timer = setTimeout(nuevaPregunta, 1800);
    return;
  }
  juego.timer = setTimeout(() => mostrarFin(motivo), 1300);
}

function terminarPractica() {
  if (!juego || juego.modo !== 'practica') return;
  juego.bloqueado = true;
  cancelAnimationFrame(juego.raf);
  clearTimeout(juego.timer);
  mostrarFin('terminado');
}

function flotante(texto) {
  const el = $('flotante');
  el.textContent = texto;
  el.classList.remove('anim');
  void el.offsetWidth; // reinicia la animación
  el.classList.add('anim');
}
function pulsar(el) { el.classList.remove('pulso'); void el.offsetWidth; el.classList.add('pulso'); }

// Si la tablet se bloquea o cambian de app en medio de una pregunta, el reloj se pausa.
document.addEventListener('visibilitychange', () => {
  if (!juego || juego.bloqueado) return;
  if (document.hidden) {
    juego.pausaRestante = Math.max(0, juego.deadline - performance.now());
    cancelAnimationFrame(juego.raf);
  } else if (juego.pausaRestante != null) {
    juego.deadline = performance.now() + juego.pausaRestante;
    juego.pausaRestante = null;
    juego.raf = requestAnimationFrame(tick);
  }
});

// ---------- Fin de partida ----------
function mostrarFin(motivo) {
  const { a, b, correcto } = juego.actual;
  const practica = juego.modo === 'practica';
  stats.partida({ modo: juego.modo, puntos: juego.puntos, aciertos: juego.n, errores: juego.errores, nivel: nivelDe(juego.n), motivo, duracion: Date.now() - juego.inicio, tablas: tablas.join(','), limiteFinal: Math.round(juego.total) });
  if (practica) {
    $('finTitulo').textContent = '📚 ¡Buena práctica!';
    $('finDetalle').textContent = juego.errores ? `${juego.errores} error${juego.errores === 1 ? '' : 'es'}` : '¡Sin errores!';
  } else {
    $('finTitulo').textContent = motivo === 'tiempo' ? '⏰ ¡Se acabó el tiempo!' : '❌ ¡Casi!';
    $('finDetalle').textContent = `${a} × ${b} = ${correcto}`;
  }
  $('finPuntos').textContent = juego.puntos;
  $('finAciertos').textContent = `${juego.n} acierto${juego.n === 1 ? '' : 's'}`;
  $('finNivel').textContent = `nivel ${nivelDe(juego.n)} · ${fmtSeg(juego.total)} s por pregunta`;
  const entra = !practica && juego.puntos > 0 && entraEnRanking(juego.puntos);
  $('formNombre').classList.toggle('oculto', !entra);
  $('finBotones').classList.toggle('oculto', entra);
  mostrar('fin');
  if (entra) {
    $('nombre').value = ls.get(LS.nombre) || '';
    setTimeout(() => $('nombre').focus(), 300);
  }
}

// ---------- Ranking (local) ----------
function cargarRanking() {
  try { const v = JSON.parse(ls.get(LS.ranking)); return Array.isArray(v) ? v : []; } catch { return []; }
}
function entraEnRanking(puntos) {
  const r = cargarRanking();
  return r.length < CFG.RANKING_MAX || puntos > r[r.length - 1].puntos;
}
function guardarEnRanking(nombre) {
  const r = cargarRanking();
  const entrada = { id: Date.now(), nombre, puntos: juego.puntos, aciertos: juego.n, nivel: nivelDe(juego.n), tablas: tablas.slice(), fecha: new Date().toISOString() };
  r.push(entrada);
  r.sort((x, y) => y.puntos - x.puntos || x.fecha.localeCompare(y.fecha));
  r.length = Math.min(r.length, CFG.RANKING_MAX);
  ls.set(LS.ranking, JSON.stringify(r));
  ls.set(LS.nombre, nombre);
  return entrada.id;
}
function renderRanking(destacadoId) {
  const r = cargarRanking();
  const lista = $('lista');
  lista.innerHTML = '';
  $('vacio').classList.toggle('oculto', r.length > 0);
  lista.classList.toggle('oculto', r.length === 0);
  $('borrar').classList.toggle('oculto', r.length === 0);
  $('pista').classList.toggle('oculto', r.length === 0);
  r.forEach((e, i) => {
    const li = document.createElement('li');
    if (e.id === destacadoId) li.className = 'nuevo';
    const fecha = new Date(e.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    li.innerHTML = `<span class="pos">${MEDALLAS[i] || (i + 1) + '.'}</span>
      <span class="nom"></span>
      <span class="det">${e.aciertos} aciertos · nivel ${e.nivel}<br>${fecha}</span>
      <span class="pts">${e.puntos}</span>
      <button type="button" class="chico ver" aria-label="Ver y compartir">${ICONO_COMPARTIR}</button>`;
    li.querySelector('.nom').textContent = e.nombre;
    li.addEventListener('click', () => mostrarDetalle(e, i));
    lista.appendChild(li);
  });
}
const MEDALLAS = ['🥇', '🥈', '🥉'];
const ICONO_COMPARTIR = '<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.7l6.8-4M8.6 13.3l6.8 4"/></svg>';
const URL_JUEGO = 'https://specie.github.io/aprendejugando/';

// ---------- Detalle de un puntaje (para sacar captura o compartir) ----------
let detalle = null;
const fmtTablas = (t) => {
  if (!Array.isArray(t) || !t.length) return '2-9';
  const seguidas = t.every((v, i) => i === 0 || v === t[i - 1] + 1);
  return seguidas && t.length > 2 ? `${t[0]}-${t[t.length - 1]}` : t.join(', ');
};
const fmtFechaLarga = (iso) => new Date(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function mostrarDetalle(e, pos) {
  detalle = { ...e, pos };
  const tp = $('tpPos');
  tp.textContent = MEDALLAS[pos] || String(pos + 1);
  tp.classList.toggle('num', !MEDALLAS[pos]);
  $('tpNombre').textContent = e.nombre;
  $('tpPuntos').textContent = e.puntos;
  $('tpAciertos').textContent = e.aciertos;
  $('tpNivel').textContent = e.nivel;
  $('tpTablas').textContent = fmtTablas(e.tablas);
  $('tpFecha').textContent = fmtFechaLarga(e.fecha);
  $('compartirMsg').classList.add('oculto');
  $('compartir').disabled = false;
  mostrar('detalle');
}

function textoCompartir(e) {
  const puesto = MEDALLAS[e.pos] ? `${MEDALLAS[e.pos]} ` : `#${e.pos + 1} `;
  return `${puesto}${e.nombre} hizo ${e.puntos} puntos multiplicando (${e.aciertos} aciertos, nivel ${e.nivel}). ¿Le ganás? ${URL_JUEGO}`;
}

// Dibuja la tarjeta como imagen (1080×1350, formato de historia/WhatsApp) para compartirla como foto.
function imagenCompartir(e) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const grad = x.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#6366f1'); grad.addColorStop(1, '#ec4899');
  x.fillStyle = grad; x.fillRect(0, 0, W, H);
  const font = (peso, px) => `${peso} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const centro = (t, y, f, color) => { x.font = f; x.fillStyle = color; x.textAlign = 'center'; x.fillText(t, W / 2, y); };
  const redondo = (px, py, w, h, r, color) => {
    x.fillStyle = color; x.beginPath();
    x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); x.fill();
  };
  // Título
  centro('⚡ ¿Quién es más rápido', 120, font(800, 52), '#fff');
  centro('multiplicando?', 185, font(800, 52), '#fff');
  // Tarjeta
  x.shadowColor = 'rgba(0,0,0,.3)'; x.shadowBlur = 40; x.shadowOffsetY = 20;
  redondo(90, 260, W - 180, 880, 48, '#fff');
  x.shadowColor = 'transparent';
  // Puesto
  if (MEDALLAS[e.pos]) centro(MEDALLAS[e.pos], 430, font(400, 150), '#000');
  else {
    x.fillStyle = '#eef2ff'; x.beginPath(); x.arc(W / 2, 390, 70, 0, Math.PI * 2); x.fill();
    centro(String(e.pos + 1), 418, font(900, 80), '#6366f1');
  }
  centro(e.nombre, 560, font(800, 72), '#1e1b4b');
  centro(String(e.puntos), 740, font(900, 190), '#6366f1');
  centro('PUNTOS', 800, font(700, 36), '#6b7280');
  // Stats
  const cajas = [[String(e.aciertos), 'aciertos'], [String(e.nivel), 'nivel'], [fmtTablas(e.tablas), 'tablas']];
  const cw = 270, gap = 20, x0 = (W - (cw * 3 + gap * 2)) / 2;
  cajas.forEach(([v, l], i) => {
    const px = x0 + i * (cw + gap);
    redondo(px, 860, cw, 150, 28, '#f3f4ff');
    x.font = font(900, 56); x.fillStyle = '#1e1b4b'; x.textAlign = 'center'; x.fillText(v, px + cw / 2, 935);
    x.font = font(700, 28); x.fillStyle = '#6b7280'; x.fillText(l, px + cw / 2, 985);
  });
  centro(fmtFechaLarga(e.fecha), 1080, font(400, 32), '#6b7280');
  // Pie
  centro('¿Le ganás? Jugá gratis en', 1230, font(700, 36), '#fff');
  centro('specie.github.io/aprendejugando', 1285, font(400, 36), '#fff');
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

async function compartir() {
  if (!detalle) return;
  const btn = $('compartir'), msg = $('compartirMsg');
  btn.disabled = true;
  const avisar = (t) => { msg.textContent = t; msg.classList.remove('oculto'); };
  const texto = textoCompartir(detalle);
  let metodo = 'ninguno';
  try {
    if (navigator.share) {
      let archivo = null;
      try {
        const blob = await imagenCompartir(detalle);
        if (blob) {
          const f = new File([blob], `puntaje-${detalle.nombre.replace(/\W+/g, '_')}-${detalle.puntos}.png`, { type: 'image/png' });
          if (!navigator.canShare || navigator.canShare({ files: [f] })) archivo = f;
        }
      } catch { /* sin imagen: se comparte el texto */ }
      if (archivo) { metodo = 'imagen'; await navigator.share({ files: [archivo], title: 'Mi puntaje', text: texto }); }
      else { metodo = 'texto'; await navigator.share({ title: 'Mi puntaje', text: texto }); }
      avisar('¡Listo!');
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      metodo = 'portapapeles';
      await navigator.clipboard.writeText(texto);
      avisar('Texto copiado. Pegalo donde quieras, o sacá una captura de pantalla.');
    } else {
      avisar('Sacá una captura de pantalla para compartir este puntaje.');
    }
  } catch (err) {
    if (err && err.name === 'AbortError') { metodo = 'cancelado'; }
    else avisar('No se pudo compartir. Sacá una captura de pantalla.');
  }
  stats.compartir({ metodo, puntos: detalle.puntos, pos: detalle.pos + 1 });
  btn.disabled = false;
}
let borrarArmado = 0;
function borrarRanking() {
  const btn = $('borrar');
  if (borrarArmado) {
    clearTimeout(borrarArmado); borrarArmado = 0;
    ls.del(LS.ranking);
    btn.textContent = 'Borrar ranking';
    renderRanking();
    return;
  }
  btn.textContent = '¿Seguro? Tocá de nuevo para borrar';
  borrarArmado = setTimeout(() => { borrarArmado = 0; btn.textContent = 'Borrar ranking'; }, 3000);
}

// ---------- Eventos ----------
$('jugar').addEventListener('click', () => iniciar('reloj'));
$('practicar').addEventListener('click', () => iniciar('practica'));
$('otraVez').addEventListener('click', () => iniciar(juego ? juego.modo : 'reloj'));
$('rankingJugar').addEventListener('click', () => iniciar('reloj'));
$('terminar').addEventListener('click', terminarPractica);
$('verRanking').addEventListener('click', () => { renderRanking(); mostrar('ranking'); });
$('finRanking').addEventListener('click', () => { renderRanking(); mostrar('ranking'); });
$('finMenu').addEventListener('click', () => mostrar('menu'));
$('rankingMenu').addEventListener('click', () => mostrar('menu'));
$('borrar').addEventListener('click', borrarRanking);
$('compartir').addEventListener('click', compartir);
$('detalleJugar').addEventListener('click', () => iniciar('reloj'));
$('detalleVolver').addEventListener('click', () => { renderRanking(); mostrar('ranking'); });
$('sonido').addEventListener('click', () => {
  sonidoOn = !sonidoOn;
  ls.set(LS.sonido, sonidoOn ? 'on' : 'off');
  renderSonido();
  if (sonidoOn) { sonido.activar(); sonido.ok(); }
});
$('formNombre').addEventListener('submit', (e) => {
  e.preventDefault();
  const nombre = $('nombre').value.trim().slice(0, 12) || 'Anónimo';
  const id = guardarEnRanking(nombre);
  renderRanking(id);
  mostrar('ranking');
});
// Teclas 1-4 para jugar con teclado (útil para probar en la compu)
document.addEventListener('keydown', (e) => {
  if (!juego || !$('juego').classList.contains('activa')) return;
  const i = parseInt(e.key, 10) - 1;
  if (i >= 0 && i < 4) responder(i);
});

// ---------- Arranque ----------
$('version').textContent = 'v' + APP_VERSION;
renderChips();
renderSonido();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
