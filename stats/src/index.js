/* Worker de estadísticas anónimas de "Aprendé jugando".
 *  POST /e            recibe eventos del juego (cuerpo JSON, text/plain para evitar preflight)
 *  GET  /stats?k=&dias= devuelve los agregados en JSON
 *  GET  /dash?k=&dias=  panel HTML con los mismos números
 */
const TIPOS = new Set(['visita', 'partida', 'sesion', 'compartir']);
const ID_OK = /^[a-z0-9-]{8,40}$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

class Rechazo extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === '/e' && req.method === 'POST') return await recibir(req, env);
      if (url.pathname === '/stats' && req.method === 'GET') {
        autorizar(url, env);
        return json(await calcular(env, dias(url)));
      }
      if (url.pathname === '/dash' && req.method === 'GET') {
        autorizar(url, env);
        const d = dias(url);
        return html(renderDash(await calcular(env, d), d, url.searchParams.get('k')));
      }
      if (url.pathname === '/') return new Response('ok', { headers: CORS });
      return new Response('No encontrado', { status: 404 });
    } catch (e) {
      if (e instanceof Rechazo) return new Response(e.message, { status: e.status, headers: CORS });
      return new Response('Error: ' + e.message, { status: 500, headers: CORS });
    }
  },
};

function autorizar(url, env) {
  if (!env.STATS_KEY || url.searchParams.get('k') !== env.STATS_KEY) throw new Rechazo(401, 'Falta la clave (?k=)');
}
function dias(url) {
  const d = parseInt(url.searchParams.get('dias') || '30', 10);
  return Number.isFinite(d) && d > 0 ? Math.min(d, 3650) : 0; // 0 = todo
}
const json = (o) => new Response(JSON.stringify(o), { headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });
const html = (s) => new Response(s, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

// ---------- Ingesta ----------
async function recibir(req, env) {
  const texto = await req.text();
  if (texto.length > 8192) throw new Rechazo(413, 'Cuerpo demasiado grande');
  let cuerpo;
  try { cuerpo = JSON.parse(texto); } catch { throw new Rechazo(400, 'JSON inválido'); }
  const { cid, sid, eventos } = cuerpo || {};
  if (!ID_OK.test(String(cid)) || !ID_OK.test(String(sid))) throw new Rechazo(400, 'cid/sid inválidos');
  if (!Array.isArray(eventos) || eventos.length === 0 || eventos.length > 20) throw new Rechazo(400, 'eventos inválidos');
  const ahora = Date.now();
  const stmt = env.DB.prepare('INSERT INTO events (ts, cid, sid, tipo, datos) VALUES (?, ?, ?, ?, ?)');
  const lote = [];
  for (const ev of eventos) {
    if (!ev || !TIPOS.has(ev.tipo)) throw new Rechazo(400, 'tipo inválido');
    const datos = ev.datos && typeof ev.datos === 'object' ? JSON.stringify(ev.datos) : '{}';
    if (datos.length > 1000) throw new Rechazo(400, 'datos demasiado grandes');
    lote.push(stmt.bind(ahora, cid, sid, ev.tipo, datos));
  }
  await env.DB.batch(lote);
  return new Response(null, { status: 204, headers: CORS });
}

// ---------- Agregados ----------
async function calcular(env, d) {
  const desde = d ? Date.now() - d * 86400000 : 0;
  const off = (Number(env.TZ_OFFSET_H) || 0) * 3600;
  const dia = `date(ts/1000 + ${off}, 'unixepoch')`;
  const q = (sql) => env.DB.prepare(sql).bind(desde);

  const [visitas, partidas, volvieron, sesiones, porDia, rangos, top, tablas, compartidos] = await Promise.all([
    q(`SELECT COUNT(DISTINCT sid) visitas, COUNT(DISTINCT cid) dispositivos,
              COUNT(DISTINCT CASE WHEN json_extract(datos,'$.primera')=1 THEN cid END) nuevos,
              COUNT(DISTINCT CASE WHEN json_extract(datos,'$.standalone')=1 THEN cid END) instalados
       FROM events WHERE tipo='visita' AND ts>=?`).first(),
    q(`SELECT COUNT(DISTINCT sid) sesionesConJuego, COUNT(DISTINCT cid) jugadores, COUNT(*) partidas,
              AVG(json_extract(datos,'$.puntos')) puntosProm, MAX(json_extract(datos,'$.puntos')) puntosMax,
              AVG(json_extract(datos,'$.aciertos')) aciertosProm, MAX(json_extract(datos,'$.aciertos')) aciertosMax,
              MAX(json_extract(datos,'$.nivel')) nivelMax,
              SUM(CASE WHEN json_extract(datos,'$.motivo')='tiempo' THEN 1 ELSE 0 END) porTiempo,
              SUM(CASE WHEN json_extract(datos,'$.modo')='practica' THEN 1 ELSE 0 END) practicas,
              AVG(json_extract(datos,'$.duracion')) duracionProm
       FROM events WHERE tipo='partida' AND ts>=?`).first(),
    q(`SELECT COUNT(*) volvieron FROM (
         SELECT cid FROM events WHERE tipo='visita' AND ts>=? GROUP BY cid HAVING COUNT(DISTINCT ${dia}) >= 2)`).first(),
    q(`SELECT COUNT(*) sesiones, AVG(json_extract(datos,'$.duracion')) duracionProm,
              AVG(json_extract(datos,'$.jugado')) jugadoProm, AVG(json_extract(datos,'$.partidas')) partidasProm,
              SUM(json_extract(datos,'$.duracion')) duracionTotal
       FROM events e WHERE tipo='sesion' AND ts>=?
         AND id = (SELECT MAX(id) FROM events WHERE tipo='sesion' AND sid=e.sid)`).first(),
    q(`SELECT ${dia} dia,
              COUNT(DISTINCT CASE WHEN tipo='visita' THEN sid END) visitas,
              COUNT(DISTINCT CASE WHEN tipo='visita' THEN cid END) dispositivos,
              COUNT(DISTINCT CASE WHEN tipo='partida' THEN sid END) jugaron,
              SUM(CASE WHEN tipo='partida' THEN 1 ELSE 0 END) partidas,
              MAX(CASE WHEN tipo='partida' THEN json_extract(datos,'$.puntos') END) puntosMax
       FROM events WHERE ts>=? GROUP BY dia ORDER BY dia DESC LIMIT 90`).all(),
    q(`SELECT CASE WHEN p=0 THEN '0' WHEN p<500 THEN '1-499' WHEN p<1000 THEN '500-999' WHEN p<2000 THEN '1000-1999'
                   WHEN p<4000 THEN '2000-3999' ELSE '4000+' END rango, MIN(p) orden, COUNT(*) n
       FROM (SELECT json_extract(datos,'$.puntos') p FROM events WHERE tipo='partida' AND ts>=?)
       GROUP BY rango ORDER BY orden`).all(),
    q(`SELECT json_extract(datos,'$.puntos') puntos, json_extract(datos,'$.aciertos') aciertos,
              json_extract(datos,'$.nivel') nivel, json_extract(datos,'$.motivo') motivo, ts
       FROM events WHERE tipo='partida' AND ts>=? AND COALESCE(json_extract(datos,'$.modo'),'reloj')!='practica'
       ORDER BY puntos DESC LIMIT 10`).all(),
    q(`SELECT json_extract(datos,'$.tablas') tablas, COUNT(*) n
       FROM events WHERE tipo='partida' AND ts>=? GROUP BY tablas ORDER BY n DESC LIMIT 8`).all(),
    q(`SELECT COUNT(*) total, COUNT(DISTINCT cid) dispositivos,
              SUM(CASE WHEN json_extract(datos,'$.metodo')='imagen' THEN 1 ELSE 0 END) imagen
       FROM events WHERE tipo='compartir' AND ts>=?`).first(),
  ]);

  const v = visitas.visitas || 0;
  return {
    periodoDias: d,
    generado: new Date().toISOString(),
    visitas: {
      sesiones: v,
      dispositivos: visitas.dispositivos || 0,
      nuevos: visitas.nuevos || 0,
      instalados: visitas.instalados || 0,
      volvieron: volvieron.volvieron || 0,
      rebote: v ? 1 - (partidas.sesionesConJuego || 0) / v : 0,
    },
    sesiones: {
      conJuego: partidas.sesionesConJuego || 0,
      medidas: sesiones.sesiones || 0,
      duracionProm: Math.round(sesiones.duracionProm || 0),
      jugadoProm: Math.round(sesiones.jugadoProm || 0),
      partidasProm: +(sesiones.partidasProm || 0).toFixed(1),
      duracionTotal: Math.round(sesiones.duracionTotal || 0),
    },
    partidas: {
      total: partidas.partidas || 0,
      jugadores: partidas.jugadores || 0,
      puntosProm: Math.round(partidas.puntosProm || 0),
      puntosMax: partidas.puntosMax || 0,
      aciertosProm: +(partidas.aciertosProm || 0).toFixed(1),
      aciertosMax: partidas.aciertosMax || 0,
      nivelMax: partidas.nivelMax || 0,
      porTiempo: partidas.porTiempo || 0,
      porError: (partidas.partidas || 0) - (partidas.porTiempo || 0) - (partidas.practicas || 0),
      practicas: partidas.practicas || 0,
      duracionProm: Math.round(partidas.duracionProm || 0),
    },
    compartidos: { total: compartidos.total || 0, dispositivos: compartidos.dispositivos || 0, imagen: compartidos.imagen || 0 },
    porDia: porDia.results,
    rangosPuntaje: rangos.results.map(({ rango, n }) => ({ rango, n })),
    topPuntajes: top.results,
    tablasElegidas: tablas.results,
  };
}

// ---------- Panel ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => Math.round(x * 100) + ' %';
function mmss(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60), r = s % 60;
  return m < 60 ? `${m} min ${r} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
const fechaHora = (ts) => new Date(ts).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function renderDash(s, d, k) {
  const periodo = (n, label) => `<a href="?k=${esc(k)}&dias=${n}" class="${d === n ? 'on' : ''}">${label}</a>`;
  const tarjeta = (num, label, nota = '') => `<div class="t"><b>${num}</b><span>${label}</span>${nota ? `<small>${nota}</small>` : ''}</div>`;
  const filas = (arr, fn) => arr.length ? arr.map(fn).join('') : '<tr><td colspan="9" class="vacio">Sin datos todavía</td></tr>';
  const V = s.visitas, S = s.sesiones, P = s.partidas;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Estadísticas · Aprendé jugando</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f6fb; --card: #fff; --tx: #1e1b4b; --mut: #6b7280; --ac: #6366f1; --bd: #e5e7eb; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111827; --card: #1f2937; --tx: #f3f4f6; --mut: #9ca3af; --bd: #374151; } }
  body { margin: 0; padding: 24px 16px 48px; font-family: system-ui, sans-serif; background: var(--bg); color: var(--tx); max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; } h2 { font-size: 1.1rem; margin: 28px 0 10px; color: var(--mut); font-weight: 600; }
  .periodo a { display: inline-block; padding: 6px 12px; margin: 10px 6px 0 0; border-radius: 999px; background: var(--card); color: var(--tx); text-decoration: none; border: 1px solid var(--bd); }
  .periodo a.on { background: var(--ac); color: #fff; border-color: var(--ac); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
  .t { background: var(--card); border: 1px solid var(--bd); border-radius: 12px; padding: 14px; }
  .t b { display: block; font-size: 1.7rem; } .t span { color: var(--mut); font-size: .9rem; } .t small { display: block; color: var(--mut); font-size: .8rem; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--bd); border-radius: 12px; overflow: hidden; font-variant-numeric: tabular-nums; }
  th, td { padding: 8px 10px; text-align: right; border-bottom: 1px solid var(--bd); } th:first-child, td:first-child { text-align: left; }
  th { color: var(--mut); font-weight: 600; font-size: .85rem; } tr:last-child td { border-bottom: 0; } .vacio { text-align: center; color: var(--mut); }
  .barra { display: inline-block; height: 10px; background: var(--ac); border-radius: 5px; vertical-align: middle; margin-right: 6px; }
  footer { color: var(--mut); font-size: .8rem; margin-top: 32px; }
</style></head><body>
<h1>⚡ Aprendé jugando · estadísticas</h1>
<div class="periodo">${periodo(7, '7 días')}${periodo(30, '30 días')}${periodo(90, '90 días')}${periodo(0, 'Todo')}</div>

<h2>Visitas</h2>
<div class="grid">
  ${tarjeta(V.sesiones, 'visitas', 'aperturas de la app')}
  ${tarjeta(V.dispositivos, 'dispositivos distintos')}
  ${tarjeta(V.nuevos, 'dispositivos nuevos', 'primera vez en el período')}
  ${tarjeta(V.volvieron, 'volvieron otro día', V.dispositivos ? pct(V.volvieron / V.dispositivos) + ' de los dispositivos' : '')}
  ${tarjeta(pct(V.rebote), 'rebote', 'entraron y no jugaron')}
  ${tarjeta(V.instalados, 'instalados', 'abren desde pantalla de inicio')}
</div>

<h2>Sesiones</h2>
<div class="grid">
  ${tarjeta(S.conJuego, 'sesiones con juego', V.sesiones ? pct(S.conJuego / V.sesiones) + ' de las visitas' : '')}
  ${tarjeta(mmss(S.duracionProm), 'duración promedio', 'con la app en pantalla')}
  ${tarjeta(mmss(S.jugadoProm), 'tiempo jugando promedio')}
  ${tarjeta(S.partidasProm, 'partidas por sesión')}
  ${tarjeta(mmss(S.duracionTotal), 'tiempo total acumulado')}
</div>

<h2>Partidas</h2>
<div class="grid">
  ${tarjeta(P.total, 'partidas')}
  ${tarjeta(P.jugadores, 'jugadores', 'dispositivos que jugaron')}
  ${tarjeta(P.puntosProm, 'puntos promedio')}
  ${tarjeta(P.puntosMax, 'puntaje máximo')}
  ${tarjeta(P.aciertosProm, 'aciertos promedio', 'máximo ' + P.aciertosMax + ' · nivel máx. ' + P.nivelMax)}
  ${tarjeta(mmss(P.duracionProm), 'duración promedio')}
  ${tarjeta(P.total ? pct(P.porTiempo / P.total) : '0 %', 'perdidas por tiempo', 'el resto, por error')}
  ${tarjeta(P.practicas, 'prácticas', 'partidas en modo práctica')}
  ${tarjeta(s.compartidos.total, 'puntajes compartidos', s.compartidos.total ? s.compartidos.imagen + ' con imagen · ' + s.compartidos.dispositivos + ' dispositivos' : '')}
</div>

<h2>Distribución de puntajes</h2>
<table><tr><th>Rango</th><th>Partidas</th><th></th></tr>
${filas(s.rangosPuntaje, (r) => { const max = Math.max(...s.rangosPuntaje.map((x) => x.n)); return `<tr><td>${esc(r.rango)}</td><td>${r.n}</td><td style="width:50%;text-align:left"><span class="barra" style="width:${Math.round(100 * r.n / max)}%"></span></td></tr>`; })}
</table>

<h2>Mejores partidas</h2>
<table><tr><th>#</th><th>Puntos</th><th>Aciertos</th><th>Nivel</th><th>Perdió por</th><th>Cuándo</th></tr>
${filas(s.topPuntajes, (p, i) => `<tr><td>${i + 1}</td><td>${p.puntos}</td><td>${p.aciertos}</td><td>${p.nivel}</td><td>${esc(p.motivo)}</td><td>${fechaHora(p.ts)}</td></tr>`)}
</table>

<h2>Tablas elegidas</h2>
<table><tr><th>Tablas</th><th>Partidas</th></tr>
${filas(s.tablasElegidas, (t) => `<tr><td>${esc(t.tablas)}</td><td>${t.n}</td></tr>`)}
</table>

<h2>Por día</h2>
<table><tr><th>Día</th><th>Visitas</th><th>Dispositivos</th><th>Jugaron</th><th>Partidas</th><th>Puntaje máx.</th></tr>
${filas(s.porDia, (r) => `<tr><td>${esc(r.dia)}</td><td>${r.visitas}</td><td>${r.dispositivos}</td><td>${r.jugaron}</td><td>${r.partidas}</td><td>${r.puntosMax ?? ''}</td></tr>`)}
</table>

<footer>Datos anónimos: un id aleatorio por dispositivo, sin cookies ni datos personales. Generado ${fechaHora(Date.parse(s.generado))} (hora Argentina). JSON: <a href="/stats?k=${esc(k)}&dias=${d}">/stats</a></footer>
</body></html>`;
}
