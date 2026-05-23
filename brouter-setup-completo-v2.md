# 🚴 BRouter en Render — Guía de implementación

BRouter auto-hosteado · Node.js nativo · tiles en Cloudflare R2 · keepalive integrado · fallback automático

---

## Arquitectura final

```
Tu app React Native
       │
       ▼
  Tu backend (Render)
       │
       ├─ 1° BRouter   ← tu servidor propio con tiles en R2
       ├─ 2° Valhalla  ← el que ya usas
       └─ 3° OSRM      ← el que ya usas
```

Cuando cualquiera falla, pasa automáticamente al siguiente.

---

## Archivos del proyecto

```
brouter-server/
├── server.js          ← servidor: proxy HTTP + keepalive
├── start.js           ← descarga tiles desde R2 y lanza el JAR de Java
├── build.sh           ← instala Java y descarga BRouter (corre en Render al deployar)
├── package.json
└── .env.example

scripts/               ← corres esto una sola vez desde tu máquina
└── upload-tiles-to-r2.js

src/services/
└── routing.js         ← cliente con fallback para tu app React Native
```

---

---

# 👤 LO QUE HACES TÚ

> Pasos manuales: configurar infraestructura en Cloudflare y Render, correr el script de tiles, y probar que todo funciona.

---

## Paso 1 — Bucket R2 en Cloudflare

1. Ve a **dash.cloudflare.com → R2 → Create bucket**
2. Nombre: `brouter-tiles`
3. Settings del bucket → **Public access → Enable**
4. Anota la URL pública: `https://pub-XXXXXXXX.r2.dev`

---

## Paso 2 — Worker de upload en Cloudflare

El Worker recibe los tiles desde tu máquina y los escribe en R2. Solo lo usas una vez para subir los tiles.

**2.1 Crear el Worker**

1. **dash.cloudflare.com → Workers & Pages → Create application → Worker**
2. Nombre: `brouter-tiles-uploader`
3. Pega este código y haz **Deploy**:

```javascript
export default {
  async fetch(request, env) {
    if (request.method !== 'PUT') {
      return new Response('Method not allowed', { status: 405 });
    }

    const secret = request.headers.get('X-Upload-Secret');
    if (secret !== env.UPLOAD_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    const url = new URL(request.url);
    const key = url.pathname.replace(/^\//, '');

    if (!key || !key.endsWith('.rd5')) {
      return new Response('Key inválido', { status: 400 });
    }

    const existing = await env.BROUTER_TILES.head(key);
    if (existing) {
      return Response.json({ ok: true, skipped: true, key });
    }

    const body = await request.arrayBuffer();
    await env.BROUTER_TILES.put(key, body, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });

    return Response.json({ ok: true, skipped: false, key, bytes: body.byteLength });
  },
};
```

**2.2 Configurar el Worker**

En la página del Worker → **Settings → Bindings → Add:**
- Tipo: `R2 Bucket`
- Variable name: `BROUTER_TILES`
- Bucket: `brouter-tiles`

En **Settings → Variables → Add:**
- `UPLOAD_SECRET` = una cadena aleatoria larga (ej: `uLk9X2mQr8...`). **Anótala.**

Anota también la URL del Worker:
`https://brouter-tiles-uploader.TU-SUBDOMINIO.workers.dev`

---

## Paso 3 — Subir los tiles a R2

Corre esto **una sola vez** desde tu máquina. Descarga los tiles de Colombia y los sube al Worker.

```bash
# Node 18+ incluye fetch nativo, sin instalar nada
WORKER_URL=https://brouter-tiles-uploader.TU-SUBDOMINIO.workers.dev \
UPLOAD_SECRET=tu_secret \
  node scripts/upload-tiles-to-r2.js
```

Cuando termine verás algo como:
```
✅ E-75_N-5.rd5 subido a R2 (48.2 MB)
✅ E-80_N-5.rd5 subido a R2 (31.7 MB)
...
🎉 Proceso terminado.
```

Verifica que los tiles están en tu bucket abriendo en el browser:
`https://pub-XXXXXXXX.r2.dev/E-75_N-5.rd5`

