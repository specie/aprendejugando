# Aprendé jugando: Multiplicaciones

Juego web para practicar las tablas de multiplicar. Pensado para tablet o celular: botones grandes, sin login, ranking guardado en el dispositivo.

## Cómo correrlo

Es un sitio estático, no necesita build. Para probar en la compu:

```sh
cd aprendejugando
python3 -m http.server 8080
```

y abrir <http://localhost:8080>. Desde la tablet, en la misma red wifi, abrir `http://<ip-de-la-compu>:8080` (si la compu tiene firewall, abrir el puerto: `sudo ufw allow 8080/tcp`).

Para dejarlo instalado como app en la tablet: publicarlo en cualquier hosting estático (GitHub Pages, Cloudflare Pages, Netlify), abrir la URL en Safari/Chrome y elegir «Agregar a pantalla de inicio». Funciona sin conexión después de la primera carga.

## Archivos

```
index.html              pantallas: menú, juego, fin, ranking, detalle de un puntaje
style.css
app.js                  lógica del juego
manifest.webmanifest    datos de la app (ícono, nombre)
sw.js                   caché para jugar sin conexión
icon.svg
```

## Reglas

- Se elige qué tablas practicar (2 a 9, se recuerda la elección).
- Cada pregunta tiene 4 opciones y un tiempo límite que empieza en 10 s. Al subir de nivel (cada 5 aciertos) el límite se ajusta al promedio de respuesta de ese nivel: apunta a 1,6 veces el promedio, pero por nivel baja como mucho 15 % y como mínimo 3 % del límite actual. Nunca sube. Mínimo 1,2 s.
- Puntos por acierto: 100 fijos + bonus según cuánto tiempo sobró, multiplicado por la dificultad (10 s dividido el límite actual): a 2,5 s por pregunta cada acierto vale hasta 4 veces más.
- Cada 5 aciertos sube un nivel.
- Se pierde al responder mal o al quedarse sin tiempo.
- Modo práctica («Practicar»): no se pierde. Al fallar o quedarse sin tiempo, suena el error, se muestra la respuesta correcta, el tiempo se afloja un 10 % y sigue. Termina con «Terminar práctica» y no entra al ranking.
- Ranking local con los 10 mejores puntajes (`localStorage`).
- Cada fila del ranking tiene un botón de compartir (también sirve tocar la fila) que abre una tarjeta en grande para sacarle captura o compartirla. El botón «Compartir» genera una imagen PNG (1080×1350) y usa el menú de compartir del dispositivo; si no está disponible, copia el texto al portapapeles.

Los números se ajustan en `CFG`, al principio de `app.js`.

El menú muestra la versión (`APP_VERSION` en `app.js`). En cada publicación, subirla junto con `VERSION` en `sw.js`; así se sabe si el dispositivo ya tomó la versión nueva.

## Estadísticas anónimas

El juego manda eventos a un Worker de Cloudflare (`stats/`) con base D1: `visita` (apertura de la app), `partida` (modo, puntos, aciertos, errores, nivel, motivo, duración, tablas, tiempo límite final) , `sesion` (tiempo en pantalla, tiempo jugando, partidas) y `compartir` (método: imagen, texto, portapapeles o cancelado). Identifica al dispositivo con un id aleatorio guardado en `localStorage`; no hay cookies ni datos personales. No se mide cuando se juega desde `localhost` o una IP de red local. Para apagarlo, dejar `STATS_URL` vacío en `app.js`.

- Panel: `https://aprendejugando-stats.cavassinif.workers.dev/dash?k=<clave>&dias=30` (la clave está en `stats/.dev.vars`, fuera de git).
- JSON: mismo host, `/stats?k=<clave>&dias=30`. `dias=0` es todo el histórico.
- Deploy del Worker: `cd stats && npx wrangler deploy`. Esquema: `stats/schema.sql`.
