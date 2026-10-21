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
index.html              pantallas: menú, juego, fin, ranking
style.css
app.js                  lógica del juego
manifest.webmanifest    datos de la app (ícono, nombre)
sw.js                   caché para jugar sin conexión
icon.svg
```

## Reglas

- Se elige qué tablas practicar (2 a 9, se recuerda la elección).
- Cada pregunta tiene 4 opciones y un tiempo límite que empieza en 10 s y baja 0,25 s por pregunta, hasta un mínimo de 3 s.
- Puntos por acierto: 100 fijos + hasta 100 de bonus según cuánto tiempo sobró.
- Cada 5 aciertos sube un nivel.
- Se pierde al responder mal o al quedarse sin tiempo.
- Ranking local con los 10 mejores puntajes (`localStorage`).

Los números se ajustan en `CFG`, al principio de `app.js`.