---

## Paso 4 — Crear el servicio en Render

1. **render.com → New → Web Service**
2. Conecta tu repo de GitHub con los archivos del proyecto
3. Configuración:
   - **Runtime:** `Node` ← no Docker
   - **Build Command:** `bash build.sh`
   - **Start Command:** `node server.js`
   - **Health Check Path:** `/health`

**Variables de entorno** (Render → Environment → Add):

```
R2_PUBLIC_URL         = https://pub-XXXXXXXX.r2.dev
BROUTER_INTERNAL_PORT = 17777
BROUTER_JAR           = /opt/brouter/brouter.jar
PROFILES_DIR          = /opt/brouter/profiles2
TILES_DIR             = /opt/render/project/src/segments4
JAVA_XMX              = 900m
JAVA_XMS              = 256m
```

> `PORT` y `RENDER_EXTERNAL_URL` los inyecta Render automáticamente, no los agregues.

---

## Paso 5 — Probar todo en local antes de subir a Render

Esto te ahorra ciclos de deploy. Necesitas Java instalado en tu máquina.

**5.1 Instalar Java si no lo tienes**

```bash
# macOS
brew install openjdk@17

# Ubuntu / Debian
sudo apt install default-jre-headless
```

**5.2 Descargar BRouter JAR y perfiles manualmente**

```bash
mkdir -p /opt/brouter/profiles2

# JAR principal
curl -L "https://github.com/abrensch/brouter/releases/latest/download/brouter.jar" \
  -o /opt/brouter/brouter.jar

# Perfiles de ciclismo
BASE="https://raw.githubusercontent.com/abrensch/brouter/master/misc/profiles2"
for profile in trekking fastbike mountainbike safety shortest; do
  curl -sL "${BASE}/${profile}.brf" -o "/opt/brouter/profiles2/${profile}.brf"
done
```

**5.3 Crear tu `.env` local**

```bash
cp .env.example .env
```

Edita `.env` con estos valores para local:

```bash
R2_PUBLIC_URL=https://pub-XXXXXXXX.r2.dev   # tu URL real de R2
BROUTER_INTERNAL_PORT=17777
BROUTER_JAR=/opt/brouter/brouter.jar
PROFILES_DIR=/opt/brouter/profiles2
TILES_DIR=./segments4                        # carpeta local, no la de Render
JAVA_XMX=900m
JAVA_XMS=256m
PORT=10000
KEEPALIVE_URL=http://localhost:10000/health
KEEPALIVE_INTERVAL_MIN=10
```

**5.4 Arrancar el servidor**

```bash
node server.js
```

Deberías ver esto en consola (la primera vez descarga los tiles desde R2, tarda ~1 min):

```
[start] 🗺️  Verificando tiles de Colombia...
[start] ⬇️  Descargando E-75_N-5.rd5...
[start] ✅ E-75_N-5.rd5 listo
...
[start] ✅ Todos los tiles listos
[start] 🚀 Lanzando BRouter en puerto interno 17777...
[start] ⏳ Esperando que BRouter esté listo...
[start] ✅ BRouter responde correctamente
[server] 🌐 Escuchando en puerto 10000
[keepalive] 🔁 Activo — ping cada 10 min a http://localhost:10000/health
```

**5.5 Verificar en otra terminal**

```bash
# Health check
curl http://localhost:10000/health
# → {"status":"ok","ts":1234567890}

# Ruta rápida (fastbike) — Bogotá centro a Usaquén
curl "http://localhost:10000/brouter?\
lonlats=-74.0721,4.7109|-74.0536,4.7005\
&profile=fastbike&alternativeidx=0&format=geojson"

# Ruta de ciclomontaña / trochas (trekking)
curl "http://localhost:10000/brouter?\
lonlats=-74.0721,4.7109|-74.0536,4.7005\
&profile=trekking&alternativeidx=0&format=geojson"

# Ruta alternativa (BRouter devuelve hasta 3 alternativas con alternativeidx=1,2)
curl "http://localhost:10000/brouter?\
lonlats=-74.0721,4.7109|-74.0536,4.7005\
&profile=trekking&alternativeidx=1&format=geojson"
```

