// start.js
import { existsSync, statSync, createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { spawn } from 'child_process';
import path from 'path';

// Detect if running on Render (check for RENDER env var or specific path)
const isRender = process.env.RENDER === 'true' || existsSync('/opt/render');
const baseDir = isRender ? '/opt/render/project/src/brouter' : path.join(process.cwd(), 'brouter');

// On Render, ignore Windows paths from .env and use Linux paths instead
const BROUTER_DIR  = isRender ? baseDir : (process.env.BROUTER_DIR || baseDir);
const TILES_DIR    = isRender ? '/opt/render/project/src/segments4' : (process.env.TILES_DIR || path.join(process.cwd(), 'segments4'));
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
const BROUTER_JAR  = isRender ? path.join(BROUTER_DIR, 'brouter.jar') : (process.env.BROUTER_JAR || path.join(BROUTER_DIR, 'brouter.jar'));
const PROFILES_DIR = isRender ? path.join(BROUTER_DIR, 'profiles2') : (process.env.PROFILES_DIR || path.join(BROUTER_DIR, 'profiles2'));
const JAVA_BIN     = isRender ? path.join(BROUTER_DIR, 'jre', 'bin', 'java') : (process.env.JAVA_BIN || path.join(BROUTER_DIR, 'jre', 'bin', 'java'));
const BROUTER_PORT = parseInt(process.env.BROUTER_INTERNAL_PORT || '17777', 10);
const JAVA_XMX     = process.env.JAVA_XMX || '900m';
const JAVA_XMS     = process.env.JAVA_XMS || '256m';
const BROUTER_MAX_THREADS = parseInt(process.env.BROUTER_MAX_THREADS || '1', 10);

const TILES = [
  'W80_S5.rd5',  // Pacifico, Narino sur (lat -5 a 0)
  'W75_S5.rd5',  // Bogota sur, Putumayo (lat -5 a 0)
  'W70_S5.rd5',  // Amazonia sur (lat -5 a 0)
  'W80_N0.rd5',  // Valle del Cauca, Cauca (lat 0 a 5)
  'W75_N0.rd5',  // Antioquia, Medellin (lat 0 a 5)
  'W70_N0.rd5',  // Amazonia (lat 0 a 5)
  'W75_N5.rd5',  // Costa Caribe, Barranquilla (lat 5 a 10)
  'W70_N5.rd5',  // Guajira, Cesar (lat 5 a 10)
];

async function downloadTile(filename) {
  const localPath = path.join(TILES_DIR, filename);
  if (existsSync(localPath) && statSync(localPath).size > 100_000) return;

  const r2Url = `${R2_PUBLIC_URL}/${filename}`;
  console.log(`[start] ⬇️  Descargando ${filename}...`);

  let res = await fetch(r2Url).catch((err) => {
    console.warn(`[start] ⚠️  R2 error para ${filename}: ${err.message}`);
    return null;
  });

  if (!res || !res.ok) {
    if (res) {
      console.warn(`[start] ⚠️  R2 HTTP ${res.status} para ${filename} (${r2Url})`);
    }
    console.warn(`[start] ℹ️  Fallback a brouter.de...`);
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
  console.log(`[start] ℹ️  JAR: ${BROUTER_JAR}`);
  console.log(`[start] ℹ️  TILES_DIR: ${TILES_DIR}`);
  console.log(`[start] ℹ️  PROFILES_DIR: ${PROFILES_DIR}`);
  console.log(`[start] ℹ️  JAVA_BIN: ${JAVA_BIN}`);

  // Try with -jar first, then fallback to -cp if needed
  const proc = spawn(JAVA_BIN, [
    `-Xmx${JAVA_XMX}`,
    `-Xms${JAVA_XMS}`,
    '-jar', BROUTER_JAR,
    TILES_DIR,
    PROFILES_DIR,
    PROFILES_DIR, // custom profile dir (reuse same dir)
    String(BROUTER_PORT),
    String(BROUTER_MAX_THREADS), // max threads
    '0.0.0.0', // bind address
  ], { stdio: ['ignore', 'inherit', 'inherit'] });

  proc.on('error', err => {
    console.error('[start] ❌ Error al lanzar Java:', err.message);
    console.error('[start] ℹ️  Verifica que JAVA_BIN existe y el JAR contiene un Main-Class o btools.server.RouteServer');
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