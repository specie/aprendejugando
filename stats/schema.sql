CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,        -- ms epoch, hora del servidor
  cid TEXT NOT NULL,          -- id anónimo del dispositivo (uuid aleatorio en localStorage)
  sid TEXT NOT NULL,          -- id de la sesión (cada apertura de la app)
  tipo TEXT NOT NULL,         -- visita | partida | sesion | compartir
  datos TEXT                  -- JSON con los detalles del evento
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_tipo_ts ON events(tipo, ts);
CREATE INDEX IF NOT EXISTS idx_events_sid ON events(sid);