Respuesta esperada en todos: GeoJSON con `features[0].geometry.coordinates` y propiedades `track-length` y `total-time`.

**5.6 Probar el fallback**

Detén el servidor (`Ctrl+C`) y prueba `routing.js` apuntando a una URL inexistente para confirmar que cae a Valhalla → OSRM:

```bash
BROUTER_URL=http://localhost:9999 node -e "
import('./src/services/routing.js').then(({ getRoute }) =>
  getRoute({ latitude: 4.7109, longitude: -74.0721 },
            { latitude: 4.7005, longitude: -74.0536 })
  .then(r => console.log('Motor usado:', r.usedEngine))
  .catch(console.error)
)
"
# → Motor usado: valhalla
```

Si todo funciona local → puedes deployar a Render con confianza.

---

## Paso 6 — Deployar en Render

Sube el código a GitHub y crea el Web Service (ver configuración en la sección de Render más arriba). El primer deploy tarda ~2-3 min.

Verifica en producción:

```bash
curl https://brouter-colombia.onrender.com/health
# → {"status":"ok","ts":...}
```

---

## Paso 7 — URLs para tu app React Native

### Qué endpoint usar según el tipo de ruta

BRouter expone un solo endpoint `/brouter`. El tipo de ruta lo controla el parámetro `profile`:

| Lo que quiere el usuario | `profile` | Descripción |
|--------------------------|-----------|-------------|
| Ruta más rápida en calle / ciclovía | `fastbike` | Prioriza velocidad, evita subidas |
| Ruta de cicloturismo / trocha / parque | `trekking` | Acepta cualquier vía, equilibrada |
| MTB / montaña / senderos | `mountainbike` | Prioriza senderos, acepta terreno difícil |
| Ruta segura, calles tranquilas | `safety` | Evita vías de alto tráfico |
| La más corta sin importar nada | `shortest` | Distancia mínima |

### Formato de la URL

```
GET /brouter
  ?lonlats=LON_INICIO,LAT_INICIO|LON_FIN,LAT_FIN
  &profile=PERFIL
  &alternativeidx=0
  &format=geojson
```

> Los waypoints van en orden `longitud,latitud` (al revés de React Native que usa `latitude,longitude`). El `|` separa puntos. Puedes encadenar más de 2 puntos para rutas con paradas intermedias.

### Casos de uso desde React Native

**Caso 1 — Ruta más rápida**

```javascript
// En routing.js, BRouter con perfil fastbike es la ruta más rápida
const PROFILES = {
  brouter: 'fastbike',   // ← cambiar aquí
  ...
}

// O llamar directo:
const url =
  `${BROUTER_URL}/brouter` +
  `?lonlats=${start.longitude},${start.latitude}|${end.longitude},${end.latitude}` +
  `&profile=fastbike&alternativeidx=0&format=geojson`;
```

**Caso 2 — Ruta como la dibujó el usuario (waypoints intermedios)**

Si el usuario toca puntos intermedios en el mapa, pasas todos los puntos encadenados con `|`:

```javascript
/**
 * @param {{ latitude: number, longitude: number }[]} waypoints
 *   Array de puntos en orden: [inicio, ...intermedios, fin]
 * @param {'trekking'|'fastbike'|'mountainbike'|'safety'|'shortest'} profile
 */
async function routeWithWaypoints(waypoints, profile = 'trekking') {
  // BRouter espera: lon,lat|lon,lat|lon,lat
  const lonlats = waypoints
    .map(p => `${p.longitude},${p.latitude}`)
    .join('|');

  const url =
    `${BROUTER_URL}/brouter` +
    `?lonlats=${lonlats}` +
    `&profile=${profile}` +
    `&alternativeidx=0` +
    `&format=geojson`;

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`BRouter HTTP ${res.status}`);

  const data = await res.json();
  const feature = data.features[0];

  return {
    // Coordenadas en formato React Native / react-native-maps
    coordinates: feature.geometry.coordinates.map(([lng, lat]) => ({
      latitude: lat,
      longitude: lng,
    })),
    distanceKm:  feature.properties['track-length'] / 1000,
    durationMin: feature.properties['total-time']   / 60,
  };
}

// Ejemplo de uso — el usuario dibujó 4 puntos en el mapa:
const ruta = await routeWithWaypoints([
  { latitude: 4.7109, longitude: -74.0721 },  // inicio
  { latitude: 4.7200, longitude: -74.0650 },  // punto intermedio 1
  { latitude: 4.7150, longitude: -74.0580 },  // punto intermedio 2
  { latitude: 4.7005, longitude: -74.0536 },  // fin
], 'trekking');

setRouteCoords(ruta.coordinates); // directo a react-native-maps Polyline
```

