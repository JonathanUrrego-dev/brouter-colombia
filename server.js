// server.js
import http from 'http';
import { downloadAllTiles, launchBRouter, waitForBRouter } from './start.js';

const PUBLIC_PORT      = parseInt(process.env.PORT                    || '10000', 10);
const BROUTER_INT_PORT = parseInt(process.env.BROUTER_INTERNAL_PORT   || '17777',  10);
const KEEPALIVE_URL    = process.env.KEEPALIVE_URL;                    // URL completa a la que hacer ping
const KEEPALIVE_MIN    = parseInt(process.env.KEEPALIVE_INTERVAL_MIN  || '10',    10); // minutos entre pings

// ─── Proxy hacia BRouter ─────────────────────────────────────────────────────

function proxyToBRouter(req, res) {
  const options = {
    hostname: 'localhost',
    port:     BROUTER_INT_PORT,
    path:     req.url,
    method:   req.method,
    headers:  { ...req.headers, host: `localhost:${BROUTER_INT_PORT}` },
  };

  const proxy = http.request(options, upstream => {
    res.writeHead(upstream.statusCode, upstream.headers);
    upstream.pipe(res, { end: true });
  });

  proxy.on('error', err => {
    console.error('[proxy] Error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end(JSON.stringify({ error: 'BRouter no disponible', detail: err.message }));
    }
  });

  req.pipe(proxy, { end: true });
}

// ─── Keepalive ───────────────────────────────────────────────────────────────
// Render duerme servicios gratuitos tras 15 min sin tráfico.
// Configura KEEPALIVE_URL y KEEPALIVE_INTERVAL_MIN en el .env para controlarlo.

function startKeepAlive() {
  if (!KEEPALIVE_URL) {
    console.warn('[keepalive] KEEPALIVE_URL no definida, keepalive desactivado');
    return;
  }

  const INTERVAL_MS = KEEPALIVE_MIN * 60 * 1000;

  // Primer ping tras 2 min (esperar a que todo arranque)
  setTimeout(async function ping() {
    try {
      const res = await fetch(KEEPALIVE_URL, { signal: AbortSignal.timeout(15_000) });
      console.log(res.ok
        ? `[keepalive] ✅ OK ${new Date().toISOString()}`
        : `[keepalive] ⚠️  HTTP ${res.status}`
      );
    } catch (err) {
      console.warn(`[keepalive] ⚠️  ${err.message}`);
    }
    setTimeout(ping, INTERVAL_MS);
  }, 2 * 60 * 1000);

  console.log(`[keepalive] 🔁 Activo — ping cada ${KEEPALIVE_MIN} min a ${KEEPALIVE_URL}`);
}

// ─── Arranque ────────────────────────────────────────────────────────────────

async function main() {
  try {
    await downloadAllTiles();     // descarga desde R2 si faltan tiles
    launchBRouter();              // lanza el proceso Java
    await waitForBRouter();       // espera hasta que responda (máx 2 min)

    const server = http.createServer((req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', ts: Date.now() }));
        return;
      }
      proxyToBRouter(req, res);
    });

    server.listen(PUBLIC_PORT, () => {
      console.log(`[server] 🌐 Escuchando en puerto ${PUBLIC_PORT}`);
    });

    startKeepAlive();

  } catch (err) {
    console.error('[main] ❌ Error fatal:', err.message);
    process.exit(1);
  }
}

main();