'use strict';

// ---------- Configuración ----------
const CFG = {
  TIEMPO_INICIAL: 10000,   // ms para responder la primera pregunta
  TIEMPO_MINIMO: 3000,     // nunca baja de acá
  DECREMENTO: 250,         // ms que se restan por cada pregunta respondida
  PUNTOS_BASE: 100,        // por responder bien
  BONUS_MAX: 100,          // extra máximo por velocidad (proporcional al tiempo que sobró)
  PREGUNTAS_POR_NIVEL: 5,
  RANKING_MAX: 10,
};
const LS = { tablas: 'aj.mult.tablas', ranking: 'aj.mult.ranking', nombre: 'aj.nombre', sonido: 'aj.sonido' };
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

// ---------- Sonido (Web Audio, sin archivos) ----------
let sonidoOn = ls.get(LS.sonido) !== 'off';
const sonido = (() => {
  let ctx = null;
  function ensure() {
    if (!sonidoOn) return null;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch { return null; }
  }
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
    activar() { ensure(); },
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

function iniciar() {
  sonido.activar();
  if (juego) { cancelAnimationFrame(juego.raf); clearTimeout(juego.timer); }
  juego = { puntos: 0, n: 0, actual: null, total: 0, deadline: 0, raf: 0, timer: 0, bloqueado: false, ultimaClave: null, ultimoTic: null };
  $('puntos').textContent = '0';
  $('aciertos').textContent = '0';
  $('nivel').textContent = '1';
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
  juego.total = Math.max(CFG.TIEMPO_MINIMO, CFG.TIEMPO_INICIAL - CFG.DECREMENTO * juego.n);
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
  const bonus = Math.round(CFG.BONUS_MAX * restante / juego.total);
  const ganados = CFG.PUNTOS_BASE + bonus;
  const nivelAntes = nivelDe(juego.n);
  juego.puntos += ganados;
  juego.n += 1;
  const nivelAhora = nivelDe(juego.n);
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

function perder(motivo) {
  juego.bloqueado = true;
  cancelAnimationFrame(juego.raf);
  const { correcto, opciones } = juego.actual;
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
  juego.timer = setTimeout(() => mostrarFin(motivo), 1300);
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
  $('finTitulo').textContent = motivo === 'tiempo' ? '⏰ ¡Se acabó el tiempo!' : '❌ ¡Casi!';
  $('finDetalle').textContent = `${a} × ${b} = ${correcto}`;
  $('finPuntos').textContent = juego.puntos;
  $('finAciertos').textContent = `${juego.n} acierto${juego.n === 1 ? '' : 's'}`;
  $('finNivel').textContent = `nivel ${nivelDe(juego.n)}`;
  const entra = juego.puntos > 0 && entraEnRanking(juego.puntos);
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
  const entrada = { id: Date.now(), nombre, puntos: juego.puntos, aciertos: juego.n, nivel: nivelDe(juego.n), fecha: new Date().toISOString() };
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
  const medallas = ['🥇', '🥈', '🥉'];
  r.forEach((e, i) => {
    const li = document.createElement('li');
    if (e.id === destacadoId) li.className = 'nuevo';
    const fecha = new Date(e.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    li.innerHTML = `<span class="pos">${medallas[i] || (i + 1) + '.'}</span>
      <span class="nom"></span>
      <span class="det">${e.aciertos} aciertos · nivel ${e.nivel}<br>${fecha}</span>
      <span class="pts">${e.puntos}</span>`;
    li.querySelector('.nom').textContent = e.nombre;
    lista.appendChild(li);
  });
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
$('jugar').addEventListener('click', iniciar);
$('otraVez').addEventListener('click', iniciar);
$('rankingJugar').addEventListener('click', iniciar);
$('verRanking').addEventListener('click', () => { renderRanking(); mostrar('ranking'); });
$('finRanking').addEventListener('click', () => { renderRanking(); mostrar('ranking'); });
$('finMenu').addEventListener('click', () => mostrar('menu'));
$('rankingMenu').addEventListener('click', () => mostrar('menu'));
$('borrar').addEventListener('click', borrarRanking);
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
renderChips();
renderSonido();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