**Caso 3 — Ofrecer al usuario varias alternativas de ruta**

BRouter puede devolver hasta 3 alternativas para el mismo origen/destino. Las obtienes cambiando `alternativeidx`:

```javascript
async function getAllAlternatives(start, end, profile = 'trekking') {
  const base =
    `${BROUTER_URL}/brouter` +
    `?lonlats=${start.longitude},${start.latitude}|${end.longitude},${end.latitude}` +
    `&profile=${profile}&format=geojson`;

  // Pedir las 3 alternativas en paralelo
  const results = await Promise.allSettled([
    fetch(`${base}&alternativeidx=0`).then(r => r.json()),
    fetch(`${base}&alternativeidx=1`).then(r => r.json()),
    fetch(`${base}&alternativeidx=2`).then(r => r.json()),
  ]);

  return results
    .filter(r => r.status === 'fulfilled')
    .map((r, i) => {
      const feature = r.value.features[0];
      return {
        index:       i,
        coordinates: feature.geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
        distanceKm:  feature.properties['track-length'] / 1000,
        durationMin: feature.properties['total-time']   / 60,
      };
    });
}

// Uso:
const alternativas = await getAllAlternatives(inicio, fin, 'trekking');
// → array de hasta 3 rutas, muéstraselas al usuario para que elija
```

### URL base según entorno

```javascript
// En tu app React Native o backend
const BROUTER_URL = __DEV__
  ? 'http://localhost:10000'                      // local
  : 'https://brouter-colombia.onrender.com';      // producción
```

O con variable de entorno (Expo):
```bash
# .env
EXPO_PUBLIC_BROUTER_URL=https://brouter-colombia.onrender.com
```

```javascript
const BROUTER_URL = process.env.EXPO_PUBLIC_BROUTER_URL || 'http://localhost:10000';
```

---

## Paso 8 — Agregar BROUTER_URL a tu backend principal

En tu backend ya desplegado en Render → Environment → Add:

```
BROUTER_URL = https://brouter-colombia.onrender.com
```

Reinicia el servicio para que tome la variable.

---

---

# 🤖 LO QUE HACE LA IA

> Todos los archivos de código del proyecto. Dáselos a la IA con este contexto:
> *"Implementa el servidor BRouter en Node.js según esta guía. Sin Docker, sin ORS."*

---

## `package.json`

```json
{
  "name": "brouter-server",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node server.js",
    "upload-tiles": "node scripts/upload-tiles-to-r2.js"
  },
  "dependencies": {}
}
```

Sin dependencias npm. Todo usa APIs nativas de Node 18.

---

## `build.sh`

Render lo corre una vez al hacer deploy. Instala Java y descarga el JAR de BRouter.

```bash
#!/bin/bash
set -e

echo "📦 Instalando Java..."
apt-get update -qq && apt-get install -y -qq default-jre-headless

echo "📥 Descargando BRouter JAR..."
mkdir -p /opt/brouter/profiles2

curl -sL "https://github.com/abrensch/brouter/releases/latest/download/brouter.jar" \
  -o /opt/brouter/brouter.jar

PROFILES_BASE="https://raw.githubusercontent.com/abrensch/brouter/master/misc/profiles2"
for profile in trekking fastbike mountainbike safety shortest; do
  curl -sL "${PROFILES_BASE}/${profile}.brf" \
    -o "/opt/brouter/profiles2/${profile}.brf"
done

echo "✅ Build listo"
```

---

## `start.js`

Descarga los tiles desde R2 (si no existen) y lanza el JAR de Java como subprocess.

```javascript
// start.js
import { existsSync, statSync, createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { spawn } from 'child_process';
import path from 'path';

const TILES_DIR    = process.env.TILES_DIR    || '/opt/render/project/src/segments4';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
const BROUTER_JAR  = process.env.BROUTER_JAR  || '/opt/brouter/brouter.jar';
const PROFILES_DIR = process.env.PROFILES_DIR || '/opt/brouter/profiles2';
const BROUTER_PORT = parseInt(process.env.BROUTER_INTERNAL_PORT || '17777', 10);
const JAVA_XMX     = process.env.JAVA_XMX || '900m';
const JAVA_XMS     = process.env.JAVA_XMS || '256m';

const TILES = [
  'W80_N-5.rd5',  // Pacífico, Nariño
  'W75_N-5.rd5',  // Bogotá, Eje Cafetero  ← el más importante
  'W70_N-5.rd5',  // Llanos, Orinoquía
  'W80_N0.rd5',   // Valle del Cauca, Cauca
  'W75_N0.rd5',   // Antioquia, Medellín
  'W70_N0.rd5',   // Amazonía
  'W75_N5.rd5',   // Costa Caribe, Barranquilla
  'W70_N5.rd5',   // Guajira, Cesar
];

async function downloadTile(filename) {
  const localPath = path.join(TILES_DIR, filename);
  if (existsSync(localPath) && statSync(localPath).size > 100_000) return;

  const r2Url = `${R2_PUBLIC_URL}/${filename}`;
  console.log(`[start] ⬇️  Descargando ${filename}...`);

  let res = await fetch(r2Url).catch(() => null);

  if (!res || !res.ok) {
    console.warn(`[start] ⚠️  R2 falló para ${filename}, intentando brouter.de...`);
    res = await fetch(`https://brouter.de/brouter/segments4/${filename}`);
  }

  if (!res.ok) throw new Error(`No se pudo descargar ${filename} (HTTP ${res.status})`);

  await pipeline(res.body, createWriteStream(localPath));
  console.log(`[start] ✅ ${filename} listo`);
}

export async function downloadAllTiles() {
  if (!R2_PUBLIC_URL) throw new Error('Variable R2_PUBLIC_URL no configurada');

  await mkdir(TILES_DIR, { recursive: true });
  console.log('[start] 🗺️  Verificando tiles de Colombia...');

  const missing = TILES.filter(t => {
    const p = path.join(TILES_DIR, t);
    return !existsSync(p) || statSync(p).size < 100_000;
  });

  if (missing.length === 0) {
    console.log('[start] ✅ Todos los tiles ya están disponibles');
    return;
  }

  console.log(`[start] ⬇️  Faltan ${missing.length} tiles, descargando...`);
  for (const tile of missing) {
    await downloadTile(tile);
  }
  console.log('[start] ✅ Todos los tiles listos');
}

export function launchBRouter() {
  console.log(`[start] 🚀 Lanzando BRouter en puerto interno ${BROUTER_PORT}...`);

  const proc = spawn('java', [
    `-Xmx${JAVA_XMX}`,
    `-Xms${JAVA_XMS}`,
    '-jar', BROUTER_JAR,
    TILES_DIR,
    String(BROUTER_PORT),
    PROFILES_DIR,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });

  proc.on('error', err => {
    console.error('[start] ❌ Error al lanzar Java:', err.message);
    process.exit(1);
  });

  proc.on('exit', (code, signal) => {
    console.error(`[start] ❌ BRouter salió con código ${code} / señal ${signal}`);
    process.exit(code ?? 1);
  });

  return proc;
}

export async function waitForBRouter(timeoutMs = 120_000) {
  const healthUrl =
    `http://localhost:${BROUTER_PORT}/brouter` +
    `?lonlats=-74.0721,4.7109|-74.0536,4.7005` +
    `&profile=trekking&alternativeidx=0&format=geojson`;

  const deadline = Date.now() + timeoutMs;
  console.log('[start] ⏳ Esperando que BRouter esté listo...');

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        console.log('[start] ✅ BRouter responde correctamente');
        return;
      }
    } catch { /* sigue esperando */ }
    await new Promise(r => setTimeout(r, 3000));
  }

  throw new Error('BRouter no respondió en el tiempo límite');
}
```

---

## `server.js`

El único proceso que Render ejecuta. Hace todo: descarga tiles, lanza Java, levanta el proxy HTTP y activa el keepalive.

```javascript
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
```

---

## `scripts/upload-tiles-to-r2.js`

Solo se corre una vez desde la máquina local. Descarga los tiles de brouter.de y los sube al Worker de Cloudflare.

```javascript
// scripts/upload-tiles-to-r2.js
import { createWriteStream, existsSync, statSync } from 'fs';
import { mkdir, readFile } from 'fs/promises';
import { pipeline } from 'stream/promises';
import path from 'path';

const WORKER_URL    = process.env.WORKER_URL;
const UPLOAD_SECRET = process.env.UPLOAD_SECRET;

const TILES = [
  'W80_N-5.rd5',  // Pacífico, Nariño
  'W75_N-5.rd5',  // Bogotá, Eje Cafetero  ← el más importante
  'W70_N-5.rd5',  // Llanos, Orinoquía
  'W80_N0.rd5',   // Valle del Cauca, Cauca
  'W75_N0.rd5',   // Antioquia, Medellín
  'W70_N0.rd5',   // Amazonía
  'W75_N5.rd5',   // Costa Caribe, Barranquilla
  'W70_N5.rd5',   // Guajira, Cesar
];

const BROUTER_BASE = 'https://brouter.de/brouter/segments4';
const LOCAL_DIR    = './tiles-temp';

async function downloadTile(filename) {
  const localPath = path.join(LOCAL_DIR, filename);
  if (existsSync(localPath) && statSync(localPath).size > 0) {
    console.log(`📦 ${filename} ya existe localmente`);
    return localPath;
  }

  console.log(`⬇️  Descargando ${filename} desde brouter.de...`);
  const res = await fetch(`${BROUTER_BASE}/${filename}`);
  if (!res.ok) throw new Error(`brouter.de respondió ${res.status}`);

  await pipeline(res.body, createWriteStream(localPath));
  console.log(`✅ Descargado (${(statSync(localPath).size / 1024 / 1024).toFixed(1)} MB)`);
  return localPath;
}

async function uploadTile(filename, localPath) {
  console.log(`☁️  Subiendo ${filename} al Worker...`);

  const fileBuffer = await readFile(localPath);
  const res = await fetch(`${WORKER_URL}/${filename}`, {
    method:  'PUT',
    headers: {
      'Content-Type':    'application/octet-stream',
      'X-Upload-Secret': UPLOAD_SECRET,
    },
    body: fileBuffer,
  });

  if (!res.ok) throw new Error(`Worker respondió ${res.status}: ${await res.text()}`);

  const json = await res.json();
  if (json.skipped) {
    console.log(`⏭️  ${filename} ya estaba en R2\n`);
  } else {
    console.log(`✅ ${filename} en R2 (${(json.bytes / 1024 / 1024).toFixed(1)} MB)\n`);
  }
}

async function main() {
  if (!WORKER_URL || !UPLOAD_SECRET) {
    console.error('❌ Faltan variables WORKER_URL y/o UPLOAD_SECRET');
    process.exit(1);
  }

  await mkdir(LOCAL_DIR, { recursive: true });
  console.log(`🗺️  Subiendo ${TILES.length} tiles de Colombia...\n`);

  for (const tile of TILES) {
    try {
      const localPath = await downloadTile(tile);
      await uploadTile(tile, localPath);
    } catch (err) {
      console.error(`❌ Error con ${tile}: ${err.message}`);
    }
  }

  console.log('🎉 Proceso terminado.');
}

main().catch(console.error);
```

---

## `src/services/routing.js`

Cliente de routing con fallback para tu app React Native. Sin ORS.

```javascript
// src/services/routing.js

const BROUTER_URL  = process.env.BROUTER_URL  || '';
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de';
const OSRM_URL     = 'https://router.project-osrm.org';

const PROFILES = {
  brouter:  'trekking',
  valhalla: 'bicycle',
  osrm:     'bike',
};

const TIMEOUTS = {
  brouter:  10000,
  valhalla: 10000,
  osrm:     8000,
};

// ─── Motores ─────────────────────────────────────────────────────────────────

async function routeWithBRouter(start, end) {
  if (!BROUTER_URL) throw new Error('BROUTER_URL no configurada');

  const url =
    `${BROUTER_URL}/brouter` +
    `?lonlats=${start.longitude},${start.latitude}|${end.longitude},${end.latitude}` +
    `&profile=${PROFILES.brouter}&alternativeidx=0&format=geojson`;

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUTS.brouter) });
  if (!res.ok) throw new Error(`BRouter HTTP ${res.status}`);
  return normalizeBRouter(await res.json());
}

async function routeWithValhalla(start, end) {
  const res = await fetch(`${VALHALLA_URL}/route`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    signal:  AbortSignal.timeout(TIMEOUTS.valhalla),
    body: JSON.stringify({
      locations: [
        { lon: start.longitude, lat: start.latitude },
        { lon: end.longitude,   lat: end.latitude },
      ],
      costing: PROFILES.valhalla,
      costing_options: { bicycle: { bicycle_type: 'Mountain' } },
    }),
  });
  if (!res.ok) throw new Error(`Valhalla HTTP ${res.status}`);
  return normalizeValhalla(await res.json());
}

async function routeWithOSRM(start, end) {
  const url =
    `${OSRM_URL}/route/v1/${PROFILES.osrm}/` +
    `${start.longitude},${start.latitude};` +
    `${end.longitude},${end.latitude}` +
    `?overview=full&geometries=geojson&steps=true`;

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUTS.osrm) });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  return normalizeOSRM(await res.json());
}

// ─── Normalizadores ───────────────────────────────────────────────────────────

function normalizeBRouter(data) {
  const feature = data.features[0];
  const props   = feature.properties;
  return {
    coordinates: feature.geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
    distanceKm:  props['track-length'] / 1000,
    durationMin: props['total-time']   / 60,
  };
}

function normalizeValhalla(data) {
  const leg = data.trip.legs[0];
  return {
    coordinates: decodePolyline6(leg.shape),
    distanceKm:  data.trip.summary.length,
    durationMin: data.trip.summary.time / 60,
  };
}

function normalizeOSRM(data) {
  const route = data.routes[0];
  return {
    coordinates: route.geometry.coordinates.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
    distanceKm:  route.distance / 1000,
    durationMin: route.duration / 60,
  };
}

function decodePolyline6(encoded) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; }
    while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;

    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; }
    while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;

    coords.push({ latitude: lat / 1e6, longitude: lng / 1e6 });
  }
  return coords;
}

// ─── Cliente con fallback ────────────────────────────────────────────────────

const ENGINES = [
  { name: 'brouter',  fn: routeWithBRouter },
  { name: 'valhalla', fn: routeWithValhalla },
  { name: 'osrm',     fn: routeWithOSRM },
];

/**
 * @param {{ latitude: number, longitude: number }} start
 * @param {{ latitude: number, longitude: number }} end
 * @returns {Promise<{ coordinates, distanceKm, durationMin, usedEngine }>}
 */
export async function getRoute(start, end) {
  const errors = [];

  for (const engine of ENGINES) {
    try {
      console.log(`[routing] Intentando ${engine.name}...`);
      const route = await engine.fn(start, end);
      console.log(`[routing] ✅ ${engine.name}`);
      return { ...route, usedEngine: engine.name };
    } catch (err) {
      console.warn(`[routing] ⚠️ ${engine.name}: ${err.message}`);
      errors.push(`${engine.name}: ${err.message}`);
    }
  }

  throw new Error(`Todos los motores fallaron:\n${errors.join('\n')}`);
}
```

---

## `.env.example`

```bash
# URL pública del bucket R2
R2_PUBLIC_URL=https://pub-XXXXXXXX.r2.dev

# Puerto interno de BRouter (no se expone hacia afuera)
BROUTER_INTERNAL_PORT=17777

# Paths en el servidor de Render
BROUTER_JAR=/opt/brouter/brouter.jar
PROFILES_DIR=/opt/brouter/profiles2
TILES_DIR=/opt/render/project/src/segments4

# Memoria JVM
JAVA_XMX=900m
JAVA_XMS=256m

# Keepalive — URL completa a la que hacer ping para mantener el servicio vivo
# Puede ser tu propio /health o cualquier endpoint que responda rápido
KEEPALIVE_URL=https://brouter-colombia.onrender.com/health

# Intervalo del keepalive en minutos (por ahora 10)
KEEPALIVE_INTERVAL_MIN=10

# Render inyecta PORT automáticamente
```

---

---

# ✅ Checklist de despliegue

### Tú haces (infraestructura)
```
□ Crear bucket R2 con acceso público en Cloudflare
□ Crear Worker "brouter-tiles-uploader" con el código de arriba
□ Configurar binding R2 + variable UPLOAD_SECRET en el Worker
□ Correr: node scripts/upload-tiles-to-r2.js  (una sola vez)
□ Verificar tiles en R2: abrir pub-XXXXXXXX.r2.dev/E-75_N-5.rd5 en el browser
□ Probar todo en local (Paso 5) antes de subir a Render
□ Crear Web Service en Render: Runtime Node, build.sh, node server.js
□ Agregar variables de entorno en Render
□ Verificar /health en producción
□ Agregar BROUTER_URL en tu backend principal y reiniciar
```

### La IA hace (código)
```
□ package.json
□ build.sh
□ start.js
□ server.js
□ scripts/upload-tiles-to-r2.js
□ src/services/routing.js
```

### Tú pruebas (verificación)
```
□ Local: node server.js → ver logs de arranque completos
□ Local: curl http://localhost:10000/health → {"status":"ok"}
□ Local: probar los 3 perfiles (fastbike, trekking, mountainbike)
□ Local: probar fallback con BROUTER_URL apuntando a puerto inexistente
□ Producción: GET /health → {"status":"ok"}
□ Producción: ruta de prueba con curl
□ App: probar ruta más rápida (fastbike)
□ App: probar ruta con waypoints del usuario
□ App: confirmar que el fallback a Valhalla funciona si BRouter cae
```

---

## Variables de entorno — resumen

| Dónde | Variable | Valor |
|-------|----------|-------|
| Render (BRouter) | `R2_PUBLIC_URL` | `https://pub-XXXXXXXX.r2.dev` |
| Render (BRouter) | `BROUTER_INTERNAL_PORT` | `17777` |
| Render (BRouter) | `BROUTER_JAR` | `/opt/brouter/brouter.jar` |
| Render (BRouter) | `PROFILES_DIR` | `/opt/brouter/profiles2` |
| Render (BRouter) | `TILES_DIR` | `/opt/render/project/src/segments4` |
| Render (BRouter) | `JAVA_XMX` | `900m` |
| Render (BRouter) | `JAVA_XMS` | `256m` |
| Render (BRouter) | `KEEPALIVE_URL` | `https://brouter-colombia.onrender.com/health` |
| Render (BRouter) | `KEEPALIVE_INTERVAL_MIN` | `10` |
| Render (tu backend) | `BROUTER_URL` | `https://brouter-colombia.onrender.com` |
| Local (script tiles) | `WORKER_URL` | URL del Worker de Cloudflare |
| Local (script tiles) | `UPLOAD_SECRET` | Secret configurado en el Worker |
| Worker (Cloudflare) | `UPLOAD_SECRET` | Cadena aleatoria segura |